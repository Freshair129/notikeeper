# NotiKeeper iOS Companion

SwiftUI companion app for viewing, searching, importing, speaking, and exporting NotiKeeper archive data on iPhone.

## Scope

This app does not capture other apps' notifications or screen content on iOS. iOS sandboxing prevents the Android capture model from being ported directly. Use the Android app or `mcp-server/data.jsonl` as the capture source, then import JSON/CSV/JSONL here.

## Build

1. Open `NotiKeeperIOS.xcodeproj` on macOS with Xcode 15 or newer.
2. Select the `NotiKeeperIOS` scheme.
3. Run on an iOS 16+ simulator or device.

## Ad Hoc distribution

For signed `.ipa` export and registered-device distribution, see [AD_HOC_DISTRIBUTION.md](AD_HOC_DISTRIBUTION.md).

## Import formats

- Android JSON export: array of objects with `id, source, app, pkg, title, text, side, time`
- Android CSV export: `id,source,app,title,text,side,time`
- MCP JSONL: one JSON object per line using the same JSON fields
