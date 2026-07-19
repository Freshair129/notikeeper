#!/usr/bin/env node
/**
 * Rebuilds a clean chat log from data.jsonl, across every chat app the phone
 * captures (Messenger, Facebook, Instagram, WhatsApp, LINE, Telegram — see
 * CHAT_APPS below). The noise filters were written against Messenger/Facebook
 * UI vocabulary, so they're a solid baseline everywhere but least precise on
 * apps that weren't the original target.
 *
 * Strategy:
 *   1. Read all rows whose app is in CHAT_APPS
 *   2. Filter threads whose title looks like a real person/group name
 *      (discard obvious chrome labels: "Open the home page", etc.)
 *   3. Within each (app, thread) group, filter messages through a chrome
 *      list + the existing noise filter; keep only messages that look real
 *   4. Deduplicate (same text+side within 5-second window)
 *   5. Sort chronologically and write one .txt file per thread under chatlog/
 *
 * Usage:
 *   node rebuild-chatlog.mjs                  # reads data.jsonl, writes chatlog/
 *   node rebuild-chatlog.mjs --min-msgs 5     # skip threads with < N clean msgs
 *   node rebuild-chatlog.mjs --stdout         # print to stdout instead of files
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSharedChromeLabel } from "./noise.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.NOTIKEEPER_DATA || path.join(__dirname, "data.jsonl");
const OUT_DIR   = path.join(__dirname, "chatlog");

const argv          = process.argv.slice(2);
const STDOUT        = argv.includes("--stdout");
const INCLUDE_SCREEN= argv.includes("--include-screen"); // default: skip screen source
const MIN_IDX       = argv.indexOf("--min-msgs");
const MIN_MSGS      = MIN_IDX >= 0 ? parseInt(argv[MIN_IDX + 1], 10) : 3;

// ── Thread-name quality filter ────────────────────────────────────────────────
// Patterns that indicate a Messenger UI node, not a real conversation title.
const JUNK_TITLE_RE = [
  // Navigation / action labels
  /^Open /i,
  /^Close /i,
  /^Navigate /i,
  /^Go to /i,
  /navigation drawer/i,
  /^New [Mm]essage/,
  /^QR /i,
  /^Clear /i,
  /^Search/i,
  /^Ask Meta AI/i,
  /^Story /i,
  /^Facebook App/i,
  /^Add people/i,
  /^Swipe /i,
  /^Available add-ons/i,
  /^Web [Vv]iew/,
  /^(Google|Microsoft|Samsung|GitHub|KBank|Lazada|WhatsApp|Instagram)\b/i,
  /^a11y-/,
  /^Asana /i,
  /End-to-end encrypted call/i,
  /^Missed /i,
  /https?:\/\//,
  /^TRUE-H/i,
  /^You, Camera/i,
  /^Chat profile/i,
  /^View profile/i,
  /^Message request/i,
  /^Active now?$/i,
  /^Delivered$/i,
  /^Seen$/i,
  /^\d+ of \d+$/,
  /\bTab \d+ of \d+/i,
  /\bSection \d+/i,
  /\bheader\.?\s/i,
  /,\s*switch into your page/i,
  /,\s*see your profile/i,
  /,\s*use this account/i,
  /\bDropdown\b/i,
  /^Panel contains/i,
  /^Click to dismiss/i,
  /^Applications are using/i,
  /^Logged in as/i,
  /^Showing a Map/i,
  /^Drag handle/i,
  /^Select app/i,
  /^Storage location/i,
  /^Wireless debugging/i,
  /^Voice search/i,
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i,
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  // Thai UI labels
  /^ย้อนกลับ/,
  /^ล้างคำค้นหา/,
  /^การค้นหา/,
  /^ตัวเลือก/,
  /^มุมมองเว็บ/,
  /^ข้อความที่ยังไม่ได้อ่าน/,
  /^เปิดหน้าแรก/,
  /^นโยบายความเป็นส่วนตัว/,
  /^คุณ ปิดกล้อง/,
  /^ไปที่หน้าจอก่อนหน้า/,
  /^การโทรที่เข้ารหัส/,
  /^ไดรฟ์$/,
  /^โทรศัพท์$/,
  /^เมนู$/,
  /^โหมดแฟลช/,
  /^เพิ่มใน/,
  /^สั่งเพิ่ม/,
  /^การโทร/,
];

// Single-word common English UI actions that are definitely not person names
const SINGLE_WORD_JUNK = new Set([
  "Messenger","Messages","Chats","Home","Menu","Back","Close","Cancel",
  "Upload","Download","Edit","Delete","Share","Save","Send","Search",
  "Scan","Loading","Video","Photo","Camera","Audio","Call","Notifications",
  "People","Groups","Settings","Profile","Privacy","Passwords","Storage",
  "GitHub","Google","Samsung","Microsoft","KBank","Lazada","Grab",
  "WhatsApp","Instagram","Facebook","Telegram","Drive","New",
  "Add","More","Done","Next","Skip","Retry","Report","Block",
  "Unblock","Mute","Unmute","Pin","Unpin","Archive","Unarchive",
  "React","Reply","Forward","Unsend","Copy","Bookmark","Remind",
  "Tasks","Captions","Print","Info","Help","Support","About",
  "Legal","Terms","Policy","Map","Location","Nearby","Online",
  // Thai single words
  "เมนู","ปิด","ยกเลิก","ส่ง","แชร์","บันทึก","ลบ","แก้ไข","ค้นหา",
  "โทรศัพท์","วิดีโอ","รูปภาพ","กล้อง","เพิ่ม","ถัดไป","เสร็จ",
  "ย้อนกลับ","โหลด","อัปโหลด","ดาวน์โหลด","ข้ามไป","ตั้งค่า",
]);

const JUNK_TITLES = new Set([
  "New Message","New message","Chats","Home","Menu","Back",
  "Notifications","More options","Sent","Seen","Delivered",
  "Active Now","Typing","Typing…","GIF","Send","Camera","Audio call","Video call",
  "Search Google or type URL","Ask Meta AI or Search","Messenger",
  "Add to story","Story tray","Facebook","Open the home page","เปิดหน้าแรก",
  "Cover Photo","Cover photo","Web View","Auto Messenger NUX Header",
  "Edit highlights","See more","Meta Verified","Suggested apps","Add star",
  "Add new","Scan","Edit","Loading","Video","Photo","Phone","Upload",
  "Cancel","Privacy Policy","Passwords","WhatsApp","GitHub","Google",
  "Samsung","Microsoft","Lazada","KBank","Drive","Tasks","Captions",
  "Voice search","Drag handle","Select app","Wireless debugging",
  "Help and support","See more","ไดรฟ์","เมนู","โทรศัพท์",
  "ล้างคำค้นหา","ย้อนกลับ","ปิด","นโยบายความเป็นส่วนตัว",
  "ตัวเลือกเพิ่มเติม","มุมมองเว็บ","ข้อความที่ยังไม่ได้อ่าน",
  "การค้นหาด้วยกล้อง","โหมดแฟลช","เพิ่มในสตอรี่",
]);

function isBadTitle(t) {
  if (!t || t.length < 2) return true;
  if (JUNK_TITLES.has(t)) return true;
  if (SINGLE_WORD_JUNK.has(t)) return true;
  for (const re of JUNK_TITLE_RE) if (re.test(t)) return true;
  // Very long single-line descriptions are usually accessibility labels
  if (t.length > 120) return true;
  // Contains "button" / "ปุ่ม" — accessibility button labels
  if (/button/i.test(t) || /ปุ่ม/.test(t)) return true;
  // Starts with a digit (e.g. "1 new update") — status labels
  if (/^\d/.test(t)) return true;
  // Looks like a domain / URL without scheme e.g. "kt5552.com", "cashier.x.com/path"
  if (/^[\w.-]+\.(com|net|org|io|co|th|app|me|ai|shop|store)(\/|$)/i.test(t)) return true;
  // "Logged in as, Name, use this account" pattern
  if (/^Logged in as/i.test(t)) return true;
  // "Add star", "Add highlight" (not "Add people" which is already in regex)
  if (/^Add [a-z]/i.test(t)) return true;
  return false;
}

// ── Message-text quality filter ───────────────────────────────────────────────
const CHROME_EXACT = new Set([
  "Aa","GIF","Send","Active now","Online","Sent","Seen","Delivered",
  "Typing","Typing…","Message","Messages","Search","Home","Menu","Back",
  "ส่งแล้ว","อ่านแล้ว","ออนไลน์","พิมพ์อยู่","สำเนา",
  "Open Photos","Camera","Voice message","Chats",
  "Unread messages","Thread details","Add custom reaction",
  "Type a message","Ask Meta AI or Search","Audio call","Video call",
  "New message","New Message","More options","React","Reply",
  "Forward","Report","Unsend","Learn more","View profile",
  "Chat profile","End call","Decline","Accept","Add",
  "คุณเป็นเพื่อนกันบน Facebook","You're friends on Facebook",
]);

const CHROME_MSG_RE = [
  /^ปุ่ม/,
  /^ตัวเลือก/,
  /^รูปภาพที่ \d+ จาก \d+/,
  /^ภาพที่ \d+ จาก \d+/,
  /ปุ่ม$/,
  /^ล้างคำค้นหา/,
  /^ค้นหา/,
  /^Search( bar)?$/i,
  /ขยายรูปภาพ$/,
  /^Open .+'s profile$/i,
  /^Seen by /i,
  /^Forward .+ sent by /i,
  /^Sent (photo|video|audio|sticker|GIF)/i,
  /^Missed (audio|video) call/i,
  /^(Audio|Video) call$/i,
  /^Show more options/i,
  /^Open (camera|photo gallery|audio recorder|sticker)/i,
  /^Send 👍$/,
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i,
  /^(Chats|People tab|Notifications|Menu Tab)$/i,
  /^\d+ new updates?$/i,
  /^Thread details$/i,
  /Thread details$/i,                  // "Name, Thread details" suffix
  /^Messages and calls are secured with end-to-end/i,
  /^Only people in this (chat|call)/i,
  /^@/,                                // @handle / @username (any variant)
  /^⸱ \d+:\d+$/,                       // "⸱ 00:01" timestamp artifact
  /^\d{1,2}:\d{2}( [AP]M)?$/,          // bare time strings
  /^(SAT|SUN|MON|TUE|WED|THU|FRI) AT \d/i,
  /^https?:\/\/\S+$/,                  // bare URL
  /^Active \d+/i,                      // "Active 3 minutes ago"
  /^Active [Nn]ow$/i,
  /^(Delivered|Sent) \d+ /i,
  /^End-to-end encrypted/i,
  /^Learn more$/i,
  /^Navigate up$/i,
  /^a11y-/,
  /^Swipe /i,
  /^Tap to /i,
  /^Double-tap /i,
  /^Hold to /i,
  /ขยายรูป/,
  /double tap to see/i,                // accessibility read-out
  /double tap and hold to react/i,
  /, double tap/i,
  /, \d+ (sec|min)/,                   // "Audio call, 55 sec"
  /^(Audio|Video) call, /i,
  /^Call again$/i,
  /^(Your note|Your story|Post a note|Create story)/i,
  /story unread$/i,                    // "Texaa's story unread"
  /active now$/i,                      // "พี่เดช active now"
  /^You: /i,                           // chat list "You: last msg"
  /, You: /i,                          // "Name, You: last msg, Seen by..."
  /\. You: /i,
  /^อาศัยอยู่ที่/,
  /^คุณเป็นเพื่อน/,
  /^Facebook App$/i,
  /^share_a_song/i,
  /^create story$/i,
  /\d+ new messages?/i,                // "4 new messages" in chat list
  /^Unread \d+$/i,                     // "Unread 5"
  /^Unread .+\.$/i,                    // "Unread พี่เดช แม่เรียกกินข้าว."
  /missed your (audio|video) call/i,  // "BaiToey missed your audio call"
  /^⸱ /,                              // "⸱ Calling…" / "⸱ Incoming call"
  / search results, \d+ of \d+/i,     // "All search results, 1 of 7"
  /^(Add friend|Filter All|Filter Friends|Clear text)$/i,
  /^Seen by .+$/i,                     // "Seen by Faah Sky"
  /^\p{L}[\p{L}\s]+\.$\s*$/u,         // "Name." single-item chat list labels
];

function isJunkMsg(text) {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  if (t.length < 2) return true;
  if (isSharedChromeLabel(t) || CHROME_EXACT.has(t)) return true;
  for (const re of CHROME_MSG_RE) if (re.test(t)) return true;
  // Single-word Thai/English label ≤ 12 chars (same rule as adb-scraper isChrome)
  if (/^[\p{L}\p{M}]{1,12}$/u.test(t)) return true;
  return false;
}

// ── Deduplication ─────────────────────────────────────────────────────────────
// Priority: scrape(1) > noti(2) > screen(3). scrape wins when same text within 3 min.
// noti messages have side="" (incoming-only) — normalise to "them" for matching.
const SRC_PRIORITY = { scrape: 1, noti: 2, screen: 3 };
function srcPri(s) { return SRC_PRIORITY[s] ?? 4; }

function dedup(msgs) {
  // Two-pass: mark duplicates, then filter.
  // Pass 1: sort by time so windows work correctly.
  const sorted = [...msgs].sort((a, b) => a.time - b.time);
  const keep   = new Array(sorted.length).fill(true);

  for (let i = 0; i < sorted.length; i++) {
    if (!keep[i]) continue;
    const m    = sorted[i];
    const mKey = `${m.side || "them"}|${m.text}`;

    for (let j = i + 1; j < sorted.length; j++) {
      const n = sorted[j];
      if (n.time - m.time > 180_000) break; // beyond 3-min window

      const nKey = `${n.side || "them"}|${n.text}`;
      if (mKey !== nKey) continue;

      // Same text+side within 3 min — drop the lower-priority one.
      if (srcPri(n.source) < srcPri(m.source)) {
        keep[i] = false; // n is better — drop m
        break;
      } else {
        keep[j] = false; // m is better or equal — drop n
      }
    }
  }

  // Global dedup: scraper batch-captures often re-ingest messages already seen
  // from noti with correct timestamps. For messages ≥20 chars, keep only the
  // FIRST occurrence (earliest timestamp) and drop later duplicates.
  const firstSeen = new Map(); // text → index of first keeper
  for (let i = 0; i < sorted.length; i++) {
    if (!keep[i]) continue;
    const t = sorted[i].text;
    if (t.length < 20) continue; // short strings can legitimately repeat
    if (firstSeen.has(t)) {
      keep[i] = false; // later occurrence — drop
    } else {
      firstSeen.set(t, i);
    }
  }

  return sorted.filter((_, i) => keep[i]);
}

// ── Formatting ────────────────────────────────────────────────────────────────
function fmt(ms) {
  return new Date(ms).toLocaleString("th-TH", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function safeName(title) {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[rebuild] ${DATA_FILE} not found`);
    process.exit(1);
  }

  // Read + parse rows from every chat app the phone captures (see
  // MessengerReaderService.kt's `targets`) — not just Messenger. The noise
  // filters below are Messenger/Facebook-vocabulary-heavy so they'll be less
  // precise on Instagram/WhatsApp/LINE/Telegram until tuned per app, but
  // running them beats silently dropping those apps' data entirely.
  const CHAT_APPS = new Set([
    "Messenger", "Messenger Lite", "Facebook", "Instagram",
    "WhatsApp", "WhatsApp Business", "LINE", "Telegram", "Telegram X",
  ]);
  console.error("[rebuild] Reading data.jsonl…");
  const all = [];
  for (const line of fs.readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t);
      if (CHAT_APPS.has((r.app || "").trim())) all.push(r);
    } catch { /* skip */ }
  }
  console.error(`[rebuild] ${all.length} rows across ${new Set(all.map(r => r.app)).size} apps`);

  // Group by (app, thread title) — same contact name in two different apps
  // must not collapse into one thread.
  const byThread = new Map();
  for (const r of all) {
    const app = (r.app || "").trim();
    const title = (r.title || "").trim();
    const key = `${app} ${title}`;
    if (!byThread.has(key)) byThread.set(key, { app, title, msgs: [] });
    byThread.get(key).msgs.push(r);
  }

  // Filter and clean each thread
  const goodThreads = [];
  let totalDropped = 0;

  for (const { app, title, msgs } of byThread.values()) {
    if (isBadTitle(title)) { totalDropped += msgs.length; continue; }

    // Filter message content (skip screen source by default — too noisy)
    const clean = msgs
      .filter(m => (INCLUDE_SCREEN || m.source !== "screen") && !isJunkMsg(m.text))
      .sort((a, b) => a.time - b.time);

    const deduped = dedup(clean);
    if (deduped.length < MIN_MSGS) { totalDropped += msgs.length; continue; }

    // Require at least one scrape or noti message — screen-only threads are home/search
    // screen dumps, not real conversations. The ADB scraper only runs inside actual chats.
    const hasHighQuality = clean.some(m => m.source === "scrape" || m.source === "noti");
    if (!hasHighQuality) { totalDropped += msgs.length; continue; }

    goodThreads.push({ app, title, msgs: deduped, raw: msgs.length });
  }

  // Sort threads by most recent message
  goodThreads.sort((a, b) =>
    (b.msgs.at(-1)?.time ?? 0) - (a.msgs.at(-1)?.time ?? 0)
  );

  console.error(`[rebuild] ${goodThreads.length} real threads · ${goodThreads.reduce((s,t) => s + t.msgs.length, 0)} clean msgs`);
  console.error(`[rebuild] ${totalDropped} rows dropped (${byThread.size - goodThreads.length} junk threads)`);

  if (!STDOUT) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
    // Clean stale files from previous runs before writing fresh output
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith(".txt") || f.endsWith(".json")) fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  // Write output
  for (const thread of goodThreads) {
    const lines = [
      `Thread: ${thread.title} (${thread.app})`,
      `Messages: ${thread.msgs.length} (from ${thread.raw} raw)`,
      `Period : ${fmt(thread.msgs[0].time)} → ${fmt(thread.msgs.at(-1).time)}`,
      "─".repeat(60),
      "",
    ];

    // Group messages by day for readability
    let lastDay = "";
    for (const m of thread.msgs) {
      const day = new Date(m.time).toLocaleDateString("th-TH", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
      if (day !== lastDay) {
        if (lastDay) lines.push("");
        lines.push(`  ── ${day} ──`);
        lastDay = day;
      }
      const time = new Date(m.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      const who  = m.side === "me" ? "  ฉัน" : (m.sender || "เขา").padEnd(18);
      lines.push(`${time}  ${who}  ${m.text}`);
    }
    lines.push("");

    const content = lines.join("\n");

    if (STDOUT) {
      console.log(content);
      console.log("═".repeat(60));
      console.log("");
    } else {
      const base = safeName(`${thread.app} ${thread.title}`);
      fs.writeFileSync(path.join(OUT_DIR, `${base}.txt`), content, "utf8");
      // JSON sidecar — consumed by dashboard /api/chatlog/:thread
      const json = {
        app:      thread.app,
        title:    thread.title,
        count:    thread.msgs.length,
        raw:      thread.raw,
        from:     thread.msgs[0].time,
        to:       thread.msgs.at(-1).time,
        messages: thread.msgs.map(m => ({
          time:   m.time,
          side:   m.side || "them",
          sender: m.sender || null,
          text:   m.text,
          source: m.source,
        })),
      };
      fs.writeFileSync(path.join(OUT_DIR, `${base}.json`), JSON.stringify(json), "utf8");
    }
  }

  if (!STDOUT) {
    console.error(`[rebuild] ✓ Written to ${OUT_DIR}/`);
    console.error(`           ${goodThreads.length} files`);
    // Print summary table
    console.error("\nApp          Thread                        msgs  period");
    console.error("─".repeat(68));
    for (const t of goodThreads) {
      const app  = t.app.padEnd(11).slice(0, 11);
      const name = t.title.padEnd(28).slice(0, 28);
      const cnt  = String(t.msgs.length).padStart(4);
      const from = new Date(t.msgs[0].time).toISOString().slice(0, 10);
      const to   = new Date(t.msgs.at(-1).time).toISOString().slice(0, 10);
      console.error(`${app}  ${name}  ${cnt}  ${from} → ${to}`);
    }
  }
}

main();
