# xDrive PWA P1 — current-source 100k mixed Gallery and H264 poster baseline

Date: 2026-10-24. Tracking #2260. This scope is narrower than the eventual
Viewer H264/Live Motion request. No product code or Service Worker behavior
is changed. Both existing performance workloads run on the exact same PR SHA,
using their unmodified genuine GitHub Actions / Linux Electron Chromium,
real Go/Gin, PostgreSQL17 and LocalCAS paths.

1. Gallery Mobile Web mixed 100k logical / 115k physical:
   three independent synthetic fixtures, five actual 390px VirtualGrid
   viewports each, four fresh visible JPEG decodes per view plus native
   Go/Renderer RSS. The existing hard budgets and negative controls remain.
2. Gallery Mobile Web 100k H264 posters:
   three independent real CAS fixtures, five 390px video-poster viewports,
   signed video preview, Chromium H264 capture, persisted real JPEG poster,
   warm re-read, and the original native bounded resource checks.

The new branch is added ONLY to the two existing opt-in workflow guards; all
historic branch triggers and every production script/Go/API are unchanged.
Require each specialty to finish SUCCESS on the new exact HEAD, along with
Web/Desktop/Linux/Windows/API Race and Final Gate, before counting as
accepted CURRENT measurements. Archive original source-exact numerical
summaries; do not copy prior results or invent percentile values.

This is NOT paired BEFORE/AFTER and cannot prove an optimization. The former
2026-10-21 P0C1 figures came from a different SHA/runner/time and cannot be
subtracted from this run. The previous P4F JPEG test is independently valid
only for its frozen same-runner comparison.

**Uncovered P1 after this baseline**: real authenticated SPA 100k
Gallery→Viewer→Back end-to-end, decoded original/video first presentation,
press-to-play Live Photo motion, restored virtual anchor and Owner HTTP
Context.Done cancellation, then genuine A/B against a specific optimization.
Static H264-derived thumbnail/poster does not prove video/Live playback.
Actual iOS27 Safari/Home Screen, Android Installed or Desktop Installed:
NOT RUN. Inaccessible production-only security acceptance:
按用户决定跳过（未验收）; code Owner/ACL/Abort/privacy checks remain mandatory.
