# P95 · Mobile Web typed-path atomic navigation (2026-10-19)

## Confirmed residual source defect

The real `web/src/MobileFiles.tsx` still called `beginBrowse(directoryID)` immediately when submitting a typed path **from Browse Home** if the old cloud root was already loaded behind Home. This is a visual navigation commit on intent: it briefly revealed the *old root* and zeroed scroll before the shared workspace's asynchronous path lookup and authorized destination-first Range. Failed or held paths still displayed an unrelated folder. Existing P3 guarded only typed paths from Recent or an already open folder, and older `F-PARITY-05` mounted tests positively expected the wrong eager frame.

## Correction

The original Mobile Files component now creates a current navigation-intent ticket for *every* typed-path submission, including Browse Home. Do not call `beginBrowse` when the path is submitted. The existing pre-paint commit effect retains Home/Recent/Favorites and the one virtual scroll host until either a **different authenticated directory crumb** has committed or the same directory has returned an **explicit authenticated current-intent navigation receipt** (the interactionKey remains stable), with the same generation still current and no pending read. Earlier promise acknowledgement, old same-ID Range, failed lookup and newer rail/navigation intent cannot authorize an intermediate Browse frame. Existing shared Web `submitPath`, backend/path resolution, cursor/100k virtual list, thumbnail/Live Photo and transfer progress are unchanged.

## Regression / honesty

Extend the **original mounted React** `desktop/tests/mobile-files-ios-runtime.cjs` to hold >365ms, retain home/scroll on failed or slow lookup, accept new directory exactly once, exercise same-folder renewed range and invalidation by a newer rail intent. Update the outdated original F-PARITY-05 oracle demanding eager Browse. No fake source-only simulation of the UI is substituted. Exact-head full 77+ CI and genuine browser 375/390/899px, physical iOS Safari/Android/PWA, weak WAN/100k CLS/FPS remain separate gates; these device/browser metrics are **NOT RUN** here. Do not claim whole-project zero-jitter until real physical acceptance.

**Accuracy correction:** The shared FileExplorer interactionKey is stable per workspace/directory/sort/grouping, not per request. Original shared navigation emits an optional Boolean first-page success receipt to WorkspaceController.submitPath, which returns true/false through the real Web adapter to Mobile. Rejected/aborted paths clear their pending ticket, and only a true current-intent receipt authorizes same-folder navigation. All non-typed-path clients of navigateTo retain their existing Promise<void> behavior.

## Exact-head mounted test correction

CI #39240125749 found a genuine same-directory commit defect: acceptedPathIntent changed after a verified shared navigation receipt, but the MobileFiles layout effect omitted this dependency and could leave Browse Home visible. Add this dependency, preserving the original mounted failure regression. Two source-only assertions were overbroad: previousRangeKey remains correct for ordinary row navigation and the shared typed-path navigateTo now has a required fourth accepted callback. Scope the tests to the path-specific original code and its real current receipt. Require new full exact-head CI; no iOS/Android/PWA/WAN/physical 100k CLS/FPS was run.
