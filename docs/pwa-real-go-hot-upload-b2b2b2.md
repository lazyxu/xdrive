# xDrive P0-B2b2b-2a：真实 17 MiB 分块上传跨 Go 进程 SIGKILL → 接管 → 物理 CAS 校验

日期：2026-10-21。依赖 P0-A/B1/B2a/B2b1 已合入、P0-B2b2a #2268 已合入；P0-B2b2b-1 [#2271](https://github.com/lazyxu/xdrive/pull/2271) 已完成同一真实 JWT/Owner/Directory 在两份完整生产 cmd/server 上的 Caddy A→B→A 兼容专项，需先通过自身准确 HEAD 全 CI 合并。此阶段继续 P0-B2b2b 的下一项，严格不进入 P1 私有 IndexedDB 或 P2 媒体缓存。

## 本次实现的真实场景

- 独立从不可变 A SHA（`e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4`）与本 PR 准确 B HEAD 构建真实 Web Vite A/B、正式 `cmd/server` Go A/B 两套完整二进制。真实 Caddy 2.10.2 加载原生产 `deploy/Caddyfile.common` 共享 `xdrive_app`，临时本地 upstream 从 Go A 转 Go B；历史/新资源全部通过原 `deploy/pwa-archive-assets.sh` 归档，原文件字节 SHA256/JS MIME/immutable 校验。
- 两个 Go 服务使用 **同一 CI PostgreSQL17 数据库、同一真实物理 Local CAS 根目录、同一个 JWT HMAC secret、同一个合成 Owner**。通过真实 `cmd/server admin create --password-stdin` 创建用户；实际 Chromium 390px 移动模拟使用当前 Web 登录页取得 JWT；先等真实 SW 成为页面 controller，无网络代理假 API/模拟登录。
- Chrome 产生真实 **17 MiB 非零确定性文件**（每个字节 `(i*31 + (i>>7)) % 251`），计算全文件 SHA256，真实 `POST /api/v1/uploads` 建立带 `resume_key` 和 8 MiB chunk 的原会话，将**第一块 8 MiB**通过实际 Chrome Fetch / Caddy / Gin 上传至 Go A，要求 HTTP 201/Chunk SHA256/Server `GET /uploads/:id` 原样单块记录。
- **在第一块已返回 201 且上传状态显示持久化后**，外部 Node 控制器直接向真正 Go A PID 发出 `SIGKILL`，确认旧端口不再服务、旧 Caddy upstream 真实返回 502；用真实 `docker exec caddy reload` 将 API upstream 切到独立已运行的 Go B，`/api/v1/version` 必须变为 B。旧浏览器页面不重载、不重登录、同一 JWT。
- Go B 必须从同一 PostgreSQL/Local CAS 读出原会话 ID 及仅 0 号 chunk；Chrome 以**相同 resume_key、SHA、父目录、大小**重新 POST，必须复用原 session ID，不能再 PUT chunk0。浏览器只 PUT chunk1 与 chunk2；最终真实 `POST /finalize` 返回该文件 Node 与相同 SHA。重复 finalize、重复 resume_key 不可产生第二个文件或 Session；任何差异直接失败。
- **另一个独立 Go `go test` 进程**（不是浏览器自报）直接查询真实 PostgreSQL 中原 UploadSession、Owner、Node、File、FileVersion、ContentBlob/RefCount，然后打开真实本地 CAS Key，完整读取 17 MiB 全体字节重新计算 SHA256；按相同公开公式在 Go 独立重建 17 MiB SHA256，必须同上传、DB 与 CAS 三方完全一致，并验证只存在一个原始 session。该 Go 检查成功后，才可写入匿名 summary 的 `physicalGoCASPostflight=true`。
- 严格审计 SW CacheStorage 无 `/api`、token、媒体/原件/上传；真实 Caddy 旧双版 lazy JS 必须返回正确 MIME、immutable 与原始 SHA256。任何失败都使 GitHub 专项作业 RED，保留真实失败状态。

## 特别说明：本阶段不冒充的能力

**本次使用真实浏览器 Fetch 按 xDrive 正式分块上传 API 协议上传，并非生产 UI 的 Files 上传选择器，也未执行生产 `XDriveApi.uploadWithConflictPolicy` 的完整前端 Transfer Store 状态机。** 后续 B2b2b-2b 要让真实 Files 上传组件在第一块之后发生同类真实 Server 故障，并核对 UI 失败/恢复/任务历史；必须区分 Server durable 任务与浏览器前台传输。旧 SW `waiting` 跨新版激活也需要独立专项。这里不声称浏览器锁屏后能继续上传、真实 iOS Home Screen Safari、真实公网 HTTPS 或 100k Gallery/FCP/p95 性能提升。

**物理安装 iOS/Android 测试尚未验证。** 本测试 Chromium 390px 仅是模拟视口。任何设备不具备直接可用的测试条件，应记为 NOT VERIFIED，不虚构测量结果。生产环境专属安全验收按用户决定跳过（未验收），不需要生产账号/AK/JWT/Cookie/HAR/权限，也不作为源码 CI/合并门槛。

## 分支、测试与后续路线

- 本增量先相对 [#2271](https://github.com/lazyxu/xdrive/pull/2271) 单工作提交、Draft；需上游合入后在完整最新 master 上重建并保留所有历史 `AGENTS.md`。本准确 HEAD 真实 Web A/B + 正式 Go A/B + Docker Caddy + PostgreSQL17 + Browser + 独立 Go 物理 CAS 专项必须成功，并通过完整 Web/Desktop/Go Linux/Windows、PostgreSQL API Race、发布产物、Final Gate 和 GitHub fresh clean，才可 Ready/Rebase Merge。
- B2b2b-2b：生产 Web Files 上传 UI/任务反馈/实际恢复，旧 SW waiting 双版。B2c：只读旧哈希 JS/CSS 生命周期/容量统计、不自动删除。P0-C：iOS PWA 启动、弱网/离线、Files/Gallery/Viewer 页面切换与 100k 图片/视频/Live 场景先基线→实际优化→同条件复测。P1：严格 Opt-in 受控只读离线快照。P2：有限缩略图 LRU 配额与隐私清理，绝不预缓存 100k 原图/视频/Live。

## 首次运行的 CI 源码契约失败与修正（2026-10-21）

首次准确提交 `ff1f18b270b4291eea8ba8a2c95f6d6d96bc1b28` 的 [专项 #39545974751](https://github.com/lazyxu/xdrive/actions/runs/39545974751) 失败于 Node 安全与文件连线检查：6 个 contract 中 4 个通过、2 个失败。真实双构建、浏览器上传、Go 进程终止与物理 CAS 尚未执行，不能认为已经证明真实上传失败。根因是 workflow 仍调用旧 B2b2b-1 脚本、指向旧摘要目录；另外一个测试断言与真实浏览器错误标签文案不一致。当前仅修正专用 workflow、shell 环境变量名称、源码防回归检查，严格保留浏览器/Go 物理 SHA、Caddy reload 等原有验收。旧红灯不能转写为绿灯，必须重新取得新 HEAD 的准确专项及完整 CI 成功证据。

## B2b2b-2a 第二轮真实 CI 前门检查（2026-10-21）

提交 `a9f49465c3f90d80e3376ea548f2a47a19a41b5f` 的 [专项 CI #39546699533](https://github.com/lazyxu/xdrive/actions/runs/39546699533) **失败**：6 个源码门禁中 5 个通过，剩余一项是测试断言使用“不是生产 UI 的 Files 上传选择器”，而文档实际使用语义相同的“并非生产 UI 的 Files 上传选择器”。已仅同步测试与文档的实际措辞，不放宽“非生产 UI”范围断言；同时修复测试容器的 Docker 名称由末尾字面 `$` 改为有效唯一 `$$` PID 后缀，并增设防回归源检查。本轮失败发生在构建前，未真正执行 Chromium / Go SIGKILL / 17 MiB / CAS 全量校验；绝不能误报网络连续性已通过。需以新的准确 HEAD 重跑真实完整测试、全量 CI/Final Gate 后才可合并。

## 第三轮源契约匹配问题（2026-10-21）

准确 HEAD `b92cbfc00ade8652c207a543f9db8b18d033ca0f` 的 [专项 #39547540226](https://github.com/lazyxu/xdrive/actions/runs/39547540226) RED：5/6 Node 源测试通过，余下只是在测试断言中，JavaScript `String.replace` 将替换字符串里的字面 `$$` 解释为一个 `$`，导致测试仍要求旧版无效的 Docker 容器名；真实 Shell 已正确使用 `CADDY_NAME="xdrive-pwa-b2b2b2-$$"`。本轮仅使源码契约精确检查两个字面美元符号，并保持对容器名称唯一 PID 后缀的强约束，禁止修改/跳过上传、Go SIGKILL、真实 Caddy 或独立 CAS 读回验收。此前三轮均在源码契约阶段停止，真实 17MiB 上传仍无成功证据；下一准确 HEAD 需真实跑完整 CI 并明确列出结果。

## 真实 17 MiB HTTP 成功、独立 Go 物理 CAS 成功及最终版本断言修正（2026-10-21）

本分支准确 HEAD `bb9bd61a433170b006b40980f7ecbd18d1286590` 的 [真实专项 #39547880404](https://github.com/lazyxu/xdrive/actions/runs/39547880404) 已经执行真正的两代 `cmd/server`、Chromium、Caddy 和 PostgreSQL17：首个 8 MiB chunk 上传 Go A，外部 SIGKILL Go A，Caddy 真实 502 并 reload Go B，旧窗口同 JWT 和原会话继续传完三块合计 17 MiB、重复 finalize/resume 通过，实际输出 `PWA_B2B2B2_REAL_17M_SIGKILL_RESUME_HTTP_PASSED`。独立 Go 检查的 Owner/UploadSession/Node/File/ContentBlob/RefCount、Local CAS 完整 17 MiB SHA256 已通过，但最后一条测试要求新建文件同时有一条 `FileVersion` 记录，实际为 0，专项最终 RED。
- 经核查生产 `internal/api/uploads.go`：新建文件生成 live Node Revision=1 + File + CAS，**仅覆盖旧文件时才创建 FileVersion 历史记录**。本次第一版新文件无历史记录是预期设计，不是产品错误。
- 仅修复 **独立 Go postflight 契约**：严格要求新建 Node `Revision==1`、已有 `FileVersion` 历史计数 `==0`，并以 Node 源契约确认真实创建与覆盖两个不同分支。原文件全部 17 MiB 字节/物理 CAS/三方 SHA256/Session/BlobRef/回滚/Go SIGKILL 断言不削弱，正式业务代码不修改。必须在新准确 SHA 上重新验证完整专项及跨平台 CI/Final Gate 成功，旧版红灯不得视为绿灯。
