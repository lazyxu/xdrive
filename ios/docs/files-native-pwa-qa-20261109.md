# iOS Files Native / Web-PWA parity — one-PR acceptance

Scope: P0 first-open/child stability, frame continuity, Viewer video; P1 #4202
feature parity, Home information architecture, 100k rows; P2 visual alignment.

This document is an **acceptance checklist, not evidence of completion**.
Neither signed real-iPhone tests nor populated-cloud 100k/video FPS are available
inside the GitHub connector. Never treat source assertions, synthetic Owner
screens or a successful unsigned-IPA build as a device acceptance pass.

## Required branch gate (exact head)

- Check that the PR commit has the full iOS unsigned IPA build, both mandatory
  candidate real Simulator matrices, desktop source-contract tests, Swift
  policy checks, whole CI and Final Gate **completed successfully**.
- Archived success on #4202, #4205 or an earlier SHA does not satisfy this gate.
- Keep unsigned IPA classified as unsigned: installing it on an iPhone also
  requires valid device-specific code signing.

## P0 — functional journeys, crash and frame continuity

Use a signed IPA on a physical iPhone with an authorized Owner, a populated
cloud directory and a local PhotoKit library. Retain the OS version,
iPhone model, exact commit, account/Server test fixture identifier (not
credentials), cold/warm cache, network type and captured .ips logs.

1. Open Files repeatedly from Gallery/My, cold launch and after app restart:
   no process exit, empty white/black content, unexpected pop or old Owner data.
2. Open Cloud > nested folders (at least 5 levels) > file Viewer > Back;
   compare both file ID and scroll offset. Repeat from Recent and Favorites.
3. Repeat Recent > Browse > Favorites > Gallery at least 30 times; inspect
   captured video frame by frame around every route transition. No transient
   full blank shell or unrelated prior-Owner projection is acceptable.
4. Gallery local photos > Files > Gallery, album, People, filters, map,
   Viewer return, background/foreground and rotation. Verify returned PhotoKit
   page belongs to the current permission/revision; no stale thumbnails.
5. Remove authorization mid-request, invalidate a session, change Owner,
   toggle airplane mode and retry. The UI must fail closed with a visible
   recovery route, never a crash, destructive toolbar or success-looking
   empty list.
6. Inspect actual signed-device .ips for every crash; an XCUITest AX
   snapshot timeout alone is **not** a process crash.

The CI Simulator records route-scoped screenshot samples plus
`navigation-latency.json`. These frames are **samples** and do not prove
absence of sub-frame flicker; full signed-device screen recordings and
frame-by-frame review remain mandatory.

## P0 — video first-frame and Viewer controls

- Use real MP4 and MOV (small and large), cold and warm loads, on Wi-Fi and
  throttled/unstable connections. Repeat 10+ times per combination.
- Compare same fixture with the preceding published IPA, not a differently
  cached or differently signed build. Record median, p95 and max.
- True displayed-first-frame is emitted as
  `IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=N` when
  `AVPlayerLayer.isReadyForDisplay` becomes true for the current player.
  Signed ticket or `readyToPlay` alone does not qualify.
- Seek, pause/resume, tap to hide controls, next/previous across an initial
  256-item Viewer window boundary, close and reopen, and rotate while
  buffering. Controls must remain usable and old player callbacks must not
  affect a new file.
- `video_first_displayed_frame.samples == 0` explicitly means **not
  measured**, not fast or passed. Synthetic-Owner CI normally has zero samples.
- Collect startup time and stalls together: reducing initial wait must not
  make playback unusable on weak networks.

## P1 — Native/PWA parity and 100,000 files

- Native Home should expose Location, Favorites/pinned and Organization with
  no redundant large Sections; edit Home directly, navigate verified
  ancestors, show Batch Properties and Undo/Redo on their appropriate surfaces.
- Use an authenticated Server fixture with **100,000 real Nodes in one folder**.
  Scroll top -> middle -> bottom, change sorting/grouping, toggle grid/list,
  jump to 1 / 50,000 / 99,999 / 100,000, open Viewer and return. Confirm exact
  Node and rank from Server each time; no stale wrong-folder selection.
- Measure scroll frame time, memory high-water and navigation p50/p95 on
  the device; do not infer 60/120 FPS from bounded Swift policy tests.
- `IOS_NATIVE_FILES_100K_POLICY_MS` is an algorithm-only stress test on
  100k logical indices. `IOS_NATIVE_FILES_JUMP_VERIFIED_MS` is elapsed time
  to an authorized scroll **command**, not visible frame paint.
- A current directory remains bounded to 64-node Server ranges and at most
  256 retained Node rows; the test must not weaken Owner/revision checks.

## P2 — visual/device polish

Check light/dark mode, Dynamic Type at large/accessibility sizes, iPhone SE
and Pro Max widths, landscape, long Unicode/RTL names, folder/file glyphs,
thumbnail placeholders, row heights, touch targets, disabled actions, toolbar
safe areas, VoiceOver and transition animations. Compare PWA and Native
screenshots for visual hierarchy, not pixel-identical WebView rendering.

## Release rule

Do not mark these P0/P1/P2 requirements fully complete, close the master
integration PR or merge the candidate until exact-HEAD CI/Final Gate pass.
Physical signed iPhone tests, real video first-frame p95 and a loaded 100k
directory are separate mandatory acceptance evidence.
