#!/usr/bin/env node
/**
 * NotiKeeper — ADB Messenger ALL-THREADS crawler
 * ----------------------------------------------
 * Opens Messenger, walks the inbox, and for each conversation: taps in,
 * scrolls history to the top capturing every message (real sender + approx
 * time from a11y descriptions), POSTs to /ingest, backs out, next thread.
 * Scrolls the inbox to reach threads below the fold.
 *
 * Self-contained (duplicates the parse helpers from scraper.mjs on purpose so
 * one file = one run; keep the two parsers in sync if you tweak heuristics).
 *
 * USAGE
 *   $env:ADB_DEVICE="192.168.1.107:38721"
 *   node G:\NotiKeeper\mcp-server\scrape-all.mjs --max 30 --rounds 60
 *   node G:\NotiKeeper\mcp-server\scrape-all.mjs --dry          # don't POST
 */
import { execFileSync } from "node:child_process";
import { detectLegacyTitle, extractLegacyMessage, fetchExistingMessages, isLegacyChrome, LEGACY_BUBBLE_RE, legacySideOf, parseLegacyAnchor, parseLegacyTextNodes, postJsonIngest, sleep } from "./adb-lib.mjs";
import { DEFAULT_INGEST_URL } from "./config.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith("--") ? v : true; };
const ADB = process.env.ADB || "D:\\abuild\\sdk\\platform-tools\\adb.exe";
const DEVICE = process.env.ADB_DEVICE || "192.168.1.107:38721";
const INGEST = process.env.INGEST || DEFAULT_INGEST_URL;
const MAX_THREADS = parseInt(arg("--max", "30"), 10);
const ROUNDS = parseInt(arg("--rounds", "60"), 10);
const DRY = !!arg("--dry", false);
const SETTLE = 700;

const adb = (args, bin = false) => execFileSync(ADB, ["-s", DEVICE, ...args], { encoding: bin ? "buffer" : "utf8", maxBuffer: 64 * 1024 * 1024 });

function screenSize() { const m = adb(["shell", "wm", "size"]).match(/(\d+)x(\d+)/); return m ? { w: +m[1], h: +m[2] } : { w: 720, h: 1600 }; }
function dumpUI() { adb(["shell", "uiautomator", "dump", "/sdcard/nk.xml"]); return adb(["shell", "cat", "/sdcard/nk.xml"]); }
function decode(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function parseNodes(xml) {
  const out = []; const re = /<node\b([^>]*?)\/?>/g; let m;
  while ((m = re.exec(xml)) !== null) {
    const a = m[1]; const text = (a.match(/\btext="([^"]*)"/) || [, ""])[1]; if (!text) continue;
    const b = a.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); if (!b) continue;
    const x1 = +b[1], y1 = +b[2], x2 = +b[3], y2 = +b[4];
    out.push({ text: decode(text), x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
  }
  return out;
}

const BOILERPLATE_RE = /, double tap to see sent\/receive date and time.*$/i;
const CHROME = new Set(["Aa","GIF","Send","Search","Message","Call again","Audio call","Video call","Missed call","Active now","Online","Sent","Seen","Delivered"]);
const CHROME_RE = /^(Delivered\b.*|Sent\b.*|Seen\b.*|\d+\s*(sec|min|mins|minute|minutes|hour|hours)\b.*|You (called|missed).*|Reply|Forward|React)$/i;
const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const ANCHOR_FULL_RE = /^(SUN|MON|TUE|WED|THU|FRI|SAT|TODAY|YESTERDAY)\s+AT\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const ANCHOR_TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

function extractMessage(raw) {
  let t = raw.trim(); if (!BOILERPLATE_RE.test(t)) return null;
  t = t.replace(BOILERPLATE_RE, ""); const c = t.indexOf(", ");
  if (c === -1) return { sender: null, body: t.trim() };
  const sender = t.slice(0, c).trim(), body = t.slice(c + 2).trim();
  return body ? { sender, body } : null;
}
function parseAnchor(raw, now = Date.now()) {
  const t = raw.trim(); let m = t.match(ANCHOR_FULL_RE), hh, mm, ap, day = null;
  if (m) { day = m[1].toUpperCase(); hh = +m[2]; mm = +m[3]; ap = m[4].toUpperCase(); }
  else { m = t.match(ANCHOR_TIME_RE); if (!m) return null; hh = +m[1]; mm = +m[2]; ap = m[3].toUpperCase(); }
  if (ap === "PM" && hh !== 12) hh += 12; if (ap === "AM" && hh === 12) hh = 0;
  const d = new Date(now); d.setHours(hh, mm, 0, 0);
  if (day === "YESTERDAY") d.setDate(d.getDate() - 1);
  else if (day && day in DOW) { let back = (d.getDay() - DOW[day] + 7) % 7; if (back === 0 && d.getTime() > now) back = 7; d.setDate(d.getDate() - back); }
  if (d.getTime() > now + 60000) d.setDate(d.getDate() - 1);
  return d.getTime();
}
const isChrome = (t) => { const s = t.trim(); return !s || CHROME.has(s) || CHROME_RE.test(s); };
const sideOf = (n, w) => (n.cx > w * 0.55 ? "me" : "them");

/** Inbox conversation rows: a11y title nodes (Messenger marks them w/ trailing "."). */
function inboxThreads(nodes, w, h) {
  const out = [];
  for (const n of nodes) {
    const t = n.text.trim();
    if (n.cy < h * 0.32 || n.cy > h * 0.93) continue;     // skip stories carousel + nav
    if (n.cx > w * 0.62) continue;                         // skip right-side time/status
    if (t.includes(":")) continue;                         // skip "You: ..." preview lines
    if (!t.endsWith(".")) continue;                        // names carry a trailing period
    const name = t.replace(/\.$/, "").trim();
    if (name.length < 2 || name.length > 40) continue;
    out.push({ name, cx: Math.floor(n.cx), cy: Math.floor(n.cy) });
  }
  return out;
}

function inConversation(nodes) { return nodes.some((n) => BOILERPLATE_RE.test(n.text)); }
function detectTitle(nodes, h) { const top = nodes.filter((n) => n.y2 < h * 0.14 && n.text.trim().length <= 40 && !CHROME.has(n.text.trim())); top.sort((a, b) => a.y1 - b.y1); return top[0]?.text.trim() || "Messenger"; }

async function fetchExisting() {
  try { const r = await fetch(INGEST.replace("/ingest", "/api/messages") + "?app=Messenger&limit=20000"); if (!r.ok) return new Set(); const j = await r.json(); return new Set((j.rows || []).map((m) => `${m.title}|${m.side}|${m.text}`)); }
  catch { return new Set(); }
}

async function scrapeOpenThread(existing, w, h) {
  const collected = new Map(); let title = "Messenger"; let empty = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const nodes = parseLegacyTextNodes(dumpUI());
    if (round === 0) title = detectLegacyTitle(nodes, h, CHROME, 0.14);
    nodes.sort((a, b) => a.y1 - b.y1);
    let anchor = null, fresh = 0;
    for (const n of nodes) {
      const raw = n.text.trim();
      if (n.y2 < h * 0.12 || n.y1 > h * 0.90) continue;
      const a = parseLegacyAnchor(raw); if (a) { anchor = a; continue; }
      const msg = extractLegacyMessage(raw); if (!msg || isLegacyChrome(msg.body, CHROME, CHROME_RE)) continue;
      const side = legacySideOf(n, w); const key = `${title}|${side}|${msg.body}`;
      if (existing.has(key) || collected.has(key)) continue;
      collected.set(key, { title, side, sender: msg.sender, text: msg.body, time: anchor }); fresh++;
    }
    if (fresh === 0) { if (++empty >= 2) break; } else empty = 0;
    const x = Math.floor(w / 2);
    adb(["shell", "input", "swipe", `${x}`, `${Math.floor(h * 0.35)}`, `${x}`, `${Math.floor(h * 0.82)}`, "350"]);
    await sleep(SETTLE);
  }
  return { title, items: [...collected.values()] };
}

async function post(items) {
  if (DRY || !items.length) return 0;
  const base = Date.now();
  const payload = items.map((it, i) => ({ id: base * 1000 + i, source: "scrape", app: "Messenger", pkg: "com.facebook.orca", title: it.title, sender: it.sender || null, text: it.text, side: it.side, time: it.time || base, time_exact: false }));
  const { body } = await postJsonIngest(INGEST, payload); return body.received || 0;
}

async function main() {
  console.log(`[all] device=${DEVICE} max=${MAX_THREADS} rounds=${ROUNDS} dry=${DRY}`);
  adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  adb(["shell", "monkey", "-p", "com.facebook.orca", "-c", "android.intent.category.LAUNCHER", "1"]);
  await sleep(4000);
  // make sure we're at the inbox root (back out of any open thread)
  for (let i = 0; i < 3; i++) { const n = parseLegacyTextNodes(dumpUI()); if (!inConversation(n)) break; adb(["shell", "input", "keyevent", "KEYCODE_BACK"]); await sleep(1500); }

  const { w, h } = screenSize();
  const existing = await fetchExistingMessages(INGEST, 20000);
  console.log(`[all] screen ${w}x${h} · ${existing.size} Messenger rows on server`);

  const visited = new Set();
  let totalPosted = 0, idleScrolls = 0;

  while (visited.size < MAX_THREADS && idleScrolls < 3) {
    const inbox = inboxThreads(parseLegacyTextNodes(dumpUI()), w, h);
    const todo = inbox.filter((t) => !visited.has(t.name));
    if (todo.length === 0) {
      // nothing new on screen → scroll inbox down for more
      const x = Math.floor(w / 2);
      adb(["shell", "input", "swipe", `${x}`, `${Math.floor(h * 0.8)}`, `${x}`, `${Math.floor(h * 0.3)}`, "350"]);
      await sleep(SETTLE); idleScrolls++; continue;
    }
    idleScrolls = 0;
    for (const t of todo) {
      if (visited.size >= MAX_THREADS) break;
      visited.add(t.name);
      adb(["shell", "input", "tap", `${t.cx}`, `${t.cy}`]);
      await sleep(2500);
      const nodes = parseLegacyTextNodes(dumpUI());
      if (!inConversation(nodes)) { console.log(`[all] "${t.name}" — not a conversation, skip`); adb(["shell", "input", "keyevent", "KEYCODE_BACK"]); await sleep(1500); continue; }
      const { title, items } = await scrapeOpenThread(existing, w, h);
      const n = await post(items);
      for (const it of items) existing.add(`${it.title}|${it.side}|${it.text}`);
      totalPosted += n;
      console.log(`[all] (${visited.size}/${MAX_THREADS}) "${title}" → +${n} posted (collected ${items.length})`);
      adb(["shell", "input", "keyevent", "KEYCODE_BACK"]); await sleep(1800);
    }
  }
  console.log(`[all] DONE — visited ${visited.size} threads, posted ${totalPosted} new messages`);
}
main().catch((e) => { console.error("[all] FAILED:", e.stack || e.message); process.exit(1); });
