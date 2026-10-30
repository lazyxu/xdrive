# iOS native navigation route resume — scoped follow-up (2026-10-30)

This is an iOS navigation-only development increment stacked on PR #3307. It does not alter that PR's already-started CI HEAD, and does not make native Files, Map, Admin, L2 or the landscape tab layout complete.

## Implemented scope

- After a **verified native Owner/Root** exists, the Dashboard may restore only bounded route hints: five-slot tab, Gallery source, implemented dynamic feature (currently photo backup), and implemented recent dynamic entries. Persisted hints contain a SHA-256 hash of `origin | instanceID | ownerID | rootNodeID`, not raw credentials or media identities.
- One local snapshot (UserDefaults, version 1, at most 2 KiB). It contains no local PhotoKit identifiers, signed preview URLs, tokens, file paths, media metadata, upload receipts, task logs or active consent. It is **not** a replacement for the encrypted original upload ledger.
- On any live Owner/Root/Server switch or logout, clear the saved hints and reset parent state, including A→B→A. A different verified Owner on cold launch also invalidates and deletes the previous snapshot.
- Fail closed on malformed/oversized/version-incompatible hints. Do not restore not-yet-implemented native Map, Sync, Storage, Diagnostics or privileged Admin screens, even if they were selected within an earlier session.
- Child Gallery, PhotoKit and cloud contents always recheck permissions/Owner and reload verified data. UserDefaults does not supply those contents. The app-root backup controller and its receipt/unknown ACK state are unchanged.

## Still open

- Exact scroll offset and per-feature nested navigation path restoration (album-specific and Files routes), retaining an in-memory anchor when switching between tabs; no PhotoKit IDs should be persisted across relaunch.
- A reliable on-tab long-press recent picker, compact portrait/landscape tab bar and explicit L2 focus toggle + restore. The existing recent picker remains reachable from native Launcher and dynamic page toolbar.
- Genuine native Files/Map/Admin, 100k real-device scrolling and full iPhone landscape/VoiceOver hardware validation: **跳过（未验收）**.

## Executable checks

`swiftc -swift-version 5 ios/XDriveIOS/NativeNavigationRouteStore.swift ios/tests/NativeNavigationRouteStoreChecks.swift -o /tmp/xdrive-ios-nav && /tmp/xdrive-ios-nav`

The iOS unsigned IPA workflow also runs the pure Swift scope/serialization tests and the Node wiring contract, followed by native iPhoneOS build and required repository CI/Final Gate. No evidence from a green parent commit substitutes for exact-child-HEAD checks.
