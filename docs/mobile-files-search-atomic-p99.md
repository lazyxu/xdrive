# P99 · Mobile Files global Search from Browse Home, Recent and Favorites

## Source-confirmed pre-commit visual defect

The original Mobile Web Files `launchGlobalSearch` eagerly switched to Browse, removed Home/Recent/Favorites, reset scrolling and persisted a Browse rail **before** the existing Web FileExplorer's Owner-search returned its authenticated first counted Range. For Browse Home this briefly revealed the old root; for independent Recent/Favorites rails it unmounted still-accepted rows and could misplace the return anchor. The unverified Search summary also inserted a new 44px in-flow row, shifting the Home during weak-network requests. The issue is not media network thumbnail or real transfer progress.

## Narrow repair

For Home/Recent/Favorites only, record a scoped current intent and dispatch the unchanged Server Search immediately without switching visible section. Keep Home/rail content and single scroll host mounted, hide the transient query summary until the actual Web Owner's `searchReady`-derived `searchSummary.resultCount` is a finite safe integer (including true zero), not loading and not errored. That is already based on the original accepted first Search Range; only then commit the visible Browse/Search and top reset in one pre-paint `useLayoutEffect`. Terminal Search error remains visible on the current origin with retry. A newer rail/folder cancels the shared Search via `onClearSearch` and invalidates its ticket, even before searchActive is published. Preserve Recent/Favorites scroll, including after Search Clear. Leave ordinary already-open-folder Search and Wide Web/Desktop transports unchanged to avoid overlap with independent Search Controller/Perf/Race projects.

## Regression / release evidence

Expand the actual original `desktop/tests/mobile-files-ios-runtime.cjs` tests instead of building a substitute model; assert held >365ms, failed/retry, old Home/Recent/Favorites retained, no 44px pending summary, current accepted zero, one DOM scroll host, and newer rail cancels stale Search before commit. Preserve original M07 and P78/P95 regression. Exact new-head full 77+ CI with PostgreSQL API Go Race, Windows/Linux Web/Desktop, Rootless/packages and Final Gate is mandatory. Built 375/390/899px, physical iOS/Android/PWA/WAN, and 100k CLS/FPS are NOT RUN in this source-only scope; do not claim device-wide universal elimination of jitter.

## First current-head CI and obsolete source assertions (2026-10-19)

Original P99 HEAD `a743ea5011767ef98ca6a1eaa42b4b0c62d97bf3` ran full [CI #39255400739](https://github.com/lazyxu/xdrive/actions/runs/39255400739). Its original mounted P99 tests and Web build passed, but Desktop suite found two obsolete string-only assumptions: the Home status was previously only organization-busy, and Search summary was mounted unconditionally on pending Search. These conflict with the safer current accepted-first-Range quiet semantic busy and absent transitional 44px Search summary. Update only the two ORIGINAL source oracles to demand these stronger contracts; retain actual production/React-mounted source bytes and failure evidence, and rerun an entirely NEW exact-head full CI before readiness.
