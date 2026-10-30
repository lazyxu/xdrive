# Native PhotoKit Viewer exact-tile return — iOS Gallery-only

Parent: iOS native Owner PhotoAsset/local Gallery PR #3282. This development child does not rewrite the already-tested parent. Scope is **local PhotoKit wall and album-specific wall only**, preserving existing full-screen still/video/Live reader.

## Behavior

1. On a user tap of a currently authorized local photo/album tile, retain that *single* ephemeral PhotoKit candidate ID in current SwiftUI view memory, alongside the existing bounded 64-item page offset.
2. After L3 Viewer closes, reread the same 64-item page under current PhotoKit Full/Limited permission and library revision; only if the originally selected item still exists on this verified page, use SwiftUI ScrollViewReader to place its tile near the center. The normal page cursor/reload, Viewer presentation, media decoder and ownership do not change.
3. If PhotoKit permission is revoked, library contents change, the item is absent, or the page fails to reload, do not scroll to stale content. Clear the ephemeral anchor on scope/scene/library invalidation. The app still supports manual page navigation.
4. No PhotoKit asset ID is written to UserDefaults/Keychain or persisted, sent over Server, logged, or used as an upload receipt. No new uploader/backup/ACK/journal changes. Bounded in-memory metadata only.

## Validation

- Pure Swift Foundation policy test: same page, permission revoked, changed list, empty/oversized input, nonmatching page and >64 items.
- Native SwiftUI wiring regression for both local and album-specific grids, plus existing pagination/Viewer return checks; macOS IPA compile + required CI/Final Gate on exact new PR HEAD.
- Real iPhone scroll positioning across portrait/landscape, photo deletion/limited grants, VoiceOver and SideStore remain **跳过（未验收）** until physical verification.
- Server PhotoAsset Gallery already contains a logical-item Viewer return; this PR deliberately does not duplicate it. L2 hide/restore and compact five-slot bar are under separate navigation PR #3312.
