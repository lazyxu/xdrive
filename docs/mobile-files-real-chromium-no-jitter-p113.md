# P113 · Real built-Chromium Mobile Files folder navigation acceptance

Date: 2026-10-20. Purpose: execute the **existing original** built Web iOS Files native Chromium acceptance suite after accepted P109/P110/P111 source repairs. This is an evidence-only PR: no production UI code or Server endpoint changes.

## Existing original acceptance (not invented geometry)

The original opt-in `.github/workflows/ci.yml` condition for `fix/files-quiet-navigation-*` starts real Chromium and runs `desktop/scripts/mobile-web-app-browser.cjs --scenario=files-ios27-chrome` with `XDRIVE_MOBILE_FILES_P17=P18=P19=1`.

- **P17**: capture actual original DOM/mounted scroll host and rAF frame geometry while a target directory's authenticated first counted Range remains deliberately held; old authenticated folder and anchor must remain, without a temporary caption or blank screen.
- **P18**: activate a visible folder with a real browser pointer/touch callback, not only by changing route; assert every held-request frame retains the old committed folder, then one atomic destination.
- **P19**: race two independent folder navigations from one original sparse directory. A newer accepted folder must win while the older is still held, then the late result must not reset header, scroll, URL or visible rows.
- Under `files-ios27-chrome`, also verify mobile/wide breakpoint parity at 375/390/899/900px, 52px App Frame and page/virtual-scroll-owner geometry, and preserve real network thumbnail and transfer feedback.

## Merge gate

CI must run from the exact test-only branch HEAD, complete original desktop/source tests, Web/Desktop/Go PostgreSQL Race/Linux/Windows, Rootless/artifacts and Final Gate, and the specific original **real Chromium** stage P17+P18+P19. Review machine-readable `files-ios27-browser-parity` artifacts and frames for recorded first failure; do not weaken an assertion or claim a fake sample passed. No physical iOS Safari, Android/PWA/WAN or production 100k FPS/CLS claim: **NOT RUN**. When actual Chrome CI runs, cite its ID and honest measurements in PR before marking complete.
