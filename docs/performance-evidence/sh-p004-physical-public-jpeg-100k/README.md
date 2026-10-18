# SH-P004 physically distinct JPEG shared-folder original evidence

## First genuine source-exact 3x100k physical JPEG original record (2026-10-18)

**Go original measurement source** `9737639fcf068b51a9d00cc4e0064a1522ff98b6`, [GitHub Actions CI #39126802572](https://github.com/lazyxu/xdrive/actions/runs/39126802572) / [original 22.7MB five-log+machine artifact #12136304262](https://github.com/lazyxu/xdrive/actions/runs/39126802572/artifacts/12136304262). These three samples were extracted from their original, unredacted-except-GitHub log records, without any share token, file download token, owner secret or per-JPEG file body. The Go test ran real PG17/LocalCAS for each independent sample, physically wrote 100000 SHA-unique, individually JPEG-encoded decodable originals (+1 protected outside JPEG) and 100000 corresponding File rows; each tested all 1000 actual public-folder HTTP pages, three signed file downloads with true original byte+SHA+JPEG validation, outsider denial and revoked access. Every Go `passed=true`; CI overall **FAILED in Python summary AFTER the Go runs** (`KeyError: original_source_bytes`, correct source JSON property `physical_source_bytes`). This is **not** full source-exact green; correction is just the report schema key, requiring new full n3+CI after evidence update.

| Original physical benchmark | sample-1 | sample-2 | sample-3 |
| --- | ---: | ---: | ---: |
| Public 100k walk ms | 3245.464 | 3224.434 | 3090.569 |
| Per-page p50 ms | 2.931 | 2.911 | 2.774 |
| Per-page p95 ms | 3.814 | 3.876 | 3.705 |
| Per-page slowest ms | 6.001 | 6.554 | 5.589 |
| Slowest signed ticket ms | 5.634 | 5.267 | 4.481 |
| Slowest original signed JPEG GET ms | 3.560 | 3.040 | 3.130 |
| Go 25ms sampled RSS delta bytes | 479232 | 622592 | 602112 |
| Go CPU ticks | 311 | 310 | 299 |
| Original JPEG physical content bytes | 70893376 | 70893376 | 70893376 |
| CAS disk allocation bytes incl. sentinel | 409604096 | 409604096 | 409604096 |
| CAS+SQL seed elapsed ms, EXCLUDED | 85196.899 | 77095.554 | 77665.554 |
| Actually listed items / pages | 100000 / 1000 | 100000 / 1000 | 100000 / 1000 |

**Across three independent fixtures:** complete walk P50 **3224.434ms**, worst page **6.554ms**, max ticket 5.634ms, max signed source GET 3.560ms, peak RSS growth 622592B, zero Go process kernel writes. Frozen all gates PASS. Aggregated original source hash intentionally repeats because the *deterministic fixture produces identical JPEG contents in new independent PostgreSQL/LocalCAS roots each time*, NOT because 100k entries within a fixture share one Blob. User-perceived browser/PWA, video/Live Motion, WAN, installed Desktop Agent IPC and 100k concurrent JPEG thumbnails still **Not measured**.

**Original raw JSON with unchanged JSON payloads extracted from Go CI lines:** [sample-1](ci-run-39126802572/sample-1.json) Git Blob `b298d1b100277239e5f119e35169124bc49e36c9`, [sample-2](ci-run-39126802572/sample-2.json) `f16dd61747f51331b8f24c5618ba935af488e85a`, [sample-3](ci-run-39126802572/sample-3.json) `d5acec1160fd2e16dd63410fcce1dc22dac986c5`. The first source-exact smoke JSON and all original CPU/time logs remain in the unchanged linked Actions artifact. All three samples are original CURRENT, not a candidate AFTER; since original satisfies frozen budgets, keep product unchanged, improvement percentage N/A.

**Current at source freeze: Not measured (n=0). BEFORE=CURRENT only after authentic original n3; AFTER=N/A, speedup=N/A.**

[Spec and frozen budgets](../../folder-share-physical-jpeg-100k-performance.md) · [Registry](../../performance-test-registry.md) · [Six-mode matrix](../../performance-platform-coverage.md).

The test-only Linux/Pg17 workflow must create each of three independent real 100k decodable JPEG CAS originals plus an unshared protected original, all actually physically stored with distinct SHA/metadata. Only after 1000 true public folder HTTP keyset pages (100 items each), three signed/verified original-byte download streams, owner/scope and revocation correctness, actual CPU/RSS/allocated CAS and frozen latency budgets pass can original CURRENT be called accepted. Seed duration is explicitly excluded. Do not mistake this for 100k browser-rendered thumbnails, native desktop IPC, installed PWA, physical Android/iOS, WAN, video/Live Photo or canceled durable transfers.

Before the first valid dedicated run no timings are recorded. On success archive exact-source original sample-1/2/3 JSON, source.txt and raw machine logs with SHA/checksums, link directly to GitHub Actions, append measured values and rerun the updated evidence commit and full Final Gate before merge. Preserve invalid/RED attempts and no successful-before speedup claims. No bearer/signed download URL should be recorded.
