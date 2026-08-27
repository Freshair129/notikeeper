# NotiKeeper — AI Working Contract

> Auto-loaded by Claude Code when working in this repo. Read this first.

## What this is
Android sideload app (Kotlin/Compose, minSdk 30) that captures notifications and
reads chat threads off the screen, stores them in an encrypted SQLCipher DB
behind a biometric lock, and can export/upload/read aloud. Companion Node MCP
server lets Claude search the archive. **Personal-use tool** for the device
owner's own data — not a Play-Store product.

**Current: v1.2.0** (versionCode 17). Published at
`Freshair129/notikeeper` (public). Landing: https://notikeeper.vercel.app

Three moving parts (plus an early `ios/NotiKeeperIOS` companion-app scaffold,
unreleased — see CHANGELOG `[Unreleased]`):
1. **Android app** (`app/`) — capture + encrypted store + UI + read-aloud + self-update.
2. **MCP/analytics server** (`mcp-server/`, Node, port 8765) — ingest endpoint,
   browser dashboard, SQLite relational ETL, GenesisBlock graph + BGE-M3 vectors,
   MCP tools for Claude. **Dies on every Claude-session teardown** — restart with
   `Start-Process node -ArgumentList '"G:\NotiKeeper\mcp-server\server.mjs"' -WindowStyle Hidden`
   (or the `NotiKeeper Control.cmd` GUI / Startup auto-start shortcut).
3. **Landing page** (`landing/`, React 19 + Vite) — deployed to Vercel, git-auto-deploy.

## Boundaries (do NOT cross without asking)
- **Privacy model is core, not decoration.** Don't add telemetry, analytics, or
  network calls outside the user-configured upload endpoint and the update
  checker. No third-party SDKs.
- **Don't broaden Accessibility scope** beyond the chat-app whitelist in
  `messenger_reader_config.xml`. This is the policy-sensitive surface.
- **Don't touch `claude_desktop_config.json`** — the host blocks it for good
  reason. Give the user a snippet to paste via "Edit Config".
- **Don't `git add` from `G:\`.** That's a different repo (`Freshair129/brain`).
  Always operate from `G:\NotiKeeper` (its own nested git).
- **Don't bump `versionCode` without releasing.** The in-app updater compares
  this number — bumping it locally without a matching release will make every
  install think it's outdated.
- **Vercel landing: Root Directory MUST stay `landing`** (set via project
  settings/REST API, not vercel.json). `vercel.json` must NOT contain comment
  keys — Vercel rejects unknown props and the deploy errors.
- **Capture vs read-aloud whitelists are different.** `Settings.shouldCapture`
  decides if a row is *stored*; `Settings.shouldSpeak` decides if it's *spoken*.
  Empty set = all (for both) — but a fresh install is NOT an empty set:
  `Settings.getCaptureApps` defaults to `DEFAULT_CAPTURE_APPS`
  (LINE/Messenger/WhatsApp/Telegram) since v1.13, so out-of-the-box capture is
  scoped, not "capture everything."

## How to build
Toolchain is portable at `D:\abuild` (JDK17 / Android SDK / Gradle 8.9).
```
set JAVA_HOME=D:\abuild\jdk\jdk-17.0.19+10
set ANDROID_SDK_ROOT=D:\abuild\sdk
D:\abuild\gradle\gradle-8.9\bin\gradle.bat -p G:\NotiKeeper assembleDebug
```
APK lands at `app/build/outputs/apk/debug/app-debug.apk`. The debug signing key
is stable on this machine, so updates install over each other.

## How to release
1. Bump `versionCode` (+1) and `versionName` in `app/build.gradle.kts`.
2. Update `release/version.json` to match.
3. Build.
4. `gh release create vX.Y --repo Freshair129/notikeeper --target main NotiKeeper.apk version.json`

Full detail: `RELEASE.md`. Architecture: `ARCHITECTURE.md`. Threat model: `SECURITY.md`.

## Repo map
```
app/                       Android app (Kotlin/Compose)
  src/main/java/.../        MainActivity, services, Updater, Speaker, Exporter,
                            InstalledApps, Theme
  src/main/java/.../screens/ DashboardScreen, FeedScreen, SettingsScreen, ThreadsScreen
  src/main/java/.../data/   NotiStore (SQLCipher + getStats), Settings,
                            DbKey (DB passphrase), SecureStore (Keystore-backed
                            settings store, isolated from DbKey — see gotchas)
  src/main/res/             adaptive icon, accessibility config
mcp-server/                Node server — see "analytics server" below
  server.mjs               HTTP (ingest/dashboard/SSE/pair/graph/chatlog APIs) + MCP stdio
  raw-store.mjs             SQLite mirror of data.jsonl (raw.db) — the durable
                            read path for stats/timeline/feed; replaced the old
                            in-memory `rows` array (G-19)
  relations.mjs            SQLite ETL → apps/users/threads/messages/participants
                            + thread_aliases (G-13) + message_links (G-20)
  graph-index.mjs          GenesisBlock graph + BGE-M3 embeddings (Ollama)
  noise.mjs / llm-gate.mjs  chrome-label noise filter / false-rescue guardrail
  rebuild-chatlog.mjs      per-source junk filters, bulk-dump detection → chatlog
  adb-lib.mjs / adb-scraper.mjs / scraper.mjs / scrape-all.mjs / fb-import.mjs
                            ADB live-scrape + Facebook JSON import (see
                            scraper-fb-import memory)
  config.mjs               shared server config
  dashboard.html           Feed / Threads / Chat / Timeline / รายงาน (Report) /
                            Graph / ตั้งค่า (Settings) tabs (Tailwind + vis-network CDN)
  NotiKeeper-Control.ps1   WinForms control GUI (start/stop/auto-start)
landing/                   React 19 + Vite landing page (→ Vercel)
docs/                      PRD, BRD, COMPETITIVE-BRIEF, RCAs, change requests
ios/NotiKeeperIOS/         Early iOS companion-app scaffold (unreleased)
release/version.json       Manifest the in-app updater fetches
RELEASE.md ARCHITECTURE.md SECURITY.md CHANGELOG.md LICENSE
```

## Analytics server (mcp-server/) — data pipeline
```
data.jsonl  (append-only raw, the app POSTs here via /ingest)
  → raw-store.mjs mirror → SQLite (raw.db): lossless 1:1 mirror, the durable
                   read path for stats/timeline/feed endpoints (G-19)
  → relations.mjs  ETL → SQLite (relations.db): Messenger-style schema
                   (apps/users/threads/messages/participants/thread_aliases/
                   message_links), aggressive chrome-label noise filter
  → graph-index.mjs mirror → GenesisBlock (graph.db): nodes/edges + HQL,
                   + BGE-M3 1024d vectors (collection "turns", cosine HNSW)
                   via local Ollama `bge-m3` (~190ms/embed)
```
- **Embedding unit = conversational *turn*, not raw message** (`buildTurns` in
  graph-index.mjs). Only `scrape`-source rows are embedded (clean dialogue);
  `screen` (inbox chrome) and `noti` (app spam) are dropped. Consecutive
  same-sender fragments within 5 min merge into one turn — fixes the ADB
  scraper's bubble-fragmentation. ~114 turns vs 10k raw msgs. Re-embeds leave
  orphan vectors (no `deleteVector` in GenesisBlock); `turns.json` is the source
  of truth and search filters dense hits to current reps.
- GenesisBlock = Rust napi DB `@freshair129/gks-genesis-block-native`
  (source at `G:\GenesisBlock_Dev\GenesisBlock`). HQL ids with `:` need quotes.
- HTTP: `/ingest` `/` `/dashboard` (dashboard) `/events` (SSE) `/api/{messages,
  stats,threads,threads/:id,users,relations,pair,pair-qr,graph/*,timeline,
  chatlog,chatlog/:id}`, plus admin/rebuild POSTs: `/api/chatlog/rebuild`,
  `/api/relations/rebuild`, `/api/dedup/rebuild`, `/api/gate/run`, and
  `/api/config` (GET/POST).
- MCP tools: `search_messages` `recent_messages` `list_apps` `stats`
  `semantic_search` `find_similar` `graph_neighbors` `hql` `thread_summary`
  `link_thread_alias` (G-13) `find_cross_stream_duplicates` `link_messages` (G-20).
- Runtime DBs (`raw.db*`, `relations.db*`, `graph.db/`, `data.jsonl`,
  node_modules) are gitignored — never commit them.

## House style
- Kotlin: idiomatic, no over-abstraction. Services are small; UI is one
  `MainActivity` with a couple of Composables. Don't refactor for tidiness.
- Comments: only when WHY isn't obvious from the code. No "what" comments.
- Errors at the upload/update boundary: surface as a status string in the UI,
  don't crash. Internal calls trust each other.

## Useful entry points
- Notification capture → `NotiLoggerService.kt` (`Settings.shouldCapture` gate)
- Screen-text capture → `MessengerReaderService.kt`
- Encrypted storage → `data/NotiStore.kt` + `data/DbKey.kt` (DB passphrase,
  isolated from the general settings store on purpose — see gotchas)
- Settings + Keystore-backed secure storage → `data/Settings.kt` + `data/SecureStore.kt`
- TTS read-aloud → `Speaker.kt` (+ `Settings.shouldSpeak`)
- Self-update → `Updater.kt`
- Export / API upload / QR pairing → `Exporter.kt`, `MainActivity` BackupScreen
- In-app dashboard → `screens/DashboardScreen.kt` (`NotiStore.getStats`)
- MCP + ingest + dashboard → `mcp-server/server.mjs`
- Durable raw-row read path → `mcp-server/raw-store.mjs`
- Relational ETL → `mcp-server/relations.mjs`
- Graph + embeddings → `mcp-server/graph-index.mjs`

## Known gotchas (learned the hard way)
- **`AEADBadTagException` on unlock** = a corrupted Keystore-backed key. Historically
  (through v1.11-ish) this was fixed by `Settings.prefs()` wiping the shared
  `secure_prefs`/`_androidx_security_master_key_` `EncryptedSharedPreferences`
  store — but that took the SQLCipher DB passphrase down with it too, since it
  lived in the same store, resetting `noti.db`. **That function no longer
  exists.** `data/SecureStore.kt` (direct Android Keystore, no
  `androidx.security:security-crypto`) now isolates the DB passphrase
  (`data/DbKey.kt`) into its own store/alias, separate from general settings —
  so one bad key now costs exactly one setting, never the database. A
  one-time `migrateIfNeeded` routine still references the old
  `secure_prefs`/master-key names, but only to import legacy data on upgrade,
  not as a recovery path.
- **Whether SQLCipher (`net.zetetic:android-database-sqlcipher:4.5.4`) has
  FTS5 compiled in is unconfirmed.** A real, documented upstream issue
  (`sqlcipher-android#314`) reports "no such module: fts5" on this exact
  library despite the compile flag supposedly being set, with no
  version-specific confirmation either way found. `setupFts()` in
  `NotiStore.kt` is wrapped defensively at three layers (creation, `query()`'s
  FTS-path try, a plain-LIKE fallback) specifically because this can't be
  resolved without a real device. If FTS5 search silently isn't being used,
  check this first.
- **Android 9+ blocks cleartext HTTP** — `usesCleartextTraffic=true` lets LAN
  upload (`http://192.168.x.x:8765/ingest`) work. (Fixed v1.7.)
- **ADB live-scrape works**: phone paired via wireless adb; Messenger is NOT
  FLAG_SECURE so `uiautomator dump` reads the chat. For battery, set
  `stay_on_while_plugged_in=3` + min brightness (true screen-off can't render UI).
- Server logs to **stderr only** (stdout is the MCP stdio channel).
