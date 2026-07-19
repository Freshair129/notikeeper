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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchLexical } from "./relations.mjs";
import { OLLAMA_URL } from "./config.mjs";

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
// We embed *conversational turns* (consecutive same-sender fragments coalesced),
// not raw message bubbles. The old per-message "messages" collection is left
// in place but unused — GenesisBlock has no deleteVector, so a new collection is
// the only way to drop the stale per-fragment vectors. See buildTurns().
const COLLECTION = "turns";
const TURNS_PATH = path.join(__dirname, "turns.json");

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
 * Coalesce raw message rows into *conversational turns* — the embedding unit.
 *
 * Why: the ADB scraper batch-captures one spoken burst as many tiny bubbles
 * ("เด็ก16" / "หลอกว่า19" / "วันนี้นัด…"), each at the same timestamp. Embedding
 * each bubble gives near-random 1024d vectors that pollute recall; merging them
 * into one turn restores semantic signal. (See the qdrant-search-quality skill:
 * splitting mid-sentence drops quality 30-40%.)
 *
 * What counts as embeddable: `scrape`-source rows only. The ADB scraper scrolls
 * the *interior* of a conversation, so scrape rows are clean dialogue with a real
 * sender + side. The other two sources are noise for retrieval and are dropped:
 *   - `screen` = the Messenger inbox/home accessibility dump ("Seen by…", "active
 *     now", "11:09 PM", "Chats, 12 unread, Tab 1 of 4") — UI chrome, not dialogue;
 *   - `noti`   = app notifications (weather, promos, GitHub) — app spam, and any
 *     real ones just duplicate the scraped dialogue.
 * Consecutive scrape rows with the same (thread, sender, side) within `windowMs`
 * merge into one turn; turns shorter than `minTurnChars` are dropped as too thin.
 * Returns [{ repId, ids, text, thread_id, sender_id, side, time }]. `repId` is the
 * first row's id — a real Message node, so hybridSearch resolves it.
 */
export function buildTurns(sqlite, { windowMs = 5 * 60 * 1000, minTurnChars = 8, minFragChars = 2 } = {}) {
  const rows = sqlite.prepare(
    "SELECT id, thread_id, sender_id, side, text, time, source FROM messages WHERE source='scrape' ORDER BY thread_id, time, id"
  ).all();

  const turns = [];
  let cur = null;
  const flush = () => { if (cur) { cur.text = cur.texts.join(" "); turns.push(cur); cur = null; } };

  for (const m of rows) {
    const txt = (m.text || "").trim();
    if (txt.length < minFragChars) continue;

    const sameSpeaker = cur && cur.thread_id === m.thread_id &&
      (cur.side || "") === (m.side || "") && cur.sender_id === m.sender_id;
    if (sameSpeaker && (m.time - cur.lastTime) <= windowMs) {
      if (!cur.texts.includes(txt)) cur.texts.push(txt);   // drop intra-turn dupes (noti vs scrape)
      cur.ids.push(m.id);
      cur.lastTime = m.time;
    } else {
      flush();
      cur = { repId: m.id, ids: [m.id], texts: [txt], thread_id: m.thread_id,
              sender_id: m.sender_id, side: m.side, time: m.time, lastTime: m.time, source: m.source };
    }
  }
  flush();
  return turns.filter((t) => t.text.length >= minTurnChars);
}

/** Persist the turn map so search can hydrate merged text + remap sparse hits. */
function writeTurnMap(turns) {
  const map = {};
  for (const t of turns) {
    map[msgId(t.repId)] = { text: t.text, ids: t.ids, thread_id: t.thread_id,
                            sender_id: t.sender_id, side: t.side, time: t.time };
  }
  fs.writeFileSync(TURNS_PATH, JSON.stringify(map));
}

let _turnMap = null;
/** Lazy-load turns.json → { reps, fragToRep, repSet }. Empty if not embedded yet. */
function turnMap() {
  if (_turnMap) return _turnMap;
  let reps = {};
  try { reps = JSON.parse(fs.readFileSync(TURNS_PATH, "utf8")); } catch { reps = {}; }
  const fragToRep = new Map();
  for (const [repId, t] of Object.entries(reps))
    for (const fid of t.ids) fragToRep.set(msgId(fid), repId);
  _turnMap = { reps, fragToRep, repSet: new Set(Object.keys(reps)) };
  return _turnMap;
}

/**
 * Embed conversational turns into the `turns` collection. Rebuilds the turn map
 * each run (idempotent — addVector overwrites by id). Returns counts.
 */
// batchSize stays small: Ollama's embedding endpoint drops requests under high
// concurrency (16 parallel → ~24/138 failed; 4 → clean). 138 turns @ ~190ms is
// a few seconds either way, so favour reliability.
export async function embedMessages(sqlite, { batchSize = 4, onProgress } = {}) {
  await ensureCollection();
  const gdb = await openGraph();

  const turns = buildTurns(sqlite);
  writeTurnMap(turns);
  _turnMap = null;   // invalidate cache so search picks up the fresh map

  let done = 0, failed = 0;
  for (let i = 0; i < turns.length; i += batchSize) {
    const batch = turns.slice(i, i + batchSize);
    const embeds = await Promise.all(batch.map(async (t) => {
      try { return { id: msgId(t.repId), v: await embed(t.text) }; }
      catch { failed++; return null; }
    }));
    for (const e of embeds) {
      if (!e) continue;
      try { await gdb.addVector(e.id, COLLECTION, e.v); done++; } catch { failed++; }
    }
    if (onProgress) onProgress({ done, failed, total: turns.length });
  }
  await gdb.flushIndex();
  await gdb.saveState();
  return { done, failed, total: turns.length, dim: EMBED_DIM, model: EMBED_MODEL, collection: COLLECTION };
}

/**
 * Vector (dense) semantic search across stored messages.
 *
 * NOTE on `alpha`: GenesisBlock's `hybridSearch` ranks by
 *   score = similarity * (1 - alpha) + K-Impact * alpha
 * so alpha=0 is pure vector similarity and alpha=1 is pure graph authority.
 * We default to 0.0 (vector only) — K-Impact's authority dimension is built for
 * a governance knowledge graph (MASTER/SPEC/ADR tiers) and degenerates to plain
 * degree-centrality on chat data, so it is not a useful relevance signal here.
 * (Previously this passed alpha=1.0, which silently ranked by K-Impact alone.)
 */
export async function searchSemantic(queryText, { k = 20, alpha = 0.0 } = {}) {
  const gdb = await openGraph();
  const v = await embed(queryText);
  const { reps, repSet } = turnMap();

  // Over-fetch, then keep only *current* turn reps. Re-embeds leave orphan vectors
  // behind (GenesisBlock has no deleteVector), so the collection accumulates stale
  // rep ids from earlier turn segmentations — filter them out here by repSet.
  const raw = await gdb.hybridSearch({ queryVector: v, k: Math.max(k * 5, 80), collection: COLLECTION, alpha });

  const hits = [];
  for (const h of raw) {
    const n = h.node || h;
    if (repSet.size && !repSet.has(n.id)) continue;     // drop orphan vectors
    // hybridSearch returns the rep Message node, whose props.text is only the first
    // fragment. Overlay the merged turn text so callers (fmtHit) show the full turn.
    const t = reps[n.id];
    if (t && n.props) n.props.text = t.text;
    hits.push(h);
    if (hits.length >= k) break;
  }
  return hits;
}

/** Dense retrieval as a plain ranked id list ("msg:<id>"), best first. */
export async function searchDense(queryText, { k = 50 } = {}) {
  const hits = await searchSemantic(queryText, { k, alpha: 0.0 });
  return hits.map((h) => (h.node || h).id);
}

/**
 * Reciprocal Rank Fusion — the industry-standard way to merge ranked lists from
 * heterogeneous retrievers (dense + sparse) without score normalisation.
 *   RRF(d) = Σ_lists 1 / (k + rank_list(d))      (k=60 is the conventional default)
 * Robust because it uses *ranks*, not raw scores, so cosine vs BM25 scale never
 * has to be reconciled. Returns [{ id, score }] sorted best-first.
 */
export function rrfFuse(rankedLists, { k = 60, limit = 20 } = {}) {
  const score = new Map();
  for (const list of rankedLists) {
    list.forEach((id, i) => {
      score.set(id, (score.get(id) || 0) + 1 / (k + i + 1));
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, s]) => ({ id, score: s }));
}

/**
 * Hybrid search: dense (bge-m3 vectors in GenesisBlock) + sparse (SQLite FTS5
 * BM25), fused with RRF. SQLite stays the source of truth, so we hydrate the
 * final hits from it. Returns rows shaped like `fmtHit` expects
 * ({ node:{id,labels,props}, score, sources }).
 */
export async function searchHybridRRF(sqlite, queryText, { k = 20, candidates = 50, rrfK = 60 } = {}) {
  const { reps, fragToRep, repSet } = turnMap();

  const [dense, sparseRaw] = await Promise.all([
    searchDense(queryText, { k: candidates }),                          // already turn-rep ids
    Promise.resolve(searchLexical(sqlite, queryText, { limit: candidates })), // raw fragment ids
  ]);

  // Lift each sparse fragment hit to its turn rep so both lists share one id
  // space (clean RRF, no rep/fragment near-dupes). Fragments in no turn = junk
  // (chrome / non-conversational) → dropped, keeping the sparse half noise-free.
  const sparse = [];
  const seen = new Set();
  for (const id of sparseRaw) {
    const rep = fragToRep.get(id) || (repSet.has(id) ? id : null);
    if (!rep || seen.has(rep)) continue;
    seen.add(rep);
    sparse.push(rep);
  }

  const fused = rrfFuse([dense, sparse], { k: rrfK, limit: k });
  if (!fused.length) return [];

  const denseSet = new Set(dense);
  const sparseSet = new Set(sparse);
  // Hydrate: merged text from the turn map; thread/sender/time/source from SQLite.
  const ids = fused.map((f) => Number(f.id.slice(4))); // strip "msg:"
  const rows = sqlite
    .prepare(
      `SELECT m.id, m.text, m.side, m.time, m.thread_id, m.source, u.name AS sender
       FROM messages m LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return fused.map((f) => {
    const m = byId.get(Number(f.id.slice(4)));
    const t = reps[f.id];
    return {
      node: {
        id: f.id,
        labels: ["Message", "Turn"],
        props: {
          text: t?.text ?? m?.text ?? "",
          side: m?.side, time: m?.time,
          thread_id: m?.thread_id, sender: m?.sender, source: m?.source,
        },
      },
      score: f.score,
      sources: [denseSet.has(f.id) && "dense", sparseSet.has(f.id) && "sparse"].filter(Boolean),
    };
  });
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
