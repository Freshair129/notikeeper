#!/usr/bin/env node
/**
 * LLM quality-gate — Phase 4 of docs/ARCHITECTURE_CHANGE_REQUEST.md.
 *
 * The cheap regex/heuristic filters in relations.mjs and rebuild-chatlog.mjs
 * confidently classify most captured lines as real-message vs UI-chrome. This
 * gate handles only the BORDERLINE ones a regex can't decide — short, single
 * lines where "is this 'ok' a real reply or an 'OK' button?" is genuinely
 * ambiguous — by asking a local Thai-tuned LLM.
 *
 * SSOT design: this is a one-directional quality gate on the PC parser, NOT a
 * mobile-vs-PC reconciler. Verdicts are cached by sha256(pkg|title|text) so
 * each unique line is classified exactly once and the pipeline stays
 * deterministic given the cache.
 *
 * Model: hf.co/iapp/chinda-qwen3-4b-gguf:Q4_K_M (owner-chosen), via Ollama chat.
 * Degrades gracefully: if Ollama or the model is unavailable it logs a warning
 * and exits 0 without classifying — never crashes the pipeline.
 *
 * Standalone; depends only on Node built-ins + global fetch (no better-sqlite3),
 * so it reads data.jsonl directly. The verdict cache is the integration surface
 * the parser (relations.mjs) will consult later.
 *
 * Usage:
 *   node llm-gate.mjs                # classify uncached ambiguous lines
 *   node llm-gate.mjs --limit 20     # cap LLM calls this run (testing)
 *   node llm-gate.mjs --dry          # classify but don't persist the cache
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.NOTIKEEPER_DATA || path.join(__dirname, "data.jsonl");
const CACHE_FILE = path.join(__dirname, "llm-verdicts.json");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.NOTIKEEPER_GATE_MODEL || "hf.co/iapp/chinda-qwen3-4b-gguf:Q4_K_M";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const LIMIT_IDX = argv.indexOf("--limit");
const LIMIT = LIMIT_IDX >= 0 ? parseInt(argv[LIMIT_IDX + 1], 10) : Infinity;

const hashKey = (pkg, title, text) =>
  crypto.createHash("sha256").update(`${pkg || ""}|${title || ""}|${text || ""}`).digest("hex");

// ── Ambiguity heuristic ───────────────────────────────────────────────────────
// The gate exists to rescue the ONE case the cheap filters get wrong: relations.mjs
// `looksLikeChromeLabel` drops every short single/near-single word as chrome, which
// also kills real one-word replies ("ครับ", "ได้", "555", "โอเค"). So the ambiguous
// zone is deliberately narrow — short 1–2 word fragments that carry letters and
// aren't already confidently chrome. Longer / multi-word lines are confident real
// messages the filters already keep; exact chrome (times, "seen", pure symbols) is
// confident chrome the filters already drop. Neither needs an LLM call.
const HARD_CHROME_RE = [
  /^\d{1,2}:\d{2}(\s?[AP]M)?$/i,            // bare times
  /^\d+\s*[dhwmy]$/i,                       // relative-age labels: 1d, 2h, 3w
  /^(seen|delivered|sent|active now|online|typing)$/i,
  /^(อ่านแล้ว|ส่งแล้ว|ออนไลน์|พิมพ์อยู่)$/,
  /^[\d\W_]+$/u,                            // pure digits / punctuation / emoji
  /^(mon|tue|wed|thu|fri|sat|sun)$/i,
  /button|ปุ่ม/i,
];

// Real conversations the gate can meaningfully rescue live in the core chat
// apps (same set as the capture default). Instagram/Facebook capture is
// dominated by feed/story chrome where "is this a real chat message" barely
// applies — scoping to these keeps the ambiguous set focused and small.
const CHAT_PKGS = new Set([
  "jp.naver.line.android", "com.facebook.orca", "com.facebook.mlite",
  "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger",
  "org.thunderdog.challegram",
]);

function isAmbiguous(text, source, pkg) {
  // Only `screen` source has the false-drop the gate rescues: relations.mjs runs
  // looksLikeChromeLabel on screen text only. noti text isn't heuristic-dropped.
  if (source !== "screen") return false;
  if (!CHAT_PKGS.has((pkg || "").trim())) return false;    // scope to real chat apps
  const t = (text || "").trim();
  if (t.length < 2 || t.length > 15) return false;         // borderline zone is SHORT
  if (!/[\p{L}]/u.test(t)) return false;                    // no letters -> not a message
  if (t.split(/\s+/).length > 2) return false;             // 3+ words -> confident real message
  for (const re of HARD_CHROME_RE) if (re.test(t)) return false; // already confidently chrome
  return true;
}

// ── Ollama ────────────────────────────────────────────────────────────────────
async function ollamaUp() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return { ok: false, reason: `tags ${r.status}` };
    const body = await r.json();
    const has = (body.models || []).some((m) => m.name === MODEL || m.model === MODEL);
    return { ok: true, hasModel: has };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// This GGUF import ignores Ollama's `think:false` and `format:"json"` — the
// latter also makes it ~30x slower (9.8s vs 0.3s per call). The reliable+fast
// combo is Qwen3's `/no_think` soft-switch (emits an empty <think> block then
// the answer), no format constraint, and stripping the <think> prefix before
// parsing. See the probe results recorded during implementation.
const SYSTEM_PROMPT =
  "You classify ONE UI-captured text line as either a real chat message a human " +
  "typed and sent, or app/interface chrome (buttons, labels, timestamps, status " +
  "like 'seen'/'delivered', navigation, menu items, app names). " +
  "ตอบเป็น JSON เท่านั้น ไม่ต้องอธิบาย: {\"isMessage\": true} ถ้าเป็นข้อความแชตจริงที่คนพิมพ์, " +
  "{\"isMessage\": false} ถ้าเป็นปุ่ม/ป้าย/ส่วนติดต่อผู้ใช้ของแอป. /no_think";

/** Pull the {"isMessage": bool} object out of a response that may be wrapped in
 *  a <think> block or stray prose. Returns true/false, or null if not found. */
function parseVerdict(content) {
  const m = (content || "").match(/\{[^{}]*"isMessage"\s*:\s*(true|false)[^{}]*\}/i);
  if (!m) return null;
  return m[1].toLowerCase() === "true";
}

/** Ask the model. Returns true/false, or null if the call/parse failed. */
async function classify(app, title, text) {
  const user =
    `แอป: ${app || "?"}\n` +
    `จาก/หัวข้อ: ${title || "?"}\n` +
    `บรรทัดที่จับได้: "${text}"\n\n` +
    `นี่เป็นข้อความแชตจริงที่คนพิมพ์ หรือเป็นปุ่ม/ป้าย/UI ของแอป? /no_think`;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        stream: false,
        options: { temperature: 0, num_predict: 64 },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    return parseVerdict(body?.message?.content);
  } catch {
    return null;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (e) { console.error("[gate] cache load failed, starting fresh:", e.message); }
  return {};
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0));
}

// ── Public API (integration surface for relations.mjs) ────────────────────────
// One module-level cache shared by getVerdict() and runGate(), so verdicts a
// gate run produces are immediately visible to parseRow in the same process
// (no restart needed). NOTE: reindex() is insert-only, so newly-cached verdicts
// only affect rows parsed AFTER the run — retroactively applying them to rows
// already in relations.db needs a from-scratch reindex (rm relations.db).
let _cache = null;
function cache() {
  if (_cache === null) _cache = loadCache();
  return _cache;
}
/**
 * Cached verdict for a line, or null if it was never classified (caller should
 * fall back to its own heuristic — the gate only ever covers ambiguous lines).
 */
export function getVerdict(pkg, title, text) {
  const v = cache()[hashKey(pkg, title, text)];
  return v === undefined ? null : v.isMessage;
}

/** Classify all uncached ambiguous lines in data.jsonl. Returns a summary. */
export async function runGate({ limit = Infinity, dry = false } = {}) {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[gate] ${DATA_FILE} not found`);
    return { ambiguous: 0, classified: 0, notMessage: 0, skipped: "no-data" };
  }
  const up = await ollamaUp();
  if (!up.ok) {
    console.error(`[gate] Ollama unavailable (${up.reason}) — skipping gate, no changes made.`);
    return { ambiguous: 0, classified: 0, notMessage: 0, skipped: "ollama-down" };
  }
  if (!up.hasModel) {
    console.error(`[gate] model ${MODEL} not pulled — run: ollama pull ${MODEL}. Skipping gate.`);
    return { ambiguous: 0, classified: 0, notMessage: 0, skipped: "model-missing" };
  }

  const store = cache(); // shared module cache — getVerdict sees updates immediately
  // Collect unique ambiguous lines not already in the cache.
  const pending = new Map(); // hash -> {pkg,title,text,app}
  for (const line of fs.readFileSync(DATA_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    if (!isAmbiguous(r.text, r.source, r.pkg)) continue;
    const h = hashKey(r.pkg, r.title, r.text);
    if (store[h] !== undefined || pending.has(h)) continue;
    pending.set(h, { pkg: r.pkg, title: r.title, text: r.text, app: r.app });
  }

  const total = pending.size;
  let classified = 0, notMessage = 0, failed = 0;
  for (const [h, row] of pending) {
    if (classified >= limit) break;
    const verdict = await classify(row.app, row.title, row.text);
    if (verdict === null) { failed++; continue; }         // don't cache failures — retry next run
    if (!dry) store[h] = { isMessage: verdict, text: row.text.slice(0, 80) };
    classified++;
    if (!verdict) notMessage++;
  }

  if (!dry && classified > 0) saveCache(store);
  console.error(
    `[gate] ${total} uncached ambiguous lines · classified ${classified} ` +
    `(${notMessage} chrome / ${classified - notMessage} message)` +
    (failed ? ` · ${failed} LLM failures (will retry)` : "") +
    (dry ? " · DRY (cache not written)" : "")
  );
  return { ambiguous: total, classified, notMessage, failed };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runGate({ limit: LIMIT, dry: DRY }).catch((e) => {
    console.error("[gate] fatal:", e.message);
    process.exit(0); // never fail the pipeline
  });
}
