# xDrive PWA CR-01b3 · 两个旧窗口各自真实上传期间新版 SW waiting

日期：2026-10-22。关联仍 OPEN 的 [#2347](https://github.com/lazyxu/xdrive/issues/2347)。已合入 CR-01b1 #2358 验收一个真实 HTTP PUT 在途 + 两旧窗 SW waiting，CR-01b2 #2365 验收冻结版 Go/Web A→B→A、相同 PG17/CAS 与旧 lazy JS 可读。本增量进一步证明：**两张旧 Chromium 页面各自拥有不同且真正未结束的 HTTP 文件上传请求，两个 Go LocalCAS 写入真实并行**，而不是仅一个上传、第二窗口空闲的场景。

## 固定依赖与安全边界

仅增加新的 Browser/Go `_test.go`/Shell/CI/源契约与本 Markdown，不修改正式 `web/src`、`ui/shared`、`internal/api` 非测试产品代码、Caddy 部署配置、Service Worker、上传协议、CAS、数据库 schema 或 `AGENTS.md`。依旧冻结旧 Go/Web A `e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4`，B 为唯一 PR 准确 HEAD；专用 PostgreSQL17/LocalCAS、真 Docker Caddy TLS/H2、原生 Chromium 390px 2 张旧窗与合成 JWT，保留生产 Owner Root/API 权限。

## 原生双写入时间序列

1. 第一旧窗口先在冻结 Go A 通过正式 API 创建 17MiB 上传 Session，chunk0 8MiB 实际提交及持久回读。测试控制器 SIGKILL Go A，Caddy 真正 A→B reload；原 Owner/JWT、Session/Root 和旧 SW Controller/DOM 均不变。
2. 窗口 1 原生 `fetch(ReadableStream, duplex:'half')` 的 chunk1 8MiB PUT 先向 Go B 发送 512KiB 再阻塞。隔离的测试 Node 只读 Go 写出的真实 `.xdrive-upload-*` 临时文件，至少 256KiB、但不足 8MiB。
3. 在**另一张不同的旧受控 Chromium 窗口 2**，用当前同一 Owner 权限但**唯一的新 `resume_key`、目标文件名和实际不同的文件字节**创建第二条真正持久 UploadSession：独立 6MiB 文件，chunk size 正式支持的 8MiB、只有一个分块。其 PUT 同样发送 512KiB 前缀后阻塞。测试独立遍历这个仅测试容器的真实 LocalCAS，用 dev/inode 判定**至少两份不同文件**分别存在 >=256KiB 且小于 8MiB 的 Go 临时写入；单个 HTTP 请求、浏览器已 queue 的字节、CDP requestWillBeSent 或同一 Session 的两份 Promise 都不能蒙混过关。
4. 两个真实 HTTP PUT 都尚未结束且上述双物理写入还存在时，原子发布真 Web/SW B。两个旧窗口原 Document/Service Worker Controller 均不变，0 controllerchange，新 worker `waiting=installed` 稳定至少 600ms。此时再检查**两条浏览器 PUT 仍 pending** 和**两份不同 Go LocalCAS partial 同时存在**，失败直接 RED。
5. 之后才同时释放两份 HTTP Body。两个 Browser 都必须得到各自真 Go 201 和完全不同的分块 SHA/长度，再独立完成 17MiB 三块上传与 6MiB 单块上传，重试 finalize 不得产生第二个 Node；公共 SW 严禁存储 `/api`、原片、令牌、票据、缩略图或文件 Range。
6. 最后有**两个独立 Go 物理读回测试**：原 `TestPWARealGoHotUploadPhysicalPostflight` 验证整个 17MiB、File/Blob、原 Session 未重复；新增只读 `TestPWACR01B3RealSecondWindowPhysicalPostflight` 在同一 PG17/CAS 检查不同 `owner_id + resume_key` Session、不同 Node、文件版本与 ContentBlob RefCount，真正重读 6MiB 每个 CAS 字节，按 `(offset*17+(offset>>5)+7)%251` 独立计算完整 SHA256。一项失败不得设置 dual physical pass。

## 不可外推的边界

本专项只覆盖**同一 Owner 的两个不同历史受控窗口、两条实际未完成的独立 HTTP PUT 与 SW waiting**。两个不同账户同时上传、浏览器真正 Files file picker、Durable Task 及短请求 `Request.Context.Done` 互不干扰、B→A 的**其它**数据库迁移、慢网络与实体 iOS/Android 仍未验收，因此整个 #2347 继续 OPEN。真实生产环境安全验收按用户决定跳过（未验收），源码授权/CAS/安全 CI 必须通过。

只把不含敏感字段的 SHA/布尔计数 summary 上传 CI，原始 JWT/账号/Go 日志、浏览器 Profile、Upload IDs、CAS 路径、HAR 不进入 GitHub artifact。准确 HEAD 独立真实 Chrome/TLS-H2/Caddy/Go/PG17/CAS 双写入专项和 77-job 全量 CI/Final Gate + GitHub clean 均成功后才能从 Draft 合并；原 CR-01b1/B2 的旧 SHA GREEN 不替代本次验收。本专项不增加 P2-B 持久私人 Blob 缓存，不宣称性能 AFTER，不自动 GC 历史 hashed `/assets`。

## 2026-10-22 · 首次 CI 源契约 RED（未进入两条真实 PUT）

原准确 HEAD `ea9e8b2b` [双上传专项 #39758642382](https://github.com/lazyxu/xdrive/actions/runs/39758642382) **FAILED** 在 `Fail closed on unsafe or invalid harness` 步骤第 3 个静态 Node 测试：新增第二 CAS Go `_test.go` 按 CI 的 `gofmt` 格式化后变成 `local.Open(context.Background(), key)`，而源码契约仍匹配少了空格的旧文本 `local.Open(context.Background(),key)`。这只是工具本身字符串校验与 Go 格式化后的源不一致，**未执行双旧窗真实浏览器 PUT、双物理 LocalCAS 或 Go 6MiB Postflight**，不能写“通过”或“实际双上传失败”。

新准确 HEAD 仅修正该源码契约和本说明，六个文件范围不变，仍复用原 Chrome/Go/PostgreSQL17/LocalCAS、两个独立 UID/Session/ResumeKey/临时 inode、17MiB/6MiB 双完整 SHA 的全部强断言；初版 CI SUCCESS/FAILURE 不继承到新 SHA。历史已合入的 #2358/#2365 仍有效。

## 2026-10-22 · 第二次准确 HEAD 静态 Go 字符串契约 RED

`a8e08f83` [专项 #39759233050](https://github.com/lazyxu/xdrive/actions/runs/39759233050) 又在相同 **Node 静态源契约**第三项 RED：此前只修正了 `local.Open(context.Background(), key)` 的 `gofmt` 空格，但其余用于 `session.ChunkCount != 1`、`session.TotalSize != size`、`original[0].ID == session.ID`、完整字节公式和 `io.Copy(actual, physical)` 等 Go 断言仍使用未格式化文本。原静态测试只在**遇到第一个未匹配字符串后停止**，所以前轮未发现其它同类差异。本次一次核对全部 14 个真正 Go 源内容引用，确保契约的关键条件与已格式化 Go `_test.go` 每项一一匹配。依旧**未进入真实双窗口上传或 Go CAS 运行阶段**；正式 Go、SW、Caddy、PG17 均未改动，严格源级验证不放宽。
