# iOS Photos-first five-slot navigation — implementation checkpoint (2026-10-30)

This is a **development-branch implementation**, not an installed/released native IPA. Authoritative user-approved interaction rules: [all-platform iOS navigation + gallery contract](../../docs/architecture/ios-native-navigation-and-gallery.md) (documentation PR #3276).

## Scope implemented here

- Reuses the SwiftUI native verified Owner login and the PhotoKit/backup root from #3268 and the native cloud thumbnail/foreground scheduler from #3272. Does not alter those parent branch HEADs.
- Replaces the previous four-Photos-tab dashboard with five stable native SwiftUI bottom destinations, in this order: **全部 / 动态 / 图库 / 文件 / 我的**. All icons are SF Symbols, and only the second slot varies. Gallery is the default destination after the user opens the native workspace from the verified Owner screen.
- Launcher: category-grouped native feature grid, search and recently used dynamic functions. Real paths to native local photos, bounded local albums, cloud backed-up originals, and the existing native backup; other functions truthfully explain that their native service is unavailable. Server-admin functions remain hidden, because server-admin authority is not established.
- Gallery: local photos, local **user/smart albums**, Owner-backed original thumbnail wall, and an explicit unavailable map placeholder in a single Gallery route. PhotoKit albums are 32 per page, members 64 per page. Album cover thumbnails use the existing cancellable local loader; user/collection identifiers are in-memory only.
- Viewer: native still/video/Live and cloud original previews use full-screen presentation over the five-slot bar and return to the source page. Cloud Live ZIP continues to show its non-playable state; no PDF editing.
- Owner change resets tab state and forces the old owner-scoped child view tree to be recreated. Album lists and opened album pages invalidate on foreground/background transition or PhotoKit library change. No new native upload writer/Keychain namespace and no Web/PWA cookie.
- My shows verified Server/Owner and a link back to the existing secure native login/logout screen. This stage does **not** invent native Server-switch credentials.

## Deliberately unfinished

- The dashboard is still opened from the existing verified native account screen; automatic post-login shell entry and more complete account settings are follow-ups.
- Full Files CRUD, native cloud PhotoAsset albums, media map/places, full search and complex diagnostics/storage/server-admin controllers are **not** implemented. The visible placeholders must not be presented as working features.
- Dynamic feature recent history is session-local; per-feature scroll paths and persistent Owner-scoped restore are not fully implemented. Long-press-on-tab is not assumed to work in a system `TabView`; the recent picker is explicitly accessible from the dynamic page and Launcher.
- L1 standard and L3 full-screen media entry are implemented; L2 explicit focused mode and complete iPhone landscape layout/safe-area/VoiceOver validation are still pending.
- PhotoKit limited authorization, iCloud and Live playback on real iPhone, A→B→A token switching, crash/relaunch and SideStore installation: **跳过（未验收）**.

## Acceptance

The macOS unsigned IPA workflow explicitly runs existing login/Photos/native-foreground/cloud-thumbnail contracts plus the new album/navigation source checks before building the exact head. Real Xcode compilation, GitHub CI Final Gate and physical-device evidence must be checked for this **exact** commit; a green #3268 parent does not validate it. No master merge while those checks are missing.
