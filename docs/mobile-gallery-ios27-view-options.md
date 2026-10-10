# iOS 27 Photos · Gallery View Options parity

**Scope:** Follow-up to merged P0-2a KFS columns (#1220) and P0-2b virtual/dense parity (#1232). This delivery only adds explicit **放大 / 缩小** commands to the existing Mobile Web Gallery's More/View Options sheet; it does **not** build a new photo wall, server endpoint, virtual collection, or Viewer. The P0-2c screen-relative pinch anchor (#1241) is a separate open PR and is not an implicit part of this change.

## Official target and exact behavior

Apple's [iOS 27 Photos — Browse your photo library](https://support.apple.com/guide/iphone/browse-your-photo-library-iph7d24753a5/27/ios/27) documents both pinch-to-zoom and `View Options → Zoom In / Zoom Out`; the latter increases/decreases **thumbnail size**, not image magnification within the Viewer.

The xDrive Mobile Gallery's shared `density` prop is now an integer **minimum column count** (2–10), so the UI mapping is intentionally inverse: **放大 → decrease minimum columns by one step**; **缩小 → increase by one step**. Both invoke the **existing** `onDensityChange` callback used by the mobile density slider, which ultimately reaches the shared `XDriveMediaGalleryPage` controller and virtual Grid/Timeline. The controls disable at their respective limits, stay keyboard/assistive-technology reachable with labeled MUI buttons (at least 44px touch height), and are omitted from the Collections overview without a photo wall.

At 390 CSS px content width and the **currently provisional** Mobile All default of 3 columns, one Zoom In requests a 2-column minimum; one Zoom Out requests 4. Wide Web/Desktop retain their existing pixel-width density preference and renderers; no mobile-specific API or permission path is added. Because the KFS-style formula uses `max(minColumns, floor(clientWidth/144))`, the minimum-column change may have no visible effect in a very wide Mobile Web viewport when its automatic columns already exceed that minimum. This is an **outstanding interaction fidelity gap** to address by calibrating the visible column level against iOS 27 screenshots, not by silently modifying shared pagination.

**Limitations remaining:** Apple's *Aspect Ratio Grid* genuinely arranges photo thumbnails in their native proportions. xDrive's current `aspectMode: contain` still shows an uncropped asset **inside a square grid cell**. This is not equivalent to native-proportion grid geometry; it requires a separately measured bounded layout/virtualization design, not a CSS label change. Do not claim full native visual 1:1, continuous pinch reflow, physical iOS 27 tap feedback or real 100k browser performance from this change.

## Acceptance and evidence

- Tests: `desktop/tests/mobile-gallery-ios-chrome.cjs` renders the real Mobile Gallery Chrome component and checks the More sheet, button accessibility labels/minimum touch height, 3→2/4 callback effects, disabled 2/10 boundaries, Collections omission, and unchanged shared controller hookup.
- The authoritative gate for this GitHub delivery is the **exact-head complete PR CI** and a one-work-commit branch. Until that succeeds, mark it **candidate** rather than merged.
- Native acceptance remains separate: compare iOS 27 Photos against xDrive on matching iPhones, OS versions, display zoom, photo datasets, 320/360/390/430px width and selected density level. Record screenshot pairs, pinch/Zoom In/Out videos, 899/900px transitions, dark/light UI, safe-area and 52px App Header exceptions, and 10k/100k frame/range/abort metrics independently from unit tests.
