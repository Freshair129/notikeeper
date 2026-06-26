# NotiKeeper iOS Ad Hoc Distribution

This project can produce a signed Ad Hoc `.ipa` for registered devices such as an iPhone 12 Pro Max.

The repository includes a manual GitHub Actions workflow at `.github/workflows/ios-ad-hoc.yml` that:

- imports an Apple distribution certificate
- installs an Ad Hoc provisioning profile
- archives the iOS app
- exports a signed `.ipa`
- optionally publishes the `.ipa`, `.mobileprovision`, and OTA manifest to a GitHub release

## What Apple still requires

You need these items outside the repo before the workflow can succeed:

1. Apple Developer Program membership
2. An iOS Distribution certificate exported as `.p12`
3. An Ad Hoc provisioning profile whose App ID matches the bundle identifier
4. The target device registered in Apple Developer

For an iPhone 12 Pro Max, register that phone's UDID in the Apple Developer portal before creating the Ad Hoc provisioning profile.

Apple references:

- Ad Hoc provisioning profile: https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/
- Registered-device distribution: https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices

## GitHub repo variables

Set these repository variables:

- `IOS_BUNDLE_IDENTIFIER`
  Example: `com.freshair.notikeeperios`
- `IOS_TEAM_ID`
  Your Apple Developer team ID
- `IOS_PROFILE_NAME`
  The exact provisioning profile name from Apple Developer

## GitHub secrets

Set these repository secrets:

- `BUILD_CERTIFICATE_BASE64`
  Base64 of the distribution `.p12`
- `P12_PASSWORD`
  Password used when exporting the `.p12`
- `BUILD_PROVISION_PROFILE_BASE64`
  Base64 of the `.mobileprovision`
- `KEYCHAIN_PASSWORD`
  Temporary password used on the GitHub macOS runner keychain

## Create the Base64 values

On macOS:

```bash
base64 -i ios_distribution.p12 | pbcopy
base64 -i NotiKeeperIOS_AdHoc.mobileprovision | pbcopy
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ios_distribution.p12"))
[Convert]::ToBase64String([IO.File]::ReadAllBytes("NotiKeeperIOS_AdHoc.mobileprovision"))
```

## Run the workflow

Open GitHub Actions and run `iOS Ad Hoc Distribution`.

Inputs:

- `publish_release = false`
  Builds artifacts only
- `publish_release = true`
  Also uploads the `.ipa`, `.mobileprovision`, and manifest to the GitHub release tag you supply
- `release_tag`
  Required when `publish_release = true`

## Install on iPhone 12 Pro Max

### Option A: Local install with Finder or Apple Configurator

Use the exported `.ipa` on a Mac that can install apps onto the registered device.

### Option B: Over-the-air Ad Hoc install

If the workflow published release assets, host this install link somewhere the phone can open:

```text
itms-services://?action=download-manifest&url=https://github.com/<owner>/<repo>/releases/download/<tag>/NotiKeeperIOS-AdHoc-manifest.plist
```

Requirements:

- the iPhone 12 Pro Max UDID must be inside the Ad Hoc profile
- the device must have internet access to the hosted HTTPS URLs
- the bundle identifier must match the provisioning profile exactly

## Notes

- In Ad Hoc distribution, the provisioning profile is embedded in the app. The workflow also exports a standalone `.mobileprovision` file for inspection and traceability.
- This app is still an iOS companion viewer, not the Android-style capture app.
