# iOS offline emergency stop — all local automatic Photos schedules

A follow-up to the canonical scoped-background integration #3210.
This **stacked development PR** does not alter the tested #3210 HEAD.

## Stop-only behavior

- The existing trusted HTTPS WKWebView Host bridge and the native connection
  error/bootstrap screen now both stop **all foreground auto schedules for
  this iPhone's local xDrive app**, not just the currently authenticated Owner.
- This exact, offline-only deletion enumerates UserDefaults keys that start
  with `xdrive.ios.photos.auto.v1.` and have precisely 64 lowercase SHA-256
  hex digits. It does not delete PWA cookies, unrelated defaults, encrypted
  UploadSession intent, cloud files, or user-photo metadata.
- The existing BG grant stop still cancels system requests and removes the
  approved Keychain vault, including a best-effort remote revoke pending
  marker. Disabling locally **does not assert remote revoke succeeded**.
  If Keychain deletion is unavailable, the UI explicitly reports partial
  local completion instead of claiming fully successful stop.
- A verified Owner may explicitly authorize a new foreground schedule later.
  Background activation still requires its independent native Owner/Device/
  Root-scoped grant, actual Server verification and current Photos permission.
- The shared React/MUI Settings retains one emergency stop control; no
  duplicate SwiftUI Login, Gallery, Files or Photos settings page is added.

## Test and deployment status

New Node source contracts assert exact-key deletion, stop order, a trusted
main frame, no credential exposure and conservative UI status when an older
IPA omits the new count. Native iPhoneOS IPA / full CI and real offline
Keychain/PhotoKit tests remain **unverified**. As a stacked PR with a non-master
base, it must be retargeted and pass the relevant exact-HEAD checks before
master merge. Actual iPhone / SideStore acceptance is 跳过（未验收）.
