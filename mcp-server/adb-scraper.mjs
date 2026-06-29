#!/usr/bin/env node
/**
 * ADB-driven Messenger scraper.
 * Dumps uiautomator XML from the phone, extracts messages, scrolls up to load
 * older history, then POSTs everything to /ingest in chronological order.
 *
 * Usage:
 *   node adb-scraper.mjs                         # scrape currently-open thread
 *   node adb-scraper.mjs --thread "Boss"         # open+scrape a named thread
 *   node adb-scraper.mjs --all                   # iterate every thread in list
 *   node adb-scraper.mjs --list                  # print thread names and exit
 *   node adb-scraper.mjs --dry-run               # parse only, no POST
 *
 * Prerequisites:
 *   adb connected (wireless or USB), Messenger open on phone.
 *   MCP server running at localhost:8765.
 */

import { execSync, execFileSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

// ── Config ────────────────────────────────────────────────────────────────────
const INGEST_URL   = process.env.INGEST_URL || "http://localhost:8765/ingest";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const PKG          = "com.facebook.orca";
const APP_NAME     = "Messenger";
const SCREEN_W     = 720;   // Samsung A07 (SM-A075F)

// How many consecutive scrolls with zero new messages before we stop.
const IDLE_SCROLL_LIMIT = 4;
// ms to wait after each scroll for Messenger to load older messages.
const SCROLL_WAIT_MS    = 1200;
// Swipe: bottom → top on 720px screen (loads older messages)
const SWIPE_CMD = "input swipe 360 1400 360 400 400";

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const DRY_RUN   = args.includes("--dry-run");
const LIST_MODE = args.includes("--list");
const ALL_MODE  = args.includes("--all");
const THREAD_IDX = args.indexOf("--thread");
const TARGET_THREAD = THREAD_IDX >= 0 ? args[THREAD_IDX + 1] : null;

// ── ADB helpers ───────────────────────────────────────────────────────────────
// Resolve adb binary path (no quotes — execFileSync handles spaces).
function resolveAdb() {
  if (process.env.ADB_PATH) return process.env.ADB_PATH;
  const known = "D:\\abuild\\sdk\\platform-tools\\adb.exe";
  try { execFileSync(known, ["version"], { stdio: "pipe" }); return known; } catch {}
  return "adb"; // assume in PATH
}
const ADB = resolveAdb();

// Pick device serial: env ANDROID_SERIAL > first IP-based device > first device.
function resolveSerial() {
  if (process.env.ANDROID_SERIAL) return process.env.ANDROID_SERIAL;
  try {
    const out = execFileSync(ADB, ["devices"], { encoding: "utf8", timeout: 5000 });
    const lines = out.split("\n").filter((l) => l.includes("\tdevice"));
    if (lines.length === 0) return null;
    // Prefer IP-connected device (contains a colon + port)
    const ip = lines.find((l) => /^\d+\.\d+\.\d+\.\d+:\d+/.test(l.trim()));
    const chosen = (ip || lines[0]).trim().split("\t")[0];
    return chosen;
  } catch { return null; }
}
const SERIAL = resolveSerial();

function adb(shellCmd, opts = {}) {
  // Pass entire shellCmd as one argument to adb shell; avoids Windows quoting
  // issues with execSync, and the Android shell handles redirects inside it.
  const serialArgs = SERIAL ? ["-s", SERIAL] : [];
  try {
    return execFileSync(ADB, [...serialArgs, "shell", shellCmd], {
      timeout: opts.timeout || 12000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (opts.optional) return "";
    throw new Error(`adb shell ${shellCmd}\n${e.message}`);
  }
}

function adbDump() {
  // /dev/tty doesn't stream reliably via execFileSync — write to sdcard and cat.
  return adb("uiautomator dump /sdcard/nk_dump.xml >/dev/null 2>&1 && cat /sdcard/nk_dump.xml", {
    timeout: 18000,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── XML node parser ───────────────────────────────────────────────────────────
const ATTR_RE   = /(\w[\w-]*)="([^"]*)"/g;
const BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

function unesc(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, "\n");
}

function parseNodes(xml) {
  const nodes = [];
  // Match every self-closing <node ... /> or opening <node ...>
  const nodeRe = /<node((?:\s+[\w-]+=(?:"[^"]*"|'[^']*'))+)\s*\/?>/g;
  let m;
  while ((m = nodeRe.exec(xml)) !== null) {
    const raw = m[1];
    const attrs = {};
    let a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(raw)) !== null) {
      attrs[a[1]] = a[2];
    }
    const b = BOUNDS_RE.exec(attrs.bounds || "");
    if (!b) continue;
    const x1 = +b[1], y1 = +b[2], x2 = +b[3], y2 = +b[4];
    nodes.push({
      text:        unesc(attrs.text         || ""),
      desc:        unesc(attrs["content-desc"] || ""),
      resourceId:  attrs["resource-id"]    || "",
      cls:         attrs.class             || "",
      x1, y1, x2, y2,
      cx: (x1 + x2) / 2,
      cy: (y1 + y2) / 2,
      w:  x2 - x1,
      h:  y2 - y1,
    });
  }
  return nodes;
}

// ── Timestamp parsing ─────────────────────────────────────────────────────────
const TH_MON = {
  "ม.ค.": 0,"ก.พ.": 1,"มี.ค.": 2,"เม.ย.": 3,
  "พ.ค.": 4,"มิ.ย.": 5,"ก.ค.": 6,"ส.ค.": 7,
  "ก.ย.": 8,"ต.ค.": 9,"พ.ย.": 10,"ธ.ค.": 11,
};
const EN_MON = {
  Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,
  Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11,
};

function hm24(h, m, ampm) {
  h = +h; m = +m;
  if (ampm) {
    if (/pm/i.test(ampm) && h < 12) h += 12;
    if (/am/i.test(ampm) && h === 12) h = 0;
  }
  return { h, m };
}

/** Returns Unix ms or null. `ref` is a Date used for relative labels. `hint` is the
 *  earliest known timestamp from previous scrolls — used as fallback when no labels
 *  are visible so we don't assign current time to old messages. */
function parseTimestamp(text, ref) {
  const t = text.trim();
  const now = ref || new Date();

  // Thai: "วันนี้ เวลา 15:45 น." / "วันนี้ 15:45"
  if (/วันนี้/.test(t)) {
    const m = /(\d{1,2}):(\d{2})/.exec(t);
    if (m) {
      const d = new Date(now);
      d.setHours(+m[1], +m[2], 0, 0);
      return d.getTime();
    }
  }
  // Thai: "เมื่อวาน เวลา 10:30 น."
  if (/เมื่อวาน/.test(t)) {
    const m = /(\d{1,2}):(\d{2})/.exec(t);
    if (m) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      d.setHours(+m[1], +m[2], 0, 0);
      return d.getTime();
    }
  }
  // Thai: "28 มิ.ย. เวลา 20:00 น." / "28 มิ.ย. 2568 เวลา 20:00 น."
  for (const [abbr, mon] of Object.entries(TH_MON)) {
    const esc = abbr.replace(/\./g, "\\.");
    const re = new RegExp(`(\\d{1,2})\\s+${esc}(?:\\s+(\\d{4}))?\\s+(?:เวลา\\s+)?(\\d{1,2}):(\\d{2})`);
    const m = re.exec(t);
    if (m) {
      const day = +m[1];
      // Thai Buddhist Era: 2568 BE = 2025 CE
      let year = m[2] ? +m[2] - 543 : now.getFullYear();
      if (year < 2000) year = now.getFullYear();
      return new Date(year, mon, day, +m[3], +m[4], 0, 0).getTime();
    }
  }
  // English: "Today at 3:45 PM"
  if (/\btoday\b/i.test(t)) {
    const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(t);
    if (m) {
      const { h, m: mn } = hm24(m[1], m[2], m[3]);
      const d = new Date(now); d.setHours(h, mn, 0, 0);
      return d.getTime();
    }
  }
  // English: "Yesterday at 10:30 AM"
  if (/\byesterday\b/i.test(t)) {
    const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(t);
    if (m) {
      const { h, m: mn } = hm24(m[1], m[2], m[3]);
      const d = new Date(now); d.setDate(d.getDate() - 1); d.setHours(h, mn, 0, 0);
      return d.getTime();
    }
  }
  // English: "Jun 28 at 8:00 PM" / "Jun 28, 2025 at 8:00 PM"
  for (const [abbr, mon] of Object.entries(EN_MON)) {
    const re = new RegExp(`\\b${abbr}\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*(AM|PM)`, "i");
    const m = re.exec(t);
    if (m) {
      const { h, m: mn } = hm24(m[3], m[4], m[5]);
      const year = m[2] ? +m[2] : now.getFullYear();
      return new Date(year, mon, +m[1], h, mn, 0, 0).getTime();
    }
  }
  // Generic time-only: "15:45" or "3:45 PM" — happens in some Messenger versions
  {
    const m = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/.exec(t);
    if (m) {
      const { h, m: mn } = hm24(m[1], m[2], m[3]);
      const d = new Date(now); d.setHours(h, mn, 0, 0);
      return d.getTime();
    }
  }
  return null;
}

// ── Chrome filter ─────────────────────────────────────────────────────────────
const CHROME = new Set([
  "Aa","GIF","Send","Active now","Online","Sent","Seen","Delivered",
  "Typing","Typing…","Message","Messages","Search","Home","Menu","Back",
  "ส่งแล้ว","อ่านแล้ว","ออนไลน์","พิมพ์อยู่",
  "Open Photos","Camera","Voice message","Chats",
  "Unread messages","Thread details","Add custom reaction",
  "Type a message","Ask Meta AI or Search",
]);
const CHROME_RE = [
  /^ปุ่ม/,/^ตัวเลือก/,/^รูปภาพที่ \d+ จาก \d+/,/^ภาพที่ \d+ จาก \d+/,/ปุ่ม$/,
  /^ล้างคำค้นหา$/,/^ค้นหา/,/^Search( bar)?$/i,/ขยายรูปภาพ$/,
  /^Open .+'s profile$/i,   // "Open Faah Sky's profile"
  /^Seen by /i,              // "Seen by Faah Sky"
  /^Forward .+ sent by /i,   // "Forward photo sent by Cee..."
  /^Sent (photo|video|audio|sticker|GIF) message$/i,
  /^Audio call$/i, /^Video call$/i,
  /^Show more options/i,
  /^Open (camera|photo gallery|audio recorder|sticker)/i,
  /^Send 👍$/,
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i,  // day-only labels like "Fri"
  /^(Chats|People tab|Notifications|Menu Tab)/i,
  /^\d+ new updates?$/i,
];

function isChrome(t) {
  if (!t || CHROME.has(t)) return true;
  if (t.length <= 2) return true;
  if (/^[\p{L}]{1,12}$/u.test(t)) return true; // single short word = UI label
  for (const re of CHROME_RE) if (re.test(t)) return true;
  return false;
}

// Strip the accessibility suffix Messenger appends to every message content-desc.
const DOUBLE_TAP_RE = /,\s*double tap to see sent\/receive date and time.*$/i;

/** Clean raw content-desc from a message node into plain message text. */
function cleanMsgDesc(raw) {
  // Remove ", double tap to see sent/receive date and time..." suffix
  let t = raw.replace(DOUBLE_TAP_RE, "").trim();
  // Remove sender prefix "Name, " (everything up to and including first ", ")
  // Sender name is short (< 40 chars) and the rest is the message.
  const ci = t.indexOf(", ");
  if (ci > 0 && ci < 40) t = t.slice(ci + 2).trim();
  return t;
}

// ── Thread-list parsing ───────────────────────────────────────────────────────
/**
 * Extract conversation entries from the Messenger inbox screen.
 *
 * Messenger renders thread items as android.widget.Button nodes whose
 * content-desc is "<Name>, <preview>" or "<Name>, <preview>, Seen by <X>".
 * Each item spans full screen width (~720px) and is ~120-150px tall.
 * Returns [{ name, cy }] sorted top-to-bottom (cy = tap point).
 */
function parseThreadList(nodes) {
  const threads = [];
  for (const n of nodes) {
    if (n.cls !== "android.widget.Button") continue;
    // Must span (nearly) full width and be a reasonable height
    if (n.x1 > 10 || n.x2 < SCREEN_W - 10) continue;
    if (n.h < 80 || n.h > 200) continue;
    // content-desc looks like "Name, preview" or "Name, preview, Seen by X"
    const desc = n.desc || "";
    if (!desc || desc.length < 4) continue;
    // Skip non-thread buttons (navigation bar, compose, etc.)
    if (/^(New message|Ask Meta AI|Facebook App|Chats|People|Menu)/.test(desc)) continue;

    const commaIdx = desc.indexOf(", ");
    const name = commaIdx > 0 ? desc.slice(0, commaIdx).trim() : desc.trim();
    if (!name || name.length > 80) continue;

    threads.push({ name, cy: n.cy, cx: n.cx, y1: n.y1 });
  }
  // Sort top-to-bottom, deduplicate by name (keep first occurrence)
  threads.sort((a, b) => a.y1 - b.y1);
  const seen = new Map();
  for (const t of threads) {
    if (!seen.has(t.name)) seen.set(t.name, t);
  }
  return [...seen.values()];
}

// ── Message extraction ────────────────────────────────────────────────────────
/**
 * From a uiautomator XML dump of an open Messenger thread, extract messages.
 * Returns { convo, messages: [{text, side, time}] }
 *
 * Messenger message nodes carry content-desc like:
 *   "SenderName, MessageText, double tap to see sent/receive date and time..."
 * Timestamp nodes have text like "9:52 PM", "Today at 3:00 PM", "Jun 28 at 8:00 PM".
 */
function extractMessages(xml, currentTimeMs) {
  const nodes = parseNodes(xml);
  const now = currentTimeMs || Date.now();

  // Conversation name: the thread header node has content-desc="<Name>, Thread details"
  const headerNode = nodes.find(
    (n) => (n.desc || "").includes("Thread details") && n.y1 < 200
  );
  const convo = headerNode
    ? headerNode.desc.replace(/,\s*Thread details$/i, "").trim()
    : (nodes
        .filter((n) => n.y1 < 200 && n.text && n.text.length > 1 && !isChrome(n.text))
        .sort((a, b) => a.y1 - b.y1)[0]?.text || "Messenger");

  // Walk all nodes top-to-bottom; build two lists: messages and timestamp labels.
  const sorted = nodes.slice().sort((a, b) => a.y1 !== b.y1 ? a.y1 - b.y1 : a.x1 - b.x1);
  const ref   = new Date(now);

  // Pass 1: separate message nodes from timestamp labels.
  const msgEvents = [];  // { text, side, cy }
  const tsEvents  = [];  // { ts, cy }

  for (const n of sorted) {
    if (n.y1 > 1440) continue; // skip input bar region
    const raw = n.text || n.desc;
    if (!raw) continue;

    // Timestamp/date label
    const ts = parseTimestamp(raw, ref);
    if (ts !== null) { tsEvents.push({ ts, cy: n.cy }); continue; }

    // Skip chrome
    if (isChrome(raw)) continue;

    // Messenger message node: content-desc ends with "double tap to see..."
    if (DOUBLE_TAP_RE.test(raw)) {
      const text = cleanMsgDesc(raw);
      if (!text || text.length < 1 || isChrome(text)) continue;
      const side = n.cx > SCREEN_W * 0.55 ? "me" : "them";
      msgEvents.push({ text, side, cy: n.cy });
    }
  }

  // Pass 2: assign each message the timestamp label nearest in Y position.
  // If no timestamp labels are visible on this screen (common mid-scroll),
  // fall back to `currentTimeMs` which the caller sets to the earliest
  // timestamp seen across all scrolls so far — avoids stamping old messages
  // with the current wall-clock time.
  const fallback = currentTimeMs || now;
  const messages = msgEvents.map((ev) => {
    let bestTs = fallback, bestDist = Infinity;
    for (const t of tsEvents) {
      const d = Math.abs(t.cy - ev.cy);
      if (d < bestDist) { bestDist = d; bestTs = t.ts; }
    }
    return { text: ev.text, side: ev.side, time: bestTs };
  });

  return { convo, messages };
}

// ── Scrape one thread (phone already has it open) ─────────────────────────────
async function scrapeCurrentThread() {
  const seen   = new Set();   // key = text|side|dayBucket
  const result = [];          // { text, side, time }
  let idleScrolls = 0;
  let scrollCount = 0;
  // Track the earliest real timestamp seen so far.  Passed as `currentTimeMs`
  // to extractMessages so screens without date labels don't get wall-clock time.
  let hintTs = null;

  console.error("[scraper] Starting dump loop…");

  while (true) {
    const xml   = adbDump();
    const { convo, messages } = extractMessages(xml, hintTs);

    let newThisRound = 0;
    for (const msg of messages) {
      const day = Math.floor(msg.time / 86400000);
      const key = `${msg.text}|${msg.side}|${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...msg, convo });
      newThisRound++;
      // Keep hintTs = earliest timestamp seen (we scroll UP = older messages)
      if (hintTs === null || msg.time < hintTs) hintTs = msg.time;
    }

    console.error(`[scraper] scroll #${scrollCount} → ${newThisRound} new (total ${result.length})`);

    if (newThisRound === 0) {
      idleScrolls++;
      if (idleScrolls >= IDLE_SCROLL_LIMIT) {
        console.error(`[scraper] No new messages after ${IDLE_SCROLL_LIMIT} scrolls — reached top.`);
        break;
      }
    } else {
      idleScrolls = 0;
    }

    // Scroll up (swipe finger down → loads older messages)
    adb(SWIPE_CMD, { optional: true });
    scrollCount++;
    await sleep(SCROLL_WAIT_MS);
  }

  return result;
}

// ── Navigate to a thread by name ──────────────────────────────────────────────
async function openThread(name) {
  // Press BACK in case we're inside a thread already, then wait for inbox to load
  adb("input keyevent 4", { optional: true });
  await sleep(1000);

  const xml   = adbDump();
  const nodes = parseNodes(xml);
  const list  = parseThreadList(nodes);
  const entry = list.find((t) => t.name.toLowerCase().includes(name.toLowerCase()));
  if (!entry) {
    throw new Error(`Thread "${name}" not found on screen. Visible: ${list.map((t) => t.name).join(", ")}`);
  }
  console.error(`[scraper] Opening thread "${entry.name}" at (${Math.round(entry.cx)}, ${Math.round(entry.cy)})`);
  adb(`input tap ${Math.round(entry.cx)} ${Math.round(entry.cy)}`);
  await sleep(1800); // wait for thread to load
}

async function backToThreadList() {
  adb("input keyevent 4", { optional: true }); // KEYCODE_BACK
  await sleep(1000);
}

// ── POST to /ingest ───────────────────────────────────────────────────────────
let _nextId = Date.now(); // large ID, won't collide with phone's sequential IDs

function buildRows(messages, convo) {
  return messages
    .sort((a, b) => a.time - b.time) // chronological order (explicit ask)
    .map((msg) => ({
      id:     _nextId++,
      source: "adb-scrape",
      app:    APP_NAME,
      pkg:    PKG,
      title:  convo || msg.convo || "Messenger",
      text:   msg.text,
      side:   msg.side,
      time:   msg.time,
    }));
}

function postIngest(rows) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(rows);
    const url    = new URL(INGEST_URL);
    const isHttps = url.protocol === "https:";
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method:   "POST",
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(INGEST_TOKEN ? { Authorization: `Bearer ${INGEST_TOKEN}` } : {}),
      },
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Verify ADB connection
  if (!SERIAL) {
    console.error("[scraper] ERROR: no adb device. Run: adb connect 192.168.1.107:<port>");
    process.exit(1);
  }
  console.error(`[scraper] Device: ${SERIAL}`);

  // --list mode
  if (LIST_MODE) {
    const xml  = adbDump();
    const list = parseThreadList(parseNodes(xml));
    console.log("Threads visible on screen:");
    list.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
    return;
  }

  // --thread mode: navigate to thread first
  if (TARGET_THREAD) {
    await openThread(TARGET_THREAD);
  }

  // --all mode: enumerate threads, scrape each
  if (ALL_MODE) {
    const xml  = adbDump();
    const list = parseThreadList(parseNodes(xml));
    console.error(`[scraper] Found ${list.length} threads. Scraping all…`);
    let totalPosted = 0;

    for (const thread of list) {
      console.error(`\n[scraper] ══ Thread: ${thread.name} ══`);
      adb(`input tap ${Math.round(thread.cx)} ${Math.round(thread.cy)}`);
      await sleep(1800);

      const messages = await scrapeCurrentThread();
      const rows = buildRows(messages, thread.name);

      if (DRY_RUN) {
        console.log(`[dry-run] ${thread.name}: ${rows.length} messages`);
        rows.slice(0, 3).forEach((r) => console.log(`  ${r.side} @ ${new Date(r.time).toISOString()}: ${r.text.slice(0, 80)}`));
      } else if (rows.length > 0) {
        const res = await postIngest(rows);
        console.error(`[scraper] POST → received=${res.received} total=${res.total}`);
        totalPosted += res.received || 0;
      }

      await backToThreadList();
      await sleep(800);
    }

    console.error(`\n[scraper] Done. Total new messages posted: ${totalPosted}`);
    return;
  }

  // Default: scrape whatever thread is currently open on the phone
  const messages = await scrapeCurrentThread();

  // Figure out the conversation name from the first message
  const convo = messages[0]?.convo || "Messenger";
  const rows  = buildRows(messages, convo);

  console.error(`\n[scraper] Collected ${rows.length} messages from "${convo}"`);

  if (rows.length === 0) {
    console.error("[scraper] Nothing to post.");
    return;
  }

  // Preview (always shown)
  const preview = rows.slice(0, 5);
  console.error("Preview (oldest 5):");
  for (const r of preview) {
    const ts = new Date(r.time).toLocaleString("th-TH");
    console.error(`  [${r.side}] ${ts}: ${r.text.slice(0, 80)}`);
  }

  if (DRY_RUN) {
    console.error("[dry-run] Skipping POST.");
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const res = await postIngest(rows);
  console.error(`[scraper] POST result: received=${res.received} total=${res.total}`);
}

main().catch((e) => { console.error("[scraper] FATAL:", e.message); process.exit(1); });
