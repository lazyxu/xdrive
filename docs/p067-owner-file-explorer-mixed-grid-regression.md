## P067 · Verified real 100k/115k mixed physical Owner Grid after SH-P013 (2026-10-20)

New accurate source `5ad9914d7248317b6d436a67bcaad265724d7211` has **real 100k physical n3 ALL GREEN**:

| Client | Grid first required decoder P50 | Details first required decoder P50 | Verified run |
|---|---:|---:|---|
| Native Desktop Electron+Agent | 598.202ms | 478.690ms | [P038 #39441398961](https://github.com/lazyxu/xdrive/actions/runs/39441398961) |
| Wide Web Chromium1440 | 657.146ms | 475.939ms | [P050 #39441399426](https://github.com/lazyxu/xdrive/actions/runs/39441399426) |
| Mobile Web CDP390 | 362.438ms | 312.795ms | [P049 #39441398444](https://github.com/lazyxu/xdrive/actions/runs/39441398444) |

Each has n3 genuine independent PG17/CAS corpora, 100k logical, 115k different-SHA physical media, paired Live groups and H264 poster, Grid/Details five visible windows per sample (90 total). All frozen correctness, decoding, Go requests, resource, DOM and cancellation-error budgets PASS; original machine-result summaries retained without rounding under `performance-evidence/p067-owner-mixed-100k/`. Full same-source [CI #39441397196](https://github.com/lazyxu/xdrive/actions/runs/39441397196) SUCCESS including Final Gate. **No production optimization**: existing source healthy/current, AFTER and speedup N/A (not same-runner matched A/B). Earlier RED test fixtures are invalid n=0 (missing quota-hold table), fixed by test-only AutoMigrate. Evidence update changes SHA and obliges a NEW 100k×3 + full 77-job exact-head CI and GitHub mergeability. No one should mark Ready/Merge until finished. No Race work.

## P067 source-exact first-round invalid fixture, not a product performance RED (2026-10-20)

- Initial ONE-work HEAD `f0f8b72ab872f1cbfbffdd4b8386b5b91cba0fc9` started true P038 Native Desktop [#39440163376](https://github.com/lazyxu/xdrive/actions/runs/39440163376), P050 Wide Web [#39440162892](https://github.com/lazyxu/xdrive/actions/runs/39440162892), and P049 Mobile Web [#39440163370](https://github.com/lazyxu/xdrive/actions/runs/39440163370), all **FAILED before any 100k physical mixed media seed or rendering measurement**: independent actual PostgreSQL17 logs show `relation "xd_local_push_quota_holds" does not exist` on the now-production `/me/quota` owner usage query. The shared *test-only* `TestGalleryRealWebColdFixture100K` migrates old FileExplorer bootstrap tables, omitting `meta.LocalPushQuotaHold`. The production SQL, Owner auth, CAS, Grid and Client path are not proven slow or faulty by these errors. Valid 100k n=0 for all three; AFTER/speedup=N/A, **not an optimization result**.
- Fix ONLY shared opt-in test fixture AutoMigrate with `&meta.LocalPushQuotaHold{}` (consistent with already-accepted P054's equivalent required test migration), and strengthen the P067 Node source assertion to ensure all three clients cannot regress to a missing quota schema. Do NOT disable /me/quota, change production quotas, ignore 500s, or change the frozen physical n3/visible-pixel/CPU/RSS/HTTP budgets. No Race code touched.
- The initial full [CI #39440165435](https://github.com/lazyxu/xdrive/actions/runs/39440165435) belongs to the superseded old SHA regardless of result; updated ONE-work HEAD must start entirely NEW all-three true physical n3 and complete 77+ CI/Final Gate before Ready/Merge, and retain this first RED log permanently.

# P067 — Owner FileExplorer 100k/115k mixed-media regression after SH-P013

Status: NEW original CURRENT test-only; product AFTER/speedup=N/A until source-exact measurements. Owner/Public Grid Tile sharing merged in #2243; sharing JPEG 100k tests do not test the Owner FileExplorer mixed JPEG/H264/Live view.

## Existing accepted physical baselines (different runners, NOT paired A/B)
| Real mounted workload | Grid P50 | Details P50 |
| --- | ---: | ---: |
| P038 Native Desktop Agent 100k PhotoAssets / 115k distinct SHA physical CAS | 943.144 ms | 734.891 ms |
| P050 Wide Web Chromium 1440px same shape | 663.716 ms | 485.783 ms |
| P049 CDP390 Mobile Web same shape | 466.461 ms | 310.520 ms |

Each independently verified sample has 70k JPEG, 15k H264 MP4 and 15k paired Live still/motion; 0%, 25%, 50%, 75%, 95% actual visible Grid/Details viewports, per-client n=3. MP4/MOV share an H264 encoded stream with source-distinct metadata; not independently encoded videos or real Live Motion playback.

## Frozen gates and minimal changes
Only add this branch to the strict opt-in predicates of the already accepted P038 Desktop Electron→Main→Go Agent, P049 390px Mobile Web and P050 1440px Web real-PG17/LocalCAS workflows. Do not change their fixtures, scripts, correctness gates, viewport budgets, Node/CAS metadata, source, or product. Each executes n3 × Grid/Details × five positions with physical SHA, actual pixels, signed authenticated ranges, Go request concurrency <=6, DOM and memory/CPU, and 0 non-cancelled 5xx as already frozen. Three exact HEAD specialized CI runs and entire 77+ main CI/Final Gate must pass.

AGENTS.md already mandates measure original CURRENT -> optimize ONLY when genuinely above a documented budget -> matched same-runner/data n>=3 BEFORE/AFTER -> preserve only material repeatable improvements with no CPU/RSS/I/O/bytes/integrity regression, otherwise revert and archive invalid/rejected evidence. No redundant AGENTS edit. Since only the pure Grid JSX changed and old/current benchmarks already met their budgets, no speculative production optimization.

Separate existing 4GiB high-entropy real Web P044 upload/download P50 48.509/18.417s and Native Desktop Agent P045 55.087/21.969s already qualified unchanged upload/transport paths. No need to repeat unchanged expensive loads. 100k Node Change Feed 5.308s and 100k physical Delete/Undo 1.610/1.459s also accepted, independent. The real 100k physical Copy Worker original ~512s and PR #2136 are separately blocked by 638–642s original HTTP enqueue tail, Issue #2153; this PR does not touch it.

Temporary viewport/frame/thumbnail requests must trigger AbortSignal (Desktop Main/Agent cancellation as applicable) -> real Go Request.Context.Done on viewport eviction/route/window teardown. This does NOT cancel durable user-owned upload/download/sync/delete/ZIP jobs automatically. Existing P037/P040/P048/P052/P053/P054 cancellation measurements belong to distinct workloads; do not claim P067 tested them.

Record each source-exact CI ID, raw per-sample JSON, p50/p95/slowest, CPU/RSS/HTTP/decoding/permissions and platform coverage after completion; evidence-amended SHA must itself rerun all specialty n3 and full CI before Ready/Merge. If any true budget RED, keep RED, diagnose before changing product and create a separately measured minimal optimization. Native iOS/Android/installed PWA, WAN, HEVC/RAW/LIVP complete decode and true Live motion are Not measured.

Share Folder via right-click, public read-only FileExplorer, root ZIP and neutral Grid all merged; true share media thumbnails, Video Poster/Live still, full Details/Row, subtree search/sort and nested ZIP remain independently tracked at #2205 and never borrow Owner JWT/private APIs.
