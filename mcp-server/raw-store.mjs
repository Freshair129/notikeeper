/**
 * SQLite mirror of the raw archive (data.jsonl) — step 1 of moving server.mjs
 * off an ever-growing in-memory `rows` array towards querying a real,
 * indexed store instead. See G-19 in the capture-to-archive integrity audit:
 * "the whole data.jsonl is resident [in memory]; every search is a linear
 * scan; dedup builds three more full copies."
 *
 * This is deliberately NOT the same thing as relations.mjs's relations.db.
 * relations.db is a *cleaned*, ETL'd, Messenger-style view — noise-classified
 * rows, capture-gap markers, and chrome are dropped from it on purpose. The
 * dashboard's raw Feed tab, /api/stats, and /api/timeline all need the
 * *complete*, unfiltered archive (with an optional denoise=1 toggle applied
 * at query time, not baked into what's stored) — exactly what `rows` holds
 * today. So this is a lossless, 1:1 mirror: every row that goes into
 * data.jsonl goes in here too, verbatim, with common fields promoted to real
 * (indexed) columns and the full original object also kept as JSON so
 * nothing is lost to a field this module didn't anticipate.
 *
 * Deliberately scoped: this module only stores and retrieves rows. It does
 * NOT yet replace `rows` as what server.mjs's endpoints read from — that's
 * later work, done incrementally and verified endpoint by endpoint rather
 * than in one pass, given this is the server the user runs persistently.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openRawDb(filePath) {
  const dbPath = filePath || path.join(__dirname, "raw.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_rows (
      -- Same "\${id}-\${time}" key server.mjs's in-memory \`seen\` Set already
      -- uses for ingest-time dedup (see keyOf in server.mjs) -- reused here
      -- rather than inventing a second identity scheme for the same rows.
      raw_key    TEXT PRIMARY KEY,
      -- Kept as TEXT, not INTEGER: producers use both the phone's small
      -- sequential SQLite ids and the ADB/legacy scrapers' much larger
      -- Date.now()*1000+i ids -- no shared numbering to be an integer of.
      id         TEXT,
      time       INTEGER NOT NULL,
      source     TEXT,
      app        TEXT,
      pkg        TEXT,
      title      TEXT,
      text       TEXT,
      side       TEXT,
      time_exact INTEGER,
      -- The complete original row, verbatim. Source of truth for any field
      -- not promoted to a column above -- reading this back and JSON-parsing
      -- it reproduces exactly what data.jsonl has for this row, so a
      -- consumer that needs a field this schema didn't anticipate (or that a
      -- future producer adds) still gets it correctly instead of silently
      -- losing it to an incomplete column mapping.
      raw_json   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_raw_time   ON raw_rows(time);
    CREATE INDEX IF NOT EXISTS idx_raw_source ON raw_rows(source);
    CREATE INDEX IF NOT EXISTS idx_raw_app    ON raw_rows(app);
  `);
  return db;
}

/** Cached prepared statements per db instance, same pattern relations.mjs uses. */
const cache = new WeakMap();
function stmts(db) {
  if (cache.has(db)) return cache.get(db);
  const s = {
    insert: db.prepare(`
      INSERT OR IGNORE INTO raw_rows
        (raw_key, id, time, source, app, pkg, title, text, side, time_exact, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
  cache.set(db, s);
  return s;
}

/** Inserts one row. Silently a no-op if raw_key already exists (idempotent re-ingest, same as the in-memory `seen` check). */
export function insertRawRow(db, r, keyOf) {
  const s = stmts(db);
  s.insert.run(
    keyOf(r),
    r.id == null ? null : String(r.id),
    Number(r.time) || 0,
    r.source ?? null,
    r.app ?? null,
    r.pkg ?? null,
    r.title ?? null,
    r.text ?? null,
    r.side ?? null,
    r.time_exact === true ? 1 : r.time_exact === false ? 0 : null,
    JSON.stringify(r)
  );
}

/** Batched insert in one transaction per chunk, for a large initial load. */
export function insertRawRows(db, rowsArr, keyOf) {
  const s = stmts(db);
  const insertOne = (r) => s.insert.run(
    keyOf(r),
    r.id == null ? null : String(r.id),
    Number(r.time) || 0,
    r.source ?? null,
    r.app ?? null,
    r.pkg ?? null,
    r.title ?? null,
    r.text ?? null,
    r.side ?? null,
    r.time_exact === true ? 1 : r.time_exact === false ? 0 : null,
    JSON.stringify(r)
  );
  const tx = db.transaction((batch) => { for (const r of batch) insertOne(r); });
  const CHUNK = 1000;
  for (let i = 0; i < rowsArr.length; i += CHUNK) tx(rowsArr.slice(i, i + CHUNK));
}

/** Removes rows by their raw_key — mirrors dedupCleanup()'s in-memory removal so this store never drifts out of sync with `rows`/data.jsonl. */
export function deleteRawRows(db, rawKeys) {
  if (!rawKeys.length) return 0;
  const del = db.prepare(`DELETE FROM raw_rows WHERE raw_key = ?`);
  const tx = db.transaction((keys) => {
    let n = 0;
    for (const k of keys) n += del.run(k).changes;
    return n;
  });
  return tx(rawKeys);
}

export function countRawRows(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM raw_rows").get().n;
}
