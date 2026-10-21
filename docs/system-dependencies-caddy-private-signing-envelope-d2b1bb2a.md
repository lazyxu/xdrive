# D2b-1b-b2a · Caddy Host 只读签名信封的受限封装

2026-10-21。现行规格：docs/system-dependencies-ui-v1-https-8443.md；前置 [#2298](https://github.com/lazyxu/xdrive/pull/2298) 和 [#2302](https://github.com/lazyxu/xdrive/pull/2302)。

## 本阶段真实代码范围

新增 internal/caddyhostidentity/prepare_sign.go：一个**包内非导出的、无 IO 的** Ed25519 read-only 签名封装。必须由后续独立可信宿主观察器同时声明域名及 LAN 的观察已完成，且由现有 VerifyReadOnly 原协议再次校验规范 JSON + LF、44 字节 SPKI DER 指纹、域隔离签名、Host/Server/Caddy 代际/Live Config、正反入口声明和 45 秒新鲜度，然后才返回敏感的私有 JSON 与 64 字节签名。所有拒绝仅返回固定非敏感错误；不会输出私钥或 Host 原始信息至 API、数据库或日志。

本阶段只是**供未来 Host 进程内部集成的密码学打包层**，并没有把布尔标记当作独立测量事实；因此 helper 不导出，也没有生产 Host Publisher、配置文件自动加载、定时发布、真实正反入口观察或 Server endpoint 接线。任何测试里手工构造的观察标志都是合成数据，不能作为签名 Host 实际已可信的证据。

测试仅用确定性 Ed25519 合成夹具验证双方入口观察标记、畸形密钥、时间/身份/输入拒绝、读写协议兼容及单入口 disabled *claim* 不授予采纳能力；Windows 私有 Reader 仍 fail closed。

## 必须继续

D2b-1b-b2b：**真正的**固定可信 Host Collector，采集实际运行 FQDN/RFC1918 IPv4、Caddy 实例/代际/Live Config，独立 TLS 入口启用正向和禁用负向观察，并完成 operator 管理的信任根与私有文件安全发布。D2b-1b-b2c：独立 Server 只读消费、固定信任 pin、过期/失败受限阻断证据及代码级对抗测试。再执行 D2b-2 一次性签名采纳 CAS，D2b-3 管理员明确确认；真实 Host Apply/Rescue/watchdog/rollback/receipt 仍属于 #2075。

目前始终 CandidateComplete=false、CanAdopt=false、ApplySupported=false；不能开放重新部署，也不声称真实生产可达。生产环境安全验收按用户决定跳过（未验收），源码安全、真实 PostgreSQL API Race、Go/Web/Desktop/Host Rootless/Final Gate 不跳过。
