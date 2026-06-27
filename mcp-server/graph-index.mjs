/**
 * GenesisBlock graph layer on top of the SQLite relations.
 *
 * SQLite is the source of truth (apps / users / threads / messages).
 * GenesisBlock holds the same entities as graph nodes + edges, so we can run:
 *   - HQL: SEARCH text, TRAVERSE user→message, MATCH ...
 *   - neighbors(): walk who-talks-to-whom
 *   - (later) hybridSearch with embeddings for semantic search
 *
 * Mapping (stable string IDs so SQLite and Genesis stay aligned):
 *   app:<name>            -> app
 *   thread:<sqlite_id>    -> thread (one per row in threads table)
 *   user:<sqlite_id>      -> user/sender
 *   msg:<sqlite_id>       -> message
 *
 * Edges:
 *   IN_APP        thread -> app
 *   IN_THREAD     msg    -> thread
 *   SENT_BY       msg    -> user
 *   PARTICIPATES  user   -> thread
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// GenesisBlock lives outside the mcp-server tree; load via absolute path.
const GENESIS_PKG = "G:/GenesisBlock_Dev/GenesisBlock/index.js";

let _native = null;
function loadNative() {
  if (_native) return _native;
  _native = require(GENESIS_PKG);
  return _native;
}

const GRAPH_PATH = path.join(__dirname, "graph.db");

let _gdb = null;
export async function openGraph() {
  if (_gdb) return _gdb;
  const { GenesisDatabase } = loadNative();
  _gdb = GenesisDatabase.open({ path: GRAPH_PATH });
  return _gdb;
}

const appId    = (name) => `app:${name}`;
const threadId = (id)   => `thread:${id}`;
const userId   = (id)   => `user:${id}`;
const msgId    = (id)   => `msg:${id}`;

// BGE-M3 dimensions — multilingual, strong on Thai. Served by Ollama.
const EMBED_MODEL = "bge-m3";
const EMBED_DIM = 1024;
const COLLECTION = "messages";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

/** Get one embedding from Ollama. Returns a Float32Array of length EMBED_DIM. */
export async function embed(text) {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!Array.isArray(j.embedding) || j.embedding.length !== EMBED_DIM) {
    throw new Error(`unexpected embedding shape: ${j.embedding?.length}`);
  }
  return j.embedding;
}

/** Make sure the GenesisBlock collection exists with the right dim. Idempotent. */
async function ensureCollection() {
  const gdb = await openGraph();
  const cols = gdb.listCollections();
  if (cols.some((c) => c.name === COLLECTION)) return;
  await gdb.createCollection(COLLECTION, EMBED_MODEL, EMBED_DIM, "cosine", null, null, true);
}

/** Bulk-mirror everything in the SQLite relational DB into GenesisBlock. */
export async function rebuildFromSqlite(sqlite) {
  const gdb = await openGraph();

  const apps    = sqlite.prepare("SELECT id, name, pkg FROM apps").all();
  const threads = sqlite.prepare("SELECT id, app_id, name, is_group, message_count, first_msg, last_msg FROM threads").all();
  const users   = sqlite.prepare("SELECT id, name, message_count, first_seen, last_seen FROM users").all();
  const msgs    = sqlite.prepare("SELECT id, thread_id, sender_id, side, text, time, source FROM messages").all();
  const parts   = sqlite.prepare("SELECT thread_id, user_id FROM participants").all();

  const nodes = [];
  for (const a of apps) {
    nodes.push({ id: appId(a.name), labels: ["App"], props: { name: a.name, pkg: a.pkg || null } });
  }
  for (const t of threads) {
    nodes.push({
      id: threadId(t.id),
      labels: ["Thread", t.is_group ? "GroupChat" : "DirectChat"],
      props: { name: t.name, app_id: t.app_id, message_count: t.message_count,
               first_msg: t.first_msg, last_msg: t.last_msg },
    });
  }
  for (const u of users) {
    nodes.push({
      id: userId(u.id),
      labels: ["User"],
      props: { name: u.name, message_count: u.message_count,
               first_seen: u.first_seen, last_seen: u.last_seen },
    });
  }
  for (const m of msgs) {
    nodes.push({
      id: msgId(m.id),
      labels: ["Message", m.source === "noti" ? "Notification" : "ScreenLine"],
      props: { text: m.text, side: m.side, time: m.time,
               thread_id: m.thread_id, sender_id: m.sender_id, source: m.source },
    });
  }

  await gdb.bulkAddNodes(nodes);

  const edges = [];
  const appById = new Map(apps.map((a) => [a.id, a]));
  for (const t of threads) {
    const a = appById.get(t.app_id);
    if (a) edges.push({ from: threadId(t.id), to: appId(a.name), rel: "IN_APP" });
  }
  for (const m of msgs) {
    edges.push({ from: msgId(m.id), to: threadId(m.thread_id), rel: "IN_THREAD" });
    if (m.sender_id != null) {
      edges.push({ from: msgId(m.id), to: userId(m.sender_id), rel: "SENT_BY" });
    }
  }
  for (const p of parts) {
    edges.push({ from: userId(p.user_id), to: threadId(p.thread_id), rel: "PARTICIPATES" });
  }

  await gdb.bulkAddEdges(edges);
  await gdb.saveState();

  return {
    apps: apps.length,
    threads: threads.length,
    users: users.length,
    messages: msgs.length,
    nodes: nodes.length,
    edges: edges.length,
  };
}

/**
 * Generate embeddings for every Message node and stream them into the
 * `messages` collection. Idempotent — skips ones already vectorised.
 * Returns counts.
 */
export async function embedMessages(sqlite, { batchSize = 32, onProgress } = {}) {
  await ensureCollection();
  const gdb = await openGraph();

  // Build a list of (msg_id, text) that still need embeddings. To stay simple
  // and idempotent we re-add every time — `addVector` overwrites cleanly.
  const rows = sqlite.prepare("SELECT id, text FROM messages ORDER BY id").all();
  let done = 0, failed = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const embeds = await Promise.all(batch.map(async (r) => {
      try {
        const v = await embed(r.text);
        return { id: msgId(r.id), v };
      } catch (e) {
        failed++;
        return null;
      }
    }));
    for (const e of embeds) {
      if (!e) continue;
      try { await gdb.addVector(e.id, COLLECTION, e.v); done++; } catch { failed++; }
    }
    if (onProgress) onProgress({ done, failed, total: rows.length });
  }
  await gdb.flushIndex();
  await gdb.saveState();
  return { done, failed, total: rows.length, dim: EMBED_DIM, model: EMBED_MODEL };
}

/** Vector-only semantic search across stored messages. */
export async function searchSemantic(queryText, { k = 20 } = {}) {
  const gdb = await openGraph();
  const v = await embed(queryText);
  return gdb.hybridSearch({ queryVector: v, k, collection: COLLECTION, alpha: 1.0 });
}

/** Walk the neighbours of any node id we mirrored. */
export async function neighbors(seed, opts = {}) {
  const gdb = await openGraph();
  return gdb.neighbors(seed, {
    depth: opts.depth ?? 1,
    rel: opts.rel,
    direction: opts.direction || "any",
    limit: opts.limit ?? 50,
  });
}

/** Run any HQL string. The HTTP layer just forwards. */
export async function executeHql(query) {
  const gdb = await openGraph();
  return gdb.executeHql(query);
}

/** Live status / sanity for the dashboard. */
export async function statusSync() {
  const gdb = await openGraph();
  return gdb.statusSync();
}
