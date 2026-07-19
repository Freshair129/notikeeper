// This intentionally contains only labels that both relational and chatlog
// filters already reject. Source-specific policy remains in each caller.
const SHARED_CHROME_LABELS = new Set([
  "Active now", "Online", "Sent", "Seen", "Delivered", "Typing", "GIF", "Send",
  "Message", "Messages", "Search", "Home", "Menu", "Back", "Camera",
]);

export function isSharedChromeLabel(text) {
  return SHARED_CHROME_LABELS.has((text || "").trim());
}
