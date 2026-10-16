# CAS-A02b / S001-e real 4GiB n3 – source-exact compact persistent evidence

**Status: Original unchanged-product/offline A-B accepted n=3; final archived HEAD recheck pending.** The first source-exact specialized [GitHub Actions CI #38905016820](https://github.com/lazyxu/xdrive/actions/runs/38905016820) passed on source commit 84fc5684a556b4a895deddbb91c758f42c509a3e. All 3 source payloads are independently generated SHAKE-256 high-entropy 4GiB with 512 real fsynced 8MiB stage files in both arms, opposite arm order on sample 2, correct fullSHA/40 original 64KiB Range and offline 4GiB flat materialization, physical cleaning verified.

**Permanent files here:** original exact summary.json, source.txt, and source-accurate **compact** numeric measurements (including the exact SHA-256 of each original full JSON) in observed-samples.json. Those numeric values are copied without rounding beyond the original JSON. Source SHA and the SHAKE-256 sample/index derivation in the unchanged source permit deterministic verification of every chunk identity.

**Full original archive:** [Actions Artifact #12047453131](https://github.com/lazyxu/xdrive/actions/runs/38905016820/artifacts/12047453131) has the complete 11 byte-exact original files (3 full sample JSON including chunk arrays, 3 logs, 3 CPU/RSS resource records, summary and source); original ZIP digest sha256:e6eb4ea2e6dc302d51a06d21450a9fbad9b1a756f783257b31fdb82a41998238. Independently packed deterministic tar.xz of the same 11 files is SHA256 66b63ec5e0533f2544b0f33d457951de0af2183fe2493b268dc03fff6400b98b. **Important: the GitHub Actions Artifact has limited retention; compact numeric evidence here is permanent, but does not represent the full original byte-for-byte archive.** This distinction is intentional and must not be erased in later claims.

| Real n3 original staged full assembly | Offline 8MiB chunk promotion | Result |
| --- | --- | --- |
| Peak 8,589,938,688B (2.000000954×) | 4,295,004,160B (1.000008583×) | Separate file-data layout only, not real production HTTP |
| Kernel stage+final 8,589,934,592B | 4,295,004,160B | Offline write ratio 0.500004292 |
| Finalize P50 16,305.935ms | 8,229.359ms | Extra offline full-flat materialization P50 **15,422.271ms** and extra 4GiB real writes |

**Interpretation:** Offline value accepted for the physical first-upload staging data shape only; no production change, speedup of production=N/A. Preserve fullSHA-256 immutable Blob identity, owner isolation, FileVersion, Go ctx-scoped short request abort and durable task ownership. For any future production optimization, independently test continuous Local staging pwrite+atomic promotion, rather than changing all readers to Chunk Manifest solely because offline saved space. [Canonical](../../cas-upload-staging-performance.md) · [Registry](../../performance-test-registry.md) · [Platform matrix](../../performance-platform-coverage.md).
