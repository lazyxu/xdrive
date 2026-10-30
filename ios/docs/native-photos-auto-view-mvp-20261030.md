# iOS native Photos automatic backup and viewing — integration MVP

## Why this separate development PR

The user chose a **fully native SwiftUI/UIKit iOS app**. The earlier App entry was
`XDriveWebAppHome()` (WKWebView). This branch mounts native authentication and a
native Photos-first workspace instead. It does **not** claim to provide the
complete cloud Files, album, global search or all-platform feature parity yet.

This developer branch preserves the tested sources/parent history from #3263
(PhotoKit inventory + scan screen) and #3264 (Owner sign-in + native Keychain v2).
Neither already-passing PR's head was rewritten. The integration also shares
the existing master Go UploadSession/CAS server and native sealed intent writer.
There is **no second uploader or legacy Web login**.

## Supported scope

1. Explicit native HTTPS Owner login/refresh, `/me` and `/nodes/root` checks,
   separate Keychain v2, logout and stop-only old background grant revocation.
2. Permission-scoped 64-entry PhotoKit thumbnail grid, 64-slot page navigation,
   and local still/video/Live native viewers. Thumbnails and previews do not
   upload local files. Permission prompt is user-initiated. The older local
   album list and bounded scan preview remain accessible.
3. Native explicit manual foreground original backup, up to 256 candidate
   positions and 20 new originals per run, supporting stills, video and
   Live Photo **two-resource ZIP**. AES-GCM/Owner-scoped receipt/uncertain-ACK
   controls remain in the existing `ForegroundPhotoBackupMVP` and journal.
4. Native opt-in foreground auto schedule (15/60/360/1440 minutes) with per-Owner
   persistent due window, PhotoKit epoch fence, shared global original run gate
   acquired **before** `reserveDue`, and the same Owner/CAS upload executor.
   Foreground tick only while the native Photos workspace is active. No
   unattended promise after iOS force quit or a locked device.
5. Native cloud **Owner-root original file list**, 48 root entries scanned per
   page; only `-xios-` tagged originals are displayed as imported files.
   Still and video previews use existing Owner-authorized preview ticket APIs.
   A ZIP is shown accurately as a stored Live pair, not a playable Live Photo.
6. Cancel on scene/background, page owner switch, or logout; explicit local
   schedule disable and best-effort remote BG grant revocation. Already committed
   originals/uncertain receipts are not deleted on logout.
7. If access bearer expires, native short-lived reauthentication refreshes
   the isolated native token, then reproves the same Owner/Server/root before
   continuing. Neither bearer nor refresh token reaches JavaScript.

## Explicitly NOT completed

- No fully native Files CRUD, complete Gallery PhotoAsset view, global albums,
  full cloud Viewer feature parity, or Live ZIP unpacking/animated cloud playback.
- Root-folder scans are not a whole-library Gallery index; an empty initial
  page must **not** be reported as proof that a backup is missing.
- Manual mode starts with the first 256-candidate window; the automatic mode
  walks further windows over subsequent eligible foreground checks.
- Background BGProcessing remains restricted to separately approved native
  grants and is advisory; this feature does not enable it automatically or
  weaken existing Keychain/FileProtection for locked-device work.
- The installed IPA, SideStore signing/renewal, physical iPhone/iCloud/Live
  playback and end-to-end lost-ACK recovery still require device acceptance
  and must be marked **跳过（未验收）** until actually exercised.

## Build / regression gate

Run the exact commit SHA on the macOS `iOS Native Unsigned IPA` workflow and
the repository CI `final-gate`, as well as all native source contracts
(including `ios-native-photos-auto-view-mvp.cjs`). Do not merge or publish
this development cutover until those checks pass. Preserve the current
released WKWebView IPA until the native vertical MVP is accepted.
