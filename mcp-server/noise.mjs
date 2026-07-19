// Shared, side-effect-free noise/junk classification for the capture pipeline.
// Kept separate from each caller's source-specific policy (relations.mjs /
// rebuild-chatlog.mjs keep their own wrappers) so this can be unit-tested
// without importing the live server, which binds a port and starts MCP on import.

// Chrome labels that BOTH the relational and chatlog filters already reject.
const SHARED_CHROME_LABELS = new Set([
  "Active now", "Online", "Sent", "Seen", "Delivered", "Typing", "GIF", "Send",
  "Message", "Messages", "Search", "Home", "Menu", "Back", "Camera",
]);

export function isSharedChromeLabel(text) {
  return SHARED_CHROME_LABELS.has((text || "").trim());
}

// ---------- notification/app-level noise rules (moved verbatim from server.mjs) ----------
const NOISE_APPS = new Set([
  "Meta App Manager", "Galaxy Store", "Samsung capture", "Samsung Internet",
  "Dashboard Test", "HealthCheck", "Android System", "Samsung DeX",
]);

const NOISE_PKG_PREFIX = ["com.samsung.android.app.", "com.android.systemui", "com.google.android.gms"];

// Apps the user marked as promotional/marketing (default heuristic; tweak per taste)
const PROMO_APPS = new Set(["7-Eleven", "Galaxy Store", "Grab"]);

const GENERIC_TITLES = [
  "การแจ้งเตือน", "Notification", "New notification", "New message", "Messages",
];

// Promo language patterns (Thai + English)
const PROMO_RE = /(โปรโม|พิเศษ ?\d|ราคาพิเศษ|sale|discount|ลด ?\d|ฟรี ?ดูค|click here|จองเลย|ส่งฟรี|coupon|รับเลย|กดรับ)/i;

// URL/sticker spam (e.g., line stickers)
const URL_ONLY_RE = /^https?:\/\/\S+\s*$/;

export function classifyNoise(r) {
  const app = (r.app || "").trim();
  const pkg = (r.pkg || "").trim();
  const title = (r.title || "").trim();
  const text = (r.text || "").trim();

  if (NOISE_APPS.has(app)) return "system-app";
  if (NOISE_PKG_PREFIX.some((p) => pkg.startsWith(p))) return "system-pkg";
  if (!text && !title) return "empty";
  if (!text && title.length < 4) return "empty-text";
  if (GENERIC_TITLES.includes(title) && text.length < 12) return "generic-title";
  if (URL_ONLY_RE.test(text)) return "sticker-url";
  if (PROMO_RE.test(text) || PROMO_RE.test(title)) return "promo";
  if (PROMO_APPS.has(app) && r.source === "noti") return "promo-app";
  return null; // not noise
}
