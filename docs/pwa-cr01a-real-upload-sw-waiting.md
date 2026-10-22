# xDrive PWA CR-01a · 真正 Go/Caddy 17MiB 上传期间双窗口 SW waiting 组合验证

日期：2026-10-22。前置 [五阶段权威台账](pwa-five-stage-execution-20261022.md)，第三步 CR-01 的首个组合测试。上一增量 [#2273](https://github.com/lazyxu/xdrive/pull/2273) 已合入真实浏览器发送 17MiB 三块、首块持久化、SIGKILL 正式 Go A、Caddy 真实 B reload、原 JWT/上传 ID/块0 沿用、物理 LocalCAS 完整 SHA-256 回读；[S5-04A](pwa-s5-acceptance.md) 已独立验证真实 Chromium 多窗口旧 SW waiting，但其 POST 是**合成慢请求**。这两项**不能相加**冒充同一会话中真实上传与 SW waiting 已经联合验收。

## 本增量的真实组合场景

这是**真实 17 MiB** Owner 文件上传协议的可复核组合测试，不是合成几字节 POST。实体 iOS/Android 系统安装行为仍**未验证**；不会以受控 Chrome 390px 测试冒称物理平台已验收。

- 从历史独立源码 SHA `e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4` 编译正式旧版 Web + cmd/server Go A，从本 PR 准确 HEAD 编译新版 Web + cmd/server Go B，使用同一个独立 PG17 数据库、LocalCAS、JWT Signing Key 和正式 HTTP Upload API；真实 Caddy Docker 2.10.2、仓库 `deploy/Caddyfile.common` 进行 Go A→B 的 upstream reload；用既有官方 `deploy/pwa-archive-assets.sh` 只追加保存两版 hashed JS/CSS。
- 真 Chromium Mobile 390px 的第一个实际 Owner 登录窗口安装并由旧 Worker 控制，第二个同 Origin 窗口也由旧 Worker 控制。两者保存老 `controller` 对象及原 DOM identity、统计 `controllerchange`，不广播/记录 JWT。第一窗口以真正 `fetch` 发起 17MiB 三块上传，chunk0 8MiB 成功提交且 Go A/数据库可见，原上传 Session 为 `active`。**这里是块间仍活跃的浏览器上传会话，不声称 HTTP PUT 在 SW waiting 期间有一条不断开的长 TCP 流，也不是生产 Files 选择器 UI。**
- 实际 SIGKILL Go A、确认代理 502，再真实 Caddy reload 到活 Go B。测试 Controller 仅通过原 Caddy 主机挂载静态目录**原子**公布新版构建的 `index.html` 和 `sw.js`（同一目录下两版 JS 哈希文件已安全存档），不修改正式 SW 源码，也不增加测试后门消息协议。
- 第一窗口从真 Browser 调用已有 ServiceWorkerRegistration.update()。严格等待**实际新的 Worker 进入 `waiting=installed`**；两个旧窗口必须仍保持原 controller、原 DOM、不发生任何 controllerchange、无页面 reload。未鉴权 /api/v1/nodes/root 必须 401，SW CacheStorage 不得出现私人 API/缩略图/下载凭据。接着使用**同一旧页面、JWT 和原上传 Session**在 Go B 真上传块1/2、Finalize，并确保只写新块、重复 finalize 幂等。整个期间新 Worker 不得自动接管。
- 直到这两个旧窗口**全部关闭**才在同一 Chromium Context 中开新窗口，要求 waiting 消失、新 Worker active/controller 已接管，原件/私人数据没有进入公共 CacheStorage。最后用原独立 `TestPWARealGoHotUploadPhysicalPostflight` 重新读取 PG/CAS 的真实 FileVersion、Blob RefCount、每个非零源字节和完整 SHA256，不把前端响应 200 冒充真实物理提交。
- 保留原 17MiB/3×8MiB、Go A SIGKILL、同 Owner/原 JWT、Caddy/PG17/CAS 与 Final Gate，只有私有 Fixture 用固定假凭据，凭据与 Go 日志/浏览器 Profile/用户路径不可进入 CI artifact；上传的用户操作和 Server durable jobs 仍是不同生命周期，不自动 cancel 后台 Server Worker。

## 阶段与限制

本任务是 **CR-01a**：真实 API 协议的活跃多块上传 Session *与* 新 SW waiting、双窗口、真实 Go Caddy A→B/物理 CAS 完整性联合验证，首次实现要以本 PR 专项真实 CI SUCCESS 及 77-job 全量源 SHA CI/Final Gate 才能称为已验收。

它**并非生产 UI 的 Files 上传选择器**的 end-to-end，不能承诺 iOS/Android 锁屏/杀进程后继续传输；不覆盖**单个上传 chunk 正在 HTTP 网络飞行时**的 Worker 候选安装、在两个窗口中各自存在前台 Browser Transfer、跨 Caddy **B→A 回滚**以及正在运行的 Server Durable Task。这些要在 CR-01b 的独立测试中继续完成，不能标为已通过。本轮不修改任何生产 App/Go/SW/Caddy/IndexedDB/52px Frame/统一 Gallery/Files 源码；真实设备仍 `NOT RUN`，不可接触的生产环境安全验收「按用户决定跳过（未验收）」，源码安全、Owner/ACL/撤销与 CI 照常执行。

## 执行与证据

精确当前 HEAD 与固定历史 SHA 的两套生产 Web/Go 构建→Node Shell/源码负例→真 Chromium 390px/Caddy/Go/PostgreSQL17/CAS 专项→独立物理 SHA 后验→全平台 Web/Desktop/Go Linux/Windows/PostgreSQL Race/Final Gate→GitHub fresh mergeable clean→单工作提交 Rebase Merge。失败时只修 scoped 测试，保留其他 Owner/主线完整 `AGENTS.md`，不使用生产账号、HAR 或授权凭据。

## 2026-10-22 · 准确 HEAD 真实浏览器首次 RED 诊断（不可视为通过）

- 初次源 HEAD `b31544e8` 的真实专项 [#39715882085](https://github.com/lazyxu/xdrive/actions/runs/39715882085) 通过 Node/Shell 契约及真实 Web/Go A/B 构建；实际 SIGKILL Go A 后进入浏览器组合流程时因真实断言失败而 RED。不能凭此前独立上传/等待测试冒称组合成功。
- 后续准确 HEAD `c495a341` 真实 [#39716490788](https://github.com/lazyxu/xdrive/actions/runs/39716490788) 锁定故障：新版 Service Worker **已进入 waiting**，但接下来的原 Chromium 第一个旧窗口恒等式综合断言在脚本第 380 行失败（`phase=register-and-wait-new-SW`）。这尚不能区分 controller 实际变更、DOM 刷新、旧 SW 引用 wrapper 比较问题或统计计数异常。
- 本轮仅增加**无任何凭据、URL、上传 ID、Host 路径**的固定七个布尔量观测：controller/active 存在、active 是否等于 controller、原 controller 引用是否保持、DOM 是否保持、`controllerchange === 0`、新版是否仍 waiting。原综合严格断言保持不变，实际功能/安全生产代码和条件完全不变。只有下一准确 HEAD 的完整真实 Chrome/Caddy/Go/PG17/CAS 专项及 CI 终态才支持修复或交付结论；任何失败继续 Draft、不合并。

## 2026-10-22 · 源码准确 HEAD `3ac99753` 的真假候选 waiting 诊断（仍未验收）

- [真实 Chrome/Go/Caddy/PG17/CAS 专项 #39717276395](https://github.com/lazyxu/xdrive/actions/runs/39717276395) 在保留严格断言下再次真实 RED，固定脱敏布尔信息（首、次两个独立 Chrome 旧窗口）均表明：`hasController=true`、`hasActive=true`、`activeMatchesController=true`、`originalControllerMatches=true`、`documentMatches=true`、`zeroControllerChanges=true`，唯一 `waitingInstalled=false`。之前的 `waitWaiting()` 曾观察到 installed，之后 candidate waiting 不稳定；**没有证据显示旧 SW 强制接管、浏览器 DOM 重载或者两个旧窗口丢失 controller**。不得将单一时刻的 waiting 当成持久状态已验收。
- 新增的测试修复仅将 `waitWaiting` 后的**两个原始旧客户端** waiting 状态要求变为持续至少 600ms 的稳定观察（最长 20 秒）；观测过程中任何 controller、DOM 或 `controllerchange` 异常都立即真实 RED，不修改生产 SW、Go、浏览器或缓存，也不调用第二次 `reg.update()`、`skipWaiting` 或强制 reload。若候选始终不稳定，仍必须真实 RED 并留下固定字段的脱敏失败证据。
- 本准确 HEAD 的全套真浏览器与完整 CI/Final Gate 必须重新通过；上面的失败记录不会因源代码修复而被改写成成功。
