# iOS foreground automatic incremental Photos schedule — MVP

This is the first **automatic interval** integration for the ONE shared
React/MUI xDrive iOS app. It is not a claim of precise iOS system background
delivery. Apple controls the actual launch time of BGProcessingTasks and does
not guarantee `earliestBeginDate`. The current PWA only has a short-lived
same-origin browser access token; copying its HttpOnly cookie or an unscoped
refresh credential into a native background task would violate the project's
Owner/Device security boundary.

## What is implemented

The user explicitly enables the feature in the canonical
`账户 → 设置 → iPhone 系统相册备份` section, chooses 15 min, 60 min,
6 h or 24 h and confirms the exact Owner/server and the foreground-only
limitation in an iOS system confirmation. The iCloud original download option
is separately visible and off unless explicitly enabled.

- The native bridge exposes `foregroundAutoSchedule` capability and
  `photos.auto.status/configure/tick`. Ordinary PWA/Desktop/DSM and older
  IPA versions do not pretend the Host exists.
- Native UserDefaults persists **only** the schedule, protected by a
  deterministic SHA256 partition of the verified Server origin/instance,
  Owner ID and root ID. It stores no bearer, refresh token, PhotoKit local
  identifier, GPS, original filename or private image bytes. The encrypted
  per-resource journal remains the authoritative idempotency proof.
- The native owner validates the short-lived Web access token, Server
  identity, root and PhotoKit Full/Limited authorization for every privileged
  request. The user opt-in is authorized by the system native confirmation,
  not a writable localStorage flag.
- A real visible WKWebView with an authenticated Owner periodically checks
  the due time. It first refreshes/authenticates the Owner through existing
  `/api/v1/me` Web API; only the current in-memory access token goes Web ->
  native. Swift reauthorizes it and only runs a due, permitted foreground
  scan. On logout/Owner change/hidden page/host teardown/background, cancel
  and never resubmit an uncertain upload.
- The next due time is durably reserved **before** possible bytes are sent.
  Each run checks at most one 256-item authorized PhotoKit window, processes
  max 20 new originals and advances to the next segment only if it reached
  the end of this window with no unconfirmed ACK. If the 20-item cap stops
  early, repeat the same window and reverify already-confirmed receipts.
  When the scan reaches the final current window, wrap to the newest.
- Any unknown Server create/finalize receipt pauses the auto schedule for
  manual read-only reconciliation, never a blind create/retry. Disabling
  a schedule does not delete existing cloud files or encrypted receipts.

## Important limits

**Automatic means while the iOS App is foreground, visible and authenticated.**
The first tick can run after enabling; subsequent eligible ticks are driven
by a visible WebView every minute with native interval gating. The app closed,
iPhone locked, suspended Safari WKWebView, no current authenticated Server
session or missing trusted HTTPS CA **do not have a working automatic upload
guarantee**. Native BGProcessingTask + constrained Device grant/credential
renewal, durable upload session across app relaunch and OS scheduling require
separate implementation and physical acceptance. Apple BGProcessingTask
earliestBeginDate does not promise an exact wake-up time.

Video and Live original files are implemented in independent Draft PRs #3139
and #3142. This automatic scheduling PR uses the existing current #3123
foreground runner while those resource PRs are integrated; do not label it a
complete photo+video+Live automatic backup release until all accepted code and
receipts share one tested HEAD.

## Verification

Pure Swift interval/cursor policy was compiled/executed on Linux with
`swiftc -swift-version 5`, PASS, including 600-asset wrap, 20-file
same-window continuation, unknown-ACK pause, large index and invalid time.
The IPA workflow runs the same test on macOS before native build.

Actual iPhone in foreground, lock-screen/suspension behavior, PhotoKit
permission changes, forced Server access-token revocation, iCloud and
SideStore installation: **跳过（未验收）**. Exact-HEAD Xcode IPA, Web TS,
server Owner ACL, CI Final Gate must pass before merge.
