# xDrive PWA · 五阶段剩余工作与验收台账（2026-10-22）

## 2026-10-23 · P0 可靠性最新真实交付（本节优先于历史记录）

> 当前事实以 master 的实际 PR Merge 状态与准确源码 HEAD CI 为准。历史 2026-10-22 段落保留当时失败、Draft 和实验结果，不得将历史待办当作仍未实现。仅源码级可控非生产 E2E/CI 可以计算为自动化通过；物理 iOS/Android 仍为 NOT RUN，无法访问的生产安全验收固定「按用户决定跳过（未验收）」且不阻塞源码、CI 或 PR。

| P0 | 当前真实状态 | 证据与剩余边界 |
| --- | --- | --- |
| 01：双真实上传、两个旧 SW waiting | **已合并** | [#2372](https://github.com/lazyxu/xdrive/pull/2372)：Chromium 双 in-flight HTTP/2 PUT，真实 Go 临时 CAS inode、17/6MiB 完整哈希及全 CI |
| 02：短 HTTP 取消与持久 Server Task 隔离 | **已合并** | [#2379](https://github.com/lazyxu/xdrive/pull/2379)：真实 Go Request.Context.Done + Handler 退出、独立 SQL FileOperation Worker 完成及 Owner ACL |
| 03：429/503 重新联网、Owner ACL | **已合并** | [#2378](https://github.com/lazyxu/xdrive/pull/2378)：真实 Gin/PG17/Chrome 受控 429/503、重新 /me/Node/one-row Range；不能把弱网当作授权 |
| 04：跨标签撤销、迟到响应 | **部分已合并，复合网络竞态待测** | [#2377](https://github.com/lazyxu/xdrive/pull/2377) fail-closed/广播隐藏；[#2389](https://github.com/lazyxu/xdrive/pull/2389) 阻断旧 IDB open/opt-in/目录及相册 capture 迟到写入；真实持有 HTTP 响应同时 SW/撤销的 E2E 仍缺 |
| 05：Native IndexedDB QuotaExceededError | **已合并 master** | [#2388](https://github.com/lazyxu/xdrive/pull/2388)：真实受限 tmpfs + Chromium 原生 `QuotaExceededError` + 产品写入失败/旧历史完整；准确 HEAD 专项 [#39809583156](https://github.com/lazyxu/xdrive/actions/runs/39809583156) 与全 CI [#39809583498](https://github.com/lazyxu/xdrive/actions/runs/39809583498) 双 SUCCESS，Rebase Merge `19a66bb9` |
| 06：IndexedDB 深层故障 | **部分完成** | [#2361](https://github.com/lazyxu/xdrive/pull/2361) 真 abort/blocked/VersionError；[#2377](https://github.com/lazyxu/xdrive/pull/2377) 迟到连接关闭、失败清退通知；任意底层磁盘损坏与所有 OS 错误并未全验 |
| 07：不同 Owner 同时上传 | **已合并** | [#2383](https://github.com/lazyxu/xdrive/pull/2383)：独立 Chromium 登录存储、两个真实 Go Owner、两上传和双方 Node/UploadSession 404 |
| 08：生产 Files picker 与两条在途上传/SW 升级 | **已合并** | [#2392](https://github.com/lazyxu/xdrive/pull/2392)：原 Files UI FileChooser、第三独立上传、SQL/CAS 完整 SHA、两条在途任务与旧控制器未受影响 |
| 09：升级、离线重连、撤销、取消的全组合 | **多项子场景已合并，单轮交叉竞态仍未完成** | 不能把上述分别成功的专项冒称「所有事件交错的同一次 E2E」；保留 [#2347](https://github.com/lazyxu/xdrive/issues/2347)/[#2348](https://github.com/lazyxu/xdrive/issues/2348) 的具体剩余部分 |

**后续依赖顺序**：真实 IndexedDB QuotaExceeded [#2388](https://github.com/lazyxu/xdrive/pull/2388) 已合入，禁止重复开发；优先以同一真实 Go/PG17/Chrome 组合 E2E 证明跨窗口撤权/登出恰逢在途旧 Range、SW waiting、Abort 时不能回填旧 Owner 历史，再收敛 #2347/#2348。其它 OS 底层磁盘损坏需要单独验证，不混称 QuotaExceeded 已涵盖。发布/保留策略另列 P1，不因未触及生产环境访问停止源代码开发。

**五阶段结论**：① P2-A2 跨原生 Chromium 进程真实 100k/115k CURRENT/BEFORE 已合并；② P2-B 私有持久 Blob 缓存决定暂不开发；③ 组合 P0 的真实配额门槛已完成，尚余同场交叉竞态；④ 性能 #2368 只有 BEFORE（首访 p50 2,849.398ms、重访 2,622.974ms），没有匹配 AFTER，不得声称优化；⑤ 历史公开 hashed assets 继续 append-only，safe_to_auto_delete=false，不自动 GC。已合入或废弃分支交现有安全分支清理 Action，不动其他 Owner 活跃 PR。

---

## 以下为截至 2026-10-22 的历史过程记录（保留当时状态，不是最新待办）



## 2026-10-22 · 最新 PWA P0 合并与剩余工作（权威，覆盖以下历史快照）

**源码事实已变化，不能继续把以下旧节中的 Draft / OPEN 记录当作当前状态。** 本节仅以 GitHub merged 状态和准确 HEAD CI 为准；新 PR 的真实专项通过不自动等于全 CI 通过或已合入。根 AGENTS.md 与其它 Owner 代码仍必须无损保留。

| 工作 | 已完成（真实 GitHub merge） | 尚未完成或最新 PR |
|---|---|---|
| 双旧窗口独立 17MiB / 6MiB 上传、public SW waiting | [#2372](https://github.com/lazyxu/xdrive/pull/2372) merge `52963344`；两个不同 Owner/独立 BrowserContext、双向 404、物理 PG/CAS 完整验证 [#2383](https://github.com/lazyxu/xdrive/pull/2383) merge `9d5233a2` | 与生产 Files 系统选择器同场景的真实组合 [#2392](https://github.com/lazyxu/xdrive/pull/2392) 仍 Draft；前准确 HEAD Chrome/Caddy/Go 专项成功，新同步 master 的 HEAD 专项与完整 77-job CI 须另外验收 |
| Server Durable Task / 短 HTTP `Request.Context().Done` 隔离 | [#2379](https://github.com/lazyxu/xdrive/pull/2379) merge `6eb0e9c2`；真实 Chromium 读取后取消和 Go/PG Worker durable completion | 不代表真实 iOS 锁屏持续上传、所有种类持久任务和跨副本 failover 已经验证 |
| HTTP 429/503 + 当前 Owner ACL | [#2378](https://github.com/lazyxu/xdrive/pull/2378) merge `00278397`，真实 Go/Gin/PG/Chrome 限流或暂时不可用后的 /me、Node、1-row Range 授权重验 | 与跨窗口撤销、待返回旧 HTTP 响应叠加的 race 仍需要完整组合 E2E |
| IndexedDB blocked/写失败/跨窗口广播清退 | [#2377](https://github.com/lazyxu/xdrive/pull/2377) merge `b6549562`，修复迟到 open 连接、失败清退和 UI 清空 | [#2389](https://github.com/lazyxu/xdrive/pull/2389) 延迟旧 opt-in/旧 capture 写入的 generation fencing 仍 Draft；旧 HEAD 77-job CI SUCCESS，新 HEAD 基于 master 需重新检查 |
| 原生 `QuotaExceededError` | #2361 已证明 Chrome transaction.abort/blocked/VersionError；#2377 增加确定性失败防护 | [#2388](https://github.com/lazyxu/xdrive/pull/2388) 真 Chrome 有界 tmpfs 专项首轮 **RED**，全零 22×8MiB 物理压缩后没有触发 quota；高熵/2GiB 独立测试修订仍需要自身准确 HEAD 真 QuotaExceeded 和 77-job CI，任何 UnknownError/物理 ENOSPC 不得伪称成功 |
| 10 万照片性能 | [#2368](https://github.com/lazyxu/xdrive/pull/2368) 100k logical / 115k physical 的 Chrome/Go/PG/CAS 原始 BEFORE 已合并 | 仍无同 Runner、同数据 n≥3 **AFTER** 和归因明确的生产优化；P2 私有 Blob 缓存依旧 not_planned |
| 公开 hashed 资源保留 | [#2357](https://github.com/lazyxu/xdrive/pull/2357) 只读容量/manifest 引用审计已合并 | 活跃旧客户端引用未知，`safe_to_auto_delete=false`；继续 append-only，禁止猜测式自动 GC |

**Issue 范围：** [#2347](https://github.com/lazyxu/xdrive/issues/2347) 和 [#2348](https://github.com/lazyxu/xdrive/issues/2348) 因部分交错 E2E、真配额与真实平台边界仍 OPEN；[综合 #2260](https://github.com/lazyxu/xdrive/issues/2260) 还含性能 AFTER 和长期资源策略。完成子项不应反复开发，混合 Issue 只收窄剩余。真 iOS 27 Home Screen / Android Installed 仍 `NOT RUN`；无法访问的生产环境安全验收按用户决定 **「跳过（未验收）」**，不阻塞源码、CI、PR 或合并，但 Owner/ACL/撤销/隐私负例必须执行。

---


## 2026-10-22 · 当前 GitHub 权威收尾状态（优先于全部旧快照）

旧记录中的「#2372 Draft、#2347 缺 Durable Task / 不同 Owner」「#2348 缺真实 Go 429/503」均已过期，必须以已合并的准确 HEAD PR 为准。**通过单独的真实自动化，不等于已完成所有交错 E2E**。

| 工作 | 最新代码和 CI 事实 | 仍未完成的独立验收 |
|---|---|---|
| CR-01b3 · 两个旧窗口均在途上传与新 SW waiting | [#2372](https://github.com/lazyxu/xdrive/pull/2372) 已合并；真实 Chrome/Caddy/TLS-H2/PG17/CAS 专项和完整 CI PASS，两个上传 17 MiB + 6 MiB 经 SQL/CAS SHA 后验 | 不涵盖原生生产 Files picker 或真实多任务同场交错 |
| CR-02b2 · IndexedDB 迟到 open、失败清退 | [#2377](https://github.com/lazyxu/xdrive/pull/2377) 已合并；精准 HEAD 完整 CI PASS | 不是原生 QuotaExceeded 或任意磁盘耗尽保证 |
| CR-02b3 · Go 429/503 和 Owner ACL 复核 | [#2378](https://github.com/lazyxu/xdrive/pull/2378) 已合并；真 Go/Chromium 专项和完整 CI PASS | 未覆盖撤权当刻多个已发出的旧 HTTP 响应同时返回 |
| CR-01b4 · HTTP Request.Context.Done 与 Server Durable Task 隔离 | [#2379](https://github.com/lazyxu/xdrive/pull/2379) 已合并；真 Chromium+PG17+Go Worker 专项和完整 CI PASS | 多 Owner / Files picker / 更新 / 离线四者同场交错仍需组合用例 |
| CR-01b5 · 不同 Owner 同时上传 | [#2383](https://github.com/lazyxu/xdrive/pull/2383) 已合并；两个独立 BrowserContext、不同 Owner、独立 UploadSession、真实物理 CAS 及双向 404 均经专项 + 完整 CI PASS | 两个隔离 profile 各有 SW 注册，不冒称共享一个注册中的两个用户 |
| CR-02b4 · 延迟同意和旧快照竞态 | [#2389](https://github.com/lazyxu/xdrive/pull/2389) Draft；生产 invalidation epoch 和可控时序单测在 PR 中，**未合并** | 新 HEAD 正确完整 CI、真实 Go/Chrome 同场并发失效 E2E |
| CR-03c · 真实浏览器 QuotaExceeded | [#2388](https://github.com/lazyxu/xdrive/pull/2388) Draft，准确 HEAD 全 CI 成功但真实物理 tmpfs 专项 RED | 实际 Chrome 返回 `DataError`，非 `QuotaExceededError`，测试旧历史不变及生产拒绝也尚未通过；绝不把磁盘压力或注入异常称 quota 验收 |
| P4/P5 · 100k 性能、旧公开 hashed assets | [#2368](https://github.com/lazyxu/xdrive/pull/2368) 真实 100k/115k CURRENT/BEFORE 已合并；[#2357](https://github.com/lazyxu/xdrive/pull/2357) 审计已合并 | 性能仍无同条件 AFTER；历史静态资产永不以无引用猜测自动 GC，`safe_to_auto_delete=false` |

总 [#2260](https://github.com/lazyxu/xdrive/issues/2260)、可靠性 [#2347](https://github.com/lazyxu/xdrive/issues/2347) 和存储 [#2348](https://github.com/lazyxu/xdrive/issues/2348) 在余项全部验证前继续保持 OPEN。原生 iOS/Android 安装态 `NOT RUN`。不可访问的生产专属安全验收长期标记 **按用户决定跳过（未验收）**，不索取凭据或生产抓包、不阻塞源码与 CI；Owner/ACL/Origin/CSP/跨账号/故障负例必须验收。

---


## 2026-10-22 · P0 继续修复与 PR 验收增量（高于下方历史阶段说明）

- **CR-01b3 / #2372 已合入**：两个旧 Chromium 窗口各有真实未完成的 17 MiB + 6 MiB HTTP/2 上传，SW B waiting 期间 Go/CAS 存在独立在途物理字节，最终 PostgreSQL17/CAS 双文件哈希校验通过；准确 HEAD 专项 + 77-job CI / Final Gate 成功，合并提交 `52963344e9cf128d2d00512a1fb637f211ad2569`。本段覆盖下方将 #2372 称为 Draft 的旧历史文本。
- **CR-02b2 / #2377 已合入**：被阻塞的 IndexedDB 迟到打开连接要关闭；`versionchange` 关闭旧连接；离线元数据清退/撤销失败时也广播跨标签 UI purge，不伪称持久字节已删除；撤销清空目录与相册展示并抑制过期异步结果。完整准确 HEAD 77-job CI SUCCESS、Final Gate SUCCESS；合并 `b654956244e80d4c9c27268d2b5ca1287aef8db1`。它是确定性存储故障注入和源码修复，**不是原生 QuotaExceeded/OS 磁盘耗尽通过**。
- **CR-02b3 / #2378 OPEN**：真实 Go HTTP 503 /me、429 Node、503 一行 Range 的浏览器授权恢复专项曾在准确 HEAD 成功；并发 stale replay、取消和完整 CI/最终合并须分别依据最新 HEAD 判断。
- **CR-01b4 / #2379 OPEN**：真实 Chromium AbortSignal→Go `Request.Context.Done` 与独立 Server FileOperation Worker 持久完成组合专项曾成功；同步主线后的准确 HEAD CI 必须单独成功才合并。
- **CR-01b5 / #2383 OPEN**：两个不同 Owner 的独立 Chrome BrowserContext、互访 Node/UploadSession 404、独立 CAS 物理后验已纳入单 PR 的真实专项；只有当前 HEAD 专项与完整 CI 全绿后才可以写「已完成」。
- **仍未完成**：原生真正触发 `QuotaExceededError` 的浏览器/文件系统负例、OS 真实磁盘故障、在旧响应仍悬而未决时切账号/撤权的可靠竞态、原生生产 Files picker 与双上传 SW waiting 同场 E2E、P0 全事件交错回归、100k 配对 AFTER。旧 /assets 维持只追加，P2 私有持久 Blob 缓存继续 `not_planned`。真实实体移动设备 `NOT RUN`；无法访问的生产环境安全验收 `按用户决定跳过（未验收）`，并且不阻塞代码级 CI 和 PR。

## 2026-10-22 历史快照 · 当时的源准确 CI 和合并记录

**仓库与方法**：[lazyxu/xdrive](https://github.com/lazyxu/xdrive)、根 `AGENTS.md`。先核查现有相关分支/PR，已合入或不再需要的由 [#2353](https://github.com/lazyxu/xdrive/pull/2353) 的统一安全 GitHub Actions 清理；不得误删 OPEN PR 头/基分支。受控真实 Linux Chrome/Go/PostgreSQL17/LocalCAS 回归替代不可触及的生产权限，不索取真实账号、JWT/AK、HAR、人工生产安全验收。生产专属无法接触部分始终记 **按用户决定跳过（未验收）**，代码级 Owner/ACL/撤销/CI 不得跳过。

| 工作 | 截至本次证据的准确状态 | 还缺什么 |
|---|---|---|
| **步骤 1：P2-A2** | [#2337](https://github.com/lazyxu/xdrive/pull/2337) 已合并，真 Chrome 两个不同 OS PID，同一 Profile/Go/PG17/CAS、100k/115k、n=3×3 | 无需重做基线 |
| **步骤 2：P2-B** | [#2322](https://github.com/lazyxu/xdrive/issues/2322) 按 not_planned 关闭；不增加持久私人 Blob 缓存 | 无法隔离重下资源占重访延迟比例，不能据此证明净缓存收益 |
| **步骤 3：P0/P1** | [#2344](https://github.com/lazyxu/xdrive/pull/2344)、[#2346](https://github.com/lazyxu/xdrive/pull/2346)、[#2349](https://github.com/lazyxu/xdrive/pull/2349)、[#2355](https://github.com/lazyxu/xdrive/pull/2355) 均已合并；真实单 HTTP PUT 在途双旧 SW waiting [#2358](https://github.com/lazyxu/xdrive/pull/2358) 真专项及全 CI 77-job/Final Gate 成功，合并 `04fa7d58`；冻结版本真 Go/Web/Caddy B→A 回退与原 Node/CAS/旧 hashed JS [#2365](https://github.com/lazyxu/xdrive/pull/2365) 真专项和全 CI 77-job 成功，合并 `cd60969f`；真实 IDB transaction.abort()/v1→v2 onblocked/VersionError [#2361](https://github.com/lazyxu/xdrive/pull/2361) 已合并 `0a97efa3` | [#2372](https://github.com/lazyxu/xdrive/pull/2372) 两个旧窗口各自真正上传 17MiB + 6MiB **仍 Draft/未验收**；Server Durable Task + Go 请求取消隔离、生产 Files picker、跨窗口 ACL race 及真实 HTTP 429/503 仍在 [#2347](https://github.com/lazyxu/xdrive/issues/2347)、[#2348](https://github.com/lazyxu/xdrive/issues/2348) OPEN |
| **真实 QuotaExceeded** | #2361 实测 CDP quota=1,024 B、Origin 已用约 2.55MiB，但四次真实 16MiB IndexedDB 写入均 **COMMIT**；真实 Chromium 专项虽验收事务/升级，`realQuotaExceeded=false` 和 `productFailClosedOnQuota=false` | 可信真正施加写入配额的隔离 Runner；绝不用假 `DOMException` 冒充通过 |
| **步骤 4：100k 性能归因 BEFORE** | [#2368](https://github.com/lazyxu/xdrive/pull/2368) 真实 Chrome/Go/PG17/CAS 专项 [#39756116252](https://github.com/lazyxu/xdrive/actions/runs/39756116252) + 准确 HEAD 77-job 完整 CI [#39756116142](https://github.com/lazyxu/xdrive/actions/runs/39756116142) SUCCESS/Final Gate，合并 `0c245949`，仅测量代码 | 无任何匹配 AFTER、无优化收益结论、无生产代码修改 |
| **步骤 5：历史公开资源** | [#2357](https://github.com/lazyxu/xdrive/pull/2357) B2c2 只读 Vite manifest 已知引用、缺失公开 hashed 资源、去重 inode 容量与软阈值统计已合并 `3f35b66e`；固定 `safe_to_auto_delete=false` | 旧离线 SW/HTML/lazy chunk 活跃引用、历史回滚窗口不能推断安全删除；继续 append-only，**不自动 GC** |

**P4-A 原生 Chrome 100k/115k 新 BEFORE 数值（#2368 的真实匿名制品）：**三组独立 PG/CAS 样本、9 组实际可见四张缩略图/两个 OS 进程，首次可见 p50/p95 为 **2,849.398 / 2,930.471 ms**，跨进程重访 **2,622.974 / 2,767.855 ms**，重访 Go 缩略图 HTTP **114 请求 / 80,730 响应体字节**。Chrome CDP 相同窗口测得 ScriptDuration p50 **118.252 ms**、LayoutDuration **2.621 ms**、RecalcStyleDuration **3.431 ms**、TaskDuration **183.815 ms**；可见后 `img.decode()` **剩余**等待 p50 **0.3 ms**，再经过两个 rAF 调度等待 **29.6 ms**。这些 CPU 分类互相重叠，不可加和为总时长；图片可见后剩余 decode 不是图片最初解码成本，两个 rAF 不是 GPU Paint 真实测量，ResourceTiming 的请求窗口不代表独立 TCP wire/网络关键路径。新增 CDP 探测亦可能引入成本，所以**不得将此轮数值直接与 #2337 的独立 CI 数字相减，伪称优化前后提速**。`optimizationImplemented=false`、`AFTER=null`、`privatePersistentCache=false`。

**P0/P1 仍开放而不是未做所有项目：**已关闭的历史 #2269/#2276/#2329 保持 completed，#2322 不计划实施；综合 [#2260](https://github.com/lazyxu/xdrive/issues/2260) 及复合 [#2347](https://github.com/lazyxu/xdrive/issues/2347)、[#2348](https://github.com/lazyxu/xdrive/issues/2348) 因仍存在明确未完成项继续 OPEN。实机 iOS/Android 安装态 `NOT RUN`；本轮不因此阻止符合源级 CI 的已完成 PR。

---



> 当前执行依据：`lazyxu/xdrive`、根 `AGENTS.md` 及现有 PR/Issues。本文记录**源码事实、准确 HEAD CI、是否合入、浏览器实测、性能 BEFORE/AFTER**；旧的 `docs/pwa-delivery.md` 2026-10-12 表格是历史快照，不能将其“待做”直接当成当前事实。此文仅记录、验收，不代表步骤 1–5 已完成。

## 2026-10-22 · 最新核验的准确合并与 P2-B 决策（优先于下文原任务状态）

| 阶段 | 当前权威事实 |
|---|---|
| P0 | 公共 Shell、版本等待与旧 hashed lazy JS 持久已合入；旧资源自动 GC **故意未实施** |
| P1 | 显式同意的有界目录与相册历史只读快照、实例/Owner 隔离及按需线上 ACL 重校验已合入 |
| **步骤 1：P2-A2** | [#2337](https://github.com/lazyxu/xdrive/pull/2337) 准确 HEAD `22c932a2a981806b6cf9e6d3316966809a0f8d3f` 真 Chrome A 进程退出→B 进程同 profile + 真 Go/PG17/CAS 专项 [#39712342797](https://github.com/lazyxu/xdrive/actions/runs/39712342797) **SUCCESS**；[完整 CI #39712342546](https://github.com/lazyxu/xdrive/actions/runs/39712342546) **77 项：25 SUCCESS、52 SKIPPED，Final Gate SUCCESS**；已 rebase 合入 `master@1cf0df6b82158f45c61a93d5ac4c7facd4f45400`；分支已自动清理 |
| **步骤 2：P2-B** | 在此真实 loopback 负载下**决定暂不实施私有持久缩略图缓存**，不是宣称不存在网络请求，也不宣称做过任何 P2 AFTER；高 RTT/弱网和“明确离线保留”必须另设有界需求和配对实验 |
| **步骤 3：可靠性组合** | **尚未完成** 上传中 waiting/跨窗口升级/回滚+P1 重连/撤销/损坏的组合 E2E；优先新增真实自动化而非盲目修改生产 App |
| **步骤 4：性能优化** | 对 100k 启动或 Gallery VirtualGrid/decode/render 先区分占比，按同一 Runner n≥3 BEFORE/AFTER 和成本门禁保留有明显收益的修改；当前此阶段没有 AFTER |
| **步骤 5：旧资产与文档** | 历史 /assets 只追加与只读容量审计已交付；活跃旧客户端的安全引用证明、人工预览与长期保留策略未闭环，**禁止猜测式自动删除** |

**真实同源 P2-A2 测量：**三组独立真实 Go/PG17/LocalCAS 100k 逻辑 / 115k 物理样本，原生 Chrome A 与 B 不同 OS PID、相同磁盘 Profile/Origin/Owner，每组 0/50/95% 的四个相同可见 Blob 图片，n=9。A 首次可见 4 张+2 rAF 的 p50/p95 为 **2417.266/2698.226 ms**；B 重启为 **2451.434/2626.517 ms**。A HTTP 缩略图请求 **110**、Go response-body **77,175 字节**；B **114 请求**、**80,730 字节**。这是**两个进程各自在三个视口上的聚合响应体**，不是独立每张图片的 TCP wire bytes 或其延迟占比；B 再次请求说明进程内缓存不持久，但测试没有隔离渲染/网络耗时，**不能由小幅 p50/p95 差异推断缓存收益，更不能将其标作 AFTER**。真实 iOS/Android 设备 `NOT RUN`、无法触及的生产安全验收 `按用户决定跳过（未验收）`，源码 Owner/ACL/撤销/CI 不能跳过。

## 0. 已验收、不重复开发

| 范围 | 当前源码/PR 事实 | 自动化边界 |
|---|---|---|
| P0 App Shell 公开静态预缓存 | #2246 已合入，hashed Vite Shell/App Header 52px、SW 公共白名单 | 不缓存任何私人 /api、照片、原件、Range、JWT/票据 |
| P0 旧 Chunk 持久与双版本 | #2252/#2256/#2262/#2268/#2271/#2273 已合入 | 旧 lazy JS 与真实 Web/Go/Caddy A/B、17 MiB CAS Go 切换测试存在；不可误记为待开发 |
| P0 公开资源只读容量审计 | #2276 已合入 | **没有自动删除历史 /assets**，无活跃旧客户端安全引用闭环 |
| P0 浏览器 CURRENT | #2277/#2282/#2286/#2294/#2296/#2301 已合入 | Chromium n3/n9 与真实 PG17/Go CAS；不等于实体 iPhone 或配对优化 AFTER |
| P1 只读目录快照 | #2303/#2305/#2306/#2314 已合入 | 默认不授权、每账号最多 10×20/200 项，7 日 TTL、192 KiB，实例/Owner 隔离，单目录线上重验证 |
| P1 有界图库相册摘要 | #2317 已合入（CI #39701670020 77-job PASS/Final Gate） | 最多 24 条已授权相册元数据，不保存封面/EXIF/原件/凭据 |
| P2-A 同进程真实 100k 基线 | #2325 已合入（专用 CI #39704278344、全 CI #39704280120 成功） | 100k 逻辑/115k 物理、390px Chromium n3×3；**同进程**重访 HTTP 0、响应体 0 字节 |

**P2-A 当前真实测值**：首次四张可见照片 decode + 两帧 p50/p95 `1528.098 / 1701.340ms`；同进程相同可见节点重访 `1498.226 / 1594.896ms`；九次重访新增请求 `0`，Go 响应体 `0 bytes`。Go 响应体不等于 TCP 全链路 wire bytes。该结果**不能推导**跨进程、持久缓存或手机设备的提速。

## 1. 第一优先：P2-A2 真正跨 Chromium 进程 CURRENT/BEFORE

**该阶段已完成合并与准确 HEAD 源码级自动化验收：[#2329](https://github.com/lazyxu/xdrive/issues/2329)、[#2337](https://github.com/lazyxu/xdrive/pull/2337)。以下条款保留为已执行的实验契约与后续回归约束，不代表仍待首次实现。**

- 按 `AGENTS.md` 先冻结当前完整 master、核对既有分支/PR；未合并优先继续旧 PR，已合入的临时分支不再新建重复 PR。
- 在**同一**真实 Go/Gin + PostgreSQL17 + LocalCAS fixture（100k logical/115k physical）、同一 Owner token、同一 Origin、同一 user-data-dir 下，启动独立原生 Chromium 进程 A，滚动 0/50/95%，每处记录四张**真实可见相同 ID** Blob 缩略图 decode 与两次 rAF、Server started/response_bytes。
- 完整关闭并等待 A 的 OS 进程结束，然后启动独立 Chromium 进程 B，复用磁盘 profile/Origin/Owner，在三个位置解码相同 ID；分开记录启动/首次可见/重访时间、p50/p95、Go HTTP 请求与已发送体字节、响应/失败、浏览器/Go RSS、缓存配额、是否为原生浏览器进程。
- n≥3 独立 Go 夹具×3 配对位置，严格源码准确 SHA，缺失指标直接 RED；不得把新 BrowserContext、新窗口或刷新称为跨进程。公用 SW 只缓存公开 Shell，测试不能引入 P2 私有 Blob 缓存。安全隔离、Owner/ACL 源码负例仍必测。
- **验收门禁**：准确 HEAD 真 Chrome+Go+PG17+CAS 专项 + Web/Desktop/Windows/Linux/Go API Race/Final Gate、GitHub fresh clean 后才 Ready/Rebase Merge。没有测量数据就不算完成。

## 2. 第二优先：P2-B 是否值得实现的决定

**P2-A2 CURRENT/BEFORE 已有可复核数据；当前决定不开发 P2-B**。以下内容只在高 RTT/弱网或明确离线访问新增需求并证明净收益时重新开启。P2-B AFTER=N/A，禁止宣称持久缓存已交付。

- 若跨进程仍命中、额外请求和字节≈0，或主要开销为虚拟列表/JS 绘制，则优先定位绘制、不要为提速引入 IndexedDB。
- 若跨进程重新下载真实缩略图且构成显著重复耗时/流量，再考虑 **默认关闭、单 Owner 明确 opt-in、只缓存已经授权且可见缩略图** 的有限 Blob store。32 MiB/128 张/单张 256 KiB 是待验证假设，不是已批准的优化参数或实测最优。
- 若实施，需真实逐字节容量、7 日以内 TTL、LRU、Origin/实例 UUID/Owner/revision 绑定，登出/撤销/切账户/实例清除、缓存失效/QuotaExceeded/IndexedDB 损坏安全降级、跨标签一致；禁止保存密码、JWT/签名 URL、GPS/EXIF、完整照片/视频/Live，禁止私人响应进入 SW CacheStorage。
- 必须有同一数据集/Runner/网络 n≥3 BEFORE/AFTER，改善清晰且 CPU/RSS/首启、请求取消不退化才保留；否则回退或明确记“决定不开发”。

## 3. 第三优先：P0/P1 组合可靠性（先测试、不盲目改产品）

- **CR-01** 已上传首块 17 MiB/更大浏览器前台任务→旧 SW waiting→多窗口仍忙→Go A/B Caddy 升级/回滚→内容 SHA 及传输历史一致；跨窗口和当前 Viewer/编辑不得发生自动 skipWaiting/强制 reload，Server durable 任务不可被前台浏览器取消误伤。既有分别通过的套件不能冒称这个组合已验。
- **CR-02** 同一磁盘 profile，在真实 Chrome 新进程与断网/弱网重连下，P1 Owner/instance 隔离、显式撤销、跨标签/切账号和旧快照清退；在线重验证失败不得将历史目录/相册升级为真实 ACL。
- **CR-03** 同一新版 SW Shell + P1 IndexedDB 存储故障组合：QuotaExceeded/事务 abort/过期/本地缓存被驱逐、401/403/404、Cancel/页面切换；不出现私有 CacheStorage，不触碰真实上传和持久任务。所有测试只使用隔离 fixture。

## 4. 第四优先：先基线→选择性能热点→同条件 AFTER

- 分离首屏 FCP、完整交互、网络请求/实际 Server 字节、Files↔Gallery p50/p95/CLS、真实 Go `ctx.cancel`、Renderer/Go RSS，包含 100k 图片/视频/Live **已存在的各自准确负载**。
- CURRENT 不是 AFTER。标注 runner、Chrome/Go 版本、准确源码、数据量、样本、缓存冷热及限速；优化在同配置至少 n≥3 配对，收益显著且无功能、安全、取消、成本回退才能保留。
- 不在已有 0 缩略图请求的同进程重访场景空泛宣称 IndexedDB 加速；若主要剩余是 1–1.6s 绘制，应对 VirtualGrid/decode/rAF 分析，避免增加预缓存。

## 5. 第五优先：历史静态资源与文档收尾

- 现有 P0-B1 公开 hash assets 归档是只追加，不自动 GC；只读审计已交付。下一步定义旧 SW/HTML/动态 Chunk 活跃版本引用、回滚窗口、保留容量软阈值、操作员人工预览/不可逆删除防护。
- **在有活跃客户端安全证明以前，不实现自动清除旧静态资源**。缺失/冲突/软链仍 fail closed，旧 Chunk 缺失应真 404 而非 index.html。
- 更新 `docs/pwa-delivery.md` 的权威附注，历史叙述保留以供复核；#2260/#2269 已合入部分不再报进行中。只关闭确实**全部完成**的 Issue，混合 Issue 保留未完成子项，不删除其他 Owner 正在开发的分支/PR。

## 恒定约束与真实边界

- Web/Mobile Web 仍共用 Files/Gallery/Viewer、Go Owner/ACL/Range 和虚拟列表；Mobile 全屏 Header **52px**，不重新做双后端/全图库预缓存；取消时 Go `Request.Context()` 应终止短生命周期请求，而不是取消 Durable Server Task。
- **真实 iOS/Android 安装/系统设备验收**单独保持 `NOT RUN`，不把原生桌面 Chromium 伪装成物理设备。ChatGPT 无法触达的生产环境安全验收长期统一 **「按用户决定跳过（未验收）」**，绝不索要 AK/JWT/Cookie/HAR/生产权限、也不阻塞源码/CI/PR；但代码级 Owner/Consent/撤销/Origin/CSP/跨账号/恶意输入负例必须完成。
- 必须先报告当前阶段、完成/未完成及准确 CI 证据；同一阶段优先原相关 PR/分支，已合入/废弃分支确认后清理；保证完整 `AGENTS.md` 与别的 Owner 的所有主线代码无损，唯一范围明确的工作提交通过准确 HEAD CI 才合并。
