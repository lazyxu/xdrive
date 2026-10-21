# D2b-1b-b2b1 · 真实本机 HTTPS TLS/Ready 正向观察（只读）

2026-10-21。遵循系统依赖 [UI v1.1 规格](system-dependencies-ui-v1-https-8443.md)、[安全宿主采纳 #2253](https://github.com/lazyxu/xdrive/issues/2253) 和 [受控 Host Apply #2075](https://github.com/lazyxu/xdrive/issues/2075)。

## 本阶段已经写入的源码

仅新增 internal/caddyhostidentity/positive_observer.go，定义**包内非导出**的真实本机 TLS/Ready 正向探针：公网域名通过系统信任根对固定 127.0.0.1:8443 的 SNI 与 TLS hostname 进行严格验证；LAN 仅接受 RFC1918 IPv4、确实属于本机的网络接口，并要求明确受信的本机 CA 根，目标严格固定为该本机 IP:8443，证书 IP SAN 必须有效。无代理、Cookie、JWT、Authorization、重定向、InsecureSkipVerify、动态域名解析或管理员输入 URL；固定 GET /api/v1/readyz，最多 1024 字节 JSON，ok 必须为 true，客户端操作最长 6 秒/连接最长 2 秒并响应 ctx 取消。只保留绑定证书及请求范围的 SHA-256 内部摘要，原始证书、FQDN、LAN IP 和回复体不作为可返回 API 字段。

测试使用**真正的本机 HTTPS listener + 临时合成 CA/服务器证书**，覆盖合法域名 SNI、合法私有 IP SAN、不匹配 hostname/IP SAN、错误信任根、302 重定向、false Ready、HTML、超限响应、尾随 JSON、取消与输入限制，并在本地 Go Race 下执行。没有真实用户生产网络测试。

## 明确不能声称已实现

此阶段的 Ready 只能证明**这次本机 TLS/Ready 正向握手**，不能证明服务端管理员已登录、禁用入口无法访问、当前 Caddy 容器代际和 Live Config 与 TLS 同一快照，也不能证明互联网或用户手机可达。**没有真实 Host Publisher、独立关闭入口负向验证、Host 操作者私钥发布、Server 端私有 pin 消费、采纳授权、Host Apply、Rescue/watchdog/rollback/Applied Receipt。** 此正向摘要没有接入 b2a 签名器或管理员 API；一切 CandidateComplete/CanAdopt/ApplySupported 仍然 false。

下一段 D2b-1b-b2b2 必须实现固定 Docker/Caddy generation + Live Config 对齐和独立正反入口观测，以及 Host-owned 私有发布；b2c 必须落实受信 Server 消费、签名/失效理由，之后才可以考虑 D2b-2/3 和 #2075。当前源码测试不等价于生产操作许可。

生产安全验收按用户决定跳过（未验收），不索取生产账号/AK/JWT/Cookie/HAR/抓包/人工签字；真实 Go/PG API Race/Web/Desktop/Host/Rootless/制品/Final Gate 不跳过。
