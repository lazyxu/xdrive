# Android Gallery Viewer: native TalkBack image zoom (2026-10-28)

The native Gallery image Viewer already has double-tap/pinch zoom and a
real signed Owner swipe-neighbor reader. Its TalkBack custom actions,
however, expose previous/next media only. A switch-control/screen-reader
user cannot invoke equivalent zoom/reset gestures.

This separate source module adds TalkBack **放大图片**, **缩小图片**,
**恢复图片大小**, plus a truthful current zoom state description on the
actual image-gesture semantics element. Zoom bounds remain 1x..5x;
all actions are local presentation state, use no new Owner GET, do not
persist media bytes, never change file revision or start uploads. Pan resets
on these semantic zoom jumps to avoid leaving the image inaccessible offscreen.
When no image is ready, the image-zoom actions must not appear; existing
Owner-only previous/next actions remain unchanged.

The change is intentionally isolated from #2957 Share, #2965 transfer,
#2979 camera throttle, #2985 signed viewport and #2993 BD09 drilldown.
A deterministic pure Kotlin contract test and an Android Compose semantics
test verify the action names, bounds, state descriptions, and unmodified
navigation affordances. Android Native exact HEAD CI must pass before merge.

The 32 MiB original image cap, tile decoding limitation, iOS pixel parity,
large fonts and installed OEM TalkBack are separately **跳过（未验收）**.
