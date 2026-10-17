**NET-M4 首次部署默认值说明：** 当 DB 还没有管理员 Caddy 修订时，已通过规范 RFC1918 校验的 `XD_LAN_HTTPS_IP` 作为“系统依赖”页面**未保存的默认启用 IP**显示。它来自 Server 配置声明，只用于降低首次配置混淆；仍显示 `revision=0`、`apply_state=unmanaged`、`apply_supported=false`，不表示 Caddy 重启、TLS 验证、浏览器 CA 信任或已保存的宿主修订。

## NET-M4：系统依赖页双入口配置合同（阶段性交付，未开放 Caddy 在线应用）

管理员 `系统依赖 → Caddy → 配置` 增加**公网域名 HTTPS**和**局域网私网 IP HTTPS**两组独立的期望开关、域名／地址输入；两者同时开启合法，双关闭时 Server 拒绝保存。严格校验 ASCII FQDN、规范 RFC1918 IPv4，非法地址、旧修订、无管理员权限、数据库不可用、审计失败都不会变更保存值。后台在现有管理员 `caddy-https` 设置与不可变历史中扩展 LAN 字段（升级新增列默认 false / 空，不擅自开启旧实例），历史修订和期望回滚包含完整双入口，并保留旧版 Desktop/Agent 对未提供 LAN 字段的兼容性。前端检测旧版 Server 未提供 LAN 合同时不允许保存不完整的双入口期望。

状态必须**明确区分三种证据**：DB 中已保存但未应用的期望、Compose Server 环境变量报告的内网 IP（仅部署声明）、Caddy Host Manager 对容器/本机 TLS 的只读观察。环境变量不证明证书信任、当前实际路由或公共 HTTPS；不会因为保存修订、普通重启或 Host 健康而返回 `apply_state=applied`。`apply_supported=false`、七项 Caddy 安全预检、`restricted-apply=blocked` 和 `public-https=unknown` 不改变。修改真实 `~/.xd/config/.env` 与实际重启仍需受限运维；**当前不能从 Web/Desktop 直接操作公网网关**，因为真实防失联、安全救援及超时回滚条件尚未通过物理验证。这是分阶段交付，不声称满足一键应用。

**NET-M3 IP TLS 无 SNI 安全兼容（2026-10-17）：** 普通浏览器访问 `https://192.168.x.x` 往往不发送 SNI；固定 Caddy 2.10.2 可能在自动 HTTPS 适配时没有生成默认 TLS 策略，出现 TLS internal error，虽然本地 CA 已签发 IP SAN 证书。私网单入口与域名+私网双入口现在均以 `default_sni` 绑定规范私网 IP，并显式使用 `https://` 站点；Caddy 镜像构建核对两份 adapted JSON 的 `tls_connection_policies/default_sni`。Rootless 必须真实使用受信 root 以及 `curl --cacert` 直连 IP 验证主机名，不允许 `--insecure`。此为实现和 CI 候选，不声明客户设备 CA 信任或实际网络已通过验收。

**NET-M3 exact-head CI test-fixture correction (2026-10-17):** [CI #39009313435](https://github.com/lazyxu/xdrive/actions/runs/39009313435) initially failed the original no-start bootstrap and real Rootless Docker install at secure stage 4, since CI environment offered neither public domain nor a canonical RFC1918 LAN identity. New production installs correctly reject both-disabled HTTPS; the fix is explicitly limited to the fixtures. The no-start bootstrap supplies `192.168.2.4` and also asserts that an explicitly empty IP + domain fails. The real Rootless Docker test temporarily adds `192.168.254.246/32` on ephemeral runner loopback, uses this one private IP with existing HTTPS port, and asserts a real Caddy-issued local CA + matching IP SAN is verified by installer `curl --cacert`. Temporary alias is removed on every exit. Tests MUST never use `--insecure` or weaken identity checks. Rebuild one M3 commit on same fixed parent and require NEW complete exact-head 76-job CI; no production physical browser trust or DMZ firewall proof is claimed.

## NET-M3（2026-10-17）— 新部署默认 IP HTTPS／域名可选与真实 IP TLS 验收

已合入的前置 NET-M1/M2 [#1958](https://github.com/lazyxu/xdrive/pull/1958) 完整 [76-job CI #39007318688](https://github.com/lazyxu/xdrive/actions/runs/39007318688) 通过，Ready/Rebase 合并为 `master@fbb131a0bd4017ef3cf4fd05c43786f35416ac83`。本阶段 [#1966](https://github.com/lazyxu/xdrive/pull/1966) 把原单工作提交重建为 `master@e7e4340b3af68debfe4007ec2a102e8226c4d37c` 上恰好一个 NET-M3 代码提交，复用原 Docker/Caddyfile/安装器和 Desktop 契约测试字节，只保留自己的差异，发起新的准确 HEAD 全 76 项 CI，禁止复用上阶段 CI。

新的安装不强制填写公网域名。安装器从 Linux 本机路由或接口识别 RFC1918 IPv4，拒绝不规范或模糊情形；无有效安全入口时要求配置，不能全部禁用。IP-only 固定 Caddyfile.lan-only，domain-only 固定原 AliDNS 文件，dual 同一已有 HTTPS 端口启用二者；不开放未加密 LAN HTTP 密码登录。升级原有域名部署不自动更改入口；仅明确标记的旧 HTTP-only 部署使用兼容 `XD_LEGACY_HTTP_ONLY=1`。Rootless 与绑定端口验证和既有安装回滚保持一致。

安装器必须从可信同一 Caddy 容器读取本地 CA 根证书，在私有暂存文件上用 `curl --cacert` 校验真实 `https://LAN_IP:HTTPS_PORT/api/v1/readyz` 的 IP SAN、证书链和 HTTP JSON。它不会以 `-k` 跳过安全检查，也不能自动令浏览器或系统信任该 CA：终端设备需人工安全核对并安装受信任 CA 后才可进行 IP HTTPS 登录。UNR030H1 DMZ 可能使 Linux 的共享 8443 对外可达，必须单独验证防火墙和物理网络。此阶段不修改系统依赖中现有 staged desired DB 状态，不提供危险 Caddy 在线应用；NET-M4/M5 分别完成目标配置和受限同步/实际运行生效，只有后者通过 Operator Rescue／超时回退等安全前置条件才能交付。

# xDrive 手动内外网入口切换 MVP（NET-M1）

## 目标与边界

在不修改光猫、NAT、DNS、Linux 防火墙、Caddy/Compose 监听、Go Server/Agent REST/IPC 的前提下，为 xDrive 提供明确的 **手动选择入口**。适用于 Web / Mobile Web / PWA 的同一 React 页面：登录页与已登录头像菜单都提供「手动切换连接入口」；桌面版则从已登录账户菜单经明确确认退出当前 Agent 会话，回到已有可编辑服务器地址的登录页。

- 私有 LAN 入口必须是显式完整的 RFC1918 IPv4 根地址，例如 \`https://192.168.2.4:8443\`。公网入口必须为 \`https://drive.example.com:8443\` 这类 HTTPS 域名。URL 带账号密码、路径、参数、hash、奇异 IPv4、公共 IP 伪装内网地址、JS/File scheme 均拒绝。
- 只记录 URL Origin（无路径、密码、Token），存在当前站点独立的 \`localStorage\`；不同 IP／域名站点没有共享浏览器存储，首次打开各自需要分别配置并可能重新登录。
- 每个地址使用显式、新标签页的 \`noopener noreferrer\` 导航。没有后台 IP/域名探测、跨域 fetch、CORS 豁免、会话迁移、强制当前标签页重载或中断正在进行的浏览器上传；旧标签页保留当前任务。iOS PWA 中新窗口行为由系统决定。
- LAN HTTPS 仍要求真实受信任证书及包含所访问 IP 的 SAN；不绕过警告。\`http://\` 的私有 LAN Origin 可以录入，但每次打开都必须主动确认其**明文登录风险**，绝不自动发送当前 Bearer/Refresh Token。用户必须自行确保该地址只在可信网络可达；该选择不是建议在日常环境使用 HTTP 密码登录。
- xDrive 当前 Caddy HTTP Web 监听默认 \`127.0.0.1:3000\`，HTTPS 域名证书不自动适用于 \`192.168.2.4\`。所以本阶段 **不承诺用户已经有可达的 HTTPS IP 入口或安全 HTTP LAN 入口**。切换只是访问已经由运维正确部署的入口；没有暗中开启 \`3000\` 或修改 \`8443\`。
- 特别是家庭光猫 DMZ 已转发到 Linux 的情况下，擅自新增 LAN HTTP 监听存在公网明文暴露风险；后续必须独立审查防火墙/入站访问控制及 LAN HTTPS 身份后，才能授权真实 IP 登录部署。不要靠浏览器「忽略证书错误」获得安全会话。
- Desktop 已有自由编辑的服务器地址与服务器专属的安全密码记录；本阶段仅增加醒目的「手动切换」入口，先确认退出当前 Agent 连接再由用户登录所选入口。不会静默复用另一个服务器地址的凭据、自动迁移同步根或接管后台任务。

## 测试与验收

\`desktop/tests/web-manual-connection.cjs\` 使用真实 TS 源码转译验证 URL 接受/拒绝样例、内网 HTTP 标记、纯净 URL/Origin、Web 双入口、无 Token 迁移、\`noopener noreferrer\`、Desktop 显式退出及原始 Web 上传导航守卫。必须通过新的准确 HEAD 76-job GitHub CI（Go/PostgreSQL Race、Web、Desktop、Windows、Rootless、制品、single-commit、final-gate）且保持单工作提交、干净可合并再交付。

## 后续非本阶段

NET-M2 可按明确的用户许可/运维安全评审，再设计可信的 LAN TLS（证书/私有 CA）或受防火墙硬性限制的 LAN HTTP、稳定 Server Identity、跨入口会话管理和 Desktop 网络自动检测。普通浏览器在公网域名固定、光猫没有 NAT 回环、又不修改任何 DNS/Hosts/代理且 IPv6 不可达时，无法仅靠前端 JS 自动把这个域名的 TCP 连接改到私网 IP。

## NET-M2：服务器支持私网 IP HTTPS 登录（同一 xDrive Server，显式启用）

NET-M1 的 Web/PWA/Desktop 手动入口切换已经提供，但仅有 URL 导航不足以让 `192.168.2.4` 真正能够登录。NET-M2 在 **现有 Caddy 443 容器端口 / 现有 `XD_HTTPS_PORT` 主机端口**添加 *可选* 私网 IP HTTPS 虚拟站点，保持公开域名的 AliDNS 证书、原有 Web 与 `/api/v1/auth/login`、轮换 Refresh Token、API、图库和文件访问不变；不增加新的 Server/Agent 接口。两个 Web Origin 独立保存 Token，不能自动迁移会话。

**明确选择性启用**：在服务器持久化配置 `~/.xd/config/.env` 设置 `XD_LAN_HTTPS_IP=192.168.2.4`（替换为真实且稳定的 Linux 私网 IPv4），再通过现有受控 Host Manager 正常更新/重建 Caddy 镜像。旧部署默认 `XD_LAN_HTTPS_IP=` 为空，仍执行原始 `Caddyfile` 或 `Caddyfile.http`，没有新的 LAN HTTPS 站点。安装器和 Caddy 容器启动脚本都拒绝不规范、非 RFC1918、带前导零的 IP、缺少 `XD_DOMAIN` 的 IP 配置。IP 地址变更后要重新配置并重新颁发证书；`XD_HTTPS_BIND` 必须为 `0.0.0.0` 或该 IP。不得开放 `XD_WEB_PORT:3000`、变更光猫 DMZ、修改 DNS 或开启不受限的明文密码登录。

**私网证书信任前置条件**：Caddy 使用 `tls internal` 为 `192.168.2.4` 签发包含此 IP 的证书。公有 CA 不为 RFC1918 私有地址发证。操作员先通过安全的 Linux SSH/本机渠道核验并取出该 xDrive Caddy 的本地 Root CA，例如从容器持久数据目录 `/data/caddy/pki/authorities/local/root.crt` 读取，核对 SHA-256 指纹，再**逐台、经确认后**安装到需要用 IP 登录的设备信任存储。此 Root CA 可以签发其他域名证书，属于高敏感信任根；不能由网页、URL 查询参数、明文 HTTP 或下载链接自动安装。用户在完成信任之前不应忽略 TLS 证书警告，不要点击「继续访问不安全网站」输入账户密码。

**只读验收方式**：在家庭网络客户端、从独立可信通道取得 CA 后运行 `curl --noproxy "*" --cacert <可信root.crt> https://192.168.2.4:8443/api/v1/readyz`（端口以实际 `XD_HTTPS_PORT` 为准），必须通过 IP SAN 主机名验证并获得 JSON `{"ok":true}`；随后分别验证 IP Origin 登录/刷新/退出和公网域名登录/刷新/退出、Web/Mobile Web/PWA 文件/图库、改网断连恢复。私网 IP HTTPS 在当前 Linux 的 `8443` 已经被光猫 DMZ 转发的前提下 **不等于**仅允许 LAN 来源；保持防火墙最小授权，定期检查 SSH/其他服务公网暴露。不能宣称已在用户设备上签发、安装或验证 CA，直到物理验收通过。

**构建/回滚**：新增独立 `deploy/Caddyfile.lan-ip`（公网 AliDNS + 私网 `tls internal`）、固定 `deploy/caddy-lan-start.sh` 配置选择器，Caddy 镜像构建使用真实 `caddy adapt` 验证变体。原始 Caddyfile/HTTP 模式不变；关闭选项只需清空 `XD_LAN_HTTPS_IP` 并受控重建，保留已有域名、证书及原始 Caddy 状态。自动化测试覆盖拒绝公网/伪装 IP、无域名不启用、服务同源 API 契约、无明文端口变化、原始运维事务及启动配置的边界。NET-M2 **不**实现 NAT 回环、内网 DNS 自动选择、跨 Origin 无感登录、自动 CA 信任或公网安全认证变化。
