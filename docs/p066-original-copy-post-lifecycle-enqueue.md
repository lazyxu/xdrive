## P066 true physical 100k original measured n3 checkpoint (2026-10-20)

**Historical measured work source `c37a891a3bb51734dcb730a0e1127002852d57e0`:** genuine [original PostgreSQL17/Gin/LocalCAS physical 3x100k specialty CI #39293101256](https://github.com/lazyxu/xdrive/actions/runs/39293101256) **SUCCESS**, and [same-head full 77-job CI #39293100806](https://github.com/lazyxu/xdrive/actions/runs/39293100806) **SUCCESS** (25 success/52 conditional skipped; Final Gate green). All original 100k independent CAS physical fixture + complete Worker/Undo/authorized Trash + second authenticated HTTP POST + explicit queued cancel + physical CAS verification passed.

| Source-exact original samples (100k physical each) | sample-1 | sample-2 | sample-3 | median |
| --- | ---: | ---: | ---: | ---: |
| First Owner enqueue (ms) | 133.000 | 141.246 | 133.703 | **133.703** |
| Copy Worker (ms) | 351704.056 | 352330.019 | 356569.854 | **352330.019** |
| Undo Worker (ms) | 1677.809 | 1607.848 | 1664.544 | **1664.544** |
| Authorized Trash purge (ms) | 9127.672 | 9162.157 | 9188.592 | **9162.157** |
| **Second Owner enqueue (ms)** | **162.514** | **173.938** | **188.498** | **173.938** |
| Second recursive-size SQL family GORM wall (ms) | 153.128 | 164.113 | 156.872 | **156.872** |
| True physical CAS/Owner/SHA/refcount & queued Cancel | PASS | PASS | PASS | 3/3 |

Original all six POST <=120000ms; Copy/Undo all <=900000ms, all frozen P056 CPU/RSS/bytes, 100001 physical CAS inodes and 409604096B allocation per independent fixture unchanged. P066 is a **new original measurement**, not an optimization; **product AFTER/speedup=N/A**. First and second POST states differ; the second's P50 is ~30.1% higher but is NOT a paired same-state performance regression measurement. The PG 250ms sampler captured **0 ticks** in each sub-250ms second POST and the GORM timing is not exclusive database CPU: historical 344–642s P064 RED remains unexplained. No runtime code was optimized.

[Full source-exact machine original P056 + P066 rows](performance-evidence/p066-original-post-lifecycle-enqueue/ci-run-39293101256.json) · [raw CI artifact #12208765042](https://github.com/lazyxu/xdrive/actions/runs/39293101256/artifacts/12208765042) · [open root-cause Issue #2153](https://github.com/lazyxu/xdrive/issues/2153). **This new evidence-amended one-work HEAD needs a brand-new own physical n3 and full 77-job CI, Final Gate, current clean mergeability before Ready/rebase merge.** Old source green does not authorize amended SHA.

---

# P066 原版100k Copy完整生命周期之后的第二次 HTTP 入队

**状态（2026-10-20）：新测量维度，CURRENT=Not measured n=0；AFTER=N/A，speedup=N/A。生产代码不变。**

## 历史有效数据

- 合入的 P065 #2164：三组真实物理100k SHA不同CAS原版初次Owner入队117.764 / 115.927 / 116.201 ms，P50 **116.201ms**，原120000ms门槛通过。但只执行首次HTTP，不执行持久Copy Worker、Undo和Trash，PG250ms采样没有任何轮次。
- P064 #2136：先前真实原版完整Copy试验中HTTP入队发生 641660.037 / 638310.714 / 344237.960 ms，超120000ms门槛，根因仍未查明；早期 Copy Worker 66–73%试验收益绝非可合入生产的最终验证。
- 本P066专门补齐 **执行完完整100k Copy→Undo→授权Trash清理之后再次入队**。不是在不同机器比较首次116ms与历史600s，也不是重复冷启动P065。

## 测试方法

真实 PostgreSQL17/Gin/LocalCAS/用户JWT，三份独立真实100000 SHA不同且物理分配的原片，每份额外受保护CAS，原P056运行初次POST、持久Copy、Undo、删除Trash并逐件验证SHA/所有RefCount及磁盘分配字节。所有原P056完整性验收通过之后，在同一Server/PG数据状态下，对相同source与空target执行第二个真实Owner POST。使用已经合并的P065 GORM分类Trace、250ms PostgreSQL活动等待类型采样（若原POST小于250ms，样本可能为0）、CPU/RSS；独立事后PG统计/EXPLAIN仅作辅助，不能当作请求中的SQL准确等待。新队列由正式Owner HTTP取消，验证取消持久状态、原CAS不变、目标为空，不启动第二次Worker。

只有 opt-in 环境 XD_P066_POST_LIFECYCLE_REENQUEUE=1 才执行本段；P065初次诊断和P056普通完整Copy都不变。没有新公开路由、账户分享令牌、Race或生产索引/SQL/复制逻辑。机密的SQL文本、参数、用户凭据、JWT、CAS key、文件名、backend PID不得打印或归档，只输出已约束类别和合成测试SHA。

## 首次实测前冻结门槛

- 原始首次和第二次JWT Owner HTTP POST分别 <=120000ms；原版Copy和Undo Worker各 <=900000ms；原P056最大RSS<=512MiB及原有CPU、写盘、Share/Owner、物理CAS、Trash Undo真实性校验全部保留。
- 三份不同源各100k物理CAS+受保护第100001个，完整生命周期、post-Worker第二次POST、明确取消、零目标新增与完整CAS分配校验。source SHA必须不同。原始样本若超标就是**Original RED**，缺样本/假数据为**INVALID**，保留失败与成功原始机器JSON，不挑成功样本、不更改冻结预算、不自动 ANALYZE 遮蔽慢请求。
- 若三份原版全达标，保留生产代码，历史344–642秒仍不能宣称已修复；若真正复现后续入队RED，先据SQL Trace、PG等待及主机资源证据定位来源。只在归因后，单独提生产优化与同Runner同语料交替>=3 BEFORE/AFTER，至少20%收益且CPU/RSS、完整性与跨Server Cancel额外<=50ms门槛全过；否则拒绝或回退优化。
- P064 #2136和Desktop图库IPC #1185继续Draft/Blocked；Issue #2153记录历史慢尾。P066只测Linux Server层，不代表Web/Desktop/手机PWA实机、WAN或4GiB中断、视频/实况全部完成。本次不重复已经验收的独立场景。

测试路径：原 internal/api/p056_real_physical_cas_copy_undo_100k_performance_linux_test.go 仅增加opt-in代码；新 .github/workflows/p066-original-post-lifecycle-enqueue-100k.yml 保存准确source与原始n3。新PR须单工作提交、专用真实n3和完整77+准确HEAD CI（真实PostgreSQL API Race门禁、Win/Linux Web/Desktop、Rootless、制品、Final Gate）、GitHub clean后才可Ready/Merge。

---

## P066 exact-source CI green and handoff archive (2026-10-20)

- Original preexisting AGENTS.md already contains mandatory measurement-first, named 100k/4GiB workload de-duplication, same-runner BEFORE/AFTER, material/no-regression, and Go viewport-vs-durable cancellation policies. No new performance policy is needed. To avoid repeated conflicts with unrelated concurrently appended/prepended project handoffs, P066 does NOT replace or modify upstream AGENTS.md. Every P066-only handoff formerly on this PR branch is preserved verbatim below in this canonical performance document, which owns the measured evidence.
- Previous HEAD 8b6dda92b8acad56978acfc94580e3d39469e0d5 has exact original physical PostgreSQL17/Gin/LocalCAS 3x100k SHA-distinct Copy->Undo->Trash->second Owner POST [specialty #39362083960](https://github.com/lazyxu/xdrive/actions/runs/39362083960) SUCCESS and complete 77+ [CI #39362083604](https://github.com/lazyxu/xdrive/actions/runs/39362083604) SUCCESS, including PostgreSQL API Go Race, Windows/Linux Web/Desktop and Final Gate. Previous-head evidence only. The NEW conflict-reconciled single work commit requires its OWN new accurate-head specialty, whole CI and clean mergeability before Ready/Rebase Merge. Never claim a production change, AFTER percentage or resolution to #2153's 344-642-second original HTTP tails from green original-only n3.
- All P066 tracked source/test/workflow/registry/matrix/raw-evidence files remain identical by Git Blob, except this canonical document that deliberately stores full P066 handoff history. Diagnostic changes no product SQL/Worker/cancellation/Media/FileExplorer/PublicShare/ZIP/Race.

### Archived P066-only source handoffs (verbatim)


## P066 · real AGENTS-only upstream conflict reconciliation (2026-10-20)

- Previous source-exact single-work P066 head `0ba0465b87713f14a2a16f2948a0a4b8462297d6` passed genuine original SHA-distinct 3×100k Copy→Undo→Trash→second Owner HTTP [native #39352856997](https://github.com/lazyxu/xdrive/actions/runs/39352856997) and complete 77-job [CI #39352857118](https://github.com/lazyxu/xdrive/actions/runs/39352857118) with Final Gate. Latest master `d11a3f5208895c1309c3227a4d113cd6b400ba72` has only AGENTS.md overlapping P066. Preserve every existing non-AGENTS P066 code/test/workflow/registry/evidence blob byte-for-byte, all earlier P066 AGENTS entries and full latest master AGENTS. Rebuild exactly ONE P066 commit on complete master because GitHub confirmed the prior PR mergeability dirty; do not touch unrelated Files/Gallery/Device/Host/Race or blocked P064 #2136 / Desktop IPC #1185.
- Prior HEAD CI does not approve rebuilt source: require NEW exact-head native physical 3×100k specialty, complete 77+ CI including genuine Go/PostgreSQL API Race gate and Final Gate, and clean GitHub mergeability before Ready/Rebase Merge. Original n3 initial/second Owner HTTP P50 133.703/173.938ms and full Copy Worker P50 352330.019ms unchanged, product AFTER/speedup N/A. Previous P064 original enqueue long-tail 344–642s remains unresolved; do not activate P064 production coalescing. Existing AGENTS Performance specialization policy already mandates first original measurement, matched same-condition AFTER, material repeatable gain or reject, and preservation of resource/cancellation integrity: no duplicate policy needed.

## P066 · prior exact-HEAD 3×100k and 77-job CI PASS; latest full master reconciliation (2026-10-20)

- P066 `cc5a3a0e6ba69263f671b0422779a640f424dd90` on complete former `master@50acc22e2e2ab40eb007d3beeacb7e0de4e5f8de` passed BOTH its [source-exact real 3×100k physical CAS Copy/Undo/Trash→second Owner POST #39350324855](https://github.com/lazyxu/xdrive/actions/runs/39350324855) and [77-job full CI #39350324976](https://github.com/lazyxu/xdrive/actions/runs/39350324976) incl real PG API Go Race and single-work Final Gate. Three independent physical original 100000 SHA-distinct CAS+sentinel samples under immutable original 120000ms HTTP and 900000ms Worker limits; historical P066 initial and second P50 133.703/173.938ms, original Copy Worker P50 352330.019ms. This is ORIGINAL baseline, not a product optimization; after/speedup N/A. Historical P064 344–642s original HTTP tails remain inexplicable; keep #2136 blocked, #1185 independent blocked.
- Later independent master advanced to `8539197e137852185d644a6147f94abe2e91b23d`; exact compare from original P066 parent shows **AGENTS.md only** shared P066 path. Reconstruct exactly ONE P066 work commit on COMPLETE current master, preserve every P066 test/workflow/registry/matrix/contract/evidence blob unchanged and entire newest master AGENTS history; no Race, Gallery/Explorer runtime, local Push, Map, Share/ZIP or other branch modification. Old SHA green does NOT approve rebuilt SHA: repeat NEW authentic 3×100k native + full 77+ CI/Final Gate and fresh mergeability=clean BEFORE ready/rebase merge, retain invalid/RED evidence rather than re-running indefinitely.

## P066 · full latest-master reconciliation after accurate original physical 3×100k and full CI GREEN (2026-10-20)

- Previous evidence-amended P066 accurate HEAD `25b173ef2bfe6438482d3241525ef53c3b568bb5` on complete former master `1b3d30d3baccdbfc4f66d7f219d055d85f6dae35` passed [native actual independent 3×100k physically SHA-distinct Copy→Undo→Trash→second Owner POST #39347869058](https://github.com/lazyxu/xdrive/actions/runs/39347869058) and [full 77-job CI #39347869316](https://github.com/lazyxu/xdrive/actions/runs/39347869316), both **SUCCESS**, full Final Gate green (25 success/52 conditional skips). Earlier first source `c37a891a3bb51734dcb730a0e1127002852d57e0` also passed authentic n3 and full 77 CI, and immutable raw samples/evidence are archived; current source after reconciliation is NEW HEAD and must be revalidated.
- Latest complete master `50acc22e2e2ab40eb007d3beeacb7e0de4e5f8de` advanced only independent LocalPush/FileExplorer and complete AGENTS progress since P066's preceding base; exact compare establishes **AGENTS.md only P066 overlap**, so retain original six other P066 source/test/CI/docs/evidence blobs byte-identical, preserve all AGENTS master history and P066 handoff, create exactly ONE standalone P066 work commit on full current master. Do not force-update any other branch. Require wholly NEW current-head 3×100k specialty, whole 77+ CI incl real PG API Race and Final Gate, and fresh GitHub clean before Ready/Rebase/Merge. Prior green is not approval for new SHA.
- P066 unchanged product original baseline: first post P50 **133.703ms**, second after complete physical Copy+Undo+Trash P50 **173.938ms**, 3/3 under frozen 120s; Worker P50 **352330.019ms**; second recursive-size GORM trace 153.128/164.113/156.872ms; PG250ms sampler had 0 polls. The historical **344–642 seconds original P064 #2136 admissions remain unexplained**. No product optimization or speedup AFTER; do NOT activate #2136 or relax Owner/cross-server Cancel/integrity. Desktop IPC #1185 stays independent Draft; no Race or share/ZIP changes.

## P066 · source-exact original physical 100k actual n3 PASSED (2026-10-20; evidence-head revalidation required)

- Previous original work head `c37a891a3bb51734dcb730a0e1127002852d57e0` completed [true 100k physical specialty #39293101256](https://github.com/lazyxu/xdrive/actions/runs/39293101256) **SUCCESS** (original 3 independent 100000 different SHA LocalCAS objects + protected sentinel, each 409604096B actual allocation; real Owner POST→Copy Worker→Undo Worker→authorized Trash purge→full SHA & RefCount→**second POST**→explicit authorized queued cancellation and no CAS mutation). [Exact source 77-job full CI #39293100806](https://github.com/lazyxu/xdrive/actions/runs/39293100806) **SUCCESS**: 25 success/52 conditional skips, actual Go/PostgreSQL API Race, Linux/Windows Web/Desktop, Rootless and Final Gate green.
- **Original P066 CURRENT n3 valid:** first Owner HTTP 133.000/141.246/133.703ms (P50 **133.703ms**), second AFTER FULL lifecycle 162.514/173.938/188.498ms (P50 **173.938ms**, max **188.498ms**), all six under original frozen 120000ms. Original full Copy Worker 351704.056/352330.019/356569.854ms (P50 **352330.019ms**), original Undo 1677.809/1607.848/1664.544ms, authorized Trash 9127.672/9162.157/9188.592ms; original full storage/Owner/SHA/refcount passed. Second original recursive-size GORM statement 153.128/164.113/156.872ms, PG 250ms sampler polls zero (all POSTs <250ms), **cannot rule out transient wait**. Second POST Go RSS growth 0B within coarse snapshot; do not claim actual peak memory 0B. Note the second-original HTTP P50 is ~30.1% higher than first, but these are distinct post-Worker states, **NOT a same-run product optimization A/B**. Production code unchanged, **AFTER/speedup=N/A**.
- Historical earlier P064 immutable unchanged original HTTP enqueue 641660/638311/344238ms remains genuine long-tail RED not reproduced by this P066 experiment, not explained by P066's zero activity polls. **Do not merge** production Copy P064 #2136; no same-runner valid final 3-pair production acceptance and P064 branch stays Draft. Continue Issue #2153 only with newly named telemetry and exact attribution; do not relax 120000ms, cancel+50ms, SHA/RSS/CPU or archive away old failures.
- Source raw machine rows and three SHA-distinct sampled original/candidate observations with exact source and CI artifact digest now archived under [P066 immutable measured evidence](docs/performance-evidence/p066-original-post-lifecycle-enqueue/ci-run-39293101256.json); canonical registry/matrix/contract updated. This evidence amendment REBUILDS **one work commit** atop full newest master 1b3d30d3baccdbfc4f66d7f219d055d85f6dae35; preserves original P066 production/test/CI Git blobs and full unrelated AGENTS history. Its NEW SHA is not the previously validated source; before Ready/Merge must repeat **NEW exact-evidence-HEAD authentic 3x100k dedicated suite and complete 77+ CI/Final Gate** plus GitHub mergeable clean; do not reuse #39293101256 green as new-head certification. Do not change Race/IPC/Gallery/FileExplorer UI/public Share/ZIP/4GiB already accepted unrelated workloads.

## P066 · original physical 100k Copy lifecycle followed by second HTTP admission diagnosis (2026-10-20)

- **先说明已测原版**：P065 #2164已经合并，三份100k SHA不同物理CAS的初次Owner JWT POST 117.764 / 115.927 / 116.201ms，P50 116.201ms；但P065没有Copy Worker/Undo/Trash，250ms PG采样0次。P064 #2136真实原版后续POST曾出现641660/638311/344238ms，超冻结120000ms，根因未知；早期Copy Worker提速66–73%只是测试，不准生产合并。Desktop Gallery IPC #1185继续独立Draft。现有Performance specialization policy**早已要求**CURRENT→同环境n≥3 BEFORE/AFTER→明显收益且不退化才保留，无需重复添加全局规则。
- 冻结完整master@80f4c8642d90e57a80cbcdeaf39944c5cf08b4a5，tree=33b2f9b866a491408299e15a28cbe4e1352b7960，保留完整AGENTS历史。仅一份独立P066工作提交，修改原P056 Linux真实物理100k基准**测试结尾**可选测量：在真正的Copy Worker→Undo→Owner Trash purge和所有SHA/RefCount/磁盘核验之后，对同源空目标再发一次原版认证HTTP202 POST，复用P065已合入SQL类别trace及PG等待采样；再次入队任务必须Owner接口明确取消且保持目标/CAS不变。新增专属3份真实源CI、独立合同及性能登记簿/六平台矩阵，本条完整原AGENTS。绝不改生产Copy SQL/进度/Worker、Agent、图库、FileExplorer、Race、分享令牌或ZIP，保留所有其他工作者的PR/分支。
- **新维度目前CURRENT=Not measured n0，AFTER/speedup=N/A**。每样本必须100000不同SHA真实CAS+受保护原片，源不同，完整生命周期经过HTTP、原片校验、Undo、Trash，再次POST和队列取消。首/次两次原版HTTP都≤120000ms，Copy/Undo worker≤900000ms，原CPU/RSS/CAS/SHA/权限/回收与跨Server取消门槛不降低；真实RED/无效样本保留原始日志，不丢弃、不重复挑好样本。250ms聚合PG sampler或事后EXPLAIN不能单独说明请求内backend锁等待；查出根因后才另开同Runner交替n≥3 BEFORE/AFTER，至少20%实质收益并满足取消额外≤50ms和完整性预算，否则Reject。已验收图库/Explorer 100k、大文件Web/Desktop 4GiB不重复跑同维度，不触碰Race主线。
- P066新PR保持Draft直至自己的准确HEAD3×100k物理专项和完整77+ CI含真PostgreSQL API Race测试作为gate、Win/Linux、Web/Desktop、Rootless、packages、单工作提交Final Gate、GitHub clean全部通过。源SHA变化时旧run不能替代新head。验收时先真实归档成功或RED证据才Ready/Rebase/Merge，合并后仅清理自己分支。P064原版慢尾Issue #2153维持open，P064仍blocked；当前不能声称本PR新性能结果。

## P066 · true 100k real native + full CI successful, upstream conflict-only single-commit reconstruction (2026-10-20)

- P066 previous exact one-work SHA `9d3d8e196e7d2507c916adc6135278248c52b401` passed **BOTH** independent real PG17/Gin/LocalCAS three 100k physical SHA-distinct original Copy→Undo→Trash→second Owner HTTP admissions [specialized #39360002298](https://github.com/lazyxu/xdrive/actions/runs/39360002298) and complete 77+ [CI #39360002911](https://github.com/lazyxu/xdrive/actions/runs/39360002911), including actual Go API PostgreSQL Race and Final Gate. These prior-SHA greens **DO NOT certify** this new commit. GitHub reported genuine dirty AGENTS.md conflict after three independent upstream PR merges to complete `master@c2656c401b7353bb7d1d6ab0d57d6981e70b7539`; compare confirms AGENTS is the only overlapping path. Preserve the exact six P066 non-AGENTS blobs, full latest master AGENTS content, all historic P066 notes, and one P066 work commit. This performance-only baseline adds **no runtime product optimization**; do not modify Race, maps, files, device backup, public share/ZIP, blocked Copy production #2136 or Desktop progress #1185.
- Retain original P066 BEFORE n3 first Owner POST P50 **133.703ms**, second POST after physical 100k Copy+Undo+Trash P50 **173.938ms**, original Copy Worker P50 **352330.019ms**, historical P064 original HTTP 344–642s tail still unexplained; AFTER/speedup N/A. Re-run entirely NEW exact rebuilt-HEAD n3 physical specialty + whole CI/Final Gate and confirm fresh GitHub clean mergeability before Ready/Rebase Merge. Only factual difference from previous source is append-only AGENTS history, positioned at end of complete existing policy so concurrent top-of-file handoffs will be less likely to conflict. Existing mandatory performance BEFORE→same-condition AFTER→reproducible material gain or reject policy remains authoritative.


