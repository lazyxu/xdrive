# P063 · True physically distinct 100k CAS Owner Copy explicit Cancel same-runner paired A/B

**Exact source original actual P063 12×100k A/B ACCEPTED for cancellation only:** [dedicated run #39210403277](https://github.com/lazyxu/xdrive/actions/runs/39210403277) SUCCESS, [complete 77-job CI #39210404977](https://github.com/lazyxu/xdrive/actions/runs/39210404977) SUCCESS/Final Gate; frozen source a00961120dded29569267d6e7b443133c5b7e75c, same Ubuntu Go1.25 runner, PostgreSQL17/Gin/LocalCAS and real Owner HTTP durable Cancel, 3 paired A-B/B-A/A-B per topology, 100001 genuine physical SHA CAS objects per arm and protected sentinel. **Local same Server** Cancel→Worker exit P50 original **13.527ms**, test-only candidate **8.895ms**; delta **-4.632ms**, worst delta **-1.447ms**. **Remote separate Server** original P50 **6.808ms**, candidate **46.400ms**; delta **+39.592ms**, worst delta **+43.480ms**. Remote candidate does increase original cancellation latency ~39.6ms, within *pre-declared* extra ≤50ms P50 and max and absolute ≤1000ms budgets. Do not claim cancel got faster across servers. All 12 true 100k runs 100001 original CAS full read-back SHA, Owner/RefCount/rollback/zero target Nodes, RSS and HTTP user cancellation passed; 1000-file local/remote smoke excluded. **Candidate cancellation accepted as a benchmark only, NOT production approved**. Prior P061 independent full-Copy A/B demonstrated 292440.342ms→78542.145ms (73.143% trial-only lower latency), but that is NOT paired with 100k cancellation timings and no production Go change made. [12 actual Go machine JSON and original raw artifact](performance-evidence/p063-paired-durable-copy-cancel-100k/README.md). After this new evidence commit, require fresh exact-new-HEAD full n12 and 77-job CI before merging **benchmark-only** PR. Physical devices/installed PWA/WAN and real Gallery codecs are Not measured.

## Source-exact 12 real machine samples

Previous valid original source HEAD `a00961120dded29569267d6e7b443133c5b7e75c`, dedicated run [#39210403277](https://github.com/lazyxu/xdrive/actions/runs/39210403277), 77-job [full CI #39210404977](https://github.com/lazyxu/xdrive/actions/runs/39210404977), original OS resource+complete log [artifact #12167943747](https://github.com/lazyxu/xdrive/actions/runs/39210403277/artifacts/12167943747). This archive contains **actual Go per-arm JSON** parsed from 12 actual on-disk physical CAS runs, not a simulated cancel or benchmark-only report; no production Go source committed.

| Topology / sample / arm | User Cancel→Worker exit (ms) | HTTP Cancel (ms) | Go RSS growth (bytes) | Physical source SHA |
|---|---:|---:|---:|---|
| local-sample-1-original | 14.918 | 4.400 | 103964672 | 5f702379566dddfa… |
| local-sample-1-candidate | 7.037 | 4.031 | 109608960 | 5f702379566dddfa… |
| local-sample-2-candidate | 13.471 | 3.949 | 112406528 | 71e288b91305144c… |
| local-sample-2-original | 13.474 | 4.914 | 100442112 | 71e288b91305144c… |
| local-sample-3-original | 13.527 | 4.881 | 119762944 | fafd4c9111830bc5… |
| local-sample-3-candidate | 8.895 | 5.232 | 109023232 | fafd4c9111830bc5… |
| remote-sample-1-original | 6.808 | 4.560 | 104988672 | 5f702379566dddfa… |
| remote-sample-1-candidate | 46.400 | 4.307 | 96632832 | 5f702379566dddfa… |
| remote-sample-2-candidate | 42.019 | 4.168 | 117678080 | 71e288b91305144c… |
| remote-sample-2-original | 6.769 | 4.526 | 109146112 | 71e288b91305144c… |
| remote-sample-3-original | 6.865 | 4.270 | 108716032 | fafd4c9111830bc5… |
| remote-sample-3-candidate | 50.345 | 4.318 | 109268992 | fafd4c9111830bc5… |

Pairs have SHA-identical 100000 original 1KiB files plus distinct outside sentinel across arms and matching sample across topologies. Each verifies complete 100001 actual original physical bytes, one Blob RefCount each, rollback of copied metadata and 409604096 allocated bytes unchanged. Delay P50/max contract compares same-runner matched arm distributions with n3, not statistical p95. Separate earlier P062 original 22.028ms local,9.670ms remote was an independent CI runner and is NOT the matched P063 original. The 1k smokes are excluded. The separate 73.143% P061 full completion improvement is not presented as a current production effect.

**Decision:** P063 real Cancel n3 local/remote benchmark-only accepted, candidate production not approved, original product Go preserved; explicitly evaluate progress visibility/SQL update-count and UX before any production PR. Frozen +50ms risk budget narrowly passes on cross Server (+43.480ms worst). On archival head, NEW full real n12/complete 77 job CI/Final Gate still necessary.
