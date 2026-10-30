# iOS five-slot compact bottom bar — portrait/landscape implementation (2026-10-30)

This iOS native UI change is a stacked child of #3311 (whose tested HEAD is not rewritten), itself dependent on #3307. It retains exactly five native SwiftUI TabView destinations and each destination's own NavigationStack. It does **not** introduce a second navigation rail or new server routes.

### Actual behavior

- Hide the system tab strip and use a single five-button L1 native bottom bar with SwiftUI safe-area placement. Only the dynamic button changes title/symbol; the fixed order is 全部 | 动态功能 | 图库 | 文件 | 我的.
- iPhone portrait (regular vertical size class): SF Symbol above one-line label, bar content 56 pt high. iPhone landscape (compact vertical size class): symbol beside label, 48 pt high. Both use at least 44 pt interactive target height; system home-indicator safe area is handled separately. This is intended for iPhone rather than forcing desktop-style panes.
- The dynamic button has an actual iOS native `contextMenu` on long press, showing recent features and a sheet entry. VoiceOver also has a named `最近功能` accessibility action. Native Launcher chips and the dynamic page toolbar retain alternate access.
- No added navigation state is needed to rotate; changing size class recomposes only the bar while retaining TabView selection, native page state, Owner identity and Viewer overlay. Fullscreen Viewer still owns L3 and covers the L1 strip.

### Honest limitations

- L2 focus/hide/restore is not claimed while native Map/Files focus routes are unavailable. A real L2 feature must hide this bar and offer a visible restore control when implemented.
- UIKit/SwiftUI material/background details and actual notch/Dynamic Island/home-indicator layout require physical iPhone/VoiceOver and rotation testing: **跳过（未验收）**. The source contract verifies intent, not pixel parity.
- No local backup journal encryption enhancement, no new uploader, no change to existing Owner receipt reconciliation, no WebView or extra navigation hierarchy.

### Required checks

The exact PR HEAD must pass the standalone iOS unsigned IPA source tests, native Xcode device compilation, applicable repository CI and Final Gate before merge. Failed checks are not waived.
