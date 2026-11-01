# xDrive 双入口 HTTPS 证书与客户端信任

> 适用：公网域名 HTTPS + RFC1918 私网 IP HTTPS。管理入口为
> **管理 → 系统依赖 → Caddy → 配置 → HTTPS 证书管理**。
> 只处理证书、公有根 CA 和无凭据的身份探测；不处理服务器私钥或跳过 TLS。

## 管理员界面

当前 Host 的 `~/.xd/config/.env` 是四项 Caddy 配置的唯一权威。
启用域名、内网 IP、保存配置后，仍需**单独应用 Caddy**。已有 Caddy
自动使用 AliDNS DNS-01 为公网 FQDN 获取 ACME 证书，同时使用
`tls internal` 为私有 IP 获取含 IP SAN 的证书，均由 Caddy 持续管理。

新的证书面板复用原有管理员 HTTPS 读取响应，独立展示：

- 公网：最近固定 Caddy 容器上验证的叶证书 SAN、颁发者、起止日期、
  DER SHA-256 指纹、实际验证链的公共根 CA 指纹/到期日期，
  及按需下载的**公开叶证书**。
- 内网：固定容器严格验证 IP SAN/证书链后的叶证书信息、Caddy
  **公开根 CA** 的 DER SHA-256 指纹、到期日期、PEM / iPhone DER-CER 下载。
- 未启用、旧 Server/Agent、保存但尚未应用、Host 观测过期、当前容器
  证书不匹配/失效、CA 根无效时不提供证书材料，也不将状态误标成可信。
- 数据来自固定内部服务 `caddy:443` 和固定公共证书路径，不接受来自
  浏览器的服务器地址、端口、证书根 URL、代理、重定向或自定义 TLS 配置。
  所有 TLS 握手要求有效证书链与指定域名 / IP SAN；不使用 `-k` 或
  `InsecureSkipVerify`。
- 报告仅表示**短时 Caddy 容器本地 TLS 验证**，不表示公网 DNS/路由/防火墙、
  客户端系统 CA 已信任，或 Caddy 运行状态永远不会变化。

**不能下载** Caddy 私钥、ACME 账户密钥、AliDNS AK/SK 或其他凭据；
不得把私有 CA 根证书误当作公网权威 CA。公开根 CA 虽不是秘密，
但对它的信任**具有高权限**：任何获信任根的签发者可以为其他域名
签证书。必须通过独立可信渠道核对 SHA-256 指纹。

## 各客户端

| 客户端 | 公网域名证书 | 内网 IP 证书 |
| --- | --- | --- |
| iOS 原生 SwiftUI | iOS 系统标准公开 CA 校验 | 手动安装核验后的 CER 和开启完全信任；原生 URLSession 仍验证 IP SAN |
| Android 原生 Compose | Android 系统默认信任策略 | 不自动信任用户新增 CA；建议用内网分流 DNS 将公网域名定向到 LAN 地址 |
| Windows Desktop | 系统公开 CA；已有证书错误诊断 | 已有经用户批准的应用内本地 CA 信任 / 撤销流程，无需提升为 Windows 全局根 |
| Linux Desktop / xd CLI | 公开 CA | 通过受信任系统/应用的 CA 管理策略和真实 IP SAN 校验；不要关闭 TLS |
| Web / Mobile Web / PWA | 浏览器公开 CA | 浏览器使用操作系统或自身证书信任存储；网页不能静默安装根 CA |
| DSM 管理员 Web | 与浏览器相同 | 同上；Caddy 管理功能使用共享 MUI，不建立第二套 DSM UI |

### iPhone 首次连接

1. 使用**已经可信**的公网域名或 SSH 等独立渠道进入管理页。
2. 核对「局域网 IP HTTPS」的实际 IP SAN，记录根 CA SHA-256 指纹；
   通过独立安全渠道再确认一次对应服务器身份。
3. 点击「下载 iPhone 根证书（CER）」；在 iPhone 上打开后，
   「设置 → 通用 → VPN 与设备管理」确认安装描述文件。
4. 在「设置 → 通用 → 关于本机 → 证书信任设置」手动打开该根的完全信任。
5. 回到 xDrive 登录页，再输入 HTTPS 域名 + 可选 LAN IP，正常登录。
   **不要**在错误提示下点击忽略 HTTPS、接受不明 CA 或禁用验证。

iOS 不会因证书已生成而自动信任它，证书根轮换后也必须重新核实信任。

### Android 首次连接

当前 Android 的可选内网 IP 是 **OkHttp DNS/TCP 目标覆盖**：URL、HTTP Host、
TLS SNI 以及主机名验证都保留在已配置的 HTTPS 公网域名上。因此在 Caddy
域名入口也可从内网到达的条件下，填写“公网域名 + 内网 IP”就能通过
**公网证书走内网**，无需全局安装 Caddy 私有根，也无需光猫 NAT 回环。
Android 7+ 应用通常不信任用户安装的根 CA；直接以 HTTPS IP URL 访问
仍需独立的应用级可信身份机制。这里不提供“信任所有用户 CA”或
“忽略证书错误”开关。若未来增加应用内私有 CA 信任，必须绑定确切
Server/Owner、IP:端口、根指纹并支持撤销。

### 桌面、浏览器及 CLI

- Desktop 的首次私网 TOFU 与基于已信任公网证书的交叉绑定流程详见
  [手动内外网连接](network-manual-connection.md)；批准只作用于该 IP/端口，
  不修改全局系统 CA。
- 浏览器/PWA 无法自动配置系统根。需要从独立可信渠道验证公有根，
  然后根据操作系统证书安装政策处理。
- Linux 服务器上仍可执行
  `xdrive-server lan-ca export /absolute/path/root.crt` 获取与实际
  Caddy IP SAN/TLS 链核对后的公开根 CA；此操作不涉及任何私钥。

## 回归合同

- 管理端始终区分公网与内网证书状态、禁用与未验证；刷新、保存但不部署、
  Caddy 代际改变及失效证书不提供假「已信任」结果。
- 同源管理员读取带现有的管理员身份保护和 `Cache-Control: no-store`。
  公共证书仅在明确点击下载后保存至设备，浏览器不会静默安装 CA。
- 主机不会接受来自客户端的任意根证书上传、证书私钥导出、开 TLS 验证
  豁免或修改新的公网端口。
- 已开始/通过 CI 的无关 PR 不修改；所有上线仍经过新的 PR、适用 CI
  和发布工作流验证。真实终端 CA 信任需要设备端核验，代码/CI 不能替代。
