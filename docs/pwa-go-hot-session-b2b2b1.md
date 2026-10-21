# xDrive P0-B2b2b-1：真实 Go A→B→A、同一 JWT/Owner 与 Caddy Reload

日期：2026-10-21。依赖 P0-B2b2a [#2268](https://github.com/lazyxu/xdrive/pull/2268) 的真实 Caddy + 独立两代 Go/Web 兼容验证。当前为独立 Draft 增量，不做产品新功能。

## 为什么要做

B2b2a 已证明 Web A 可登录 Go B、Web B 可登录 Go A，但使用两份隔离 Gin fixture，不能证明旧浏览器**同一已登录用户**切换到新进程仍持有有效 JWT、Owner ID 和真实文件夹。B2b2b-1 因此改用历史真实 SHA `e6018a4c...` 编译 Go A / Web A，并从准确 PR SHA 编译 Go B / Web B，分别编译**正式 `cmd/server` 二进制**，不是 Node API mock 或 test-only API server。

## 实现与真实场景

- CI PostgreSQL17 **同一个测试 database** 和**同一个磁盘 CAS 根目录**；两台正式 Go server 共享一个测试 JWT HMAC key、数据库、账号、Root 和物理目录。必须先启动 Go A、正常使用正式 `admin create --password-stdin` 初始化一个合成账号（CI 专用），再启动 Go B。两台 server 的 `/api/v1/version` 使用真实编译链接变量分别返回 `pwa-b2b2b1-A`、`pwa-b2b2b1-B`。
- 使用原 `deploy/Caddyfile.common` 和正式 `deploy/pwa-archive-assets.sh`，真实 Caddy 2.10.2 Docker 二进制 `validate` / `run` / `reload`。仅在临时测试配置中，将原 `server:8080` 修改为对应 loopback Go A/B 端口，绝不修改仓库产品 Caddyfile。真实 Vite A/B 归档的懒模块按 SHA256/JS MIME/Cache-Control 校验；缺失文件必须 404 而非 SPA HTML。
- 390px 真正 Chromium 移动*模拟*登录现有 Web UI，读取 Root、`/me`，通过带旧真实 JWT 的原 Files API 创建一层真实目录，记录 Owner/Root/Node ID；旧页面保持打开，Service Worker 有真实 controller。
- **由外部 Node 测试控制器**，而非网页重载或手写 API 模拟，直接调用 `docker exec ... caddy reload` 将原 Caddy API upstream 从真实 Go A 切到 B。真实 Version 必须从 A 变为 B；旧页面用**完全相同 JWT**读取相同 Root、用户、文件夹都返回 200 且 ID 一致。再将 Caddy 回滚 A，旧 JWT 再次访问均须正确。
- 构建、实际系统浏览器、真实 Caddy、Go/Pg 运行日志在仓库 CI runner 中执行；只保存不含 JWT/用户名敏感值、测试数据库/CAS 字节的结果布尔和两个源码 SHA。脚本失败必须返回非 0；不能用生成文件伪装认证成功。

## 严格边界：尚未验证

**这不是 17 MiB 上传中的真实进程切换**。此阶段 A/B 两个正式 Go 实例均已启动、访问同一真实 PG/CAS/JWT，真实 Caddy API upstream 由 A→B→A 动态 reload，但尚不包含：旧 Go SIGKILL 进程后 B 承接同一进行中的上传 Session；8 MiB chunk0 后切换、浏览器长上传真正继续、最后字节 SHA256/Blob ref 物理读取；持久后台任务不误取消；SW `waiting` 双版本激活；真实生产 HTTPS；实际 iOS Home Screen Safari/真机 FCP 或 100k 数据 BEFORE/AFTER。

下一增量按 [#2269](https://github.com/lazyxu/xdrive/issues/2269) 优先做真实 Go 进程替换和 17 MiB 实体上传/断点续传完整物理校验与回滚，再做 P0-B2c 旧文件安全容量/存储寿命，P0-C iOS/Files/Gallery 100k 原始基线→小优化→同条件复测，最后 P1 受控 IndexedDB 只读离线快照与 P2 缩略图限额缓存。

## 合并规范与安全

- 独立分支、一个工作提交、保持已有 `AGENTS.md` 全文；父任务 B2b2a 必须先准确 HEAD 浏览器专项 + 完整 CI/Final Gate 通过并合入。随后在完整最新 master 上提交当前增量，确保未覆盖其他并行 Owner 的新改动。
- 本 HEAD 的真实 Go/Caddy/Chrome 专项和完整 Web/Desktop/Go Linux/Windows/真实 PostgreSQL Race/Final Gate 都要通过；GitHub fresh clean 后才 Ready/Rebase Merge；任何 CI 红灯如实标红，不放宽测试。
- 源码认证/授权/隐私测试必须继续。**生产环境安全验收按用户决定跳过（未验收）**：不会索取生产账号、AK、JWT/Cookie、抓包或人工生产验收。真实 iOS 设备测试若没有可复核数据也只能标记未验证，不能谎称加速。
