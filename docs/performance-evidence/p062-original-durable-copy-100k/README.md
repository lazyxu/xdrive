# P062 · Authenticated real 100k physical CAS Owner durable Copy cancellation

## Exact original accepted six 100k samples

Original accurate source HEAD 780355c2b4a96ab4cbb9d08bdacbd8837a1eccff passed [dedicated six real 100k physical CAS Cancel CI #39204613765](https://github.com/lazyxu/xdrive/actions/runs/39204613765) and [complete 77-job CI #39204613948](https://github.com/lazyxu/xdrive/actions/runs/39204613948) (25 success, 52 conditional skip, Final Gate success). Actual local Same-Server Owner HTTP Cancel→Worker exit n3 P50 **20.161 ms**, max **25.208 ms**, HTTP P50 6.761ms; remote independent Server persisted SQL cancel n3 P50 **8.532 ms**, max **8.580 ms**, HTTP P50 5.586ms. Each topology 3 independent actual 100000 SHA-distinct physical 1KiB LocalCAS original sources + protected sentinel, 100001 full original SHA checked, exact Owner/CancelRequested→Cancelled/rollback/progress reset, zero target copied Nodes, RefCount=1 and 409604096 physical allocated bytes unchanged. All six <=1000ms cancel latency budget and <=512MiB Go postseed RSS passed. [Permanent actual six Go machine JSON and raw CI artifact pointer](performance-evidence/p062-original-durable-copy-100k/README.md). Status **Accepted ORIGINAL genuine cancel n3 / production unchanged / AFTER=N/A / speedup=N/A**. P061 temporary Copy candidate 73.14% faster on independent full-completion A/B but its across-Server cancel response has NOT been tested; do not deploy production candidate or conflate original cancellation with its safety. New evidence HEAD requires entirely fresh real 6x100k and full 77-job CI success and clean GitHub mergeability before benchmark-only merge. No Race/installed six-platform hardware claim.

Frozen dedicated source exact HEAD: 780355c2b4a96ab4cbb9d08bdacbd8837a1eccff. Original work CI #39204613765 and complete 77-job CI #39204613948 succeeded. [Full machine logs and OS resource files artifact #12165566172](https://github.com/lazyxu/xdrive/actions/runs/39204613765/artifacts/12165566172). Six permanent JSON files are verbatim parsed from original actual Go P062_REAL_100K_CANCEL lines. Exclude two separate 1k smoke runs from n3. Original P062 source was committed as a SINGLE test-only work commit; no product Go changes.

| Topology / sample | Owner Cancel→Worker exit (ms) | HTTP Cancel (ms) | Go postseed RSS growth (B) | original source SHA prefix |
|---|---:|---:|---:|---|
| local / sample-1 | 20.161 | 6.761 | 113029120 | 5f702379566ddd… |
| local / sample-2 | 19.930 | 7.796 | 115822592 | 71e288b9130514… |
| local / sample-3 | 25.208 | 6.145 | 111550464 | fafd4c9111830b… |
| remote / sample-1 | 8.532 | 5.586 | 118198272 | 5f702379566ddd… |
| remote / sample-2 | 7.996 | 5.307 | 103145472 | 71e288b9130514… |
| remote / sample-3 | 8.580 | 5.840 | 109490176 | fafd4c9111830b… |

Actual local same-Server n3 P50 20.161ms, worst 25.208ms; remote second-Server n3 P50 8.532ms, worst 8.580ms. Three source aggregate SHA256 hashes are pair-identical between local and remote runs. No performance candidate in these six samples, so AFTER/speedup N/A. All CAS SHA/inode/RefCount/allocated-byte and zero-committed-target assertions pass. n=3 max is not statistical p95.

Go Server cancellation is user-owned durable task cancellation, NOT request-scoped viewport eviction; do not cancel persistent Copy on navigation. P061 test-only coalescer was not validated in this benchmark, especially its cross-Server persisted cancellation status check. Keep #1185 independent Desktop Gallery IPC benchmark Blocked until exact source resolution. Distinct installed Web, Desktop, iOS/Android PWA, WAN and mixed media runtime remain Not measured.

Initial invalid P062 gofmt-first-red failures (#39203777177/#39204171290/#39204472496) were fixed before genuine 100k data were recorded; preserve their history. This archival commit must re-run NEW accurate-HEAD six 100k samples and 77-job full Final Gate before merging.
