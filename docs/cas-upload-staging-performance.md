# CAS-A02b / S001-e · 4GiB首次上传分片暂存 vs 离线直接分块提交 A/B

## 当前阶段与原版基线（2026-10-16）

状态：首轮真实离线n3通过，原版/Candidate同源CURRENT已测；生产 AFTER=N/A；证据修订新HEAD验收待完成。仓库 lazyxu/xdrive；冻结 master@37115c7d1d3cfb767c305fe8993b4834bb6b2139，短期分支 perf/cas-a02b-offline-first-upload-staging-20261016；单个test-only工作提交，不改生产上传/下载/Blob/GC/同步/权限或Race。

已验收的CAS-A02a是真实Web→Gin/PostgreSQL17/Local CAS不可压缩4GiB首次上传（[原始CI #38846688152](https://github.com/lazyxu/xdrive/actions/runs/38846688152)）：512个8MiB分片stage和4GiB完整组装临时同时在盘，st_blocks峰值8,589,938,688B=2.000000954×，Go写盘8,589,934,592B=2.000000×。原版符合原本≤2.35×容量/≤2.50×写盘预算，故没有优化生产代码。已有CAS-A03-d2小修改版本、CAS-A04b两代备份是不同负载，不能代替本项。参见[中央登记簿](performance-test-registry.md)、[架构审查](blob-cas-dedup-architecture-audit.md)、[六平台表](performance-platform-coverage.md)。

## 新同源物理 A/B（仅离线文件数据布局）

1. 由固定SHAKE-256伪随机种子生成真正非稀疏4,294,967,296B高熵实体源，按8MiB拆成512份真实fsynced上传stage。三独立种子n3；每样本Baseline/Candidate重新生成相同内容，按样本奇偶交替测试。seed时间和内核写量分列，不能把预备阶段混入finalize wall。
2. Baseline采用现有分片+整份拼装的独立文件布局模型：每片原始bytes按顺序流式写新4GiB临时文件并fsync、rename，测实际stage+full-temp并存峰值、kernel write_bytes、CPU/RSS，完整SHA及40次真实64KiB随机Range。此段重现现有2×I/O结构但**不直接运行Gin/Local.Put**，不同于CAS-A02a真实生产数据。
3. Candidate把原生stage每片独立计算SHA、按hash原子rename至离线objects目录，写入fsynced不可变Manifest（有序chunk SHA、完整文件SHA与真实size）。对全部chunk重新串流SHA、验证同一随机Range；再额外重建4GiB连续平面文件+fsync+SHA，单独测实际写盘和恢复耗时；最后清理全部对象确保物理0。**平面兼容重建的额外写盘绝不忽略**。

冻结判定：每源512物理part、两arms完整SHA一致/不同样本SHA不同、全部40 Range和重建SHA正确。Baseline峰值至少2×4GiB，kernel writes(stage+finalize)至少8GiB；Candidate峰值最多1.01×4GiB，写盘(stage+commit)≤Baseline60%；额外平面物化确实新写至少4GiB。三组每阶段stage≤240s、finalize≤180s、flat materialize≤180s、进程RSS≤512MiB。无效夹具、runner磁盘不足、断言不成立必须真实标记 Invalid harness或Measured RED，不能凭设计预测accepted。

专用[n3工作流](../.github/workflows/cas-a02b-first-upload-staging-offline.yml)先用64MiB实物smoke再按独立进程执行三组4GiB；记录原始sample-1/2/3.json、stdout、资源、source exact SHA和summary，首轮成功后在同一唯一工作提交归档至 docs/performance-evidence/cas-a02b-first-upload-staging/，重新跑准确归档HEAD专项和全仓CI/final-gate后才Ready/rebase合并。

本实验未使用生产Local.Put、HTTP/Gin/PostgreSQL或任何真实Web/Desktop/PWA上传；在线ContentBlob、Owner权限、FileVersion、GC、云存储、HTTP Range、视频Seek、CfAPI/FUSE与多代恢复均没有被离线layout证明。结果只能作为是否进一步研究安全chunk/manifest旁路存储的证据，绝不将它直接合并为产品优化；耐久上传/下载/同步/删除不能被界面视口取消。

开源参照：[restic](https://github.com/restic/restic/blob/master/doc/design.rst)分块/快照提交；[Kopia](https://kopia.io/docs/advanced/architecture/)多层CAS/manifest；[Seafile](https://manual.seafile.com/14.0/develop/data_model/) block引用。具体产品优化需保留xDrive完整SHA-256 Blob身份、跨Owner安全和原子可恢复性。
## 首轮真实4GiB source-exact n3结果（2026-10-16，原生产未改）

源提交 84fc5684a556b4a895deddbb91c758f42c509a3e 的[专项CI #38905016820](https://github.com/lazyxu/xdrive/actions/runs/38905016820)成功，三组真实非稀疏4GiB SHAKE-256高熵源/每组512×8MiB fsync staged chunks、样本2候选优先，其余原版优先。64MiB smoke成功但不计入真实n3。同一个源两次分别重建physical stage，且两arms全文件SHA256/40个64KiB随机Range、候选额外4GiB扁平物化SHA正确，最终对象全删到0。

| 测量指标（同源离线，仅Linux FS） | 原版分片→4GiB平面拼装 | 候选分片→原子hash块+Manifest |
| --- | ---: | ---: |
| 实测物理峰值 st_blocks P50 | 8,589,938,688B（2.000000954×） | 4,295,004,160B（1.000008583×） |
| 写入总量 stage + finalize | 8,589,934,592B | 4,295,004,160B（0.500004292×） |
| Finalize阶段P50 | 16,305.935ms | 8,229.359ms |
| 候选flat恢复额外写量 / P50 | N/A | 4,294,967,296B / 15,422.271ms |
| 三样本最大进程RSS | — | 37,796KiB |

**结果判定：Accepted Offline experimental capacity/IO evidence，生产AFTER=N/A，生产性能提升=N/A。** 虽然离线写量几乎减半，但不能替代当前Gin/Local.Put下的4GiB HTTP端到端测量，不能忽略重新物化完整4GiB的物理IO成本；安全版本恢复、多账户引用与其他Store不可凭模拟承诺。

永久登记 [original exact summary/source + 三样本关键数字和源JSON SHA](performance-evidence/cas-a02b-first-upload-staging/README.md)；完整原始11文件由原CI Artifact #12047453131保存（ZIP SHA256 e6eb4ea2e6dc302d51a06d21450a9fbad9b1a756f783257b31fdb82a41998238，有限保留）。附带在对话的tar.xz另有SHA256 66b63ec5e0533f2544b0f33d457951de0af2183fe2493b268dc03fff6400b98b；仓库内永久numeric+source SHA，并**没有冒称完整二进制原始ZIP已存入Git**。记录本次修订后还要新HEAD专项/完整FinalGate，才能考虑合入。原测负载是离线布局模拟，并非针对产品的实际优化A/B。


## CAS-A02c / S001-f · 真正4GiB重复内容在同Owner秒传与跨Owner上传后的物理去重（2026-10-17）

**Status: Planned / original CURRENT Not measured (n=0); production AFTER=N/A.** This is a NEW authenticated owner boundary, not CAS-A02a's first 4GiB upload, CAS-A02b's offline block/manifest layout, CAS-A03-d3's 1MiB modified version or CAS-A01's 100k identical references. Freeze the original production baseline first. The accepted first-upload CAS-A02a historical CI reported 8,589,938,688 B stage+assemble allocated (2.000000954×) and 8,589,934,592 B Go kernel writes (2×); do not compare those independent runners to this new run as an optimization.

**Real path and fixed dataset:** 3 independent Linux PostgreSQL17 isolated schemas and Local CAS roots, each one unique high-entropy AES-CTR full 4,294,967,296 B SHA-256 source, 512 actual HTTP PUT requests of 8MiB through production Gin to create Owner A's first CAS. Next, Owner A creates a second logical File by authenticated upload initialization **without any new PUT** (must set `instant_cas_reused=true`). Owner B, who knows the same digest but does **not** own the Blob, must obtain an ordinary active upload session and send **another 512 real 8MiB PUTs**, with no cross-Owner instant-upload leak. Owner B finalizes into the existing canonical full SHA CAS: verify all 512 truly allocated physical stage files before finalize, 0 stage files/SQL parts after, exactly **one** allocated CAS inode after both Owners, full byte SHA, `ContentBlob.RefCount=3`, other-Owner 404, Owner A two reference releases leave Owner B's actual bytes intact, and last Owner B release physically GC's the single CAS to zero. The prior 4GiB prehash, 64MiB smoke and full post-timer SHA are measured/excluded separately from the transfer times.

**FROZEN original budgets before first genuine sample:** A initial real complete upload ≤360s; Owner-A instant ≤30s, 0 new HTTP PUT and ≤1MiB Go PID kernel write_bytes; B entire 512 PUT upload ≤360s; B finalize ≤360s and ≤64MiB **Go-process** extra physical write_bytes (not independently measured PostgreSQL IO); all three Owner deletions and final GC ≤180s. For B, 25ms peak Go process RSS growth ≤512MiB and monotonic CPU ticks; stage `st_blocks×512≥4GiB`, first and after B single CAS physical bytes `≥4GiB`, no duplicate CAS, no leaked physical stage, SQL references/Owner isolation and complete SHA MUST pass on **all n=3**. Measure the stage+CAS allocation immediately *before* finalize, but do **not** mislabel it a continuously sampled peak or count DB WAL in Go write_bytes. Failed infrastructure/fixture is **Invalid harness**, not an optimization RED.

**Execution / evidence:** source `internal/api/cas_a02c_real_http_owner_reuse_4gib_performance_linux_test.go`; independent branch-only [native CI](../.github/workflows/cas-a02c-real-http-same-cross-owner-4gib.yml) first compiles, runs 64MiB actual Gin+PG+Local smoke (excluded from n3), and then three source-exact 4GiB real runs, capturing original JSON, Go log, process time/RSS and source SHA. Command for each sample: `XD_CAS_A02C_REAL_HTTP=1 XD_CAS_A02C_SAMPLE=sample-1 XD_TEST_DATABASE_URL=postgres://... go test -mod=readonly ./internal/api -run '^TestCASA02CRealHTTP4GiBSameAndCrossOwnerReuse$' -count=1 -timeout=32m -v`. Permanent numeric/raw evidence goes to [CAS-A02c evidence](performance-evidence/cas-a02c-real-http-owner-reuse-4gib/README.md) with the [central registry](performance-test-registry.md), [six-platform table](performance-platform-coverage.md) and [Blob/CAS audit](blob-cas-dedup-architecture-audit.md) in the **same one-work-commit PR**. After genuine valid n3, amend evidence (preserve failed samples), rerun the final exact-head specialized and complete 76-job CI/single-commit/final-gate before Ready/Rebase merge.

**Decision:** If CURRENT meets budgets, **keep production unchanged, AFTER=N/A**. If reproducible real production RED, archive BEFORE and only then trial a minimal performance-only correction, same source+runner alternating n≥3, requiring material improvements without regression to isolation/refs/SHA/recovery/CPU/RSS/IO. This Linux Server authenticated HTTP layer is **not** desktop Electron Agent, Web OPFS, mobile device, any OS-installed PWA, WAN or 100k file GUI; all six platform rows for this exact new workload remain **Not measured**. Do not touch Race, UI-only abort scope or user-owned durable task cancellation.


### CAS-A02c first source-exact CI Invalid harness (2026-10-17)

[Scoped native CI #38970735889](https://github.com/lazyxu/xdrive/actions/runs/38970735889) failed at **gofmt -l of newly added test source** before compiling, before 64MiB smoke and before any 4GiB true physical sample. Valid baseline n=0 / original CURRENT=Not measured / AFTER=N/A. This is formatting of a test fixture, **not** a product performance regression. The next exact-head specialized diagnostic prints `gofmt -d` then rejects noncanonical formatting; apply only that precise difference to this one new Go test without altering physical dataset, CPU/RSS budgets, Owner/cross-Owner privacy or Blob/GC invariants. Old full-PR CI cannot attest a rewritten head.

**格式诊断和最小修复（2026-10-17）：** 之前的 [全仓 Go Linux #38970735971](https://github.com/lazyxu/xdrive/actions/runs/38970735971) 于 `gofmt -d` 实际打印了本次唯一新Go测试 `map[string]any` 字段空白对齐与 `-` 运算符间距差异；该错误与专用 #38970735889 为同一个源码格式 Invalid harness，**非两个独立的生产失败**。按真实 hunk 精确替换，测试语义、4GiB源和冻结预算不变；该版本须重新通过实际64MiB smoke/4GiB n3和完整FinalGate。

### CAS-A02c first 4GiB source-true but **Invalid harness** #38971379131 (2026-10-17)

Dedicated [CI #38971379131](https://github.com/lazyxu/xdrive/actions/runs/38971379131) **passed Go compilation, authenticated 64MiB smoke, and the first genuine 4GiB Owner A/B upload HTTP PUT/finalize**. The first full-sized source then failed a test-only metric comparison **before** its remaining SHA/Owner last-reference GC assertions, so **valid complete 4GiB n=0; do not report a full pass or production regression**. Actual scanner `p046PhysicalInventory` sums **logical `ManagedFile.Size`** = 4,294,967,296 B, while `casA03D3Allocated` measures Linux **allocated `st_blocks×512`** = 4,294,971,392 B: the expected 4KiB physical filesystem padding was incorrectly treated as a second CAS. Both counts showed exactly **one original immutable CAS**, not an extra object. Fix ONLY this benchmark assertion to require `WalkManagedFiles` logical bytes==4GiB and independent `stat st_blocks` allocated bytes==initial same source; add separate machine JSON fields. Preserve frozen old budgets/Owner privacy/full source SHA/GC, and rerun a new exact-head n3+full CI. This is **Invalid harness / mixed-units audit**, not product RED. The prior gofmt invalidity is separate but already repaired.


### CAS-A02c source-exact FIRST VALID full-4GiB CURRENT n=3 (2026-10-17)

**CAS-A02c valid original CURRENT n=3/3 ([native specialized CI #38971859757](https://github.com/lazyxu/xdrive/actions/runs/38971859757)); production unchanged, AFTER=N/A, speedup=N/A.** 3 fresh independent true non-sparse 4,294,967,296B distinct high-entropy SHA sources; per group A real 512×8MiB authenticated PUT, same Owner A instant second File 0 new PUT / kernel write 0B, other Owner B forbidden hash-only instant and required true 512×8MiB PUT (4,294,967,296B), B stage real physically allocated 4,294,967,296B; after B finalize one SHA-preserved actual immutable CAS allocated 4,294,971,392B (logical 4,294,967,296B). 3 real File references / ContentBlob.RefCount=3, cross-Owner node 404, A releases twice keep B readable, B last Owner release to 0 CAS/files, full physical SHA intact and zero SQL/stage leaks. **No product code modification or demonstrated optimization.**

| Separate independent true 4GiB source | sample-1 | sample-2 | sample-3 | n3 P50 |
| --- | ---: | ---: | ---: | ---: |
| A first complete HTTP upload/finalize (ms) | 31687.422 | 31925.274 | 31800.751 | **31800.751** |
| Owner A same-hash true instant only HTTP init (ms) | 11.397 | 11.182 | 11.240 | **11.240** |
| Owner B full 512×8MiB actual PUT and stage (ms) | 13026.537 | 12992.908 | 13381.574 | **13026.537** |
| Owner B true physical CAS reuse finalize (ms) | 10959.714 | 10820.202 | 10864.469 | **10864.469** |
| Owner B Go process finalize kernel write_bytes (B) | 0 | 0 | 0 | **0** |
| B stage physically allocated before finalize (B) | 4294967296 | 4294967296 | 4294967296 | **4294967296** |
| One immutable CAS physical st_blocks after 3 refs (B) | 4294971392 | 4294971392 | 4294971392 | **4294971392** |
| 25ms sampled Owner B Go peak RSS growth (B) | 1830912 | 1941504 | 7323648 | **1941504** |
| Release all three real references + last-Owner GC (ms) | 3776.183 | 3791.489 | 3781.828 | **3781.828** |

**Frozen gates all pass** (A 360s, instant 30s / 0 PUT / ≤1MiB writes, B full upload 360s, B finalize 360s/≤64MiB Go writes, final GC 180s, B RSS growth ≤512MiB and full authorization/SHA/RefCount/staging constraints). Measured Go CPU+RSS and full physical SHA verification timing are in each original sample machine JSON. Because the original is inside budget, keep the original production CAS and no speculative changes. B's 0B write_bytes applies **only** to Go PID's /proc/self/io during finalize, not the independent PostgreSQL process or an assertion that total host writes are zero. The three Owners share **one** physical CAS, not three. B's full 4GiB HTTP is a security necessity, not a bug to bypass. Independent existing CAS-A02a first-upload 2× staging write and CAS-A03 1MiB-different full-version space remain separate problems and were not optimized here.

**Immutable authentic evidence:** `ci-run-38971859757-verified-numeric.tar.gz` SHA256 `bae7c3c0442db884bdcd71bca4ff4a6f8bb46f65f0e5f9010addcbce7153ec13`, Git binary Blob (recorded in tree), containing all eight original sample JSON / CPU+RSS resource / source+summary files **byte-for-byte**, plus complete SHA manifest for all eleven originals. Full original eleven-file [Actions Artifact #12077815778](https://github.com/lazyxu/xdrive/actions/runs/38971859757/artifacts/12077815778) ZIP SHA256 `c39769ff530f9067513049d7aaf744c6754d931288a374891b33ecfed47891d2`; its three verbose Go logs are **only** in the expiring Artifact, not in this permanent numeric subset. `source.txt` records actual measured `HEAD=46e80a71734d4f4b0bc16943f6c7d7cf2d1031ae` (spelled EXACT_SOURCE_HEAD) and CI run. **Evidence publication creates a new work HEAD.** Exact-evidence-head specialty 4GiB n3 AND full standard CI/final-gate must be rerun before Ready/merge. All six real Web/Desktop/Mobile Web/installed PWA users of this exact three-Owner workflow are **Not measured**, because test is Server-only authenticated HTTP.

### CAS-A02c first archival SHA mismatch (2026-10-17)

**Evidence byte-transport Invalid harness (2026-10-17):** first archived-evidence [CI #38972876450](https://github.com/lazyxu/xdrive/actions/runs/38972876450) failed the new SHA256 **before** smoke/4GiB n3: initial Git binary object omitted one 4-character base64 group while transferring the 2,745-byte original numeric tar.gz. It is neither a storage-performance regression nor a new failed original n3. Fetched actual on-branch base64 and restored the missing 4-character group; verified corrected Git object SHA-1 **`952bfd1aa76ed4dc375750b7576d22045974511e`** equals `git hash-object` of the original local 2,745-byte archive, while original archive SHA256 stays `bae7c3c0442db884bdcd71bca4ff4a6f8bb46f65f0e5f9010addcbce7153ec13`. No test/production source changed; new exact-HEAD archive validation, true 4GiB n3 and full CI still required.

