# iOS background automatic photo backup: fail-closed system integration checkpoint

User goal: full original **still + video + Live Photo** automatic incremental
backup while the iPhone is locked, suspended or the app was backgrounded.

## This PR actually provides

- iOS 16+ `BGProcessingTask` launch-handler registration in the original
  SwiftUI App bootstrap and exactly matching
  `BGTaskSchedulerPermittedIdentifiers` Info.plist property.
- `UIBackgroundModes = processing` is declared through the existing
  XcodeGen project file.
- An unmatched BGTask is failed closed; the registered processing task
  explicitly **does not start upload, read PhotoKit, mint a Device SourceRun
  credential or reuse a WKWebView Cookie or short-lived PWA access token**.
- Pending requests can be revoked by the native scheduler; no pending
  requests are created by this PR. The explicit
  `hasTrustedBackgroundExecutionGrant == false` models the real security
  limitation, not a fake success state.

## Why no background uploading is claimed

The existing #3147 foreground automatic scheduler has an authenticated
WebView session only while visible. The already-enrolled iOS Device
credential is identity-only and must not be widened into SourceRun/Root
write authority. A BGProcessingTask launch is not authorization.

Before enabling upload on a BGTask:

1. Server issues a narrowly scoped, revocable iOS Photo backup grant
   requiring exact authenticated Owner, installed Device ID, canonical
   Root, permitted PhotoKit source, expiry and replay protection.
2. Store the approved background credential in the native
   ThisDeviceOnly/WhenUnlocked Keychain; never expose it to JavaScript.
   Fail closed when locked/unavailable, revoked or changed Owner/Root.
3. Use the same persistent encrypted resource journal and authenticated
   Go UploadSession/CAS protocol; preserve unknown create/finalize ACK
   across process relaunch.
4. Stage genuine still/video/complete Live originals in durable protected
   files; use a background URLSession file-upload task with strict
   per-task Owner/revision verification. Apple's background sessions
   differ from foreground (including redirection behavior), so the
   backend must tolerate safe exact-host URLs and the client must not
   send Bearer credentials to an untrusted redirect.
5. Implement task expiration, OS restart, force-quit restrictions,
   user-visible revocation, scheduling policy, rate limits, battery /
   network controls and limited PhotoKit authorization handling.
6. Run exact-head XcodeGen + unsigned IPA build, linked Server security
   tests, and physical iPhone lock/suspend/resume/force-quit acceptance.

**No actual BGTask request is scheduled or executed by this PR.**
This is a deliberately narrow platform registration step, not completion
of the user's background-backup MVP.

Apple documentation:
- https://developer.apple.com/documentation/backgroundtasks/bgprocessingtaskrequest
- https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)

Tests on actual device, BGTask wake timing, silent Owner refresh, iCloud,
SideStore, Live ZIP and 100k ledger: **跳过（未验收）**.
