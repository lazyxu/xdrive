# P059 — 100k physical CAS Copy SQL profile: original machine evidence

## Valid ORIGINAL source-exact n3 (2026-10-19)

Measured HEAD `6019f5eff26eb80a37d3012744f58ab2ba9a0d84`; genuine [P059 PostgreSQL17/Gin/LocalCAS n3 CI #39143149021](https://github.com/lazyxu/xdrive/actions/runs/39143149021) **SUCCESS**, and [full 77-job CI #39143148917](https://github.com/lazyxu/xdrive/actions/runs/39143148917) **SUCCESS** (25 success, 52 conditional skips, zero failures, real PostgreSQL API Race, Windows/Linux, Web/Desktop, Rootless, Final Gate). 1k actual physical smoke passed separately, excluded from n3. Three independent original sources each seeded 100000 physically written distinct SHA-256 1KiB CAS files plus one separate protected sentinel, then authenticated Owner HTTP enqueue, actual durable Copy Worker, Undo/Trash, authorized permanent purge, complete original SHA/RefCount and no new physical inode checks. No production Go/SQL/API, GUI, Race or durable task cancellation was changed. Frozen 900s Copy/Undo/Purge, 512MiB RSS/Go-write gates all passed.

| Original measured field | sample-1 | sample-2 | sample-3 | P50 |
| --- | ---: | ---: | ---: | ---: |
| Copy Worker with test SQL Trace ms | 353520.787 | 355982.088 | 353529.817 | **353529.817** |
| SQL statements (GORM Trace) | 500016 | 500016 | 500016 | 500016 |
| Sum client-side SQL Trace ms | 344934.697 | 347456.429 | 344999.793 | **344999.793** |
| `update_operation` SQL count | 100006 | 100006 | 100006 | 100006 |
| `update_operation` SQL Trace ms | 232662.666 | 235526.938 | 233216.472 | **233216.472** |
| Undo Worker ms | 1628.870 | 1580.049 | 1600.931 | **1600.931** |
| Authorized Trash purge ms | 9105.236 | 8700.665 | 10235.522 | **9105.236** |
| Postseed Go sampled max RSS delta B | 126054400 | 118128640 | 117145600 | **118128640** |
| Go process measured kernel writes B | 0 | 0 | 0 | 0 |
| Physical allocated CAS bytes before/after Copy, Undo and purge | 409604096 | 409604096 | 409604096 | 409604096 |

Category `update_operation` accounts for about **66.0%** of the *profiled worker* duration, and client-side trace wall sum is about **97.6%** of worker wall. These are GORM/driver-observed statement spans, NOT isolated PostgreSQL CPU/locks or fully exclusive per-phase timings. SQL Trace adds overhead. Older P056 unprofiled P50 **277677.598ms** was from different CI and is **not a matched BEFORE**; do NOT claim a 27% product regression or numerical speedup. All frozen product gates pass; production remains unchanged; AFTER/speedup=N/A. High-frequency progress writes are a valid hypothesis for a future controlled same-runner unprofiled n>=3 optimization, not yet an accepted fix.

## Original machine provenance

The original [Actions artifact #12142778593](https://github.com/lazyxu/xdrive/actions/runs/39143149021/artifacts/12142778593) contains original `sample-1/2/3.json`, `sample-1/2/3.log`, `sample-1/2/3-resources.txt`, `summary.json` and `source.txt`; entire ZIP SHA256 **`372becca28869cbbadd2bbb491fe15922778da581cdeb50a7fb67c122dde720c`** (verified against downloaded bytes). Original artifacts expire under provider retention, so the three Go machine-record payloads and runner summary are permanently represented by the committed `ci-run-39143149021/sample-{1,2,3}.json` and `summary.json`. The committed JSON is **field-value-exactly reserialized** from the original source-exact Go stdout, NOT claimed byte-identical to the Python-indented ZIP members. Full original logs/resources remain linked in the Actions artifact, not falsely claimed committed.

Original ZIP member SHA256 (original bytes, not the reserialized committed blob):
- `sample-1.json`: `e4b6c13296e1561619c688a1cb440140936e479b8a2cc9016db81501be6eea65`
- `sample-2.json`: `d9cc1ef1cad0ee2bfffd42c2307c852f669cc30db248e3e4cbfc9e725af1d72e`
- `sample-3.json`: `07a112fa39132cc20df23d0d5bd4bfc3e3c73f62765cc4076b30732925cbddfa`
- `summary.json`: `ca8fd97a3c7b9c0483561c429cdbec3ecfdc74aa8090791fd1474165ba15615b`
- `source.txt`: `581676461bb447b81f4775bcd97f171b2e1d8989a4d3d24f80a3c31b11337d73`

The first source-exact [P059 CI #39142952339](https://github.com/lazyxu/xdrive/actions/runs/39142952339) failed an invalid gofmt preflight **before** any genuine 100k data; source n=0 and not a product regression. The updated first valid measured source is `6019f5eff26eb80a37d3012744f58ab2ba9a0d84`. Archiving this evidence changes PR HEAD: a **NEW source-exact dedicated 3×100k** and full 77-job CI/Final Gate plus current GitHub clean mergeability are mandatory before Ready/Rebase.

**Six actual client GUI/installed PWA platform cells for this exact operation remain Not measured**: this is Linux Go Server+PostgreSQL only. Never confuse this with true Web/Desktop virtual scroll, Live Photo motion, 4GiB WAN transfers or view-triggered cancellation of durable Copy tasks.
