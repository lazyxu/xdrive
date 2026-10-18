# U02 · Current-master 899↔900px compiled Chromium acceptance

Date: 2026-10-18. Frozen source: `master@54297b5b27e2489a617a4b461197db568bfc3e18`.

## Before this test

- The shared Web/Mobile selection identity, owner-scoped Workspace and mounted breakpoint tests are already on master. The existing CI green runs do **not** prove that today's latest built Web still passes all real Chrome breakpoint transitions.
- Related P62 Files/Gallery loading PR #2028 is independently open and changes the navigation presentation plus browser fixture. Do not modify or stack over that in-flight work; this branch has zero production changes.

## Scope and real test entry

- This test-only branch name `test/mobile-files-ios27-real-chrome-u02-rename-20261018` intentionally matches the existing `test/mobile-files-ios27-real-chrome-` CI opt-in prefix. The current `.github/workflows/ci.yml` `web` job prepares native Chrome/Playwright and executes the already existing `Verify real Chrome Files 375/390/899/900px shared API parity` script on the compiled production Web build.
- The more specific `test/mobile-files-ios27-real-chrome-u02-` and `test/mobile-files-ios27-real-chrome-u02-rename-` gates in `desktop/scripts/mobile-web-app-browser.cjs` execute **both** actual DOM acceptance methods: `filesU02BreakpointSelectedNodeAcceptance` and `filesU02BreakpointRenameDraftAcceptance`.
- Compare 899→900→899 selected Node identities (Mobile `aria-pressed` versus wide `aria-selected`) and an unsent in-place rename dialog/draft. Verify no unexpected rename API writes while crossing the 900px breakpoint and real UI focus/selection remains consistent.
- This uses original built Web/actual headless Chromium with bounded *Server-shaped fixture interception*, not a true deployed Gin/PostgreSQL Server, physical iOS Safari/Android, software keyboard, VoiceOver, or a physical 100k workload. Keep those evidence levels separate.

## Gate and follow-up

- Require this PR's own exact-HEAD complete 76-job CI, Web real Chrome artifacts plus Go API Race/Windows/Desktop/Rootless/single-commit/Final Gate and clean current GitHub mergeability. CI 51 conditional skips do not imply physical PASS.
- If a real browser regression fails, preserve the failing fixture and make the smallest production fix in a separately scoped single-work-commit reconstruction, then restart full accurate-head CI. No route/nav redesign, 52px title bar, 900px breakpoint, Server authority or PWA SW change.
- On success, treat U02 as **non-device built Chromium validation at this exact SHA**, not full hardware approval. Real keyboard/safe-area/breakpoint/OS Installed matrix remains NOT RUN and physical release remains NO-GO.
