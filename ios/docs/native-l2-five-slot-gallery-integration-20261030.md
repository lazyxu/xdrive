# Native iOS five-slot + Gallery L2 focus integration (2026-10-30)

This developer integration branch joins the accepted source and tests of #3312 (five-tab native compact bar, Owner-scoped route hints, dynamic recent picker) and #3315/#3282 (Owner PhotoAsset Gallery, local PhotoKit/album Viewer exact-tile return). **No parent branch HEAD is rewritten.** This branch must independently pass its current-HEAD checks before being considered for master.

## Behavior and integration fix

- Five native tab positions remain 全部 | 动态功能 | 图库 | 文件 | 我的. TabView owns independent NavigationStacks; only the dynamic position changes label/icon. The custom native bar is a single L1 safe-area inset; there is no side rail or duplicate UIKit tab strip.
- Gallery/album-specific PhotoAsset wall's original “专注浏览” now signals the parent shell. In L2 the custom five-slot bar and Gallery source chips hide; the existing visible navigation-toolbar button “显示底部导航” restores L1. No forced L2 merely from turning an iPhone sideways.
- The verified Owner's Gallery PhotoAsset view alone may hide this bar. Native Files/Map/Admin remain honestly unavailable and cannot trigger fake L2. Child album routes propagate the focus callback; no child overrides system tab-bar visibility.
- Presenting a full-screen Gallery Viewer suspends disposable page reads without clearing L2 focus; after Viewer dismissal the originating Gallery and its focus remain, and the user may explicitly restore L1. Moving away from a gallery route or changing Owner/Root/session clears L2 state.
- The source selector distinguishes 云端图库 (PhotoAsset), 备份原件 (originals), and 本机照片/相册. Bounded Owner-scoped route restoration now also accepts the verified originals source. No PhotoKit local ID, signed preview ticket, password or upload ledger is persisted by the navigation state store.
- Portrait/landscape L1 bottom navigation reflows icon and label without modifying the underlying Tab route; controls retain a minimum 44-pt target and system-managed safe areas.

## Executable regression

Existing IPA tests from #3312 and #3315 are all retained. Two old source assertions are updated rather than suppressed: the gallery tests now verify the callback + absence of competing system tab-bar control, while the five-tab tests verify conditional custom-bar ownership. The new Foundation policy tests verify that L2 hides the bar only for an Owner-verified cloud PhotoAsset Gallery; Node tests verify callback propagation, reset paths, orientation stability and L3 modal continuity.

The exact integration HEAD still requires macOS iPhoneOS compilation, relevant repository CI/Final Gate and merge-protection checks. Physical iPhone notch/rotation, VoiceOver, PhotoKit Full/Limited/iCloud/Live, SideStore and 100k page performance remain **跳过（未验收）** until evidenced.

## Branch hygiene

Retain parent #3312/#3315/#3282 and the earlier #3307/#3311 untouched while their required CI jobs are running. Consolidate only after this branch's own tests confirm no dropped sources or test cases and GitHub accepts the integration. Do not claim parent CI certifies this merge commit.
