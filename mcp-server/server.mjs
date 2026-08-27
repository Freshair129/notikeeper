#!/usr/bin/env node
/**
 * NotiKeeper MCP server + ingest + dashboard.
 *
 * Three jobs in one process:
 *  1) HTTP POST /ingest   — receives uploads from the NotiKeeper app
 *     (point the app's "Upload API" endpoint here). Stores rows in a local
 *     JSONL file (deduplicated).
 *  2) HTTP dashboard      — GET /          serves a small browser dashboard
 *                          GET /api/messages, /api/stats, /events (SSE)
 *  3) MCP (stdio)         — exposes the same data as tools to Claude.
 *
 * All logs go to STDERR; STDOUT is reserved for the MCP protocol.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import QRCode from "qrcode";
import { openDb, reindex, listThreads, getThread, listUsers, statsSummary, deleteMessages, linkThreadAlias, findCrossStreamDuplicates, linkMessages } from "./relations.mjs";
import { openRawDb, insertRawRow, insertRawRows, deleteRawRows, countRawRows, filterRawRows, allRawRows } from "./raw-store.mjs";
import { rebuildFromSqlite as rebuildGraph, neighbors as graphNeighbors,
         executeHql as graphHql, statusSync as graphStatus,
         embedMessages, searchSemantic, searchHybridRRF } from "./graph-index.mjs";
import { runGate } from "./llm-gate.mjs";
import crypto from "node:crypto";
import { BIND_HOST, IS_LOOPBACK_ONLY, LOCALHOST, LOOPBACK_HOST, PORT, TOKEN_FILE, readLocalToken } from "./config.mjs";
import { classifyNoise } from "./noise.mjs";

// Defined here, ahead of the rest of the ingest/dedup machinery below,
// because dedupCleanup() needs it at module load time — startup runs a
// dedup pass before the server is otherwise ready, so this can't wait until
// wherever it's next convenient to declare a `const`.
const isNoise = (r) => classifyNoise(r) !== null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.NOTIKEEPER_DATA || path.join(__dirname, "data.jsonl");
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const CHATLOG_DIR = path.join(__dirname, "chatlog");
/**
 * Auth token for /ingest and the read APIs.
 *
 * Resolution mirrors the scrapers: environment, then the shared token file, then
 * generate and persist one. The result is never empty, which is the point — the
 * gates below used to be written `if (TOKEN && ...)`, so an unset token disabled
 * authentication rather than denying access. Any server started outside the
 * launchers therefore served the whole archive to anything that could reach the
 * port. Failing closed means the worst case is "pair the phone again", not
 * "the archive was readable by the network".
 */
function resolveOrCreateToken() {
  const fromEnv = (process.env.NOTIKEEPER_TOKEN || "").trim();
  if (fromEnv) return fromEnv;

  const fromFile = readLocalToken();
  if (fromFile) return fromFile;

  const generated = crypto.randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(TOKEN_FILE, generated, { encoding: "utf8", mode: 0o600 });
    console.error(`[notikeeper-mcp] generated a new API token: ${TOKEN_FILE}`);
    console.error("[notikeeper-mcp] re-pair the phone so it picks up the new token.");
  } catch (e) {
    console.error(`[notikeeper-mcp] WARNING: could not persist a token (${e.message}).`);
    console.error("[notikeeper-mcp] WARNING: using an in-memory token - it changes on every restart.");
  }
  return generated;
}

const TOKEN = resolveOrCreateToken();
const CONFIG_FILE = path.join(__dirname, "config.json");

// Shared mobile config: the capture-app whitelist pushed to the phone via QR
// pairing, and the last device seen at /ingest (both surfaced on the dashboard).
let CONFIG = { captureApps: [], lastDevice: null, ignoredNames: ["LV177"] };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (Array.isArray(parsed.captureApps)) CONFIG.captureApps = parsed.captureApps;
    if (parsed.lastDevice) CONFIG.lastDevice = parsed.lastDevice;
    if (Array.isArray(parsed.ignoredNames)) CONFIG.ignoredNames = parsed.ignoredNames;
  }
} catch (e) { console.error("[notikeeper-mcp] config load failed:", e.message); }
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2));
}

// `rows` (a permanently-resident array of every captured row, growing
// forever) is gone — see G-19 in the capture-to-archive integrity audit.
// `seen` stays: it's the ingest-time durability gate (see ingest()'s own
// doc comment) and needs to answer "have I durably stored this raw_key"
// synchronously and unconditionally on every /ingest call. Making that
// check depend on a query against raw.db instead — a *second* store,
// populated by a write that's allowed to fail without blocking the
// response (see the try/catch around insertRawRows below) — would mean a
// raw.db-specific hiccup could make an already-durable row look "new"
// again on resubmission, re-appending an actual duplicate into data.jsonl.
// `seen` is a Set of short string keys, not full row objects — the memory
// cost this whole file's `rows` array carried was the full objects, not
// the keys; keeping just the keys resident is the safe, small trade-off.
const seen = new Set();
const keyOf = (r) => `${r.id}-${r.time}`;

/** Live SSE subscribers (browsers watching the dashboard). */
const sseClients = new Set();
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

/**
 * Parses every line of DATA_FILE into an object, skipping blank/malformed
 * lines. No dedup against `seen` here — data.jsonl itself should never
 * contain two lines with the same raw_key (ingest() never durably writes a
 * duplicate in the first place), so a plain parse is already correct.
 * Callers that need dedup-against-`seen` semantics (just load(), below, the
 * one-time startup bootstrap) do that themselves.
 */
function parseDataFile() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const out = [];
  for (const line of fs.readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

/**
 * One-time startup bootstrap: parses DATA_FILE, populates `seen` from every
 * row found (deduping on raw_key exactly like the old rows-populating
 * version did), and returns the parsed rows so the caller can seed
 * raw.db/relations.db with them. Not held onto anywhere after that — see
 * the IIFE this feeds below.
 */
function load() {
  const out = [];
  for (const r of parseDataFile()) {
    const k = keyOf(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

/**
 * Append [text] to [filePath] and fsync before returning — appendFileSync
 * alone only guarantees the OS page cache has it, not the disk. Retries a few
 * times on the same transient Windows file-lock class (EPERM/EBUSY/EACCES)
 * atomicWriteFileSync already has to handle (see its comment for how that was
 * found); a persistent failure still throws, which is the point — ingest()'s
 * caller must not admit these rows as "durable" if this doesn't return clean.
 */
function appendDurable(filePath, text, { retries = 5, retryDelayMs = 150 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const fd = fs.openSync(filePath, "a");
      try {
        fs.writeSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return;
    } catch (e) {
      const retryable = e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES";
      if (!retryable || attempt >= retries) throw e;
      console.error(`[ingest] append attempt ${attempt} to ${filePath} got ${e.code}, retrying...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
    }
  }
}

/**
 * Ingests a batch, durably, and returns the id through which the caller can
 * honestly acknowledge receipt (see /ingest's handler — this is Phase 1 of
 * docs/ARCHITECTURE_CHANGE_REQUEST.md, rebuilt to actually hold the guarantee
 * its own comment used to just assert).
 *
 * Two things this fixes, both about `seen`/`rows` being the phone's proof that
 * a row is durably stored:
 *
 *  1. The old code added every new row to `seen`/`rows` BEFORE the append that
 *     was supposed to persist them. If that append then threw — disk full, a
 *     permission error, anything — the exception propagated up and the client
 *     correctly saw a failure, EXCEPT the rows were already marked "seen" in
 *     memory. A retry of the identical batch would then find every row
 *     already in `seen`, write nothing, and the handler would happily ack the
 *     resubmitted batch's ids as durable — a full 200 for a batch that was
 *     never actually on disk. Rows here only enter `seen`/`rows` AFTER
 *     appendDurable() returns without throwing, so a failed attempt leaves
 *     nothing to falsely "remember" and a retry behaves like a first try.
 *
 *  2. The ack itself: `ackThroughId` only ever reflects ids from THIS array —
 *     freshly persisted just now, or already `seen` from a prior successful
 *     call for the SAME rows (so a duplicate resubmission still acks
 *     correctly without writing twice). It intentionally has no fallback to
 *     the store's overall max id. `rows` mixes ids from independent
 *     producers with no shared numbering — the phone's own small sequential
 *     SQLite autoincrement ids alongside the ADB/legacy scrapers' much larger
 *     Date.now()*1000+i ids — and acking against whichever happens to be
 *     largest across the whole store let one device's/producer's id
 *     authorize pruning local rows a completely different device never
 *     actually uploaded. A batch with nothing to durably vouch for now acks
 *     0, not "whatever the biggest id in the store happens to be."
 */
function ingest(arr) {
  const candidates = [];
  const candidateKeys = [];
  let ackThroughId = null;

  for (const r of arr) {
    if (r == null || r.id == null) continue;
    const k = keyOf(r);
    const n = Number(r.id);
    const idUsable = !Number.isNaN(n);
    if (seen.has(k)) {
      // Already durable from a prior call — fine to vouch for again.
      if (idUsable && (ackThroughId === null || n > ackThroughId)) ackThroughId = n;
      continue;
    }
    candidates.push(r);
    candidateKeys.push(k);
  }

  if (candidates.length) {
    const text = candidates.map((r) => JSON.stringify(r)).join("\n") + "\n";
    // Throws straight out of ingest() on failure — nothing below runs, and
    // critically nothing above has touched `seen`/`rows` for these rows yet.
    appendDurable(DATA_FILE, text);

    for (let i = 0; i < candidates.length; i++) seen.add(candidateKeys[i]);
    for (const r of candidates) {
      const n = Number(r.id);
      if (!Number.isNaN(n) && (ackThroughId === null || n > ackThroughId)) ackThroughId = n;
    }
    // Keep the raw.db mirror in lock-step with `seen` (see G-19, raw-store.mjs)
    // — same "don't let a fold failure block the response that's already
    // durably true" reasoning as the relations.db fold below. Note this is
    // NOT what makes a row durable — appendDurable() above already did that;
    // this only keeps the queryable mirror in sync with what's now on disk.
    try { insertRawRows(RAWDB, candidates, keyOf); } catch (e) { console.error("[raw-store] mirror failed:", e.message); }
    // incrementally fold the new rows into the relational DB
    try { reindex(RDB, candidates); } catch (e) { console.error("[relations] fold failed:", e.message); }
    broadcast("new", { count: candidates.length, total: countRawRows(RAWDB), sample: candidates.slice(-3) });
  }

  return { fresh: candidates, ackThroughId: ackThroughId ?? 0 };
}

// One-time startup bootstrap. `initialRows` lives only inside this IIFE —
// unlike the old module-level `rows` array, nothing keeps it (or a renamed
// copy of it) resident after this block finishes; it's eligible for GC the
// moment the IIFE returns. See G-19.
const RAWDB = openRawDb(path.join(__dirname, "raw.db"));
(function bootstrapRawDb() {
  const initialRows = load();
  console.error(`[notikeeper-mcp] loaded ${initialRows.length} rows from ${DATA_FILE}`);
  insertRawRows(RAWDB, initialRows, keyOf);
  const mirrored = countRawRows(RAWDB);
  const log = mirrored === initialRows.length ? console.error : console.warn;
  log(`[notikeeper-mcp] raw.db mirror: ${mirrored}/${initialRows.length} rows` +
    (mirrored === initialRows.length ? "" : " — MISMATCH, investigate before relying on this store"));
})();

// Relational DB — derived view over data.jsonl. Sourced from raw.db (see
// allRawRows), not a resident `rows` array — relations.db is itself a fully
// disposable, rebuildable-from-scratch derived cache (see G-12's commit for
// the same reasoning applied to the users-table migration), so it's fine for
// this specific path to trust raw.db rather than needing the stronger
// never-trust-a-possibly-drifted-mirror guarantee dedupCleanup() below holds
// itself to — nothing here can destroy data that isn't itself disposable.
const RDB = openDb(path.join(__dirname, "relations.db"));
function rebuildRelations() {
  const result = reindex(RDB, allRawRows(RAWDB));
  console.error(`[notikeeper-mcp] relations: +${result.inserted} (${result.threads} threads, ${result.users} users)`);
  return result;
}
rebuildRelations();

// ---------- exact-duplicate cleanup ----------
// Some notifications (spam/promo channels especially) repost the exact same
// text over and over with a new timestamp each time, so the id+time dedup key
// in ingest() never catches them. This removes exact (pkg, title, side, text)
// duplicates down to one copy, but ONLY among rows the noise classifier
// (noise.mjs) already flags as not a meaningful message — never a fuzzy match,
// and never applied to anything that looks like a real conversation, so it
// can't mistake two genuinely separate messages for the same spam blast
// (see dedupCleanup's own comment for why that distinction matters — it used
// to run over every row with no such restriction). Nothing is ever
// hard-deleted: every removed row is archived to DEDUP_LOG_FILE first, so
// this is always reversible.
const DEDUP_LOG_FILE = path.join(__dirname, "dedup-removed.jsonl");
const DEDUP_SRC_PRIORITY = { scrape: 1, noti: 2, screen: 3 };
const dedupSrcPri = (s) => DEDUP_SRC_PRIORITY[s] ?? 4;

/**
 * Replace `filePath`'s content without ever leaving it truncated or partial.
 *
 * A plain fs.writeFileSync opens the target with O_TRUNC and writes into it in
 * place — a crash, a full disk, or a killed process partway through leaves
 * whatever fraction had been flushed, and the rest (often most of the file, for
 * something this size) is gone. DATA_FILE is the one archive this whole system
 * is built around; dedupCleanup rewrites the entire thing every hour, and it is
 * also the phone's documented recovery path (see NotiStore.kt's DB-open catch).
 * Losing it to an interrupted write would take out the whole loop.
 *
 * Write to a sibling temp file, fsync it so the bytes are actually on stable
 * storage rather than sitting in a buffer, then rename over the real path.
 * rename() replaces the destination as a single filesystem operation — the
 * reader-visible file is either fully the old content or fully the new content,
 * never a mix — on both POSIX and Windows (verified here; Windows historically
 * required MOVEFILE_REPLACE_EXISTING for this, which is what libuv/Node use).
 *
 * Trade-off found while verifying this: on Windows, unlike a plain in-place
 * write, rename() over a destination that some *other* process has open (an
 * editor with data.jsonl open to look at it, an AV scan, a backup tool taking
 * a snapshot) fails with EPERM rather than just succeeding around it — a real,
 * easily-reproduced case, not a hypothetical. Retrying a few times rides out
 * the transient ones; the caller still needs to handle a persistent failure
 * without crashing (see dedupCleanup, which now writes before mutating any
 * in-memory state so a failure here leaves disk and memory equally untouched).
 */
function atomicWriteFileSync(filePath, content, { retries = 5, retryDelayMs = 150 } = {}) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (e) {
      const retryable = e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES";
      if (!retryable || attempt >= retries) {
        try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
        throw e;
      }
      console.error(`[atomic-write] ${filePath}: rename attempt ${attempt} got ${e.code}, retrying...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
    }
  }
}

function dedupCleanup() {
  // Reads DATA_FILE directly — the primary source of truth — rather than
  // raw.db. raw.db is kept in sync via best-effort writes that are allowed
  // to fail without blocking an /ingest response (see ingest()'s comment on
  // insertRawRows); trusting it here, where the result gets written BACK
  // over data.jsonl, would mean a rare raw.db-specific hiccup could bake
  // itself in as permanent data loss the next time this runs. See G-19 and
  // allRawRows' own doc comment in raw-store.mjs for the same distinction
  // applied to rebuildRelations(), where trusting raw.db is fine because
  // relations.db is fully disposable and this isn't.
  const currentRows = parseDataFile();

  const groups = new Map();
  for (const r of currentRows) {
    // Only rows the noise classifier already treats as not a meaningful
    // message — promo blasts, system spam, sticker/URL reposts, generic-title
    // chrome — are even eligible to be grouped here. This used to run over
    // EVERY row unconditionally with no time bound at all, which meant two
    // entirely separate, genuine occurrences of a short reply like "ครับ"
    // anywhere across the archive's whole history collapsed down to one, with
    // no trace beyond an entry in dedup-removed.jsonl. A real message from a
    // real person, however many times they've sent it, is never eligible for
    // this pass now, regardless of how much text or time separates the two
    // occurrences — this is the one dimension where being wrong is
    // irreversible (see the capture-to-archive integrity audit, G-06).
    if (!isNoise(r)) continue;
    const key = `${r.pkg || ""}|${r.title || ""}|${r.side || ""}|${r.text || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const toRemove = new Set(); // keyOf(r) for rows being dropped
  let groupsAffected = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    groupsAffected++;
    // Keep the best copy: prefer scrape > noti > screen, then earliest time.
    const sorted = [...group].sort(
      (a, b) => dedupSrcPri(a.source) - dedupSrcPri(b.source) || a.time - b.time
    );
    for (const r of sorted.slice(1)) toRemove.add(keyOf(r));
  }
  if (toRemove.size === 0) return { removed: 0, groups: 0 };

  // One pass building both arrays, not two separate .filter() calls over the
  // same (potentially large) array — see G-19 ("dedup builds three more
  // full copies").
  const removedRows = [];
  const keptRows = [];
  for (const r of currentRows) {
    (toRemove.has(keyOf(r)) ? removedRows : keptRows).push(r);
  }

  // Archive BEFORE touching the active store — the log is the undo path.
  const archiveLines = removedRows
    .map((r) => JSON.stringify({ ...r, _dedup_removed_at: Date.now() }))
    .join("\n") + "\n";
  fs.appendFileSync(DEDUP_LOG_FILE, archiveLines);

  // Write the new archive BEFORE touching `seen` or either mirror. If this
  // throws (a persistent Windows file lock outlasting atomicWriteFileSync's
  // retries, a full disk, ...), nothing below runs — `seen`, raw.db, and
  // relations.db all stay exactly as they were, still matching what's on
  // disk, rather than racing ahead to a deduped state the file itself was
  // never updated to reflect. Not caught here: propagates out of
  // dedupCleanup so every caller (startup, the hourly timer, POST
  // /api/dedup/rebuild) sees this pass failed.
  try {
    atomicWriteFileSync(DATA_FILE, keptRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  } catch (e) {
    console.error(`[dedup] FAILED to write ${path.basename(DATA_FILE)} - keeping the old file, skipping this pass: ${e.message}`);
    return { removed: 0, groups: 0, error: e.message };
  }

  // A removed row's raw_key is no longer durable — drop it from `seen` so a
  // genuine future resubmission of that exact row (unlikely, but possible:
  // a retried old upload batch, a re-scrape) is treated as new rather than
  // silently swallowed as "already seen" against a row that no longer
  // exists. Equivalent to the old code's `seen.clear()` + rebuild from the
  // post-dedup rows array, just without needing that array to be resident
  // to rebuild from.
  for (const r of removedRows) seen.delete(keyOf(r));

  // Keep raw.db's mirror consistent with the file write above — same
  // reasoning as the incremental insert in ingest(). Uses server.mjs's own
  // keyOf (raw_key), not relations.db's "source|id|time" format below —
  // the two stores index the same rows under different, unrelated keys.
  try {
    const n = deleteRawRows(RAWDB, removedRows.map(keyOf));
    console.error(`[dedup] raw.db: deleted ${n} rows`);
  } catch (e) { console.error("[dedup] raw.db cleanup failed:", e.message); }

  // Purge the same rows from relations.db (Threads/Graph tabs, MCP tools) so
  // they don't keep showing duplicates reindex() would otherwise never remove.
  try {
    const rawKeys = removedRows.map((r) => `${r.source}|${r.id}|${r.time}`);
    const rel = deleteMessages(RDB, rawKeys);
    console.error(
      `[dedup] relations.db: deleted ${rel.deleted} messages, ` +
      `updated ${rel.threadsUpdated} threads, ${rel.usersUpdated} users`
    );
  } catch (e) { console.error("[dedup] relations.db cleanup failed:", e.message); }

  console.error(
    `[dedup] removed ${removedRows.length} exact-duplicate rows across ${groupsAffected} groups ` +
    `(archived to ${path.basename(DEDUP_LOG_FILE)})`
  );
  broadcast("dedup", { removed: removedRows.length, groups: groupsAffected, total: keptRows.length });
  return { removed: removedRows.length, groups: groupsAffected };
}

// dedupCleanup already turns a failed archive write into a logged no-op (see
// above), but nothing guards the rest of the function — a bad grouping key, a
// full disk on the DEDUP_LOG_FILE append, anything unanticipated. An uncaught
// throw here is an uncaught throw at the top of the module / inside a timer
// callback, and Node has no default recovery from either: it takes the whole
// server down, ending notification capture along with whatever this pass
// tripped over. A skipped dedup pass is fine — there's another one next hour.
function runDedupCleanupSafely(reason) {
  try {
    return dedupCleanup();
  } catch (e) {
    console.error(`[dedup] pass (${reason}) failed unexpectedly, server stays up: ${e.stack || e.message}`);
    return { removed: 0, groups: 0, error: e.message };
  }
}

runDedupCleanupSafely("startup");
setInterval(() => runDedupCleanupSafely("hourly"), 60 * 60 * 1000);

/** Return the first private-LAN IPv4 address (e.g. 192.168.x.x or 10.x), skipping
 *  loopback, link-local, and the noisy 172.x ranges used by WSL/Hyper-V. */
function getLanIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const ip = a.address;
      if (ip.startsWith("169.254.")) continue;     // link-local
      if (ip.startsWith("172.")) continue;          // WSL / Hyper-V
      if (ip.startsWith("192.168.") || ip.startsWith("10.")) return ip;
    }
  }
  return LOOPBACK_HOST;
}

// ---------- noise rules ----------
// classifyNoise + its constants live in ./noise.mjs so they can be unit-tested
// without importing this module (which binds a port and starts MCP on import).
// NOTIKEEPER_NOISE_OFF=1 still disables filtering at the call sites below.

function sendJson(res, code, obj, contentType = "application/json") {
  res.writeHead(code, { "Content-Type": contentType });
  res.end(JSON.stringify(obj));
}

// ---------- helpers used by every layer ----------
const byNewest = (a, b) => b.time - a.time;

// Thin wrapper kept so all four existing call sites (/api/messages,
// /api/timeline, the search_messages and recent_messages MCP tools) migrate
// onto raw.db together, from one change, rather than being individually
// rewritten and individually able to drift out of sync with each other —
// see G-19 and filterRawRows' own doc comment in raw-store.mjs. Was a
// linear scan + filter over the in-memory `rows` array; now a real SQL
// query against raw.db's indexed columns.
function filterRows(opts) {
  return filterRawRows(RAWDB, opts);
}

// source + a "~" time marker when the timestamp isn't a genuinely observed
// one (see G-11/G-09 in the capture-to-archive integrity audit — this used
// to render identically whether a row was a full scraped message or a
// truncated notification preview, and whether its time was a real send time
// or a capture-time guess; an AI reading this output had no way to tell).
// r.time_exact === true is the only case treated as exact — undefined
// (legacy rows from before this field existed) is honestly unknown, not
// assumed exact.
const fmt = (r) => {
  const approx = r.time_exact === true ? "" : "~";
  return `[${approx}${new Date(r.time).toLocaleString()}] ${r.app} · ${r.source}` +
    `${r.title ? " · " + r.title : ""}` +
    `${r.side ? " (" + r.side + ")" : ""}: ${r.text}`;
};

// ---------- HTTP server ----------
/**
 * Origins allowed to read this server's responses from browser JS. Same-origin
 * requests (the dashboard fetching its own host:port) don't need this at all —
 * browsers only consult it for *cross*-origin reads. A wildcard here meant any
 * other page open in the same browser could fetch the archive's JSON and read
 * it, gated only by knowing the token; reflecting a fixed allowlist instead
 * means an unrelated origin's request is still answered (CORS is a browser-side
 * read restriction, not a server-side access control — the auth gate already
 * does that job) but the browser refuses to hand the response to that page's
 * script. Recomputed per-request since getLanIp() can change if the network does.
 */
function allowedOrigins() {
  const origins = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`];
  if (!IS_LOOPBACK_ONLY) origins.push(`http://${getLanIp()}:${PORT}`);
  return origins;
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // 1) Upload endpoint (the phone POSTs here)
  if (req.method === "POST" && url.pathname === "/ingest") {
    if (req.headers["authorization"] !== `Bearer ${TOKEN}`) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const deviceName = (() => {
      try { return decodeURIComponent(req.headers["x-device-name"] || "").trim().slice(0, 100); }
      catch { return ""; } // malformed percent-encoding — ignore rather than 400 the whole ingest
    })();
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 50_000_000) req.destroy(); });
    req.on("end", () => {
      let batch;
      try {
        const parsed = JSON.parse(body);
        batch = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        sendJson(res, 400, { error: String(e) }); // malformed request — the client's problem
        return;
      }

      let result;
      try {
        result = ingest(batch);
      } catch (e) {
        // The durable write itself failed (disk full, a permission error, a
        // lock that outlasted appendDurable's retries, ...) — not the
        // client's fault, so 500, not 400. ingest() guarantees nothing in
        // `batch` was admitted into `seen`/`rows` when it throws, so no ack
        // goes out and the phone must not advance anything; retrying this
        // exact batch later will attempt the write again rather than finding
        // everything already "seen" and silently doing nothing (see
        // ingest()'s doc comment — this is the failure mode that used to
        // produce a false 200 ack for data that was never on disk).
        console.error("[notikeeper-mcp] ingest FAILED, nothing durable for this batch:", e.message);
        sendJson(res, 500, { error: String(e) });
        return;
      }

      if (deviceName) {
        CONFIG.lastDevice = { name: deviceName, lastSeen: Date.now() };
        saveConfig();
      }
      // ackedThroughId comes straight from ingest() — every id in it is either
      // freshly fsynced to disk just now, or was already durable from a prior
      // successful call. See ingest()'s doc comment for why there is
      // deliberately no fallback to the store's overall max id here anymore.
      sendJson(res, 200, {
        ok: true, received: result.fresh.length, total: countRawRows(RAWDB), ackedThroughId: result.ackThroughId,
      });
      console.error(`[notikeeper-mcp] ingested ${result.fresh.length} new (total ${countRawRows(RAWDB)})`);
    });
    return;
  }

  // 2) Dashboard SPA
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
    try {
      let html = fs.readFileSync(DASHBOARD_FILE, "utf8");
      // Same-machine/LAN access to this page is already inside the trust boundary —
      // inject the token so the local dashboard authenticates itself automatically,
      // no login prompt needed here (unlike the Vercel-hosted copy, which is
      // reachable from anywhere and has no way to know this server's secret).
      html = html.replace("<head>", `<head>\n<script>window.NK_TOKEN=${JSON.stringify(TOKEN)};</script>`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500); res.end("dashboard.html missing");
    }
    return;
  }

  // Auth gate for every read API + the SSE stream. Always on: TOKEN is resolved or
  // generated at startup and is never empty, so there is no configuration in which
  // these endpoints serve the archive unauthenticated. EventSource and <img> can't
  // send custom headers, so a ?token= query param is accepted as well as the header.
  if (url.pathname.startsWith("/api/") || url.pathname === "/events") {
    const authHeader = req.headers["authorization"];
    const queryToken = url.searchParams.get("token");
    if (authHeader !== `Bearer ${TOKEN}` && queryToken !== TOKEN) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
  }

  // 3) JSON APIs for the dashboard
  if (req.method === "GET" && url.pathname === "/api/messages") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 5000);
    const filtered = filterRows({
      query:   url.searchParams.get("q") || "",
      app:     url.searchParams.get("app") || "",
      source:  url.searchParams.get("source") || "",
      sinceMs: parseInt(url.searchParams.get("since") || "0", 10) || 0,
      untilMs: parseInt(url.searchParams.get("until") || "0", 10) || 0,
      // sinceId: row-id cursor for incremental pull (Phase 3 of
      // docs/ARCHITECTURE_CHANGE_REQUEST.md) — kept separate from `since`,
      // which is already the dashboard's epoch-ms day-range filter.
      sinceId: parseInt(url.searchParams.get("sinceId") || "0", 10) || 0,
      denoise: url.searchParams.get("denoise") === "1",
    }).sort(byNewest).slice(0, limit);
    sendJson(res, 200, { total: filtered.length, all: countRawRows(RAWDB), rows: filtered }, "application/json; charset=utf-8");
    return;
  }

  // ── Chatlog API ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/chatlog") {
    if (!fs.existsSync(CHATLOG_DIR)) {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return;
    }
    const threads = fs.readdirSync(CHATLOG_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(CHATLOG_DIR, f), "utf8"));
          return { slug: f.replace(".json", ""), title: d.title, count: d.count, from: d.from, to: d.to };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.to - a.to);
    sendJson(res, 200, threads);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/chatlog/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/chatlog/".length));
    const file = path.join(CHATLOG_DIR, `${slug}.json`);
    if (!fs.existsSync(file)) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(fs.readFileSync(file, "utf8"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chatlog/rebuild") {
    sendJson(res, 202, { status: "rebuilding" });
    // Run rebuild in background — stderr goes to server's stderr (not stdout/MCP)
    spawn(process.execPath, [path.join(__dirname, "rebuild-chatlog.mjs")],
      { stdio: ["ignore", "ignore", "inherit"], detached: false });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/timeline") {
    const app    = url.searchParams.get("app") || "";
    const denoise = url.searchParams.get("denoise") === "1";
    const filtered = filterRows({ app, denoise });
    const byDay = new Map();
    for (const r of filtered) {
      const date = new Date(r.time).toISOString().slice(0, 10);
      if (!byDay.has(date)) byDay.set(date, { count: 0, apps: {} });
      const d = byDay.get(date);
      d.count++;
      d.apps[r.app] = (d.apps[r.app] || 0) + 1;
    }
    const days = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({
        date,
        count:  d.count,
        topApp: Object.entries(d.apps).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
      }));
    sendJson(res, 200, { days, total: filtered.length }, "application/json; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    // Sourced from raw.db, not the in-memory `rows` array — see G-19 in the
    // capture-to-archive integrity audit and raw-store.mjs's own doc
    // comment. total/byApp/bySource/byPkg/minTime/maxTime are all real
    // indexed SQL aggregates now, not a JS reduction over every row in
    // memory. byNoise/noiseCount still need one pass over every row's full
    // shape (classifyNoise takes the whole object, not something SQL can
    // evaluate) — same total cost as before, but reading raw_json back out
    // of the DB via .iterate() rather than requiring `rows` to be resident
    // for this endpoint's sake specifically.
    //
    // Two intentional, minor differences from the old in-memory version,
    // both edge cases that shouldn't occur against a healthy archive:
    //  - A row with a genuinely missing `app` grouped under the JS object
    //    key "undefined" before (r.app coerced by property-access syntax);
    //    it groups under SQL NULL here, surfaced as the key "null" instead.
    //  - byApp's tie-break for two apps with the exact same count used to
    //    be "whichever was encountered first walking the in-memory array"
    //    (an accident of insertion order, not a deliberate choice); it's
    //    alphabetical now (ORDER BY n DESC, app ASC) — deterministic across
    //    runs instead of dependent on ingest history.
    const totals = RAWDB.prepare(
      "SELECT COUNT(*) AS total, MIN(time) AS minTime, MAX(time) AS maxTime FROM raw_rows"
    ).get();

    const byApp = {};
    for (const r of RAWDB.prepare(
      "SELECT app, COUNT(*) AS n FROM raw_rows GROUP BY app ORDER BY n DESC, app ASC"
    ).all()) byApp[r.app] = r.n;

    const bySource = {};
    for (const r of RAWDB.prepare(
      "SELECT source, COUNT(*) AS n FROM raw_rows GROUP BY source ORDER BY source ASC"
    ).all()) bySource[r.source] = r.n;

    const byPkg = {};
    for (const r of RAWDB.prepare(
      "SELECT pkg, app, COUNT(*) AS n FROM raw_rows WHERE pkg IS NOT NULL AND pkg != '' GROUP BY pkg"
    ).all()) byPkg[r.pkg] = { app: r.app, count: r.n };

    let noiseCount = 0;
    const byNoise = {};
    for (const r of RAWDB.prepare("SELECT raw_json FROM raw_rows").iterate()) {
      const tag = classifyNoise(JSON.parse(r.raw_json));
      if (tag) { noiseCount++; byNoise[tag] = (byNoise[tag] || 0) + 1; }
    }

    sendJson(res, 200, {
      total: totals.total,
      noiseCount,
      cleanCount: totals.total - noiseCount,
      byNoise,
      byApp,
      byPkg,
      bySource,
      minTime: totals.total ? totals.minTime : null,
      maxTime: totals.total ? totals.maxTime : null,
    }, "application/json; charset=utf-8");
    return;
  }

  // 4) Relational queries (Messenger-style: threads, users, messages)
  if (req.method === "GET" && url.pathname === "/api/threads") {
    const out = listThreads(RDB, {
      app: url.searchParams.get("app") || null,
      limit: Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 2000),
    });
    sendJson(res, 200, { count: out.length, threads: out }, "application/json; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/threads/")) {
    const id = parseInt(url.pathname.split("/").pop(), 10);
    const t = getThread(RDB, id, { limit: parseInt(url.searchParams.get("limit") || "500", 10) });
    sendJson(res, t ? 200 : 404, t || { error: "not found" }, "application/json; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/users") {
    const out = listUsers(RDB, { limit: parseInt(url.searchParams.get("limit") || "200", 10) });
    sendJson(res, 200, { count: out.length, users: out }, "application/json; charset=utf-8");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/relations") {
    sendJson(res, 200, statsSummary(RDB), "application/json; charset=utf-8");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/relations/rebuild") {
    const r = rebuildRelations();
    sendJson(res, 200, r, "application/json; charset=utf-8");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/dedup/rebuild") {
    const r = runDedupCleanupSafely("manual");
    sendJson(res, r.error ? 500 : 200, { ok: !r.error, ...r }, "application/json; charset=utf-8");
    return;
  }

  // LLM quality-gate (Phase 4) — MANUAL trigger only. The full backfill is tens
  // of thousands of ambiguous lines (~hours of local inference), so it is never
  // run automatically or inline with /ingest. Cap each run with ?limit=. Verdicts
  // accumulate in llm-verdicts.json; degrades to a no-op if Ollama/model absent.
  if (req.method === "POST" && url.pathname === "/api/gate/run") {
    const limit = parseInt(url.searchParams.get("limit") || "200", 10);
    runGate({ limit }).then(
      (r) => { sendJson(res, 200, { ok: true, ...r }); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }

  // Graph (GenesisBlock) — vector+graph layer over the SQLite relations
  if (req.method === "POST" && url.pathname === "/api/graph/rebuild") {
    rebuildGraph(RDB).then(
      (r) => { sendJson(res, 200, r); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph/status") {
    graphStatus().then(
      (s) => { sendJson(res, 200, s); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/graph/neighbors/")) {
    const seed = decodeURIComponent(url.pathname.replace("/api/graph/neighbors/", ""));
    graphNeighbors(seed, {
      depth: parseInt(url.searchParams.get("depth") || "1", 10),
      rel: url.searchParams.get("rel") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
    }).then(
      (out) => { sendJson(res, 200, { seed, count: out.length, neighbors: out }); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }
  // Subset of the graph shaped for vis-network: {nodes, edges}
  if (req.method === "GET" && url.pathname === "/api/graph/view") {
    try {
      const focus = url.searchParams.get("focus");
      const onlyApp = url.searchParams.get("app");
      const includeMsgs = url.searchParams.get("messages") === "1";

      // ── Junk thread title filter (mirrors rebuild-chatlog.mjs) ──
      const GRAPH_JUNK_RE = [
        /^Open /i, /^Close /i, /^Clear /i, /^New message/i,
        /^Story tray/i, /drawer/i, /ปุ่ม$/, /^ปุ่ม/,
        /^Shared Link:/i, /^End-to-end/i, /^More options/i,
        /^Like button/i, /^Shop now/i, /^Available /i,
        /^Reel by /i, /^ย่อ/, /^ขยาย/,
        /^(back|home|menu|cancel|send|search|loading|video|photo|audio|call|scanner)$/i,
        /\.(com|game|net|org|io)\b/i,  // URL-looking titles
        /^https?:\/\//i,
        /\|/,                           // "X | Y" web page titles / breadcrumbs
        /^📍/,                          // location emoji prefix
      ];
      const GRAPH_JUNK_SET = new Set([
        "New Message","New message","Story tray","Open navigation drawer",
        "Clear query","Close browser","Notifications","More options",
        "Sent","Seen","Delivered","Active Now","Typing","Typing…","GIF",
        "Camera","Audio call","Video call","Asana 2 of 2","QR Scanner",
        "Shop now","Like button",
      ]);
      const isJunkTitle = (t) => {
        if (!t || t.length < 2) return true;
        if (GRAPH_JUNK_SET.has(t)) return true;
        if (!/\s/.test(t) && t.length <= 12) return true; // single short word → likely button
        if (t.endsWith(":")) return true;                  // "Available add-ons:" etc.
        if (/•/.test(t) && t.split("•").map(s=>s.trim()).some((s,_,a)=>a.filter(x=>x===s).length>1)) return true; // "X • X"
        for (const re of GRAPH_JUNK_RE) if (re.test(t)) return true;
        return false;
      };

      const NODE_STYLE = {
        App:     { color: "#5EC1FF", size: 26, shape: "dot",     fontColor: "#E6EEF8" },
        Thread:  { color: "#FFC857", size: 18, shape: "diamond", fontColor: "#E6EEF8" },
        User:    { color: "#9AE6B4", size: 14, shape: "dot",     fontColor: "#E6EEF8" },
        Message: { color: "#C8D5E5", size:  6, shape: "dot",     fontColor: "#E6EEF8" },
      };
      const baseFor = (l) => NODE_STYLE[l] || { color: "#888", size: 8, shape: "dot", fontColor: "#fff" };

      let threadIds;
      if (focus && focus.startsWith("thread:")) {
        threadIds = [parseInt(focus.split(":")[1], 10)];
      } else if (onlyApp) {
        threadIds = RDB.prepare(
          "SELECT t.id FROM threads t JOIN apps a ON a.id=t.app_id WHERE a.name=? ORDER BY t.message_count DESC LIMIT 40"
        ).all(onlyApp).map((r) => r.id);
      } else {
        // Overview: every app + top 40 threads (by message count)
        threadIds = RDB.prepare(
          "SELECT id FROM threads ORDER BY message_count DESC LIMIT 40"
        ).all().map((r) => r.id);
      }

      const threadsQ = RDB.prepare(`SELECT t.id, t.name, t.is_group, t.message_count, a.name AS app
                                    FROM threads t JOIN apps a ON a.id=t.app_id
                                    WHERE t.id IN (${threadIds.map(() => "?").join(",") || "NULL"})`);
      const threads = threadIds.length ? threadsQ.all(...threadIds) : [];

      const apps = RDB.prepare(`SELECT DISTINCT a.name FROM apps a JOIN threads t ON t.app_id=a.id
                                WHERE t.id IN (${threadIds.map(() => "?").join(",") || "NULL"})`)
                      .all(...threadIds).map((r) => r.name);

      // Per-(thread,user) message counts — drives edge thickness for PARTICIPATES.
      const partsQ = RDB.prepare(`
        SELECT m.thread_id, m.sender_id AS user_id, u.name, u.message_count AS total_msgs,
               COUNT(*) AS msgs_here
        FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.thread_id IN (${threadIds.map(() => "?").join(",") || "NULL"})
          AND m.sender_id IS NOT NULL
        GROUP BY m.thread_id, m.sender_id
        ORDER BY msgs_here DESC LIMIT 200`);
      const parts = threadIds.length ? partsQ.all(...threadIds) : [];

      // Edge width: 1 (rare) → ~6 (very frequent). log10 keeps long tail readable.
      const edgeWidth = (n) => Math.max(1, Math.min(6, 1 + Math.log10(n + 1) * 1.8));
      // Mid-line label only when the edge is meaningful (skip "1" — too noisy).
      const edgeLabel = (n) => n >= 3 ? String(n) : undefined;

      const nodes = [];
      const edges = [];
      const seen = new Set();
      const addNode = (id, label, type, props = {}) => {
        if (seen.has(id)) return;
        seen.add(id);
        const s = baseFor(type);
        nodes.push({
          id, label, group: type,
          shape: s.shape, size: s.size,
          color: { background: s.color, border: s.color, highlight: { background: "#fff", border: s.color } },
          font: { color: s.fontColor, size: 12 },
          title: JSON.stringify(props, null, 2),
        });
      };

      // Dedup by name — keep highest message_count per name
      const byName = new Map();
      for (const t of threads.filter(t => !isJunkTitle(t.name))) {
        const prev = byName.get(t.name);
        if (!prev || t.message_count > prev.message_count) byName.set(t.name, t);
      }
      const cleanThreads = [...byName.values()];
      const cleanThreadIdSet = new Set(cleanThreads.map(t => t.id));
      const cleanParts = parts.filter(p => cleanThreadIdSet.has(p.thread_id));

      for (const a of apps) addNode(`app:${a}`, a, "App");
      for (const t of cleanThreads) {
        const tid = `thread:${t.id}`;
        const lbl = t.name.length > 26 ? t.name.slice(0, 26) + "…" : t.name;
        addNode(tid, lbl, "Thread", { app: t.app, msgs: t.message_count });
        const w = edgeWidth(t.message_count);
        edges.push({
          from: tid, to: `app:${t.app}`, arrows: "to",
          width: w, label: edgeLabel(t.message_count),
          color: { color: "#5EC1FF66", highlight: "#5EC1FF" },
          title: `IN_APP · ${t.message_count} msgs in thread`,
        });
      }
      const userSet = new Set();
      for (const p of cleanParts) {
        const uid = `user:${p.user_id}`;
        userSet.add(uid);
        const lbl = p.name.length > 22 ? p.name.slice(0, 22) + "…" : p.name;
        addNode(uid, lbl, "User", { totalMsgs: p.total_msgs });
        const w = edgeWidth(p.msgs_here);
        edges.push({
          from: uid, to: `thread:${p.thread_id}`, arrows: "to",
          width: w, label: edgeLabel(p.msgs_here),
          color: { color: "#9AE6B466", highlight: "#9AE6B4" },
          title: `PARTICIPATES · ${p.msgs_here} msgs from ${p.name} in this thread`,
        });
      }

      if (includeMsgs && threadIds.length === 1) {
        const msgs = RDB.prepare(`SELECT m.id, m.text, m.time, m.side, u.id AS uid, u.name AS uname
                                  FROM messages m LEFT JOIN users u ON u.id=m.sender_id
                                  WHERE m.thread_id = ? ORDER BY m.time DESC LIMIT 50`).all(threadIds[0]);
        for (const m of msgs) {
          const mid = `msg:${m.id}`;
          const txt = (m.text || "").slice(0, 60);
          addNode(mid, txt, "Message", { full: m.text, time: m.time });
          edges.push({ from: mid, to: `thread:${threadIds[0]}`, arrows: "to",
                       color: { color: "#C8D5E544" }, dashes: true });
          if (m.uid) edges.push({ from: mid, to: `user:${m.uid}`, label: "SENT_BY", arrows: "to",
                                  color: { color: "#FFC85744" } });
        }
      }

      sendJson(res, 200, { nodes, edges, counts: { nodes: nodes.length, edges: edges.length } }, "application/json; charset=utf-8");
    } catch (e) {
      sendJson(res, 500, { error: String(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/graph/embed-all") {
    embedMessages(RDB, {
      onProgress: ({ done, failed, total }) => {
        if (done % 50 === 0) console.error(`[embed] ${done}/${total} (${failed} failed)`);
      },
    }).then(
      (r) => { sendJson(res, 200, r); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/graph/search") {
    const q = url.searchParams.get("q") || "";
    const k = parseInt(url.searchParams.get("k") || "20", 10);
    // mode=hybrid (default) → RRF(dense+sparse); mode=semantic → vector only.
    const mode = url.searchParams.get("mode") || "hybrid";
    if (!q.trim()) {
      sendJson(res, 400, { error: "q is required" }); return;
    }
    const run = mode === "semantic"
      ? searchSemantic(q, { k })
      : searchHybridRRF(RDB, q, { k });
    run.then(
      (r) => { sendJson(res, 200, { q, mode, count: r.length, hits: r }); },
      (e) => { sendJson(res, 500, { error: String(e) }); }
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/graph/hql") {
    let body = "";
    // HQL queries are short command strings (see the MCP tool's own examples) —
    // this was the one POST body in the file with no cap at all, unlike /ingest
    // (50 MB, real batches) and /api/config (100 KB). 20 KB is generous headroom
    // over any real query while still bounding it.
    req.on("data", (c) => { body += c; if (body.length > 20_000) req.destroy(); });
    req.on("end", () => {
      const q = (() => { try { return JSON.parse(body).query; } catch { return body; } })();
      graphHql(q).then(
        (r) => { sendJson(res, 200, { query: q, result: r }); },
        (e) => { sendJson(res, 500, { error: String(e) }); }
      );
    });
    return;
  }

  // 5) Pairing info for the QR code shown on the dashboard
  if (req.method === "GET" && url.pathname === "/api/pair") {
    const ip = getLanIp();
    const endpoint = `http://${ip}:${PORT}/ingest`;
    const updateUrl = "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json";
    const payload = {
      type: "notikeeper-pair",
      v: 1,
      endpoint,
      ip,
      port: PORT,
      token: TOKEN || "",
      updateUrl,
      // The endpoint above names a LAN address, which is only reachable when the
      // server was started with NOTIKEEPER_BIND. Surfaced so a pairing UI can warn
      // instead of handing the phone an endpoint that will silently never connect.
      loopbackOnly: IS_LOOPBACK_ONLY,
      ...(CONFIG.captureApps.length ? { captureApps: CONFIG.captureApps } : {}),
    };
    sendJson(res, 200, payload, "application/json; charset=utf-8");
    return;
  }

  // Shared mobile config (e.g. default capture-app whitelist), read/written by
  // the PC dashboard and pushed to the phone via /api/pair(-qr) above.
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, CONFIG, "application/json; charset=utf-8");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/config") {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 100_000) req.destroy(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed.captureApps)) {
          CONFIG.captureApps = parsed.captureApps.filter((s) => typeof s === "string");
        }
        if (Array.isArray(parsed.ignoredNames)) {
          CONFIG.ignoredNames = parsed.ignoredNames.filter((s) => typeof s === "string");
        }
        saveConfig();
        sendJson(res, 200, { ok: true, config: CONFIG });
      } catch (e) {
        sendJson(res, 400, { error: String(e) });
      }
    });
    return;
  }

  // Pre-rendered QR code as PNG so the dashboard works without any CDN.
  if (req.method === "GET" && url.pathname === "/api/pair-qr") {
    const ip = getLanIp();
    const endpoint = `http://${ip}:${PORT}/ingest`;
    const updateUrl = "https://github.com/Freshair129/notikeeper/releases/latest/download/version.json";
    const payload = JSON.stringify({
      type: "notikeeper-pair", v: 1,
      endpoint, token: TOKEN || "", updateUrl,
      ...(CONFIG.captureApps.length ? { captureApps: CONFIG.captureApps } : {}),
    });
    QRCode.toBuffer(payload, {
      width: 320, margin: 2,
      color: { dark: "#0F1B2D", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then((png) => {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Length": png.length,
      });
      res.end(png);
    }).catch((e) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("qr error: " + e.message);
    });
    return;
  }

  // 5) Server-Sent Events stream — pushes live updates when /ingest fires
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: hello\ndata: {"total":${countRawRows(RAWDB)}}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
    req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  res.writeHead(404); res.end("not found");
});

httpServer.listen(PORT, BIND_HOST, () => {
  console.error(`[notikeeper-mcp] HTTP on http://${BIND_HOST}:${PORT}  (dashboard /, ingest /ingest, events /events)`);
  if (IS_LOOPBACK_ONLY) {
    console.error(
      "[notikeeper-mcp] loopback only - the phone CANNOT upload to this server over Wi-Fi. " +
      "Set NOTIKEEPER_BIND=0.0.0.0 (ideally with NOTIKEEPER_TOKEN) to allow it."
    );
  } else {
    console.error(
      `[notikeeper-mcp] reachable on ${BIND_HOST} - every request needs the token in ${path.basename(TOKEN_FILE)}. ` +
      "Pair the phone from the dashboard to hand it over."
    );
  }
});

// ---------- MCP tools (same data, also exposed to Claude) ----------
const mcp = new McpServer({ name: "notikeeper", version: "1.1.0" });

mcp.tool(
  "search_messages",
  { query: z.string(), limit: z.number().optional() },
  async ({ query, limit = 50 }) => {
    const hits = filterRows({ query }).sort(byNewest).slice(0, limit);
    return { content: [{ type: "text", text: hits.length ? hits.map(fmt).join("\n") : "no matches" }] };
  }
);

mcp.tool(
  "recent_messages",
  { limit: z.number().optional(), app: z.string().optional() },
  async ({ limit = 50, app }) => {
    const out = filterRows({ app }).sort(byNewest).slice(0, limit);
    return { content: [{ type: "text", text: out.length ? out.map(fmt).join("\n") : "no data" }] };
  }
);

mcp.tool("list_apps", {}, async () => {
  // Sourced from raw.db, not the in-memory `rows` array — see G-19. Same
  // per-app aggregate /api/stats's byApp already computes (Wave 16); tie
  // order is alphabetical (ORDER BY n DESC, app ASC) rather than whatever
  // order `rows` happened to encounter apps in, for the same reason.
  const counts = RAWDB.prepare(
    "SELECT app, COUNT(*) AS n FROM raw_rows GROUP BY app ORDER BY n DESC, app ASC"
  ).all();
  const lines = counts.map((r) => `${r.app}: ${r.n}`);
  return { content: [{ type: "text", text: lines.join("\n") || "no data" }] };
});

mcp.tool("stats", {}, async () => {
  // Sourced from raw.db, not the in-memory `rows` array — see G-19.
  const totals = RAWDB.prepare(
    "SELECT COUNT(*) AS total, MIN(time) AS minTime, MAX(time) AS maxTime FROM raw_rows"
  ).get();
  const bySource = {};
  for (const r of RAWDB.prepare(
    "SELECT source, COUNT(*) AS n FROM raw_rows GROUP BY source ORDER BY source ASC"
  ).all()) bySource[r.source] = r.n;

  const text = [
    `total rows: ${totals.total}`,
    `by source: ${JSON.stringify(bySource)}`,
    totals.total ? `range: ${new Date(totals.minTime).toLocaleString()} -> ${new Date(totals.maxTime).toLocaleString()}` : "range: -",
    `dashboard: http://${LOCALHOST}:${PORT}/`,
    `data file: ${DATA_FILE}`,
  ].join("\n");
  return { content: [{ type: "text", text }] };
});

// ===== Semantic / graph tools (Phase B: BGE-M3 1024d + GenesisBlock) =====

/**
 * Format a hybridSearch / neighbors hit for Claude — readable text line.
 *
 * Reads p.source directly rather than matching against n.labels the way this
 * used to (`labels.find(l => l === "Notification" || l === "ScreenLine")`) —
 * that list was two source values behind current: adding "ScrapedMessage"
 * and "UnknownSource" to sourceLabel() (see G-22) would have silently
 * produced an empty tag for exactly the rows G-22 was about, the same class
 * of bug this whole function exists to prevent. props.source is the raw
 * value already, so there's nothing to keep in sync.
 */
function fmtHit(hit) {
  const n = hit.node || hit;
  const p = n.props || {};
  const approx = p.time_exact === 1 ? "" : "~";
  const time = p.time ? approx + new Date(p.time).toLocaleString() : "";
  const where = p.thread_id ? `t:${p.thread_id}` : "";
  const tag = p.source || "";
  const score = hit.score != null ? ` (score=${hit.score.toFixed(3)})` : "";
  return `[${time}] ${n.id} ${tag} ${where}${score}: ${p.text ?? p.name ?? ""}`.trim();
}

mcp.tool(
  "semantic_search",
  {
    query: z.string().describe("Free-text query (Thai or English). Looks up the closest messages by vector cosine."),
    k: z.number().optional().describe("How many hits to return (default 10)"),
  },
  async ({ query, k = 10 }) => {
    try {
      const hits = await searchSemantic(query, { k });
      const text = hits.length
        ? `top ${hits.length} semantic matches for "${query}":\n` + hits.map(fmtHit).join("\n")
        : `no matches for "${query}"`;
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "hybrid_search",
  {
    query: z.string().describe("Free-text query (Thai or English). Fuses dense vector search (meaning) with FTS5 keyword search (exact terms/names) via Reciprocal Rank Fusion — the recommended general search."),
    k: z.number().optional().describe("How many hits to return (default 10)"),
  },
  async ({ query, k = 10 }) => {
    try {
      const hits = await searchHybridRRF(RDB, query, { k });
      const text = hits.length
        ? `top ${hits.length} hybrid (RRF) matches for "${query}":\n` +
          hits.map((h) => `${fmtHit(h)} [${(h.sources || []).join("+") || "—"}]`).join("\n")
        : `no matches for "${query}"`;
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "find_similar",
  {
    text: z.string().describe("Text to find semantically similar messages to."),
    k: z.number().optional().describe("How many neighbours (default 8)"),
  },
  async ({ text, k = 8 }) => {
    try {
      const hits = await searchSemantic(text, { k: k + 1 });   // +1 to skip the seed if present
      const trimmed = hits.slice(0, k);
      const out = trimmed.length
        ? trimmed.map(fmtHit).join("\n")
        : "no matches";
      return { content: [{ type: "text", text: out }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "graph_neighbors",
  {
    seed: z.string().describe("Node id, e.g. 'thread:42', 'user:7', 'msg:1234', 'app:Messenger'."),
    depth: z.number().optional().describe("How many hops out (default 1)"),
    rel: z.string().optional().describe("Filter by relation: IN_APP, IN_THREAD, SENT_BY, PARTICIPATES"),
    limit: z.number().optional().describe("Max nodes to return (default 25)"),
  },
  async ({ seed, depth = 1, rel, limit = 25 }) => {
    try {
      const out = await graphNeighbors(seed, { depth, rel, limit });
      const text = out.length
        ? `${out.length} neighbours of ${seed} (depth=${depth}${rel ? ", rel="+rel : ""}):\n` +
          out.map(fmtHit).join("\n")
        : `no neighbours for ${seed}`;
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "hql",
  {
    query: z.string().describe(
      "Raw HQL string. Examples:\n" +
      '  TRAVERSE FROM "thread:1" DEPTH 1 REL IN_APP\n' +
      '  TRAVERSE FROM "user:5" DEPTH 1 REL PARTICIPATES\n' +
      '  CONTEXT FOR "msg:42" TIER H1 BUDGET 200'
    ),
  },
  async ({ query }) => {
    try {
      const r = await graphHql(query);
      const text = Array.isArray(r)
        ? `${r.length} result(s):\n` + r.slice(0, 25).map((row, i) =>
            `#${i+1} ${JSON.stringify(row).slice(0, 300)}`).join("\n")
        : JSON.stringify(r, null, 2).slice(0, 4000);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "thread_summary",
  {
    threadName: z.string().optional().describe("Conversation name (partial match)"),
    threadId: z.number().optional().describe("SQLite thread id"),
    limit: z.number().optional().describe("Messages to include (default 30)"),
  },
  async ({ threadName, threadId, limit = 30 }) => {
    let id = threadId;
    if (!id && threadName) {
      const row = RDB.prepare(
        "SELECT id FROM threads WHERE name LIKE ? ORDER BY message_count DESC LIMIT 1"
      ).get(`%${threadName}%`);
      if (row) id = row.id;
    }
    if (!id) return { content: [{ type: "text", text: "no matching thread" }] };
    const t = getThread(RDB, id, { limit });
    if (!t) return { content: [{ type: "text", text: "thread not found" }] };
    const head = `Thread #${t.id} [${t.app}] "${t.name}" — ${t.message_count} msgs, participants: ${t.participants.map(p => p.name).join(", ")}`;
    // Includes source and a time_exact marker — this is the tool's own doc
    // comment's evidence citation for G-11: getThread already selected
    // m.source, this loop just never printed it, so a scraped message and a
    // notification preview rendered identically. "?" for m.sender already
    // covers unknown authorship reasonably (see G-14) — untouched here.
    const lines = t.messages.map((m) => {
      const approx = m.time_exact === 1 ? "" : "~";
      const time = approx + new Date(m.time).toLocaleString();
      const who = m.side === "me" ? "me" : (m.sender || "?");
      return `[${time}] ${m.source} ${who}: ${m.text}`;
    });
    return { content: [{ type: "text", text: head + "\n" + lines.join("\n") }] };
  }
);

mcp.tool(
  "link_thread_alias",
  {
    canonicalThreadId: z.number().describe(
      "Thread id to keep as the conversation's current identity — its history " +
      "will include the alias thread's messages too."
    ),
    aliasThreadId: z.number().describe(
      "Older thread id being folded in — e.g. the conversation's name before a rename."
    ),
    reason: z.string().optional().describe(
      "Why these are the same conversation, e.g. \"renamed 'Family' -> 'Family 2024'\""
    ),
  },
  // See G-13 in the capture-to-archive integrity audit: a renamed
  // conversation starts a brand-new thread row with no automatic link back
  // to its history under the old name, and nothing in the capture pipeline
  // carries a stable app-internal conversation id that would let a rename be
  // told apart from "coincidentally the same name, actually a different
  // conversation" by inference — so this is never inferred automatically,
  // only recorded when asked. Use thread_summary/list_apps or hql first to
  // find both thread ids.
  async ({ canonicalThreadId, aliasThreadId, reason }) => {
    try {
      const result = linkThreadAlias(RDB, canonicalThreadId, aliasThreadId, reason || null);
      return {
        content: [{
          type: "text",
          text: `Linked: thread ${result.aliasThreadId} now folds into thread ${result.threadId}. ` +
            `thread_summary on ${result.threadId} will include both histories from now on.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "find_cross_stream_duplicates",
  {
    threadId: z.number().describe("Thread id to scan — use thread_summary/list_apps or hql first to find it."),
    windowMs: z.number().optional().describe("How close in time two messages must be to be considered the same event. Default 180000 (3 minutes)."),
  },
  // See G-20 in the capture-to-archive integrity audit: the same real-world
  // message often lands as two unlinked rows — a notification's preview and
  // the screen reader's (or scraper's) fuller capture of the same moment.
  // This only ever SURFACES candidate pairs (different source, close in
  // time, one message's text a prefix of the other's or identical) for
  // review — it never asserts they're the same message. Confirm a real pair
  // with link_messages; a pair that turns out to be two genuinely different
  // messages just... isn't linked, no action needed.
  async ({ threadId, windowMs }) => {
    try {
      const pairs = findCrossStreamDuplicates(RDB, threadId, windowMs ? { windowMs } : {});
      if (!pairs.length) return { content: [{ type: "text", text: "no candidate pairs found" }] };
      const lines = pairs.map((p) =>
        `#${p.id1} [${p.source1}] "${p.text1}" (${new Date(p.time1).toLocaleString()})\n` +
        `  ~ #${p.id2} [${p.source2}] "${p.text2}" (${new Date(p.time2).toLocaleString()})`
      );
      return { content: [{ type: "text", text: `${pairs.length} candidate pair(s):\n\n${lines.join("\n\n")}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

mcp.tool(
  "link_messages",
  {
    canonicalId: z.number().describe("Message id to keep as the canonical record of this event."),
    duplicateId: z.number().describe("The other stream's message id, confirmed to be the same real-world event."),
    reason: z.string().optional().describe("Why these are the same message, e.g. \"notification preview of the screen-captured message\""),
  },
  // Only ever asserted from outside (typically after reviewing
  // find_cross_stream_duplicates' output) — see G-20. Neither message is
  // deleted or hidden; this just records the relationship.
  async ({ canonicalId, duplicateId, reason }) => {
    try {
      const result = linkMessages(RDB, canonicalId, duplicateId, reason || null);
      return {
        content: [{
          type: "text",
          text: `Linked: message ${result.duplicateId} marked as a duplicate capture of message ${result.messageId}. Both rows stay in the archive.`,
        }],
      };
    } catch (e) {
      return { content: [{ type: "text", text: `error: ${e.message}` }] };
    }
  }
);

await mcp.connect(new StdioServerTransport());
console.error("[notikeeper-mcp] MCP server ready (stdio)");
