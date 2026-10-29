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
- A visible WKWebView with an authenticated Owner periodically checks
  the due time using the existing `/api/v1/me` bearer; only the current
  in-memory access token flows Web -> native. Swift reauthorizes and only
  runs a due, permitted foreground scan.
- The native shell additionally registers a BGProcessingTask at launch and
  submits a single system request after prior explicit opt-in. The same
  original-file runner and encrypted journal can execute while the app
  remains resident and its *RAM-only short-lived* bearer is still valid.
  The system can decline or delay the request. Expiration cancels the task,
  and unknown ACKs retain uncertainty. A cold launch without a new verified
  bearer **never** automatically enrolls a device, reads private Photos or
  uses a stored browser cookie/refresh token.
- On logout, Owner change, WebView teardown or explicit offline emergency
  OFF, the RAM-only bearer is discarded. The user can locally disable all
  schedules even without Server connectivity.
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

**Automatic is guaranteed only as a best-effort attempt in a visible,
authenticated foreground App.** A registered iOS BGProcessingTask may also
continue a *system-initiated* background interval while the same app process
retains an unexpired, recently verified in-memory bearer, but neither the
wake-up time nor success is guaranteed. A force-quit, a cold iOS relaunch,
expired token, PhotoKit Complete file protection while locked, or an
untrusted HTTPS certificate stops the task. Reliable unattended operation
across process termination still needs a *separate, explicit, revocable,
Owner/Root-limited background authorization issued by Server* and matching
Keychain/access refresh; never reuse a full Web refresh token or treat the
identity-only iOS Device Token as upload permission. No background
URLSession replacement is deployed: iOS background sessions can follow
redirects and would break the present no-redirect credential invariant.

This consolidated follow-up contains the original-video path from #3139,
the complete-still+motion one-Node Live ZIP path from #3142, the read-only
receipt review from #3135, and this authorized foreground schedule.
The single merged source still needs **exact-HEAD native IPA and Web CI**.
It must not be described as verified until that evidence exists. A Live ZIP
preserves both originals, not immediate Gallery Live playback.

## Verification

Pure Swift interval/cursor policy was compiled/executed on Linux with
`swiftc -swift-version 5`, PASS, including 600-asset wrap, 20-file
same-window continuation, unknown-ACK pause, large index and invalid time.
The IPA workflow runs the same test on macOS before native build.

Actual iPhone in foreground, lock-screen/suspension behavior, PhotoKit
permission changes, forced Server access-token revocation, iCloud and
SideStore installation: **跳过（未验收）**. Exact-HEAD Xcode IPA, Web TS,
server Owner ACL, CI Final Gate must pass before merge.
