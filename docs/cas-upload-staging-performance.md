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
