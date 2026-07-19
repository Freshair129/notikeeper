#!/usr/bin/env node
/**
 * NotiKeeper — ADB Messenger scraper
 * ----------------------------------
 * Drives the phone over (wireless) adb to read a Messenger conversation that is
 * ALREADY OPEN on screen, scrolls up through history, and POSTs every new
 * message line into the NotiKeeper ingest endpoint (so it lands in data.jsonl
 * → SQLite → graph → embeddings, same as the app's own upload).
 *
 * Why "currently-open thread" instead of auto-navigating: tapping the right row
 * blindly is fragile across locales/layouts. You open the thread, the script
 * does the tedious scroll+read+dedup. Run it once per conversation.
 *
 * REQUIREMENTS
 *   - Node 18+ (uses global fetch). You have Node 24.
 *   - adb connected to the phone (wireless pair already done this project).
 *   - The NotiKeeper server running on :8765 (the /ingest target).
 *   - Messenger open ON the conversation you want, scrolled to the BOTTOM
 *     (newest message visible) before you start.
 *
 * USAGE (PowerShell)
 *   $env:Path="C:\Users\freshair\AppData\Local\GoVibeToolchains\node-v24.16.0-win-x64;$env:Path"
 *   node G:\NotiKeeper\mcp-server\scraper.mjs
 *   node G:\NotiKeeper\mcp-server\scraper.mjs --rounds 60      # scroll more
 *   node G:\NotiKeeper\mcp-server\scraper.mjs --dry            # don't POST, just print
 *
 * ENV overrides: ADB, ADB_DEVICE, INGEST
 *
 * NOTE ON TIMESTAMPS: Messenger does not render a time on every bubble, so
 * scraped rows are stamped with capture-time and flagged source="scrape"
 * (time_exact = false). For an accurate historical timeline use the Facebook
 * "Download Your Information" (DYI) importer instead — this scraper is for
 * capturing *new* messages before they can be deleted.
 */
import { execFileSync } from "node:child_process";
import { detectLegacyTitle, extractLegacyMessage, fetchExistingMessages, isLegacyChrome, legacySideOf, parseLegacyAnchor, parseLegacyTextNodes, postJsonIngest, sleep } from "./adb-lib.mjs";
import { DEFAULT_INGEST_URL } from "./config.mjs";

const arg = (name, def = null) => {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
};

const ADB = process.env.ADB || "D:\\abuild\\sdk\\platform-tools\\adb.exe";
const DEVICE = process.env.ADB_DEVICE || "192.168.1.107:35417";
const INGEST = process.env.INGEST || DEFAULT_INGEST_URL;
const ROUNDS = parseInt(arg("--rounds", "40"), 10);
const DRY = !!arg("--dry", false);
const SETTLE_MS = 700;          // wait after each swipe for the list to settle

function adb(args, { binary = false } = {}) {
  return execFileSync(ADB, ["-s", DEVICE, ...args], {
    encoding: binary ? "buffer" : "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}


/** Screen size → {w,h}. */
function screenSize() {
  const out = adb(["shell", "wm", "size"]);            // "Physical size: 720x1600"
  const m = out.match(/(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 1080, h: 2400 };
}

/** Dump the current window hierarchy and return the XML text. */
function dumpUI() {
  // exec-out cat avoids a separate `adb pull` round-trip
  adb(["shell", "uiautomator", "dump", "/sdcard/nk_dump.xml"]);
  return adb(["shell", "cat", "/sdcard/nk_dump.xml"]);
}

/** Very small attribute extractor for uiautomator <node .../> elements. */
function localParseNodes(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const text = (attrs.match(/\btext="([^"]*)"/) || [, ""])[1];
    if (!text) continue;
    const bounds = (attrs.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) );
    if (!bounds) continue;
    const x1 = +bounds[1], y1 = +bounds[2], x2 = +bounds[3], y2 = +bounds[4];
    nodes.push({
      text: decodeEntities(text),
      x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
    });
  }
  return nodes;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Conversation title = the highest short text in the top app-bar zone. */
function localDetectTitle(nodes, h) {
  const top = nodes.filter((n) => n.y2 < h * 0.13 && n.text.length <= 40);
  top.sort((a, b) => a.y1 - b.y1);
  // skip obvious chrome
  const t = top.find((n) => !CHROME.has(n.text));
  return t ? t.text : "Messenger";
}

const CHROME = new Set([
  "Aa", "GIF", "Send", "Search", "Ask Meta AI or Search", "Share a song",
  "Create story", "Active now", "Online", "Sent", "Seen", "Delivered",
  "ส่งแล้ว", "อ่านแล้ว", "ออนไลน์", "พิมพ์อยู่", "ย้อนกลับ", "เมนู", "ค้นหา",
  "โทร", "วิดีโอคอล", "ข้อมูล", "Message", "Call again", "Audio call",
  "Video call", "Missed call", "Missed audio call", "Missed video call",
]);

// Trailing boilerplate Messenger appends to every message's contentDescription.
const BOILERPLATE_RE = /, double tap to see sent\/receive date and time.*$/i;

// Chrome that varies (so can't be a fixed Set member).
const CHROME_RE = /^(Delivered\b.*|Sent\b.*|Seen\b.*|\d+\s*(sec|min|mins|minute|minutes|hour|hours)\b.*|You (called|missed).*|.* reacted .*|Reply|Forward|React)$/i;

// Time / date anchors. Messenger formats: "SUN AT 11:55 PM", "YESTERDAY AT 9:41 PM",
// "TODAY AT 9:52 PM", "11:55 PM", and Thai weekday/relative forms.
const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const ANCHOR_FULL_RE = /^(SUN|MON|TUE|WED|THU|FRI|SAT|TODAY|YESTERDAY)\s+AT\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const ANCHOR_TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

/**
 * Pull (sender, body) out of a Messenger message contentDescription.
 * Pattern: "<Sender>, <message body>, double tap to see ..."
 * Returns null if it isn't a message bubble.
 */
function localExtractMessage(rawText) {
  let t = rawText.trim();
  if (!BOILERPLATE_RE.test(t)) return null;            // only real bubbles carry this
  t = t.replace(BOILERPLATE_RE, "");                   // -> "Sender, body"
  const c = t.indexOf(", ");
  if (c === -1) return { sender: null, body: t.trim() };
  const sender = t.slice(0, c).trim();
  const body = t.slice(c + 2).trim();
  if (!body) return null;
  return { sender, body };
}

/** Resolve a time/date anchor to epoch-ms (best effort), else null. */
function localParseAnchor(rawText, now = Date.now()) {
  const t = rawText.trim();
  let m = t.match(ANCHOR_FULL_RE);
  let hh, mm, ap, dayKey = null;
  if (m) { dayKey = m[1].toUpperCase(); hh = +m[2]; mm = +m[3]; ap = m[4].toUpperCase(); }
  else { m = t.match(ANCHOR_TIME_RE); if (!m) return null; hh = +m[1]; mm = +m[2]; ap = m[3].toUpperCase(); }
  if (ap === "PM" && hh !== 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;

  const d = new Date(now);
  d.setSeconds(0, 0); d.setHours(hh, mm, 0, 0);
  if (dayKey === "YESTERDAY") d.setDate(d.getDate() - 1);
  else if (dayKey && dayKey in DOW) {
    // most recent past date with that weekday
    let back = (d.getDay() - DOW[dayKey] + 7) % 7;
    if (back === 0 && d.getTime() > now) back = 7;
    d.setDate(d.getDate() - back);
  }
  if (d.getTime() > now + 60_000) d.setDate(d.getDate() - 1);  // future → roll back a day
  return d.getTime();
}

function localIsChrome(t) {
  const s = t.trim();
  return !s || CHROME.has(s) || CHROME_RE.test(s);
}

/** side from horizontal position: right half = me, left = them. */
function localSideOf(n, w) {
  return n.cx > w * 0.55 ? "me" : "them";
}

async function localFetchExistingKeys() {
  // Pull current Messenger rows so re-runs don't double-post identical lines.
  try {
    const r = await fetch(INGEST.replace("/ingest", "/api/messages") + "?app=Messenger&limit=10000");
    if (!r.ok) return new Set();
    const j = await r.json();
    return new Set((j.rows || []).map((m) => `${m.title}|${m.side}|${m.text}`));
  } catch {
    return new Set();
  }
}

async function main() {
  console.log(`[scraper] device=${DEVICE} ingest=${INGEST} rounds=${ROUNDS} dry=${DRY}`);
  const { w, h } = screenSize();
  console.log(`[scraper] screen ${w}x${h}`);

  const existing = await fetchExistingMessages(INGEST, 10000);
  console.log(`[scraper] ${existing.size} Messenger rows already on server`);

  const collected = new Map();   // key -> {title, side, sender, text, time}
  let title = "Messenger";
  let emptyRounds = 0;

  for (let round = 0; round < ROUNDS; round++) {
    const xml = dumpUI();
    const nodes = parseLegacyTextNodes(xml);
    if (round === 0) title = detectLegacyTitle(nodes, h, CHROME, 0.13);

    // Walk nodes top→bottom (older→newer); track the most recent time anchor seen
    // above so each message inherits an approximate timestamp.
    nodes.sort((a, b) => a.y1 - b.y1);
    let curAnchor = null;
    let newThisRound = 0;
    for (const n of nodes) {
      const raw = n.text.trim();
      if (n.y2 < h * 0.12 || n.y1 > h * 0.90) continue;   // app bar / composer
      const a = parseLegacyAnchor(raw);
      if (a) { curAnchor = a; continue; }
      const msg = extractLegacyMessage(raw);
      if (!msg) continue;
      if (isLegacyChrome(msg.body, CHROME, CHROME_RE)) continue;
      const side = legacySideOf(n, w);
      const key = `${title}|${side}|${msg.body}`;
      if (existing.has(key) || collected.has(key)) continue;
      collected.set(key, { title, side, sender: msg.sender, text: msg.body, time: curAnchor });
      newThisRound++;
    }
    console.log(`[scraper] round ${round + 1}/${ROUNDS}: +${newThisRound} new (total ${collected.size})`);

    if (newThisRound === 0) { emptyRounds++; if (emptyRounds >= 2) { console.log("[scraper] reached top (2 empty rounds)"); break; } }
    else emptyRounds = 0;

    // scroll UP to reveal older history: drag finger downward
    const x = Math.floor(w / 2);
    adb(["shell", "input", "swipe", `${x}`, `${Math.floor(h * 0.35)}`, `${x}`, `${Math.floor(h * 0.82)}`, "350"]);
    await sleep(SETTLE_MS);
  }

  const items = [...collected.values()];
  console.log(`[scraper] collected ${items.length} new messages from "${title}"`);

  if (DRY) {
    for (const it of items.slice(0, 40)) {
      const ts = it.time ? new Date(it.time).toLocaleString() : "(no time)";
      console.log(`  [${ts}] (${it.side}) ${it.sender ? it.sender + ": " : ""}${it.text}`);
    }
    if (items.length > 40) console.log(`  … +${items.length - 40} more`);
    return;
  }
  if (!items.length) { console.log("[scraper] nothing new to post"); return; }

  // POST in one batch. Stable-ish ids from a base timestamp + index.
  const base = Date.now();
  const payload = items.map((it, i) => ({
    id: base * 1000 + i,
    source: "scrape",
    app: "Messenger",
    pkg: "com.facebook.orca",
    title: it.title,
    sender: it.sender || null,
    text: it.text,
    side: it.side,
    time: it.time || base,   // anchor time when found; else capture time
    time_exact: false,
  }));

  const { response, body } = await postJsonIngest(INGEST, payload);
  console.log(`[scraper] POST -> ${response.status} ${JSON.stringify(body)}`);
}

main().catch((e) => { console.error("[scraper] FAILED:", e.message); process.exit(1); });
