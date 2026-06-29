#!/usr/bin/env node
/**
 * Facebook Messenger JSON export importer for NotiKeeper.
 *
 * Usage:
 *   node fb-import.mjs <message_1.json>              single file
 *   node fb-import.mjs <thread-folder/>              all message_N.json in that folder
 *   node fb-import.mjs --all <inbox-folder/>         all thread subfolders in inbox
 *   node fb-import.mjs --me "Your Name" <path>      identify which sender is you
 *   node fb-import.mjs --dry-run <path>             preview only, no POST
 *
 * Facebook encodes non-ASCII text (Thai etc.) as mojibake — Latin-1 bytes written
 * into a UTF-8 JSON file.  This script auto-corrects the encoding transparently.
 *
 * How to get the export:
 *   Facebook → Settings & Privacy → Settings → Your Facebook Information
 *   → Download Your Information → Messages → Format: JSON → Create File
 *   Extract the zip; the inbox lives at:
 *     your_facebook_activity/messages/inbox/<ThreadName_hash>/message_1.json
 *
 * Prerequisites: MCP server running at localhost:8765
 */

import fs   from "node:fs";
import path from "node:path";
import http  from "node:http";
import https from "node:https";

const INGEST_URL   = process.env.INGEST_URL   || "http://localhost:8765/ingest";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const APP_NAME     = "Messenger";
const PKG          = "com.facebook.orca";

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ALL_MODE= argv.includes("--all");

const ME_IDX  = argv.indexOf("--me");
const MY_NAME = ME_IDX >= 0 ? argv[ME_IDX + 1] : null;

// TARGET = last non-flag, non-flag-value argument
const TARGET = argv.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (i > 0 && argv[i - 1] === "--me") return false;
  return true;
}).pop();

// ── Facebook mojibake decoder ─────────────────────────────────────────────────
// Facebook serialises its JSON as if each UTF-8 byte were a Latin-1 code point.
// To recover: re-read each char's code unit as a byte, then decode as UTF-8.
function fbDecode(s) {
  if (!s || typeof s !== "string") return s;
  try { return Buffer.from(s, "latin1").toString("utf8"); } catch { return s; }
}

function deepDecode(v) {
  if (typeof v === "string")  return fbDecode(v);
  if (Array.isArray(v))       return v.map(deepDecode);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = deepDecode(val);
    return o;
  }
  return v;
}

// ── File helpers ──────────────────────────────────────────────────────────────
function msgFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(e => /^message_\d+\.json$/.test(e))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0]);
      const nb = parseInt(b.match(/\d+/)[0]);
      return na - nb;
    })
    .map(e => path.join(dir, e));
}

function threadFolders(inboxDir) {
  return fs.readdirSync(inboxDir)
    .map(e => path.join(inboxDir, e))
    .filter(p => {
      try { return fs.statSync(p).isDirectory() && msgFilesIn(p).length > 0; }
      catch { return false; }
    });
}

// ── Row builder ───────────────────────────────────────────────────────────────
let _nextId = Date.now();

function buildRows(title, participants, messages, myName) {
  // Heuristic for 1:1 threads when --me is not given:
  //   The thread title is typically the other person's name in a 1:1 conversation.
  //   So a sender whose name ≠ title is likely "me".
  const isOneOnOne = participants.length === 2;

  function inferSide(senderName) {
    if (myName)      return senderName === myName   ? "me" : "them";
    if (isOneOnOne)  return senderName !== title     ? "me" : "them";
    return "them"; // group chat — can't infer without --me
  }

  const rows = [];
  for (const m of messages) {
    if (m.type !== "Generic" && m.type !== "Share") continue;
    const text = (m.content || "").trim();
    if (!text || text.length > 8000) continue; // skip sticker/media/empty

    const senderName = m.sender_name || "";
    const side = inferSide(senderName);

    rows.push({
      id:     _nextId++,
      source: "fb-import",
      app:    APP_NAME,
      pkg:    PKG,
      title,
      text,
      side,
      time:   m.timestamp_ms,
      sender: side === "them" ? senderName : undefined,
    });
  }
  return rows;
}

// ── POST helper ───────────────────────────────────────────────────────────────
function postIngest(rows) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const u    = new URL(INGEST_URL);
    const isHttps = u.protocol === "https:";
    const req = (isHttps ? https : http).request(
      {
        hostname: u.hostname,
        port:     u.port || (isHttps ? 443 : 80),
        path:     u.pathname,
        method:   "POST",
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(INGEST_TOKEN ? { Authorization: `Bearer ${INGEST_TOKEN}` } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end",  () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Process one thread ────────────────────────────────────────────────────────
async function processThread(files) {
  let title        = null;
  let participants = [];
  const allMsgs    = [];

  for (const f of files) {
    console.error(`  reading ${path.basename(f)}…`);
    const raw  = JSON.parse(fs.readFileSync(f, "utf8"));
    const data = deepDecode(raw);
    if (!title && data.title) title = data.title;
    if ((data.participants || []).length > participants.length)
      participants = data.participants || [];
    if (Array.isArray(data.messages)) allMsgs.push(...data.messages);
  }

  // Facebook stores newest-first within each file; sort all chronologically.
  allMsgs.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  const rows    = buildRows(title || "Messenger", participants, allMsgs, MY_NAME);
  const skipped = allMsgs.length - rows.length;
  console.error(`  "${title}": ${rows.length} messages (${skipped} skipped — media/sticker/empty)`);

  if (rows.length === 0) return 0;

  if (DRY_RUN) {
    console.log(`\n--- DRY RUN: ${title} (${rows.length} rows) ---`);
    rows.slice(0, 8).forEach(r =>
      console.log(`  [${r.side}] ${new Date(r.time).toISOString().slice(0, 16)}: ${r.text.slice(0, 80)}`)
    );
    if (rows.length > 8) console.log(`  … +${rows.length - 8} more`);
    return rows.length;
  }

  let posted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res   = await postIngest(chunk);
    posted     += res.received ?? 0;
    process.stderr.write(`\r  posted ${Math.min(i + CHUNK, rows.length)}/${rows.length} (new: ${posted})   `);
  }
  process.stderr.write("\n");
  return posted;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!TARGET) {
    console.error(`
NotiKeeper — Facebook Messenger importer

Usage:
  node fb-import.mjs <message_1.json>              single file
  node fb-import.mjs <thread-folder/>              all message_N.json in folder
  node fb-import.mjs --all <inbox-folder/>         all thread subfolders
  node fb-import.mjs --me "Your Name" <path>      tag your side correctly
  node fb-import.mjs --dry-run <path>             preview, no POST

Facebook export path (after unzip):
  your_facebook_activity/messages/inbox/
    Friend_abc123/
      message_1.json   message_2.json  ...
`.trim());
    process.exit(1);
  }

  const stat = fs.statSync(TARGET);
  let totalPosted = 0;

  if (stat.isFile()) {
    // Single JSON — treat its folder as the thread folder (may have message_2.json etc.)
    const dir   = path.dirname(TARGET);
    const files = msgFilesIn(dir).length > 1 ? msgFilesIn(dir) : [TARGET];
    console.error(`[fb-import] Single thread — ${files.length} file(s)`);
    totalPosted = await processThread(files);

  } else {
    const threadFiles = msgFilesIn(TARGET);

    if (threadFiles.length > 0) {
      // Thread folder
      console.error(`[fb-import] Thread folder — ${threadFiles.length} file(s)`);
      totalPosted = await processThread(threadFiles);

    } else if (ALL_MODE) {
      // Inbox folder — iterate every thread subfolder
      const folders = threadFolders(TARGET);
      console.error(`[fb-import] Inbox — ${folders.length} thread folder(s)`);
      for (const folder of folders) {
        console.error(`\n[fb-import] ── ${path.basename(folder)}`);
        const n = await processThread(msgFilesIn(folder));
        totalPosted += n;
      }

    } else {
      console.error("[fb-import] No message_N.json found here.");
      console.error("  Pass --all if this is your inbox folder.");
      process.exit(1);
    }
  }

  console.error(`\n[fb-import] ✓ Done — ${totalPosted} new messages ingested`);
}

main().catch(e => {
  console.error("[fb-import] FATAL:", e.message);
  process.exit(1);
});
