# Architecture

## One-page overview

```
                       ┌─────────────────────────────┐
                       │      Android device         │
                       │                             │
   ┌────────────────┐  │  ┌───────────────────────┐  │
   │ App posts noti │──┼─▶│ NotiLoggerService     │──┼─┐
   └────────────────┘  │  │ (NotificationListener)│  │ │
                       │  └───────────────────────┘  │ │
   ┌────────────────┐  │  ┌───────────────────────┐  │ │   ┌──────────────┐
   │ Chat screen    │──┼─▶│ MessengerReaderService│──┼─┼──▶│  NotiStore   │
   │ (Messenger…)   │  │  │ (AccessibilityService)│  │ │   │  (SQLCipher) │
   └────────────────┘  │  └───────────────────────┘  │ │   └──────┬───────┘
                       │                             │ │          │
                       │  ┌───────────────────────┐  │ │          │
                       │  │  TTS (Speaker.kt)     │◀─┘ │          │
                       │  │  + ducking            │    │          │
                       │  └───────────────────────┘    │          │
                       │                                          │
                       │  ┌───────────────────────┐               │
                       │  │  MainActivity (UI)    │◀──────────────┘
                       │  │  – search             │
                       │  │  – backup / export ───┼──▶ share sheet / Downloads
                       │  │  – API upload ────────┼──▶ POST /ingest ─┐
                       │  │  – updater ───────────┼──▶ GET version   │
                       │  └───────────────────────┘                  │
                       └─────────────────────────────────────────────┼──┐
                                                                     │  │
                                          ┌──────────────────────────┘  │
                                          ▼                             ▼
                          ┌───────────────────────────┐    ┌──────────────────────────┐
                          │ NotiKeeper MCP server     │    │  GitHub Releases         │
                          │ (Node, mcp-server/)       │    │  version.json + APK      │
                          │ – ingest endpoint         │    └──────────────────────────┘
                          │ – Claude tools:           │
                          │   search/recent/list/stats│
                          └───────────────────────────┘
```

## Why these pieces

### Two capture surfaces, not one
- **NotificationListenerService** is reliable, low-cost, and works for every
  app — but Android delivers only the preview text the notification carries,
  not the whole message thread.
- **AccessibilityService** can read the actual rendered chat history once the
  user opens a thread, which is what makes "scroll back to recover deleted
  messages" work. Restricted to chat apps via `packageNames` in
  `messenger_reader_config.xml` to keep scope tight.

The two streams are tagged (`source = "noti" | "screen"`) and stored
together so the search UI can show both with context.

### Encrypted-at-rest, not just locked
SQLCipher encrypts the whole DB file with AES-256, so a backup grab or rooted
adversary sees ciphertext. The passphrase is 32 random bytes generated once
and held in `EncryptedSharedPreferences` (master key in the Android Keystore,
hardware-backed where available). Crucially the key is NOT tied to user
authentication — the background services must be able to write while the app
is locked. The biometric prompt protects the UI surface; encryption protects
the file at rest. They are layered, not redundant.

### Why the read-aloud uses TTS, not VAD/STT
The use case is *output* (eyes-free hearing), not input. Android's built-in
`TextToSpeech` already handles voice selection, locale fallback, and concurrency
with `QUEUE_ADD`. Audio focus with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` reuses
Android's ducking pipeline so the spoken alert behaves identically to a GPS
prompt — including over Bluetooth helmet audio. This is the same ducking
contract the CoVibe rider PRD §5.3 specifies.

### Why the MCP server doubles as the upload endpoint
A separate ingest service would mean two processes, two install steps, two
config blocks. Combining them means the user only points the app's "Upload
API" at the same port the MCP server is already on. When Claude Desktop spawns
the server, it both serves Claude's tools and receives the phone's uploads —
one moving part instead of three.

### Why a debug-signed APK
Debug builds use a deterministic local keystore, so updates install over each
other without managing release keys. Acceptable because distribution is
sideload to known devices, not Play Store. If the app ever ships to others,
swap in a release signing config and store the keystore outside the repo.

## Data flow on the phone

1. A notification arrives → `NotiLoggerService.onNotificationPosted` extracts
   title + best-available body (`EXTRA_BIG_TEXT` > `EXTRA_TEXT_LINES` > `EXTRA_TEXT`),
   skips ongoing/persistent notifications, and inserts a row with
   `source = "noti"` and a dedupe key `noti:<title>:<text>:<time>`.
2. Inside Messenger/LINE/IG/etc., a screen update fires
   `MessengerReaderService.onAccessibilityEvent`. We debounce (500ms), walk
   the `AccessibilityNodeInfo` tree of `rootInActiveWindow`, and emit a
   `ScreenRow` per text-bearing node. An LRU of recent `convo|side|text`
   tuples filters out re-scroll duplicates before insert.
3. If a read-aloud toggle is on AND `Settings.shouldSpeak(pkg)` matches the
   whitelist, the text is also sent to `Speaker.speak` which requests audio
   focus (ducks background music), speaks, and releases focus on completion.
4. The UI subscribes to refresh ticks (`ON_RESUME`) and re-runs
   `NotiStore.query(filter)` for display.
5. If auto-upload is configured, every resume tries
   `NotiStore.querySince(lastUploadedId)` and POSTs JSON to the user's
   endpoint, advancing the high-water mark on 2xx.
6. The updater runs the same way: `Updater.check` hits the configured
   `version.json` URL, surfaces a banner if `versionCode` is newer, and the
   user's button press downloads the APK and launches the system installer.
