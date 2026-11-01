# iOS native local Viewer — on-demand iCloud original loading (2026-11-01)

## Verified gap on master

`NativeLocalPhotoGallery.swift` displayed locally cached thumbnails and still/video/Live resources but explicitly set PhotoKit network access to `false`. A permitted iCloud-only asset could therefore appear in the authorized wall but fail in the full-screen native Viewer. The foreground original backup policy already has independent opt-in iCloud handling; this is **not** a backup change.

## Implemented in this narrowly scoped branch

- Local PhotoKit **still, video and Live Photo** Viewer requests remain local-only by default. Grid thumbnail requests remain strictly network-disabled.
- If PhotoKit reports missing/cloud-only resources, L3 Viewer exposes a 44pt **从 iCloud 加载当前原件** action. Only a direct tap can retry the exact current PhotoKit item with `isNetworkAccessAllowed = true`. It requires active app scene, still-authorized library and unchanged local asset creation/modification dates plus media-kind match.
- A visible progress indicator covers the requested still/video/Live parts. If a download fails, the action changes to **重试从 iCloud 加载当前原件**; it is not reported as an uploaded or cloud-backed-up receipt.
- Switching to a different loaded item resets the explicit permission to download. Backgrounding, leaving the Viewer, or PhotoKit mutation cancels/stales the active PhotoKit requests. Returning to foreground cannot implicitly repeat a previous iCloud request. Existing local/album source and Viewer return anchors are preserved.
- No changes to the Owner, photo upload writer, BG grants, CAS, account credentials, server endpoints, platform navigation or existing running PR heads.

## Acceptance and remaining gaps

Source regression: `desktop/tests/ios-native-local-viewer-on-demand-icloud.cjs`, included in the exact-head iOS Native Unsigned IPA workflow. Xcode Swift compilation, entire applicable PR CI and Final Gate must pass at this new PR HEAD before master merge.

iCloud loading on a **physical iPhone** with locally unavailable photo, video, and Live Photo; weak network/revoked permission; and installed IPA re-entry remain **跳过（未验收）** until actually tested. This PR does not deliver the missing Year/Month/Day global Photos timeline, multi-select, Favorites/Trash, full cloud PhotoAsset restore to the iOS Photos library, or comprehensive iPhone UI parity.