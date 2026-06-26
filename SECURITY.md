# Security Model

## Threat model

NotiKeeper is built for one specific situation: **the device owner archiving
their own chat / notification data, on their own device, to recover information
they would otherwise lose** (deleted messages, the 24-hour notification log
limit, etc.). Everything below is reasoned against that scope.

### What we defend against
- **Casual pickup of the phone** while unlocked → biometric app lock.
- **Forensic file-grab from a rooted phone, ADB backup, or stolen device
  storage** → whole-DB encryption (SQLCipher / AES-256).
- **The DB passphrase leaking from disk** → key held in
  `EncryptedSharedPreferences`, master key in the Android Keystore
  (hardware-backed where available).
- **Accidental data egress** → no telemetry, no analytics, no third-party
  SDKs. The only network traffic is the user-configured upload endpoint
  and the update check.

### What we explicitly do NOT defend against
- **A compromised OS or malicious accessibility-enabled malware on the same
  device.** Anything with accessibility access can read what NotiKeeper reads.
- **The other party in the conversation.** The remote party always retains
  their own copy of messages; NotiKeeper does not change that.
- **The user themselves making bad choices** with exports — exported JSON /
  CSV is plaintext (so it can be opened on a PC). Treat it like any other
  sensitive document.
- **Government / lawful access**, where the user is compelled to unlock the
  device.

## Encryption details

| Layer | What | How |
|---|---|---|
| At rest | `noti.db` file | SQLCipher 4.x, AES-256 in CBC + HMAC-SHA512, default KDF iterations |
| Key storage | 32-byte random passphrase | `EncryptedSharedPreferences` (AES256_GCM values, AES256_SIV keys) |
| Master key | wraps the prefs file | Android `MasterKey` (`AES256_GCM`), hardware-backed via Keystore where available |
| UI gate | biometric / device credential | `BiometricPrompt` with `BIOMETRIC_STRONG \| DEVICE_CREDENTIAL` |

**Why the passphrase is not user-derived.** The background capture services
must write to the DB while the app is locked. A user-derived key would force
the user to unlock the app before any new notification could be saved — which
defeats the point. Layering encryption + app lock instead gives both
properties: the file is unreadable without the device, and the UI is gated
even when the device is unlocked.

**Consequence:** clearing app data or factory-resetting the device destroys
the Keystore-held master key, which makes the existing DB unrecoverable. This
is by design. Users who need long-term archival should use the export
functions and store the output elsewhere.

## Permission model

| Permission | Why needed | Optional? |
|---|---|---|
| `BIND_NOTIFICATION_LISTENER_SERVICE` | Capture notifications | No — core feature |
| `BIND_ACCESSIBILITY_SERVICE` | Read on-screen chat text | Yes — only screen capture needs it |
| `INTERNET` | User-configured upload + update check | Only used when user enables it |
| `REQUEST_INSTALL_PACKAGES` | In-app updater installs downloaded APK | Required only when an update is applied |
| `QUERY_ALL_PACKAGES` | Read-aloud picker enumerates installed apps | Could be replaced with a manual list if Play distribution is ever pursued |

Notification + Accessibility access cannot be granted at runtime — Android
requires the user to enable each in the system Settings screen. The app
detects whether each is enabled and shows a card linking to the right
Settings page until it is.

## Policy notes (non-technical)

This app uses `AccessibilityService` to read chat content for the device
owner's own archival. That is allowed by the API but **violates the Google
Play distribution policy** for accessibility access (Play requires the use to
"genuinely assist users with disabilities"). NotiKeeper is therefore
**sideload-only** and not intended for the Play Store.

Use on someone else's account or device without their consent is not within
the project's intended use and is not supported by the maintainer.

## Reporting

Found a real security issue (not a policy concern)? Open a private security
advisory on the GitHub repo, or email the address in the commit log. Please
don't open a public issue with reproducible exploit details.
