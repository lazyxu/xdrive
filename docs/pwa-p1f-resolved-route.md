# PWA P1F · Already-resolved Files/Gallery synchronous route candidate

Baseline: `1fdc58c7c4d99fc634f73199fdead9f57861b3ef` (full master). Related diagnostic P1E #2429/#2430.
Do not merge based on the T-S-S-T test-only observation alone.

## Change

- First visit to a lazy Files or Gallery workspace still uses `startTransition` to preserve the prior authorized view while downloading code. Two existing cold transitions remain intact.
- Only after the original workspace Suspense has **actually committed** Files/Gallery does an explicit mounted marker grant the route's same-hook-instance direct `setRoute` path.
- Browser Back/Forward and programmatic launch honor the same readiness evidence; no cross-account/global persistence. Viewer/admin/other cold programs remain on the original transition.
- Auth, Owner API, Server Go cancellation and VirtualGrid are untouched; public SW and private cache policy unchanged.

## Exact acceptance

Require the new source-exact single work commit and full CI. P1F runs the **unchanged original** native Electron + real Go/Gin/PG17/CAS Owner 100k logical /115k metadata performance fixture with one identical baseline Go binary, before/after on the same Runner A-B-B-A (n=3 per batch). Every sample must pass original <=160ms Go cancellation, zero post-cancel bytes, and memory caps. The balanced cancellation delta must improve at least 10ms; otherwise this candidate is not merged.

Also run real 390px Files/Gallery navigation (3 independent Chromium sessions, 9 transitions each direction), Viewer return, existing cold lazy route contract and guarded browser-history tests. The 390px browser is **not** a physical iOS Home Screen verification; first-visible full 100k mixed originals and OS lifecycle remain open.

No permission to delete historic hashed assets, cache Owner pixels, force a Service Worker or skip code-level security CI. Inaccessible production-only safety acceptance: 按用户决定跳过（未验收）.
