export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function decodeXmlEntities(s, decodeNewlines = false) {
  let value = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return decodeNewlines ? value.replace(/&#10;/g, "\n") : value;
}

export function parseLegacyTextNodes(xml) {
  const nodes = []; const re = /<node\b([^>]*?)\/?>/g; let match;
  while ((match = re.exec(xml)) !== null) {
    const attrs = match[1]; const text = (attrs.match(/\btext="([^"]*)"/) || [, ""])[1]; if (!text) continue;
    const bounds = attrs.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/); if (!bounds) continue;
    const x1 = +bounds[1], y1 = +bounds[2], x2 = +bounds[3], y2 = +bounds[4];
    nodes.push({ text: decodeXmlEntities(text), x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 });
  }
  return nodes;
}

export const LEGACY_BUBBLE_RE = /, double tap to see sent\/receive date and time.*$/i;
const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const ANCHOR_FULL_RE = /^(SUN|MON|TUE|WED|THU|FRI|SAT|TODAY|YESTERDAY)\s+AT\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
const ANCHOR_TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

export function extractLegacyMessage(raw) {
  let text = raw.trim(); if (!LEGACY_BUBBLE_RE.test(text)) return null;
  text = text.replace(LEGACY_BUBBLE_RE, ""); const comma = text.indexOf(", ");
  if (comma === -1) return { sender: null, body: text.trim() };
  const sender = text.slice(0, comma).trim(), body = text.slice(comma + 2).trim();
  return body ? { sender, body } : null;
}

export function parseLegacyAnchor(raw, now = Date.now(), futureMs = 60_000) {
  const text = raw.trim(); let match = text.match(ANCHOR_FULL_RE), hours, minutes, amPm, day = null;
  if (match) { day = match[1].toUpperCase(); hours = +match[2]; minutes = +match[3]; amPm = match[4].toUpperCase(); }
  else { match = text.match(ANCHOR_TIME_RE); if (!match) return null; hours = +match[1]; minutes = +match[2]; amPm = match[3].toUpperCase(); }
  if (amPm === "PM" && hours !== 12) hours += 12; if (amPm === "AM" && hours === 12) hours = 0;
  const date = new Date(now); date.setSeconds(0, 0); date.setHours(hours, minutes, 0, 0);
  if (day === "YESTERDAY") date.setDate(date.getDate() - 1);
  else if (day && day in DOW) { let back = (date.getDay() - DOW[day] + 7) % 7; if (back === 0 && date.getTime() > now) back = 7; date.setDate(date.getDate() - back); }
  if (date.getTime() > now + futureMs) date.setDate(date.getDate() - 1);
  return date.getTime();
}

export const isLegacyChrome = (text, chrome, chromeRe) => { const value = text.trim(); return !value || chrome.has(value) || chromeRe.test(value); };
export const legacySideOf = (node, width) => node.cx > width * 0.55 ? "me" : "them";
export function detectLegacyTitle(nodes, height, chrome, fraction) {
  const top = nodes.filter((node) => node.y2 < height * fraction && node.text.trim().length <= 40);
  top.sort((a, b) => a.y1 - b.y1);
  return top.find((node) => !chrome.has(node.text.trim()))?.text.trim() || "Messenger";
}

export async function fetchExistingMessages(ingest, limit) {
  try { const response = await fetch(`${ingest.replace("/ingest", "/api/messages")}?app=Messenger&limit=${limit}`); if (!response.ok) return new Set(); const body = await response.json(); return new Set((body.rows || []).map((message) => `${message.title}|${message.side}|${message.text}`)); }
  catch { return new Set(); }
}

export async function postJsonIngest(ingest, payload) {
  const response = await fetch(ingest, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return { response, body: await response.json().catch(() => ({})) };
}
