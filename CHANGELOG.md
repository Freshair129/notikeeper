# Changelog

All notable changes to NotiKeeper. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project uses
[SemVer](https://semver.org/) where `versionCode` increments monotonically per
release.

## [Unreleased]
### Added
- iOS companion app scaffold under `ios/NotiKeeperIOS` for importing,
  searching, reading aloud, and exporting NotiKeeper archive data on iPhone.
- iOS companion PRD documenting the platform boundary: iOS can view/import
  exported archives, but cannot capture other apps' notifications or screen
  content like the Android app.

## [1.13] — 2026-07-09
### Fixed
- **QR pairing scan loop**: launching the QR scanner (or the notification/
  accessibility permission screens, or the file-share sheet) triggered the
  app's re-lock-on-background check, tearing down the screen — and its
  pending scan-result callback — before the result arrived, so the scan was
  silently dropped and the app demanded re-authentication every time.
  Scanning now completes and pairs correctly; see
  `docs/rca/2026-07-09-qr-scan-relock-loop.md`.

### Added
- Bottom navigation (Feed / Threads / Dashboard / Settings) replacing the
  flat TopAppBar button row; Threads folded into a segmented toggle on Feed.
- **Threads** tab: on-device conversation grouping + Thread Detail chat view.
- **Settings → อุปกรณ์และการเชื่อมต่อ** (Device & Connection): device name,
  live connection status, capture-filter summary, QR pairing.
- Default capture whitelist narrowed to LINE / Messenger / WhatsApp /
  Telegram (previously captured every app by default); still user-editable.
- `captureApps` now syncs from the PC dashboard through QR pairing.
- App-scoped filter chips on Feed.
- Light/dark theme following the system setting (previously hardcoded dark).
- Real server-side auth (`NOTIKEEPER_TOKEN`) on all dashboard read APIs and
  the SSE stream — the PIN gate on the Vercel-hosted dashboard was
  previously client-side-only and didn't protect the underlying data.

## [1.11] — 2026-06-26
### Added
- **QR Pairing** between the PC dashboard and the phone: dashboard exposes
  a "Pair Mobile" button that opens a modal with a QR code carrying the
  server endpoint, token, and update URL (auto-detected LAN IP via
  `os.networkInterfaces()`, skipping WSL/Hyper-V 172.x ranges). The Android
  app has a matching "📷 สแกน QR จาก PC dashboard" button in the Backup
  screen (uses `journeyapps:zxing-android-embedded`). Accepts plain URL or
  JSON payloads; falls back gracefully when the QR is just a URL.

## [1.10] — 2026-06-26
### Added
- Per-app **capture whitelist** (`Settings.shouldCapture`): the Backup screen
  now has a "เลือกแอปที่จะบันทึก" section that scans every installed app and
  lets the user pick which ones get archived. Empty selection = capture all
  apps (previous behaviour). Applies to both `NotiLoggerService` (noti) and
  `MessengerReaderService` (screen reads).

## [1.9] — 2026-06-26
### Added
- In-app **Dashboard** screen (top app bar → "Dashboard"): four KPI tiles
  (total messages, top app, noti/screen split, time range), a 24-hour
  activity sparkline (Compose Canvas), and a Top-8 apps bar chart. Reads
  aggregates straight from the encrypted DB via `NotiStore.getStats()`.

## [1.8] — 2026-06-26
### Changed
- The update URL field is now prefilled with NotiKeeper's GitHub Releases
  `latest/download/version.json` endpoint by default. A fresh install can
  check for updates and self-update without any manual configuration; users
  can still overwrite the field to point at a private mirror.

## [1.7] — 2026-06-26
### Fixed
- Upload to a private LAN endpoint (e.g. `http://192.168.1.100:8765/ingest`)
  failed with "unable to parse TLS packet" on the server side. Android 9+
  blocks cleartext HTTP by default, which made `HttpURLConnection` either
  upgrade the request or send TLS bytes against an HTTP listener. The
  `<application>` element now sets `android:usesCleartextTraffic="true"`,
  so plain HTTP works for private servers while HTTPS endpoints continue
  to work as before.

## [1.6] — 2026-06-26
### Added
- Adaptive launcher icon (vector bell + lock, navy / blue / gold).
- Read-aloud whitelist now enumerates **every installed app** via
  `PackageManager.queryIntentActivities(ACTION_MAIN/CATEGORY_LAUNCHER)`, with a
  filter field — no typing required to pick which apps to read.
- `QUERY_ALL_PACKAGES` permission (required by Android 11+ for the picker).

### Changed
- App picker UI: replaces the previous DB-only list with installed-app scan +
  filter; shows a "X selected / Y total" counter.

## [1.5] — 2026-06-26
### Added
- In-app updater: checks a configurable `version.json` URL on launch,
  downloads the APK if `versionCode` is newer, and launches the system
  installer. Designed for GitHub Releases
  (`/releases/latest/download/version.json` is a stable URL).
- `REQUEST_INSTALL_PACKAGES` permission.

## [1.4] — 2026-06-26
### Added
- Per-app whitelist for read-aloud (`Settings.shouldSpeak`). Empty whitelist =
  read every app (previous behaviour); ticking apps narrows it down.

## [1.3] — 2026-06-26
### Added
- Eyes-free read-aloud mode for riders (`Speaker.kt`): Android `TextToSpeech`
  with `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` so spoken alerts dip background
  music like a GPS prompt and restore it on completion.
- Two independent toggles: read notifications aloud, and/or read screen text
  aloud (Messenger / LINE / IG / WhatsApp / Telegram).
- `<queries>` for `TTS_SERVICE` in the manifest (Android 11+).

## [1.2] — 2026-06-26
### Added
- WhatsApp + WhatsApp Business + Telegram + Telegram X to the screen reader.
- Backup / export screen:
  - Share JSON / CSV via the system share sheet (→ Drive, email, send-to-PC).
  - Save JSON + CSV into the public `Downloads` folder.
  - Configurable private API upload (`POST /ingest`) with optional bearer
    token and an auto-upload toggle. Tracks last-uploaded id to send only new
    rows on subsequent runs.
- `INTERNET` permission (used only for the user-configured upload / updater).
- `FileProvider` for sharing exported files.

## [1.1] — 2026-06-26
### Added
- LINE + Instagram DM screen capture (previously Messenger-only).
- Per-app label displayed in the row tag instead of hardcoded "Messenger".

## [1.0] — 2026-06-26
### Added
- Initial release. Notification capture
  (`NotificationListenerService`), Messenger screen-text capture
  (`AccessibilityService`), encrypted storage (SQLCipher / AES-256, key in
  Android Keystore via `EncryptedSharedPreferences`), and biometric app lock
  (`BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`).
