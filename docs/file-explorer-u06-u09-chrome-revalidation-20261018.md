# U06/U09 · current-master real Chromium revalidation (2026-10-18)

## Progress and frozen baseline
- F02/F03/F04 and P59-P62 are merged. U02 real compiled-browser acceptance PR #2032 passed all 76 exact-head CI jobs (25 success, 51 conditional skips) and merged as master commit `3c0138caec964d4edf8c73afb8afc031a4203749`; the trusted closed-PR cleanup confirmed its old branch absent.
- Freeze `master@53f196e0a625d7bdb94babbbca565335267db728` for ONE scoped test-only commit. No source logic, Server ACL, virtualizer, thumbnail, view renderer, navigation model, 52px App Frame or 900px breakpoint changes. Unrelated Gallery/Admin/Race/performance branches untouched.

## Test scope (authoritative distinction)
- Existing `web` CI opt-in branch `test/files-search-return-chromium-u06-u09-sort-group-20261018` matches its native Chrome/Playwright setup and the existing **U06 real Chromium Search→containing folder→Back/Forward** command with `--case=all`.
- Original browser script bundles current production shared FileExplorer/Workspace/Search MUI source via esbuild and opens actual Chromium, with *controlled local fake Search/Directory range responses*. It is neither a live authenticated Go/PostgreSQL test nor a physical iOS/Android/Windows test.
- The specific `u06-u09-sort-group-` branch prefix additionally activates **U09-C** 100k logical sparse Details viewport: deep-row identity, changed Server-authored sort and group ordering, no stale selected-ID reuse, <=200 bounded range pages, fixed one scroll host, and correct full group-inclusive ARIA rowcount.
- Existing `return`/recovery cases validate query/filter/order/scroll/selected ID restoration, failed range Retry, stale user-intent fencing, and Forward directory state. Do not infer real 100k DB query latency, 100k transfer throughput, native screen reader or 1:1 iOS 27 UI fidelity.

## Source guard and release gate
- Added one minimal Desktop Node source guard that binds **both** Chromium setup and test runner to the existing opt-in branch prefix and asserts the U09-C conditional, actual 100k fixture and U06 return scopes. No weakening or replacement of old tests.
- Require entirely NEW accurate-head full 76-job CI including Web Chrome artifacts, Desktop/Windows, real Go PostgreSQL API Race, Rootless and Final Gate, plus GitHub clean mergeability before Ready/Rebase. Never merge on older CI or conflate 51 conditional skips with 51 passes.
- Real iOS Safari, Android Installed, OS Back/keyboard/gesture, original 1–4 GiB OS download SHA256, VoiceOver/TalkBack/NVDA physical testing and seven-platform S5 matrix remain NOT RUN / release NO-GO.
