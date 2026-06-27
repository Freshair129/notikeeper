/**
 * Relational ETL — converts the flat noti+screen rows in data.jsonl into a
 * Messenger-style schema (apps, users, threads, messages, participants) in a
 * local SQLite database. Re-runnable; safe to call repeatedly.
 *
 * The shape is intentionally close to how Facebook/Messenger models its own
 * data: every message belongs to a thread, threads belong to an app, threads
 * have one or more participants, and each message is sent by a user (or
 * nullable when it's "me" / unknown).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Sender prefix in noti / screen text — "John: hi" → ["John", "hi"]. */
const SENDER_PREFIX_RE = /^([^:：\n]{1,40})[:：]\s+(.+)$/s;

/** Words that look like UI chrome rather than real messages. */
const CHROME_WORDS = new Set([
  // Status / chat UI
  "Active now", "Online", "Sent", "Seen", "Delivered", "Typing", "Typing…",
  "ส่งแล้ว", "อ่านแล้ว", "ออนไลน์", "พิมพ์อยู่", "GIF", "Aa", "Send",
  "การแจ้งเตือน", "Notification", "Message", "Messages", "Search",
  // Navigation buttons captured from the system bar / drawer
  "ย้อนกลับ", "เมนู", "หน้าหลัก", "Back", "Menu", "Home", "Search",
  // App icons in the launcher / share sheet (label-only, no body)
  "Instagram", "Lazada", "ไดรฟ์", "Drive", "รูปภาพ", "Photos",
  "Keep Memo", "ปุ่ม Keep Memo", "Samsung", "Microsoft", "Files",
  "Calculator", "Camera", "Clock", "Calendar", "Contacts", "Phone",
  "Settings", "Maps", "Wallet", "Health", "TV", "Music",
  "Play Store", "Chrome", "Gmail", "Meet", "Translate",
]);

/** Catches FB/Messenger accessibility chrome that slipped past CHROME_WORDS. */
const UI_PATTERNS = [
  /ปุ่ม$/,                                  // "...ปุ่ม"
  /^ตัว[​ ]?เลือก/,                    // "ตัวเลือก..."
  /^รูปภาพที่ \d+ จาก \d+/,                 // "รูปภาพที่ 3 จาก 5"
  /^ภาพที่ \d+ จาก \d+/,
  /^Cover (Photo|Image)$/i,
  /^Google Search$/i,
  /^ล้างคำค้นหา$/,
  /^สแกน(คิวอาร์|qr)/i,
  /^ค้นหา/,                                 // "ค้นหา..."
  /^Search( bar)?$/i,
  /^Page \d+ of \d+$/i,
  /^หน้าที่ \d+ จาก \d+/,
  /ขยายรูปภาพ$/,
  /(ย้|ย้อ|ย้อน)กลับ$/,                     // unicode-replaced variants of "ย้อนกลับ"
];

/** True if a label looks like UI chrome — short single line, no message-shape. */
function looksLikeChromeLabel(text) {
  const t = (text || "").trim();
  if (!t) return true;
  if (CHROME_WORDS.has(t)) return true;
  if (t.length <= 2) return true;                       // single char / emoji button
  if (/^[\p{L}]{1,16}$/u.test(t)) return true;          // single short word (no whitespace)
  for (const re of UI_PATTERNS) if (re.test(t)) return true;
  return false;
}

export function openDb(filePath) {
  const dbPath = filePath || path.join(__dirname, "relations.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pkg  TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      first_seen INTEGER,
      last_seen  INTEGER,
      message_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY,
      app_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_group INTEGER NOT NULL DEFAULT 0,
      first_msg INTEGER,
      last_msg  INTEGER,
      message_count INTEGER DEFAULT 0,
      UNIQUE (app_id, name),
      FOREIGN KEY (app_id) REFERENCES apps(id)
    );

    CREATE TABLE IF NOT EXISTS participants (
      thread_id INTEGER NOT NULL,
      user_id   INTEGER NOT NULL,
      PRIMARY KEY (thread_id, user_id),
      FOREIGN KEY (thread_id) REFERENCES threads(id),
      FOREIGN KEY (user_id)   REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      thread_id INTEGER NOT NULL,
      sender_id INTEGER,                -- NULL = me / unknown
      side TEXT,                        -- "me" | "them" | NULL
      text TEXT NOT NULL,
      time INTEGER NOT NULL,
      source TEXT NOT NULL,             -- "noti" | "screen"
      reply_to_id INTEGER,
      read_at INTEGER,
      raw_id INTEGER,                   -- original id in data.jsonl
      raw_key TEXT UNIQUE,              -- dedup across reingest
      FOREIGN KEY (thread_id)   REFERENCES threads(id),
      FOREIGN KEY (sender_id)   REFERENCES users(id),
      FOREIGN KEY (reply_to_id) REFERENCES messages(id)
    );

    CREATE INDEX IF NOT EXISTS idx_msg_thread_time ON messages(thread_id, time);
    CREATE INDEX IF NOT EXISTS idx_msg_sender      ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_msg_time        ON messages(time);
  `);
}

/** Cached prepared statements per db instance. */
const cache = new WeakMap();
function stmts(db) {
  if (cache.has(db)) return cache.get(db);
  const s = {
    upsertApp:  db.prepare(`INSERT INTO apps(name, pkg) VALUES(?, ?)
                           ON CONFLICT(name) DO UPDATE SET pkg=COALESCE(pkg, excluded.pkg)
                           RETURNING id`),
    upsertUser: db.prepare(`INSERT INTO users(name, first_seen, last_seen, message_count)
                           VALUES(?, ?, ?, 0)
                           ON CONFLICT(name) DO UPDATE SET
                             first_seen = MIN(first_seen, excluded.first_seen),
                             last_seen  = MAX(last_seen,  excluded.last_seen)
                           RETURNING id`),
    upsertThread: db.prepare(`INSERT INTO threads(app_id, name, is_group, first_msg, last_msg)
                             VALUES(?, ?, 0, ?, ?)
                             ON CONFLICT(app_id, name) DO UPDATE SET
                               first_msg = MIN(first_msg, excluded.first_msg),
                               last_msg  = MAX(last_msg,  excluded.last_msg)
                             RETURNING id, is_group`),
    insertMsg:  db.prepare(`INSERT OR IGNORE INTO messages
                           (thread_id, sender_id, side, text, time, source, raw_id, raw_key)
                           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`),
    addParticipant: db.prepare(`INSERT OR IGNORE INTO participants(thread_id, user_id) VALUES(?, ?)`),
    incUserMsg: db.prepare(`UPDATE users SET message_count = message_count + 1,
                             last_seen = MAX(last_seen, ?) WHERE id = ?`),
    incThreadMsg: db.prepare(`UPDATE threads SET message_count = message_count + 1,
                              last_msg = MAX(last_msg, ?) WHERE id = ?`),
    markGroup: db.prepare(`UPDATE threads SET is_group = 1 WHERE id = ?`),
    threadSenders: db.prepare(`SELECT DISTINCT sender_id FROM messages
                              WHERE thread_id = ? AND sender_id IS NOT NULL`),
  };
  cache.set(db, s);
  return s;
}

/**
 * Parse a single raw row into (sender, text) candidates.
 * For noti rows: title is usually the sender (in 1-1) or the group name,
 *  text may itself begin with "Sender: msg" for groups.
 * For screen rows: title is the conversation name, sender comes from side.
 */
function parseRow(r) {
  const app = (r.app || "").trim();
  const pkg = (r.pkg || "").trim();
  const title = (r.title || "").trim();
  const text = (r.text || "").trim();
  const source = r.source;
  const side = r.side || null;

  if (!app || !text) return null;
  // Skip system app noise outright — these never carry real messages.
  if (["Meta App Manager", "Galaxy Store", "Samsung capture",
       "Dashboard Test", "HealthCheck"].includes(app)) return null;
  // Screen-capture artefacts: very short labels are almost always button text.
  if (source === "screen" && looksLikeChromeLabel(text)) return null;
  if (CHROME_WORDS.has(text.trim())) return null;
  // Screen reader sometimes captures a UI button ("ย้อนกลับ", "เมนู") as the
  // top-most short line and tags it as the thread title. Drop those — they are
  // not real conversations, and they pollute user/thread tables otherwise.
  if (source === "screen" && looksLikeChromeLabel(title)) return null;
  if (CHROME_WORDS.has(title.trim())) return null;

  let threadName = title || "(no title)";
  let senderName = null;

  if (source === "noti") {
    // try to peel "Sender: message" out of the body (group chats often do this)
    const m = text.match(SENDER_PREFIX_RE);
    if (m) {
      senderName = m[1].trim();
      // keep the unstripped text — we want the full content in the archive
    } else {
      senderName = title.trim() || null;
    }
  } else if (source === "screen") {
    if (side === "me") senderName = null;             // it's the device owner
    else if (side === "them") senderName = title.trim() || null;
  }

  if (senderName === "" || senderName === title && side === "them") {
    // okay, leave as-is
  }
  if (senderName) {
    if (senderName.length > 60) senderName = senderName.slice(0, 60);
  }

  return { app, pkg, threadName, senderName, text, time: r.time, source, side, rawId: r.id };
}

/** ETL the full rows list. Skips rows already imported via raw_key. Returns counts. */
export function reindex(db, rows) {
  const s = stmts(db);
  let inserted = 0, skipped = 0;

  const tx = db.transaction((batch) => {
    for (const r of batch) {
      const parsed = parseRow(r);
      if (!parsed) { skipped++; continue; }
      const { app, pkg, threadName, senderName, text, time, source, side, rawId } = parsed;
      const rawKey = `${source}|${rawId}|${time}`;

      const appRow = s.upsertApp.get(app, pkg || null);
      const thread = s.upsertThread.get(appRow.id, threadName, time, time);
      let senderId = null;
      if (senderName) {
        const u = s.upsertUser.get(senderName, time, time);
        senderId = u.id;
        s.addParticipant.run(thread.id, senderId);
      }
      const info = s.insertMsg.run(thread.id, senderId, side, text, time, source, rawId, rawKey);
      if (info.changes === 1) {
        inserted++;
        if (senderId != null) s.incUserMsg.run(time, senderId);
        s.incThreadMsg.run(time, thread.id);
      } else {
        skipped++;
      }
    }
  });
  // Process in chunks so a huge file does not lock the DB too long.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) tx(rows.slice(i, i + CHUNK));

  // Mark threads with > 1 distinct sender as groups.
  const groupCandidates = db.prepare(`
    SELECT thread_id FROM messages
    WHERE sender_id IS NOT NULL
    GROUP BY thread_id
    HAVING COUNT(DISTINCT sender_id) > 1
  `).all();
  const markGroup = s.markGroup;
  for (const g of groupCandidates) markGroup.run(g.thread_id);

  return { inserted, skipped, threads: countAll(db, "threads"), users: countAll(db, "users") };
}

function countAll(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

// ---------- query helpers (used by HTTP endpoints) ----------
export function listThreads(db, { app = null, limit = 200 } = {}) {
  let sql = `SELECT t.id, t.name, t.is_group, t.message_count, t.last_msg,
                    a.name AS app,
                    (SELECT text FROM messages WHERE thread_id = t.id ORDER BY time DESC LIMIT 1) AS last_text
             FROM threads t JOIN apps a ON a.id = t.app_id`;
  const params = [];
  if (app) { sql += ` WHERE a.name = ?`; params.push(app); }
  sql += ` ORDER BY t.last_msg DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function getThread(db, id, { limit = 500 } = {}) {
  const t = db.prepare(`
    SELECT t.id, t.name, t.is_group, t.message_count, t.first_msg, t.last_msg,
           a.name AS app
    FROM threads t JOIN apps a ON a.id = t.app_id
    WHERE t.id = ?`).get(id);
  if (!t) return null;
  const messages = db.prepare(`
    SELECT m.id, m.time, m.source, m.side, m.text, m.reply_to_id,
           u.name AS sender
    FROM messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.thread_id = ?
    ORDER BY m.time ASC LIMIT ?`).all(id, limit);
  const participants = db.prepare(`
    SELECT u.id, u.name, u.message_count
    FROM participants p JOIN users u ON u.id = p.user_id
    WHERE p.thread_id = ?
    ORDER BY u.message_count DESC`).all(id);
  return { ...t, participants, messages };
}

export function listUsers(db, { limit = 200 } = {}) {
  return db.prepare(`
    SELECT id, name, message_count, first_seen, last_seen
    FROM users ORDER BY message_count DESC LIMIT ?`).all(limit);
}

export function statsSummary(db) {
  const apps     = db.prepare(`SELECT name, (SELECT COUNT(*) FROM threads WHERE app_id = apps.id) AS thread_count,
                                          (SELECT COUNT(*) FROM messages m JOIN threads t ON t.id = m.thread_id
                                           WHERE t.app_id = apps.id) AS message_count
                              FROM apps ORDER BY message_count DESC`).all();
  const threads  = countAll(db, "threads");
  const users    = countAll(db, "users");
  const messages = countAll(db, "messages");
  const groups   = db.prepare(`SELECT COUNT(*) AS n FROM threads WHERE is_group = 1`).get().n;
  return { messages, threads, users, groups, apps };
}
