# P061 real 100k physical CAS Copy same-runner paired n3 — permanent evidence

Source-exact experimental commit `21f33ebb4ad9a184f7cacbe3a6022dabdd989e18`: [specialized 6-run CI #39197273634](https://github.com/lazyxu/xdrive/actions/runs/39197273634) success, [complete 77-job CI #39197274335](https://github.com/lazyxu/xdrive/actions/runs/39197274335) success, [original full machine logs and time -v artifact #12163685724](https://github.com/lazyxu/xdrive/actions/runs/39197273634/artifacts/12163685724). Six machine JSON rows here were directly parsed from the Go test's actual source-executed output, rather than estimated.

One Github Ubuntu Go1.25/PostgreSQL17/Gin/LocalCAS runner. Three A/B paired, order A-B/B-A/A-B, each arm seeds 100000 physical SHA-distinct 1KiB originals plus one protected outside source, authentic Owner HTTP Copy enqueue, actual Go durable Worker, Undo, authorized purge, complete SHA and RefCount checks. Each pair shares the exact same source SHA. All 100001 CAS inodes and 409604096 allocated bytes unchanged. Seed and SHA readback excluded from Worker time.

| Sample-arm | Copy actual Worker ms | postseed Go peak RSS growth bytes | CPU ticks Copy+Undo | Source SHA prefix |
|---|---:|---:|---:|---|
| sample-1-original | 335905.300 | 111271936 | 11718 | 5f702379566d… |
| sample-1-candidate | 111984.922 | 122535936 | 7581 | 5f702379566d… |
| sample-2-candidate | 111823.809 | 115064832 | 7568 | 71e288b91305… |
| sample-2-original | 335975.607 | 107982848 | 11716 | 71e288b91305… |
| sample-3-original | 336050.395 | 111095808 | 11707 | fafd4c911183… |
| sample-3-candidate | 111658.776 | 122335232 | 7590 | fafd4c911183… |

**BEFORE original Copy P50 335975.607ms → AFTER test-only candidate P50 111823.809ms; 66.717% wall-latency reduction, 3.005x speed ratio.** Original max 336050.395ms vs candidate max 111984.922ms, CPU ticks median 11716→7581, Go RSS-growth median 111095808→122335232 bytes, Go kernel source-write 0B, all 6 SHA/inode/authorization/refcount verified. Three samples do not establish true P95.

**Status: performance-only candidate meets materiality threshold; PRODUCTION GO UNCHANGED.** CAUTION: the isolated candidate tests ctx.Err() on each copied Node, but throttles the original per-Node DB status UPDATE and may delay observing persisted cancel_requested from a second Server instance. Existing progress-count contract expects 121 writes/120 nodes, and current immediate DB-cancel-check test checks its first BEGIN only. Do not weaken tests. Explicit HTTP user-owned cancellation, cross-instance status observation, rollback/refcount and progress visibility need separate validation before ANY production Go adoption. The benchmark-only PR must rerun genuine exact-new-HEAD six 100k samples and full CI after this permanent archive. Six real installed Web/Desktop/PWA/iOS/Android clients, WAN, 100k mixed media Gallery and actual user Cancel test NOT MEASURED.
