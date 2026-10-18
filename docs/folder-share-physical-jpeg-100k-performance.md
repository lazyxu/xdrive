# SH-P004 — 100k distinct original JPEG CAS shared-folder performance

## First real original n3 (source HEAD 9737639f, 2026-10-18)

[Exact original-source CI #39126802572](https://github.com/lazyxu/xdrive/actions/runs/39126802572) ran 1k smoke and then **3 independent true physical 100000 JPEG** sources. Each benchmark Go subprocess emitted source-exact success and met all frozen gates. Authenticated PostgreSQL17/Gin/LocalCAS actual 1000 public pages plus first/middle/last signed JPEG original GETs passed end-to-end: full walk **3245.464 / 3224.434 / 3090.569ms** (P50 3224.434ms); P95 page **3.814 / 3.876 / 3.705ms**, slowest page 6.554ms; slowest signed ticket 5.634ms, actual original stream 3.560ms, Go RSS growth max 622592 bytes; outside authorization and post-revoke signed access denied, 100001 actual CAS disk objects and exact original SHA. Seed excluded. No production tuning, AFTER/speedup N/A. The **entire workflow is still failed** because the post-measurement Python report key was wrong. It erroneously requested `original_source_bytes` when authentic Go JSON uses `physical_source_bytes`. This is an invalid **wrapper** after valid original n3, not a measured product regression. Retain old run as evidence but require corrected exact-HEAD genuine rerun + full CI/FinalGate and current GitHub clean mergeability before merging. Raw source and fixture limits: [immutable evidence records](performance-evidence/sh-p004-physical-public-jpeg-100k/README.md).

Status at freeze, 2026-10-18: **Original CURRENT not measured; valid n=0; AFTER=N/A, speedup=N/A.** No production code optimization. Read [central registry](performance-test-registry.md), [six-mode matrix](performance-platform-coverage.md), and [permanent evidence log](performance-evidence/sh-p004-physical-public-jpeg-100k/README.md) first.

## Existing successful workloads are NOT this workload

- SH-P001: true PostgreSQL17 100k folder metadata, 1,000 pages, original P50 16,699ms, physically stored original CAS count 0.
- SH-P002: separate mounted React first-request cancellation and genuine Go/PostgreSQL SQL cancellation; not integrated physical original loads.
- SH-P003: merged #2070; actual 1440px and 390px Chromium real-browser→Gin/PG 100k metadata navigation/HTTP cancel, n3 per viewport, original passed. Physical image/video originals 0. Reusing that test would not close this gap.
- P053/P054: physical 100k original JPEG viewport cancellation, but not public-share signed original file downloads; P057: real physical 100k CAS delete/undo worker, different API.

## Novel real HTTP test and budgets frozen BEFORE n3

Identity: SH-P004 Linux original owner-authenticated production Gin/PostgreSQL17/LocalCAS physical 100k shared JPEG. Exactly three independent PostgreSQL schemas and local fsync'd CAS fixtures; each holds 100000 different SHA256, individually encoded and decodable 80x64 JPEG original files PLUS one physically stored but unshared sibling original. Each original is stored by the actual immutable LocalCAS.Put and bound to distinct real File/Node/ContentBlob metadata (RefCount=1), never one JPEG aliased into 100k names.

All HTTP uses a real loopback TCP server running the production router. Owner creates a read-only Folder Share; another Owner cannot create it. Public bearer reads 1000 keyset pages of 100 real File rows, including File.Size with no stale/duplicate nodes. Authorize signed original-byte GET for first, middle and final physical JPEG: compare complete source SHA, response SHA and JPEG decode. Verify unshared outside sibling cannot acquire a public ticket and an already signed URL returns HTTP410 after revocation. Never log bearer/signed URLs.

| Contract (n=3 fresh exact-source fixture, smoke not counted) | Frozen requirement |
| --- | --- |
| Physical provenance | 100000 unique valid JPEG originals plus outside sentinel, original CAS file count and allocated bytes, full source aggregate SHA, actual SQL File records |
| Complete bounded public enumeration | Exactly 1000 x 100 = 100000 active file rows; <=90000 ms per walk, excluding source CAS/SQL seed time |
| Page latency | p95 <=500ms, single slowest <=2000ms across 1000 HTTP POSTs |
| Signed original GET | 3 real ticket POSTs and 3 signed true file-byte streams; each issuance and GET <=3000ms; exact SHA, JPEG and scope/revocation |
| Resource / provenance | 25ms Go RSS peak sample delta <=256MiB; Go CPU ticks, kernel write bytes, total response bytes, exact source SHA, runner/Go version and raw logs |
| Decision | First original CURRENT; if accepted keep production unchanged, AFTER/speedup N/A. True product RED: archive it unchanged, try one minimum scoped optimization, same-source same-runner matched n>=3 BEFORE/AFTER; reject weak gains |

This is a Server-layer real HTTP benchmark, NOT actual Desktop/Web/Mobile Web GUI, PWA installation, native OS/real phones, WAN, 100k simultaneously decoded thumbnails, H264/HEVC/LIVP/Live Motion playback or background user-owned transfer cancellation. No Race, product API, CAS schema or durable operation changes.

## Native Linux and merge gates

Branch-only [SH-P004 CI](../.github/workflows/sh-p004-real-physical-jpeg-public-100k.yml) invokes the opt-in Go test TestSHP004RealPhysicalJPEG100KSharedFolder with XD_SH_P004_PHYSICAL_SHARE_PERF=1 and explicit XD_SH_P004_SAMPLE=sample-1/2/3. It runs a 1k smoke that is not n3, then three independent real 100k seeds. Record immutable machine JSON/logs, SHA, CPU/RSS and the real Actions workflow link after a valid run. Any format/build/synthetic fixture failure is Invalid harness, NOT a genuine product performance RED. Only a fully new exact-head specialized n3 and complete 76+ Go/PostgreSQL API Race, Web/Desktop Linux/Windows, Rootless, artifacts, one-work-commit and Final Gate plus fresh clean GitHub mergeability may be marked Ready/Rebase. Neither native Browser nor installed PWA is implied by CI.
