# NotiKeeper — AI Working Contract

> Auto-loaded by Claude Code when working in this repo. Read this first.

## What this is
Android sideload app (Kotlin/Compose, minSdk 30) that captures notifications and
reads chat threads off the screen, stores them in an encrypted SQLCipher DB
behind a biometric lock, and can export/upload/read aloud. Companion Node MCP
server lets Claude search the archive. **Personal-use tool** for the device
owner's own data — not a Play-Store product.

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
  src/main/java/.../        MainActivity, services, Updater, Speaker, Exporter
  src/main/java/.../data/   NotiStore (SQLCipher), Settings, DbKey
  src/main/res/             icon (adaptive vector), accessibility config
mcp-server/                Node MCP server (ingest + Claude tools)
release/version.json       Manifest the in-app updater fetches
RELEASE.md                 Release process
ARCHITECTURE.md            System overview + diagrams
SECURITY.md                Threat model + encryption choices
CHANGELOG.md               Version history
```

## House style
- Kotlin: idiomatic, no over-abstraction. Services are small; UI is one
  `MainActivity` with a couple of Composables. Don't refactor for tidiness.
- Comments: only when WHY isn't obvious from the code. No "what" comments.
- Errors at the upload/update boundary: surface as a status string in the UI,
  don't crash. Internal calls trust each other.

## Useful entry points
- Notification capture → `NotiLoggerService.kt`
- Screen-text capture → `MessengerReaderService.kt`
- Encrypted storage → `data/NotiStore.kt` + `data/DbKey.kt`
- TTS read-aloud → `Speaker.kt` (+ `Settings.shouldSpeak`)
- Self-update → `Updater.kt`
- Export / API upload → `Exporter.kt`
- MCP integration → `mcp-server/server.mjs`
