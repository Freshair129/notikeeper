# RCA — Real Messenger messages dropped from chat-log rebuild due to chrome-labeled thread titles

- **Symptom:** After syncing fresh data and running `rebuild-chatlog.mjs`, real Thai conversation content captured today was entirely missing from the output, even though the raw rows existed in `data.jsonl`. Inspecting the raw rows showed several captured today grouped under thread titles `"Back"`, `"Drive"`, `"Messenger"` instead of the actual contact's name (e.g. `"Cee"`).

- **Evidence:** `MessengerReaderService.kt:91` (pre-fix) selected the conversation title as `lines.filter { it.top < 350 }.minByOrNull { it.top }?.text` — the topmost text in the app-bar band, with **no check against the `chrome` denylist** that's already used two lines later to filter message *content*. `"Back"` is literally in that `chrome` set, but the title-selection code never consulted it. When the real contact-name view wasn't the topmost node in a given capture tick (e.g. a transient icon-button label briefly rendered above it), the batch got tagged with the chrome text instead. `rebuild-chatlog.mjs`'s `isBadTitle()` correctly recognized `"Back"`/`"Drive"`/`"Messenger"` as junk and dropped those threads wholesale — correctly rejecting the bad title, but taking real message content down with it.

- **Root Cause:** Two independent code paths (message-content filtering vs. title selection) shared the same `chrome` denylist in intent but not in implementation — title selection was never wired to it.

- **Why it escaped detection:** The title-selection line and the message-filtering line were written together but never had a shared test; nothing exercises "top band contains only chrome text" as a case distinct from "top band contains the real title."

- **Prevention:**
  1. Title candidates are now filtered against the same `chrome` set as message content (extended with a few more Thai nav labels: "ย้อนกลับ", "หน้าแรก", "เมนู", "ค้นหา").
  2. Added `lastGoodConvo: HashMap<pkg, title>` — when a capture tick's top band yields no valid (non-chrome) title, the service reuses the last real title seen for that package instead of falling through to a generic placeholder. This is defense-in-depth against chrome text that isn't in the denylist yet (e.g. the still-unexplained `"Drive"` capture, possibly a transient home-screen widget bleed) — a single bad tick no longer corrupts a whole batch of otherwise-real messages.
