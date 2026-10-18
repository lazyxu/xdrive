# NET-M5-B2 — Caddy HTTPS 双入口宿主应用计划（只读准备阶段）

## NET-M5-C1-A — 异机监督主 Caddy 停机／独立 Rescue 管理员连续性验证（只读，2026-10-18）

**前置状态：** #2071 双入口初始化与页面去重已合并；NET-M5-C0 只能独立验证已经开启的 IP/域名登录，现有 `caddy-rescue-primary-state-witness.py` 和 `caddy-rescue-ssh-auth-check.py` 分别观测宿主生命周期或异机救援登录，过去**不能绑定在同一次实际主网关中断期间**。本阶段只增补可验证的观察链，不授予 Host Apply/Restart。

- `caddy-rescue-primary-state-witness.py --json before|primary-down|restored ENV COMPOSE` 在**宿主只读验证成功后**额外返回严格、单行、无凭据 JSON（固定协议、阶段、当前 UTC、哈希过的同 Compose 项目／主网关容器／Server 与 Rescue 进程代际、主 Caddy 启停时间，始终 `apply_supported=false`）。默认旧版人类可读输出不变；没有原始 Docker inspect、域名/IP、环境值、凭据或证书输出。Docker 状态、独立 Rescue 本机健康、匿名 401 与镜像隔离仍通过已有检查器。
- 新 `scripts/caddy-rescue-supervised-outage-check.py` **只能由另一台受信任操作员电脑在交互式终端显式运行**。准备已审查的独立 Rescue、可信 SSH known_hosts、真实双操作员受监督维护窗口及独立恢复方案之后，工具通过固定主机密钥与独立固定的远端 witness/checker SHA-256 执行四次**只读远端观察**：主网关健康 → 外部运维人员已停止主网关 → 在另一路固定 SSH -W 救援连接验证管理员登录（必须有 401、管理员身份和 11 项服务清单）之后再确认主网关仍停止 → 外部运维人员将主网关恢复健康。每阶段重新核验两个脚本内容摘要；从一次私有 SSH known_hosts 快照复用主机身份；不从保存配置猜测任何已生效事实。
- 本工具**不**执行 Docker stop/start/restart、Compose Apply、主机/DNS/证书写入、SSH 自动远程执行任意用户命令，也不自动操作现网端口。所有私有密码只从当前操作员的交互终端取得，经匿名本地子进程输入管道交给既有安全 Rescue SSH 检查器；禁止把密码和 Token 放进 CLI、环境或日志。输出仅固定枚举，不输出原始 SSH、Docker/Compose、用户地址或口令。
- 通过条件：同一项目、主 Caddy 容器身份、Server 与 Rescue 启动代际跨四次采样不变；Docker `StartedAt` → `FinishedAt` → 真实新的 `StartedAt` 时间线合理；两次主网关停机观测之间的独立 SSH 管理员登录成功。拒绝旧数据、重复键、非法 SHA、未经信任的远端脚本、失效主机证书、权限/登录失败、过期时间、代际变更或主 Caddy 未真正恢复。
- **证据限制：** 这是同一次受监督操作的「离散采样一致性」，不能证明两次停机采样之间毫秒级不间断、对外 DNS/公网 HTTPS、全客户端 CA 信任、已关闭入口不可访问、签名镜像发行商身份、Caddy 新配置实际应用或独立自动回滚；脚本绝不产生可被当作 Host Apply 授权的签名回执，`apply_supported=false`。**本轮只有离线夹具与源码/CI 测试，没有执行实体主 Caddy 停机或现场异机登录；生产 Host Apply 仍 NO-GO。**

使用示意（仅限已建立运维安全条件的监督演练；以下变量均需由操作员事先安全获得）：

```bash
python3 scripts/caddy-rescue-supervised-outage-check.py \
  "$TRUSTED_OPERATOR_SSH_TARGET" "$PINNED_KNOWN_HOSTS" 3080 22 \
  "$REMOTE_TRUSTED_XDRIVE_SCRIPTS/caddy-rescue-primary-state-witness.py" \
  "$REMOTE_XDRIVE_ENV" "$REMOTE_XDRIVE_COMPOSE" \
  "$INDEPENDENT_WITNESS_SHA256" "$INDEPENDENT_OPERATOR_CHECK_SHA256"
```

操作员不得在未准备主网关恢复、可信独立管理员救援及维护窗口的情况下尝试物理演练；参数对应真实平台端口与绝对路径，镜像签名及真实公网 TLS 必须另行验收。CI 原有 `scripts/test-caddy-rescue-profile.sh` 集成新的离线 Python 负例测试，不改工作流、不跳过旧检查，不触及 Web/Desktop Server Auth/Agent IPC。

本阶段把 xDrive「系统依赖 → Caddy」已审计、已保存的目标配置导出为**规范、无密钥的版本化运维计划**，并在宿主机只读复核配置一致性。它准备最终的“保存 → 安全应用 → 受控重启 → 实效验证 → 超时回滚”流程，**本阶段没有实际应用能力**。

## 实现与证据边界

- 仅管理员可访问 `GET /api/v1/admin/services/caddy/https/host-plan`。该接口使用既有管理员认证、PostgreSQL repeatable-read 的 HTTPS 与 AliDNS 双修订快照，生成 Canonical JSON。未保存修订、双入口均关闭、非法域名或私网 IP、域名启用却缺少加密 AliDNS 凭据，全部拒绝导出。
- 本次修复期望快照中遗漏的 LAN 开关及 LAN IP 对比。生成计划前后核对两项开关、两种地址、两种修订及已加密凭据元数据。快照复核不等于跨进程、跨时段的 Host Manager CAS。
- 只有操作员在受信任宿主机上执行 `scripts/caddy-https-host-plan.py`；它读取独立校验的计划 SHA-256 及当前私有 `.env`、Compose，拒绝软链接、无写入端 FIFO、不可信权限、重复字段、非法 IPv4/FQDN、错误 Bind/端口与文件中途替换，计算现有入口/目标模式差异及固定风险代码。
- 结果不包含原始域名、IP、AliDNS Secret、Token、CA 或原始 Compose。所有成功的本地预览均报告 `apply_supported=false`。它**不调用 Docker、网络、DNS、Caddy 或操作系统信任库，也不写宿主机文件、不能重启**。
- 既有 `apply_state=pending`、七点预检、`restricted-apply=blocked`、`public-https=unknown` 不变；任何计划哈希或本机 TLS 成功都不能冒充“已生效”。

## 规范输入

Canonical JSON 是严格小写 ASCII 字段值、键名排序、紧凑编码、末尾一个 LF。下列为无密钥、IP-only **示例**：

```json
{"credential_revision":0,"desired_revision":7,"domain":"","domain_enabled":false,"lan_enabled":true,"lan_ip":"192.168.2.4","protocol":"xdrive.caddy.https.host-plan.v1"}
```

字段固定：`protocol`、`desired_revision`、`credential_revision`、`domain_enabled`、`domain`、`lan_enabled`、`lan_ip`。整数修订小于 2^60；至少启用一个 HTTPS 入口；域名只接受规范小写 ASCII FQDN；IP 只接受规范 RFC1918 IPv4；启用域名必须有正的 AliDNS 凭据修订。额外/重复字段、浮点、IPv6、CIDR、URL、通配符、八进制/缩写 IPv4 都被拒绝。

## 宿主机只读预演

通过现有可信 HTTPS 管理员会话，安全地获取上述管理员 API 的**原始响应字节**，在操作员机器以模式 0600 保存为私有文件，并在**独立可信通道**核对其 SHA-256。不要把浏览器会话 Token、Secret 或 Caddy Root CA 写入该计划或命令行。

```bash
python3 scripts/caddy-https-host-plan.py \
  --plan "$HOME/.xd/state/caddy-host-plan.json" \
  --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256"
```

仅从同一不可信文件计算哈希，再把它冒充“独立批准”没有认证效力。工具输出 `current_mode`、`desired_mode`、`changes`、`blockers`、`candidate_sha256`、`host_environment_sha256`、`host_compose_sha256` 与修订号，均无敏感明文。阻断时以固定 `invalid-or-changing-input` 报错，不泄露路径和异常文本。

## 尚未完成：真实自动应用 NET-M5-B3/C

真正让系统依赖页面“保存、应用、重启生效”还需独立交付：可信的宿主 Host Manager 版本化双修订 CAS、经过审核的 Operator Rescue 与异机登录实测、安全交付 AliDNS 凭据、原子替换环境和备份、独立限时回滚看门狗、两个真实 HTTPS 入口与登录/刷新/退出测试、失败恢复回执、不可变审计及 UI 真实进度。任何一项缺失均不得开放危险的 Apply/Restart 开关。

目前新部署优先直接配置 **IP HTTPS**；域名需要单独配置；两者可同时启用但不能全部关闭。对私网 IP 使用本地 CA：**浏览器/手机首次登录前仍须从可信通道核对并信任 Caddy 私有 CA，不能跳过 TLS 证书警告输入密码。**

## 回归

CI server-validation 执行 `python3 scripts/test-caddy-https-host-plan.py`。离线测试覆盖 IP-only、双入口、启停/切换、错 IP/FQDN/端口/Bind、双关、缺少 AliDNS 修订、重复与未知字段、错误摘要、损坏或可替换文件、FIFO、软链接与保守无密钥输出。Go 纯函数输出与 Python 严格规范必须一致，新的管理员只读路由仍在 requireAdmin 保护下。只有本工作提交完整准确 HEAD CI（Go PostgreSQL Race、Linux/Windows、Web/Desktop、Rootless、制品、Final Gate）全绿且 GitHub clean，才可合并。

## NET-M5-B2-UI — 在系统依赖页面核对应用计划（2026-10-18）

管理员可以在 **系统依赖 → Caddy → 检测** 点击“查看宿主机应用计划（只读）”，不需要手动调用 REST API。Web、Mobile Web、PWA、Desktop 共用同一 MUI 面板，访问管理员专用 Host Plan GET；Desktop 使用当前认证 Agent IPC，显式检查 `admin-services` 能力。UI 只显示规范的双入口启停意图、局域网 IP/域名以及已保存的 HTTPS/AliDNS 修订号，不会读取或复制加密凭据、宿主机环境文件或 Root CA。7 字段响应接受严格运行时 Schema；旧 Server/Agent、不完整字段、双入口同时关闭、非法 IP/FQDN、额外 `apply_supported`/applied 字段、无效修订都会显式报错。保存与历史回滚后，复用现有失效信号清空旧预览，避免误把缓存计划当成当前应用状态。

此按钮只提供**保存值预览**，不是宿主机已应用验收；本机 HTTPS 的独立检测仍在原预检页。实际“应用配置并重启”需要单独开发并通过物理验收，受限 Host Manager/Rescue/超时回滚门禁没有因此放宽，现有 Caddy 启停仍禁用。

## NET-M5-B3-A — 宿主机 .env 候选配置确定性指纹（只读，2026-10-18）

操作员只读 Host Plan 现追加 `candidate_environment_sha256`：在保护的同一 .env 快照上，于**内存**中仅重写固定的 `XD_DOMAIN`、`XD_LAN_HTTPS_IP`、`XD_LEGACY_HTTP_ONLY=0`，保留所有其他字节（包括不返回的旧凭据）。它计算候选 .env 整体 SHA-256，且重新按既有私网 IP、FQDN、非明文、绑定和端口规则验证候选；重复的任意环境变量、畸形行、CRLF、缺末尾 LF 和不可信文件一律阻断。缺失的三项固定变量可按确定顺序追加。变化结果仍只有受限枚举与哈希，绝不暴露候选完整内容、凭据、原始域名/IP、Shell 命令或写文件接口。

`host_environment_sha256` 与 `candidate_environment_sha256` 可供未来受信 Host Manager 的预提交版本/文件检查对比；**SHA 相同也不证明已应用**。本阶段无真实 Host CAS、授权令牌、可信 Rescue/失联实测、域名 AliDNS 凭据宿主安全交付、原子写入/备份、Docker/Caddy 重启、双入口浏览器登录或计时回滚，因此依然 `apply_supported=false`。绝对不能把此候选指纹当作应用许可或不可变已应用回执。完整宿主 Apply/Restart 属于后续 NET-M5-B3-B/C。

若目标 IP 与当前 `XD_HTTPS_BIND` 不兼容，仍按既有只读预检返回 `https-bind-migration-required`，但 `candidate_environment_sha256` 必须为 `null`，避免对无法仅靠这三个变量应用的候选生成可误用的摘要；绝不自动把绑定扩大到 `0.0.0.0`。

## NET-M5-B3-B — 受保护的宿主机候选 .env 暂存（不触碰实际网关）

`scripts/caddy-https-host-stage.py` 是**操作员在可信宿主机显式运行**的独立命令。先复用只读 Host Plan 预检与经独立可信通道核对的 Plan SHA，然后通过固定的期望修订、现有 .env 与 Compose 哈希再次核验候选字节；仅在已有的私有 `state/caddy-https-staging`（所属操作员、0700、不可是符号链接）内，以 O_EXCL/O_NOFOLLOW 创建 0600 的候选 .env 与无密钥暂存收据，fsync 文件与目录。二者以同一个输入指纹命名，重复执行拒绝覆盖；失败会尽量清理本次创建的文件。任何已有正式 `config/.env` / Compose 均只读；没有 Docker、DNS、TLS CA、Restart、Save/Apply API 或网页登录凭据。在异常断电时可能留下**没有收据的未完成暂存文件**，这种文件不得安装且需操作员清理。

为防遗漏保护，尚未具备 AliDNS 私密凭据宿主交付、当前私网 Bind 迁移、现有管理入口切换/关闭，或旧 HTTP 安装时，暂存直接失败，不会放宽绑定或删除当前入口。此命令只为后续经过批准的原子 Host Apply 提供可比对的私有输入工件，不是一次部署，也不是一个安全应用许可。收据固定 `state=candidate-staged-unapplied`、`apply_supported=false`；真实重启仍被 Rescue、Host CAS、双 HTTPS/login 与看门狗回滚门禁阻止。测试通过 `python3 scripts/test-caddy-https-host-plan.py` 同时覆盖纯只读计划与暂存权限、无覆盖、无凭据打印、不改原文件及危险入口拒绝。

## NET-M5-B3-C1 — 暂存候选的只读完整性复核（绝不应用）

宿主机操作员可显式执行 `scripts/caddy-https-host-verify-stage.py`。它独立复核已保存的 Canonical Host Plan 指纹、当前受保护的 .env/Compose 快照、确定性候选 .env 全部字节，以及暂存收据的严格规范 JSON 和 SHA-256。所有被读取的暂存文件必须属于当前操作员、0600 常规文件、不可使用符号链接/FIFO，所在目录必须为操作员所有的 0700 私有目录；读入前后核对固定 inode、长度、mtime、ctime，避免将旧候选当成可用部署。需要从独立可信通道核验两个 SHA-256，并保留原有七项 Caddy 只读预检。

例：`python3 scripts/caddy-https-host-verify-stage.py --plan "$HOME/.xd/state/caddy-host-plan.json" --env-file "$HOME/.xd/config/.env" --compose-file "$HOME/.xd/config/docker-compose.yml" --expected-plan-sha256 "$TRUSTED_PLAN_SHA256" --staging-dir "$HOME/.xd/state/caddy-https-staging" --expected-stage-receipt-sha256 "$TRUSTED_STAGE_RECEIPT_SHA256"`。

输出永远是 `candidate-verified-unapplied` 或 `blocked`，且 `apply_supported=false`；不返回原始 IP、域名、凭据、候选内容或路径。即使验收通过，也只代表固定时点的私有暂存工件正确，**不证明管理员保存修订已应用、当前 Caddy 运行配置、异机登录、独立救援或自动回滚可用**。它不修改文件、Docker、Caddy、DNS、证书和系统信任。必须先完成真实独立救援的停机验证、签名批准、受限 Host CAS、双入口登录证明、独立超时看门狗及不可变应用回执，才可以提供真正的“应用并重启”操作。

## NET-M5-B3-C2 — 受操作员签名的候选复核（非 Apply 授权，2026-10-18）

新的宿主机私有脚本 scripts/caddy-https-host-signed-review.py 严格重用 B3-C1 完整候选复核，另要求操作员经独立可信通道固定 Ed25519 公钥 DER SHA-256 指纹，验证私有 0600 签名清单和签名。私钥绝不进入 Server、Agent、Web、Desktop 或 Git；测试仅生成临时密钥。清单为规范 JSON + LF，固定 scope=xdrive.caddy.https.operator-stage-review.v1 与 action=candidate-review-only，绑定 HTTPS/AliDNS 双修订、Plan/Stage Receipt/原始 .env/Compose/候选五个 SHA-256、UTC 有效期（最长 60 分钟）及 nonce。

拒绝非规范/重复字段、过期与未来或超长有效期、错误类型/公钥/签名/摘要、源文件替换和权限错误；有效签名但包含 apply-and-restart 的越权 action 也拒绝。签名后再次验证保护文件与私有阶段收据没有更改。唯一成功返回 signed-review-verified-unapplied，所有路径一律 apply_supported=false，不输出 IP/域名/Secret/私有路径。

这不是可防重放的在线 Host Apply 授权，也不证明救援、DNS、真实 HTTPS 登录、宿主启动修订或回滚。实际生效仍必须由不同 scope 的一次性 Host 事务、独立离线授权和现网物理恢复证据构成；不得将 review-only 签名升级为重启许可。现有 server-validation 运行的 scripts/test-caddy-https-host-plan.py 增加临时真实 OpenSSL Ed25519 正反测试，不改线上 Docker/Caddy。

## NET-M5-C0 — 独立设备真实 IP/域名 HTTPS 与管理员登录验收（仍非 Host Apply）

操作员在**另一台受信任的终端**显式运行 `scripts/caddy-https-remote-login-check.py`，读取已安全保存的 Canonical Host Plan；Plan 文件须由独立可信通道固定 SHA-256，包含严格有效的局域网 RFC1918 IPv4、公网 FQDN、IP/域名独立启停以及正修订。至少一个 HTTPS 入口启用。要求显式提供 HTTPS 主机端口，不猜测公网/NAT 端口；不修改 DNS、Caddy 或服务器配置。

对于已启用的 LAN IP，必须从可信渠道取得 Caddy 本地 Root CA PEM 并**独立固定其文件 SHA-256**，用单独的 TLS 客户端信任上下文验证完整链、IP SAN 和所访问的 IP 主机名；对于已启用的公网域名，使用系统受信任 CA 验证完整链、DNS 主机名，不自动接受私有 CA。不使用代理、不跟随跳转、不绕过 TLS 证书校验，不允许明文 HTTP。尚未信任本地 CA 的浏览器和手机不可无视安全告警登录。

每个已启用入口通过真实网络、独立 TLS 会话执行固定顺序：GET /api/v1/readyz（200 且 ok=true）；匿名 GET /api/v1/admin/services 必须是 401；使用操作员**在本机交互输入**的账号密码 POST /api/v1/auth/login，必须成功且角色为 admin；再以该入口自己的临时 Bearer 获取严格 11 个服务项，并取得 GET /api/v1/admin/services/caddy/https/host-plan，要求其原始规范字节与独立固定的 Plan **完全相同**。拒绝非 200、重定向、TLS/身份错误、缺失权限、计划改动、响应超限、密码/Token 泄露。两入口同时开启时都必须独立通过，Token 不跨 Origin 复用；终端输出仅最小枚举、修订与哈希，不输出真实 IP、域名、Root CA 路径、密码或 Token。

典型 IP-only/双入口命令（port 以真实部署配置为准；domain-only 省略两项 lan-root-ca 参数）：

```bash
python3 scripts/caddy-https-remote-login-check.py \
  --plan "$HOME/.xd/state/caddy-host-plan.json" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256" \
  --https-port 8443 \
  --lan-root-ca "$TRUSTED_CADDY_ROOT_CA_PEM" \
  --expected-lan-ca-sha256 "$TRUSTED_ROOT_CA_SHA256"
```

**证据边界：** 只验证当前操作员所在网络能够到达开启的入口，并通过真实证书、管理员登录和已保存期望修订一致性检查；没有检测已关闭入口是否完全不可访问，无法断言两个 Origin 由同一 Server 进程服务、所有客户设备信任私有 CA、当前 Caddy 使用了该修订、WAN 所有路径可达或改动能够安全重启/回滚。`state=enabled-origin-logins-verified-unapplied`，固定 `apply_supported=false`。证据仍需由可信 Host Manager 与事务、启动配置摘要、不可变 Applied Receipt、独立超时回滚和实际设备验收联合使用，不能单独向“系统依赖”页面开放应用按钮。

CI 现有 `server-validation` 执行 `scripts/test-caddy-https-host-plan.py`，由此固定入口调用 `test-caddy-https-remote-login-check.py`，不需要修改 CI 工作流 YAML：使用真实临时 OpenSSL CA/IP SAN 证书和 loopback TLS HTTP Server，验证真实匿名 401、登录、权限、原始 Plan 字节、错误证书名/CA、阻断非管理员/篡改/健康失败、HTTP 代理旁路和不修改宿主机。所有密钥/管理员口令都是临时无效测试夹具，不连接生产网络。
