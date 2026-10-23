# Caddy 管理第一版：宿主机 .env 单一配置源

**状态：2026-10-23 已合入 `master`，PR [#2382](https://github.com/lazyxu/xdrive/pull/2382)，Squash `f240c9e5b02dec2de12903530963cd5252fb62c8`。** 准确 HEAD 的 [CI #39878810970](https://github.com/lazyxu/xdrive/actions/runs/39878810970) 已通过（25 成功、52 条件跳过、Final Gate 成功）；原分支已由 [清理工作流 #39880257174](https://github.com/lazyxu/xdrive/actions/runs/39880257174) 删除。仅代表**源码合并**，不代表生产服务器升级、网关重新部署、真实公网 HTTPS 或终端证书信任验收。

## 用户确认的第一版范围

- Caddy 当前管理配置唯一来源为宿主机 `~/.xd/config/.env`，而非 PostgreSQL Desired。
- 只允许管理员操作四项：`XD_DOMAIN`、`XD_LAN_HTTPS_IP`、`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET`。对其他变量（数据库密码、JWT、连接器密钥、路径、镜像）不得修改。
- “读取”通过固定 Host Control 观察取得非密钥字段、AliDNS 是否配置及四字段 SHA256。“保存配置”使用预期 SHA256 的 CAS、0600 原子替换并保存原运行配置到受限宿主目录；**保存不会触发部署**。
- 单独“重新部署 Caddy”：仅运行固定 `docker compose --env-file ... -f ... up -d --no-deps --force-recreate caddy`。不开放泛用 Docker 命令、不提供任意宿主机文件编辑器，也不重启 Server/PostgreSQL/Worker。
- 发布成功仅要求固定本机 Caddy HTTP Ready 与启用的域名/私网 IP 本机可信 TLS 验证；不等于公网可达或客户端 CA 信任完成。失败则尝试恢复上次宿主配置并单独重建旧 Caddy；升级器的安装锁占用时拒绝操作而不是错误回退。
- 原 Host Control 操作中断后，新的 Runner 只对原 `deploy` 任务执行受限旧配置恢复；没有足够物理证明时保持状态不确定及阻断新写入。
- AliDNS 密钥默认不进入普通 GET/状态/log；管理员明确点击密码框眼睛时，使用固定 Host-only reveal、当前四字段 SHA CAS、私有一次性回执和客户端至多 30 秒显示周期。
- PostgreSQL 继续服务原有用户和管理员认证；**本版不增加或修改 Caddy PostgreSQL 历史表、配置事务或回退记录**。数据库历史版本与修改审计推迟第二版。旧 PostgreSQL Caddy 控制接口仅用于测试/旧版兼容，实际生产 Host 模式不再让它修改当前配置。

## 不可混淆的配置状态

1. `.env` 已保存：仅磁盘配置更新，仍可能尚未重建 Caddy。
2. Caddy 本机入口已验证：当前主机上已通过指定健康和 TLS 探针。
3. 公网域名可达、真实 DNS/ACME 和终端信任：本机验证无法替代这些证据，不得自动标记成功。

升级安装器也会读取 `.env` 并重新创建 Caddy，因此在“保存配置”与“重新部署”之间发生升级时，新配置可能被升级流程应用；UI 不得把待部署标记等同于确切运行代次。

## 代码与离线回归

- `scripts/caddy-env-config.py`：限定 JSON、四字段值检查、CAS、0600/0700 fsync+rename、私有原始备份、主动恢复、读取和一次性 AliDNS reveal。
- `scripts/server-control.sh`：受限 Host 队列、Docker recreate、健康与 TLS、安装锁互斥、失败/中断恢复与固定状态回执。
- `internal/api/admin_caddy_env_only.go`、`admin_caddy_host_env.go`、`admin_caddy_host_deploy.go`：管理员受限读/写/部署/状态/揭示；生产 Server 标记 `CaddyHostEnvAuthoritative`。
- Web/Mobile 复用共享 `CaddyDetailV1`；Desktop 经 Electron Main、Preload、Agent 到 Server，旧 Agent 不允许静默落回分段保存。
- 运行：`python3 scripts/test-caddy-env-config.py`、`bash scripts/test-caddy-env-deploy.sh`；脚本纳入现有 Host validation。另有 Go 无 PostgreSQL Host 读取/部署防误操作测试。

## 有限终态查询（P1 第一增量，独立后续 PR）

- Host Control 对每次成功结束的 Deploy 保存最多 64 条、保留 7 天的**非敏感终态回执**，按随机 request_id 独立定位。日志只包含固定状态/错误码、配置指纹与经确认的回退标记；不包含 AK/SK、Host 原始 .env、路径、Docker 日志或证书私钥。
- 记录存于 Host Control 内仅 Host 可写、Server 组只读的目录；断电前必须 fsync 文件与目录。管理员已有 GET 状态接口先查询原请求的终态记录，未命中时兼容原 15 秒单槽状态；过期、符号链接、损坏或未知状态必须保守拒绝。
- 这**不等于**可信签名 Applied Receipt、WAN 可达证明、服务端任务中心、完整部署历史 UI 或自动恢复/重试；后续仍需补足跨代际运行身份、审计与可靠性加固。

## P1：Caddy 本机提交与崩溃回执的一致性收敛（新增待验证源码）

- 本机固定 Ready + 可信 TLS 验证成功后，Host 在**同一安装锁**中先把对应原始 Request ID、四字段 SHA256 和 `deployed` 写成**原子、不可覆盖、fsync 的本地终态决议**，然后才清除旧配置备份与 Pending 标记；避免“已提交 .env/Caddy，但成功回执还没有持久化”的丢 ACK 窗口。
- 在落盘前退出或没有可信同 ID 终态决议：仍按旧的受限恢复路径处理；在终态决议落盘后进程中断：重启 Host 检查**原 ID + 指纹 + 当前 .env 一致性**，只完成 Pending/Backup 清理并补发旧单槽回执，**绝不因失去 Shell ACK 而回滚已成功提交的 Caddy**。
- 若归档有错误、硬链接/权限不可信、SHA 不符或清理失败：保持原 Active 操作隔离，不发虚假 `deployed`，不自动再次运行 Caddy。原子写期间若在 hard-link 发布后、临时链接删除前被 SIGKILL，只接受具有确切 Host 私有临时 inode 身份的情况。
- 离线回归分别注入：物理检查后、决议落盘前（保守回滚）、决议链接已发布但临时链接尚未删、决议落盘后/删除 Pending 后/清理完成但 Shell ACK 丢失，以及恶意非成功同 ID 回执。**回执只证明历史上的一次本机验证/提交事务，仍不等于当前运行代际、签名 Applied Receipt、公网可达、DNS 成功或终端 CA 信任。**

## 合并后的限制与第二版边界

- **源码验收已完成**：PR #2382 及其准确 HEAD 的 Go Linux/Windows、PostgreSQL API Race（整仓兼容）、Web/Desktop、Host/Rootless、制品与 Final Gate 全部通过。
- **运行环境尚未变更**：源代码合并不会修改已有宿主机 `.env` 或重新创建生产 Caddy。生产环境专属安全验收：**按用户决定跳过（未验收）**；不得据此宣称公网可达、终端 CA 已信任或实际 Caddy 已部署。
- Host 返回的 `installer-busy`、`deploy-refused`、`interrupted-deploy`、`caddy-deploy-or-verify-failed` 是固定诊断代码；管理员 UI 仅将已知代码映射为安全的中文提示。未知字段、主机路径、环境变量值、Docker/TLS/供应商原始日志不得传给浏览器。
- 第二版如需配置历史、回退和修改审计，可在 PostgreSQL 记录经严格脱敏或加密的受限修订及操作记录，**但不得把 PostgreSQL 恢复为 Caddy 当前配置权威**；任何版本回退应先经受限 Host Control 的四字段 CAS 写入 `.env`，再单独执行 Caddy-only 重新部署。

## P0-01 · 回退网关未验证时保持 Host 操作隔离（2026-10-23）

- 新 Caddy 失败后，即使 Python 已恢复旧 `.env` 并清除 Pending/Backup，旧 Caddy recreate、Ready 或 TLS 未通过便不是可信物理回退。保留相同 Request ID 的 `caddy-env-active.json`；历史失败回执仍只返回 `rolled_back=false` 和固定错误码，不宣称 `deployed`。
- Active 留存期间 Host Control 拒绝后续请求；Server 在新 Save/Deploy/Reveal 提交前检查 Active，避免超时后迟到执行。只读配置和失败历史查询不受影响。
- 重启时缺少可信证据就保持 fail-closed 隔离；本轮不允许靠清除 Active 或仅检查旧 `.env` 伪造恢复。独立 Rescue/Watchdog 后续实施。
- 离线故障注入覆盖新旧双重失败、原 ID 失败归档、Active 留存、请求队列隔离和重启后仍隔离。Go 测试覆盖正常及符号链接 Active。生产环境专属验收：**按用户决定跳过（未验收）**。

- 多副本竞态补充：Server 检查 Active 与发布队列并非原子事务；即使第二个请求在这一间隙入队，Host 发现 Active 后会删除该普通队列文件，防止稍后解除隔离时执行早已超时的请求。符号链接或异常 Active 保持保守隔离。
## P0-02A · Caddy-only 部署与回退的本机同代际验证窗口（2026-10-23）

- 将已有的固定 Docker ID/StartedAt/PID/healthy 采样与仅返回 SHA256 的 Caddy Admin `/config/` Live Config 采样，直接接入 Host-only 重新部署和旧配置回退的 Ready/域名 TLS/LAN TLS 验证；验证前后运行代际与内存配置摘要必须完全相同。
- 采样和探针运行在同一个 `install.lock` 受限部署事务中。发生 Docker Generation 切换、Caddy 原地 Reload、Live Config 不可读取或探针失败时，不将结果标记为本机成功或已回退。独立的现有 Host 只读采样仍可工作。
- 离线固定 Docker fixture 验证稳定成功、跨代际拒绝、同代际 Live Config 变化拒绝、缺少 Live Config 拒绝，原有成功/失败/崩溃和锁互斥回归仍需继续。此阶段不新增公开 API、凭据暴露或数据库配置权威。
- 该本机观测仍无法阻止安装锁之外的 A→B→A 变化；也不具备独立签名、禁用入口负向证明、当前代际持续验证或 WAN/客户端 CA 证据。**不是** Applied Receipt，后续 P0-02B/P0-05 独立交付。生产环境专属验收按用户决定跳过（未验收）。

## P0-02B1 · Host 崩溃恢复沿用可信运行代际窗口（2026-10-23）

- 中断恢复的 `caddy_env_recover_interrupted` 不再仅凭旧 `.env` 已恢复、本机 `readyz` 和单次域名/LAN TLS 检查就声明 `rolled_back=true`，而是在固定 `install.lock` 内调用 P0-02A 的 Docker Generation + Caddy Live Config 前后双采样窗口。
- Docker 实例/进程代际变化、Caddy 原地重载、Admin Live Config 不可读取、任何 Ready/TLS 未通过时维持同 Request ID 的 Sticky Active，不发成功回退，也不触发新候选再次执行。
- Host 离线 fixture 分别注入重启恢复时换代、同代配置改变、缺少 Live Config，验证非敏感固定错误码、`rolled_back=false`、原 Active 留存、旧 `.env` 之外的密码未被修改。正式 Rescue/Watchdog、签名 Applied Receipt 和持续运行监测另行开发。生产环境专属安全验收：**按用户决定跳过（未验收）**。

## P0-02B2 · 单次部署的 Host 本机代际摘要写入持久成功决议（2026-10-23）

- 对 P0-02A 已通过 Ready、域名/LAN TLS、Docker Generation 和 Live Config 同一验证窗口的结果，在 Host 内派生 `host_local_generation_sha256`（域分离的固定实例/启动代际/PID 摘要）与 `host_local_live_config_sha256`（运行中的 Caddy Admin 配置摘要）；只保留不可逆 SHA-256，不持久化原始 Docker inspect、Caddy JSON、AK/SK 或日志。
- 原 `commit` 在固定 `install.lock` 与 Host 私有继承文件描述符约束下，要求两个摘要同时存在。成功时把原 Request ID、四字段 `.env` SHA、上述本地窗口摘要**一起写入现有不可覆盖、fsync 的相同终态回执**，然后才清理 Pending/Backup；不是第二套独立提交记录。崩溃/丢 ACK 的原 Request ID 回放接受新旧两种严格固定字段格式。
- 旧版不带摘要的成功终态仍允许只读和历史崩溃恢复，**不得被视作具有新窗口代际证据**；只有一个摘要、非法十六进制、失败终态携带摘要、额外敏感字段一律拒绝。管理员 API 仍只返回既有安全的终态和固定错误码，不向浏览器泄露 Host 私有摘要。
- 该摘要是**历史本机观测，不是当前网关运行证明或签名 Applied Receipt**：没有独立 Host 签名/禁用入口负向证据，也尚未实现实时重新比对并自动宣告旧 generation 失效、跨进程 Watchdog、WAN/终端 CA 信任。P0-02B3/P0-05 继续独立开发。生产专属验收按用户决定跳过（未验收）；源代码安全测试仍必需。

## P0-02B3-A · 当前 Host 本机代际观测字段（2026-10-23）

- 不增加 Docker、TLS、地图或第三方 API 调用，而是复用现有 `caddy_host_refresh` 的本机 Docker ID/StartedAt/PID/healthy、Live Config SHA、域名 SNI 与 LAN IP SAN/本机 CA 正向样本。只有已配置的**全部**入口在同一稳定采样窗口内通过、且域名入口与容器启动域名一致，才用与 P0-02B2 成功终态完全相同的域分离规则派生 `host_local_generation_sha256` 与 `host_local_live_config_sha256`。
- 当前快照 `caddy-runtime-status.json` 仅携带两个非密钥摘要，绝不携带原始 Docker inspect、Caddy 配置 JSON、域名、LAN IP、AK/SK 或证书；一方缺失、切换运行代际、同实例 Live Config 变化、TLS/CA 失败、双入口任一失败均不发布摘要。LAN-only 正常可独立证明本机窗口，旧版 Host 省略字段保持只读兼容。
- Go Server 严格校验成对 SHA-256、空配置摘要、配置/入口状态矛盾，以及与原现有 Live Config 字段的一致性。管理员服务状态仍只返回既有的安全状态与本机验证范围，**不**传输这两个私有摘要，不公开新的 Applied 接口。
- 这一小段只完成**最近一次正向本机观测**的标准化；Host 控制目录允许 Server 读取并非独立签名授权，快照存在 45 秒新鲜度限制且可能刚好发生代际变化。禁止据此宣布某个历史 `deployed` 当前仍生效。后续 P0-02B3-B 必须将**可信原请求历史记录**与独立重新采样下的当前代际对比并定义 matching/changed/unverified，完成签名和禁用入口负向验证后才能考虑真正 Applied Receipt。
- 保留 Host `.env` 唯一权威、原提交持久回放、安全隔离和 Rescue 边界；生产环境专属安全验收 **按用户决定跳过（未验收）**，源码级故障注入及权限测试照常要求。

## P0-02B3-B · 历史部署与当前本机观测的受限对比（2026-10-23）

- 只读管理员 `GET /api/v1/admin/services/caddy/config/deploy?request_id=...` 在原有终态 `state` 之外，对于 `deployed` 返回固定的 `local_runtime_state`：`matching-local` / `changed-local` / `unverified`。原 `state=deployed` 仍仅表示历史 Host 事务提交，不是当前生效证明；不返回私有原始 Docker Identity、Live Config JSON、私有摘要或新的签名字段。
- `matching-local` 仅在原请求 ID 对应**不可覆盖成功归档**中包含两项有效 Host 本机摘要、当前 Host `.env` 指纹与入口开关同档、域名 TLS SNI 摘要/LAN IP SAN 摘要正确、当前 Docker Generation 与 Live Config 都通过正向本机观测并逐项等于历史记录、没有待部署更新或未完成 Host 请求、相关 Host 快照和 heartbeat 均未过期（45 秒）时返回。读取前后重查一致性；中途发生读写变化保守返回 `unverified`。
- `changed-local` 仅表示原可信本机历史摘要与当前**同样完整有效**的本机观测在运行代际、配置内容或现行 `.env` 指纹中至少一项不一致；不指明是谁修改、WAN 是否失效或新部署是否获得权限。
- 任何历史旧回执没有摘要、当前 Host 观测无法读取、证书/入口样本失败或不一致、双入口缺一个、保存未部署、Active/queued 操作、权限/时间异常、伪造或部分摘要、一侧快照缺失均返回 `unverified`，**不能降级成 matching**。失败/进行中原终态不增加本机成功标签。
- 此 API 仍不是独立 Host 签名的 Applied Receipt：在两次快照读取之间或读取之后发生的 A→B→A/重新部署无法被排除，只有短有效期的 Host 本地观察，不构成连续生效保证。后续仍须可信独立 Collector、签名防重放、启用/禁用入口正负验证，以及独立 Rescue/Watchdog。
- 生产环境专属安全验收继续按用户决定跳过（未验收）；不要求生产账号或抓包，不作为源码、CI、PR、合并阻塞条件。源码层面的 Owner/Admin 权限、证据隔离和故障负例测试仍必须通过。
