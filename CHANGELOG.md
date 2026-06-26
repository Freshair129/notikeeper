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
