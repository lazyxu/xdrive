# NET-M5-B2 — Caddy HTTPS 双入口宿主应用计划（只读准备阶段）

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
