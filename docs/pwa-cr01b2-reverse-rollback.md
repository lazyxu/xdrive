# xDrive PWA CR-01b2 · 真实 Go 与公开 SW 的 B→A 回滚专项

日期：2026-10-22。对应仍开放的 [#2347](https://github.com/lazyxu/xdrive/issues/2347)。继已合并 [CR-01b1 #2358](https://github.com/lazyxu/xdrive/pull/2358) 后，补充真正的**冻结历史 A→新 B→历史 A** 回滚，而不是把 A→B 的成功称为可逆部署兼容。

## 真实组合验证契约

这个增量仅新增测试驱动、Shell、源码契约、独立 GitHub Actions 与文档，**不修改**生产 Go/CAS/PostgreSQL schema、Caddyfile、Web、Service Worker、`AGENTS.md` 或上传协议。CI 使用原冻结历史源码 `e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4` 编译正式旧 Go/Web A、用该 PR **准确 HEAD** 编译正式新 Go/Web B。测试隔离 PostgreSQL17/LocalCAS、Docker Caddy 2.10.2 TLS/H2、原生 Chromium 390px 双窗口与临时合成 Owner/JWT。

1. 保留完整已验 CR-01b1：第一个 8MiB chunk0 在旧 Go A 实际提交、原 A SIGKILL、Caddy A→B 真 reload，第二块 8MiB 真实 Chromium streaming PUT 在途时新版 B SW waiting，两个旧窗口继续保留 A controller/原 DOM，随后释放、上传剩余第三块、在新 Go B 真 finalize 17MiB，原上传 ID/Owner/JWT/未重传 chunk0 与 SQL/CAS SHA 后验原样保留。
2. 直到新 B 确实提交全部字节并且旧 A Web 客户端关闭，新启动**另一真实冻结旧 Go A 二进制进程**（不能复用原 A2 活旧进程或 mock），连到完全相同、刚由 B 写入的 PG17/CAS。旧二进制拒绝新版数据库 schema、启动失败或 ready 不足即 **RED**，不能自动更换旧 A 版本或伪造“支持回滚”。
3. 测试控制器再次执行 Docker `caddy reload`，将原代理 B upstream 真正切到新启动的旧 Go A2。经公开 HTTPS/H2 外部 Origin 验证构建版本必须是 A，且旧 A 可使用原 JWT 读取 B 完成的真实 File/Upload（HTTP 200、同一 Node、upload finalized）。没有登录替换、没有回滚时清空数据库或复制 CAS。
4. 发布原 A 的 `index.html` 与 `sw.js`，只做隔离 Fixture 上的原子文件替换；已发布 A/B 哈希 JS/CSS 继续通过生产 `deploy/pwa-archive-assets.sh` 的**只追加**历史目录提供。用真实请求逐字节 SHA 验证旧 A 的一个动态 lazy JS 与旧 SW 完全匹配原构建。新打开的两个 B-controlled 页面在 A candidate waiting 时原 controller/原 DOM/0 controllerchange 均保持；两个旧 B 窗口关闭后旧 A worker 自然成为 active，再次读取原 Owner 真实 File 与 Upload，SW 仍不得缓存私有 API、令牌、原片、下载/票据。
5. 最后独立 Go TestPW A 物理后验重新读取 SQL/CAS 原 FileVersion、Blob RefCount 和 17MiB 每个字节；只有原始公开静态 A 文件、Go A2 和 B→A 真 HTTPS 代理回退全项成立，摘要才允许 `bToARollbackProven=true`。仅上传脱敏布尔结果与源码 SHA；私人 Go 日志、浏览器 Profile、测试账号/JWT、CAS 路径、Node/Upload ID 绝不上传到 Actions Artifacts。

## 范围和未覆盖

本专项只能证明**这一对明确冻结的旧版本 A 与当前 B 的受控回滚**。不能外推任意未来旧客户端、所有 PostgreSQL schema 向后兼容，不能保证真实 WAN/iOS Home Screen 长期离线的 SW 行为。若旧二进制对新 DB 不兼容，就留 RED 并上报确切代码级兼容缺口；绝不删除历史资源来规避。两个窗口**各自**持续进行 Browser 上传、Server Durable Task 与短 HTTP 请求的取消相互不误伤、生产 Files picker 仍属于 #2347 未验收子项。生产环境不可触达安全验收按用户决定跳过（未验收），Owner/ACL/CAS/安全真实 CI 不跳过。

**合并门禁**：必须使用当前精确 HEAD 的真实 Chrome + Caddy + 两版正式 Go/Web + PG17/LocalCAS 专项、完整 77-job/Final Gate 和 GitHub fresh clean，源码/CI 有 RED 就保持 Draft；不从历史 CR-01b1 GREEN 推断本次回滚通过。没有 P2-B 私人 Blob 缓存、没有性能 AFTER、没有静态资源自动 GC。

## 2026-10-22 · 第一版独立 CI 源契约 RED（没有进入真实回滚测试）

首次原 HEAD `f1ec0e08a3e75599d62aa647bca15ff2829f9f57` 的 [真实专项 #39752686337](https://github.com/lazyxu/xdrive/actions/runs/39752686337) **FAILED**，定位为 Node 源契约第四个测试中的 `assert(!workflow.includes('HAR'))`：完整 Actions 文件只是在注释中写明“不把私人日志和 HAR 上传”，它并未把 HAR 文件列入 `actions/upload-artifact` 的 `path:`。此 RED 发生在构建/真实 Chrome/Caddy/Go 前，**不表示 B→A 兼容性通过或失败**。修订只把源码断言改为检查**实际 artifact 上传路径**不包含 `.har`、`private-go`、`browser-profile`，依然只允许脱敏 `summary.json`；不会更改产品 Go、Caddy、SW、CAS/PG 或任何真实回滚硬条件。

新工作仍采用原真实旧 A SHA、最新完整 master 上一份五文件测试提交，源准确 HEAD 的专项、全部 77-job Final Gate 和 fresh clean 均需要重新跑。之前的 RED 不能计为本轮真实回滚结果。
