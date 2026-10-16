# CAS-A01 original CURRENT: one physical Blob, 100k logical File + 100k historical FileVersion refs, 2 owner keepers

This repository copy permanently preserves byte-identical source original [native CI #38854311221](https://github.com/lazyxu/xdrive/actions/runs/38854311221), HEAD `fa97a9d48105a0c7c95c6eb51af1ff6430f573c9`: `source.txt`, `summary.json`, `sample-1/2/3.json`, `sample-1/2/3.time`. Each Git Blob SHA-1 verified against **the original Actions ZIP member bytes** (not manually rounded); original full artifact includes source Go runtime debug logs [artifact #12027180215](https://github.com/lazyxu/xdrive/actions/runs/38854311221/artifacts/12027180215), ZIP SHA256 `c2d22037dd2ba80cac3edae4b836f73c6e8f3680cc518e08ce9ea66edb99ad1e`.

| 来源样本 | 真100k HTTP删除耗时 | 最后两个Keeper真实GC | Owner A/B的不同StorageKey物理配额 | Go RSS增量 | 释放引用变化 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 5585.206ms | 32.263ms | 1024/1024B | 94650368B | 200002 → 2 → 0 |
| 2 | 5725.223ms | 43.372ms | 1024/1024B | 86077440B | 200002 → 2 → 0 |
| 3 | 5711.080ms | 28.115ms | 1024/1024B | 92594176B | 200002 → 2 → 0 |

3 independent PostgreSQL17 and Local storage fixtures. Signed genuine owner /trash permanent deletion performed 200k logical reference release of 100k File + 100k FileVersion metadata rows. One SHA-distinct immutable physical original (1,024B) shared globally with initial refcount 200002; owner A and B quota each 1,024B. Selected 100k deletion returns 204, foreign404/stale409, shared RefCount→2 with original bytes intact. Last two Keeper deletions reduce RefCount→1→0 and finally GC physical Blob inode to zero; no premature unlink; all original budgets pass. Original 100k selected HTTP P50 5711.080ms, last-two-reference GC P50 32.263ms, max Go RSS delta 94650368 bytes. This is **not the P047 100k different physical SHA Blob GC**, and not a matched latency optimization comparison. No product change; AFTER=N/A. Exact evidence HEAD requires **new** dedicated + full FinalGate CI before delivery; no installed PWA or real Web/Desktop GUI claimed.
