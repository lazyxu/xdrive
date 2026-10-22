# xDrive PWA CR-03b · 真实 Chromium IndexedDB 配额、事务回滚与版本阻塞回归

2026-10-22 · 第三阶段 P0/P1 组合可靠性：继续独立 [#2348](https://github.com/lazyxu/xdrive/issues/2348)。之前 [#2355](https://github.com/lazyxu/xdrive/pull/2355) 已合入，覆盖生产公共 SW + 真 Chrome A/B/C + P1 离线目录/相册 TTL/坏 schema/IDB 驱逐；[#2349](https://github.com/lazyxu/xdrive/pull/2349) 则独立覆盖真实 Gin/PG17 Owner ACL。**本 PR 只新增非生产隔离浏览器测试/源码契约/专项 CI/文档，无生产代码改动**。

## 新增的独立物理浏览器证据

- 用真实 Chromium 390px、生产 Vite `web/dist`、正式 `sw.js` 与一个自动创建的本地 Loopback Origin；等待原生产 SW 自然注册/激活并接管页面，真实 IndexedDB 中单个 synthetic Owner 先明确授权并保存小范围目录+相册摘要。**该 synthetic Owner 不等于 Go JWT/ACL 证明。**
- 通过 Chrome DevTools Protocol 的原生 `Storage.overrideQuotaForOrigin` 把**此测试 Origin** 配额压低到 1024 字节，另以原生 `Storage.getUsageAndQuota` 验证 override 确已生效，直接调用现有 P1 写函数，要求 Chrome 真正返回 `QuotaExceededError`、P1 Promise 拒绝、失败的新历史不可被当作已授权或实时目录。这是可控 Chrome 配额注入，不代表用户生产磁盘已满；绝不伪造 JS `DOMException` 来骗 PASS。
- 恢复配额后，测试一笔**真实 Chrome IndexedDB readwrite transaction**：向当前 Owner Scope 写入坏历史再同步 `transaction.abort()`，要求浏览器真实发出 abort，原 P1 读函数依旧只看到未被提交的旧摘要、`revalidated=false`，不出现半写的数据。
- 保持原 IndexedDB v1 connection 存活，在第二连接发起 v2 升级，验证实际 `IDBOpenDBRequest.onblocked`；关闭老 connection 后浏览器才升级。原 P1 v1 读取必须因为版本不兼容 fail closed，不能把未来版本任意记录重新解释成在线 Owner ACL。最后逐项检查公共 SW CacheStorage 没有 `/api`、票据、原片、JWT 或私有缩略图。
- 源准确 HEAD Node /真实 native Chrome 专项与完整 77-job CI/Final Gate + GitHub clean 后才能合并。只上传脱敏布尔结果 JSON，不保存用户路径、Token、浏览器 Profile 或抓包。

## 仍未覆盖

HTTP 429/503 的真实 Go Owner 历史快照重验证、短读请求 Go `Context.Done`、跨标签并发 ACL 撤销/重放、OS 层真实文件损坏和物理 iOS/Android 均不因本 PR 完成。它们仍由 #2348 追踪。本项也不实施 P2-B 私有 Blob 缓存、不生成任何性能 AFTER、不自动删除旧公用 `/assets`；未知老 PWA 客户端继续安全保留。不可触达生产环境安全验收 **按用户决定跳过（未验收）**，代码级 Owner/ACL/隔离/恶意输入与 CI 门禁不豁免。

## 2026-10-22 · 首次精确 HEAD 专项 RED 与配额归因修订

初次 HEAD `326b868a` 的真实 Chrome / 生产公共 SW 专项 [#39746162850](https://github.com/lazyxu/xdrive/actions/runs/39746162850) **FAILED**：匿名结果 `phase=native-CDP-quota-overflow`、`AssertionError`，确认 CDP quota override 已生效，但 P1 小型捕获没有产生预期的原生 `QuotaExceededError`。不能将此记成生产 P1 漏洞，亦不能宣称 QuotaExceeded 已验收；真实浏览器、历史元数据和配额算法必须分别排查。

修订仅在隔离测试中增加独立的 **16MiB 原生 IndexedDB readwrite put**，在同一 Origin/Browser、CDP 配额限制下明确要求真正发生 `QuotaExceededError`。先得到这层可信底座，再检查原 P1 `xDrivePwaCaptureVisitedDirectory` 写入是否在配额耗尽后拒绝、有没有错误提交新历史；匿名结果区分 `nativeQuotaProbeError` 与 `productCaptureError`，不保存具体 User/文件路径、URI 或内容。原真实 SW、Owner 历史只读、事务 abort 与 `onblocked` 检查均保留，任何环节 RED 就不得合入。

即使 CDP 原生大写入成功触发配额，也不能从它推断 P1 元数据小写入必然失败；如果小写入成功，专项继续 RED，并以新观测决定是否需要设计更可复现的真实容量压力夹具，不放宽验收。以前旧 HEAD CI 的成功/失败不适用于新准确 SHA。

## 2026-10-22 · 下一准确 HEAD 的源测试假阳性阻塞

`43d38e21` 对应的真 GitHub Actions [#39747581342](https://github.com/lazyxu/xdrive/actions/runs/39747581342) 在运行真实 Chromium 前 **源契约测试即 RED**：旧测试仍要求驱动包含 `quotaOutcome.name==='QuotaExceededError'`，但该提交已经将真正 Browser 原生 16MiB 写入的 QuotaExceeded 单独归因，P1 捕获单独只要求真实拒绝；因此该旧字符串约束已不符合新的严格验收结构。修订仅把源测试断言改成新的拒绝表达式，**不放宽**真实原生 QuotaExceeded、P1 fail-closed、事务 abort 与 native blocked upgrade，也不改生产代码。旧 HEAD 的 CI 不能当作新 HEAD 的通过证据。

## 2026-10-22 · 真 Chromium CDP quota 仍未约束首次 IDB 16MiB 写入

准确 HEAD `59147b55` 的原生 Chrome 专项 [#39748010488](https://github.com/lazyxu/xdrive/actions/runs/39748010488) **FAILED**（不是功能验收）：匿名 summary `nativeQuotaOverride=true`、`chromeQuotaBytes=1024`、`chromeUsageBytes=2551548`，但第一次真正 16MiB readwrite IDB put **成功提交**（`nativeQuotaProbeAborted=false`），从未执行后续产品捕获及事务 abort/blocked。这说明 CDP 返回的配额状态与该批次真正 IDB 写入是否被拒绝并不等价，不能在报告中声称实现 QuotaExceeded 安全回归。

下一测试版本允许**最多四次、每次 16MiB**的原生独立 IDB 事务提交，中间用有界 500ms 间隔等待 quota manager 更新；只有某次真实事务 `QuotaExceededError` 后才进入 P1 写入失效测试。最多约 64MiB 本地私有测试数据，所有工作在自动创建/最终删除的隔离 Chrome Profile 上。仍不制造假 DOMException、不修改产品 IDB 代码、不放松失败门禁。若 4 次后 Chrome 仍不约束，专项保持 RED，后续需要独立的可控设备文件系统配额环境；此测试不构成通过。

## 2026-10-22 · 当前 CI 的可信分界：CR-03b Native abort/blocked 与 Quota 必须分列

最新完整诊断 HEAD `da6c5779` 的真正 Chrome [专项 #39749195924](https://github.com/lazyxu/xdrive/actions/runs/39749195924) **FAILED**：CDP 报 `quotaSize=1024 bytes`、真实 Origin 使用约 `2,551,548 bytes`，四笔独立的真实 16MiB IndexedDB 事务（每次后等待 500ms）**全部成功提交**：`nativeQuotaProbeAttempts=4`、`nativeQuotaProbeAborted=false`。因此不能声称已经产生 QuotaExceededError，也不能把后续 P1 捕获失败处理说成通过。

此后采用明确的两类结果，避免无限增加测试文件：原生 Quota 实际被触发时，必须同时测试 P1 拒绝和失败数据不落盘才允许标记 `realQuotaExceeded=true`、`productFailClosedOnQuota=true`；当前 Chrome CI **无法真正触发**时，必须报告 `quotaEnforcementUnavailable=true`，保留两个 quota 验收布尔量 **false**，跳过并注明 P1 quota 故障分支 `NOT TESTED`。两种路径都必须清理仅供测试的临时写入，恢复原 Owner 的已同意只读摘要，严格测试真正的 IndexedDB readwrite `transaction.abort()` 回滚、v1 持有连接时 v2 请求的真实 `onblocked` 及原 v1 读函数 VersionError fail-closed。只有这两种原生行为成功，才交付 **CR-03b 的事务/升级子项**。

**此设计没有完成 QuotaExceeded**：真实生产配额和失败清退独立保持 #2348 OPEN，待单独建立可信受限 OS 文件系统或能可靠施加配额的浏览器 Runner；不能把 CDP 屏幕上看到的 “quota override active” 冒充 IDB 实际拒绝。没有生产代码更改、没有 P2-B 缓存、没有自动删除旧 PWA hashed 静态资源。
