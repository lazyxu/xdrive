# D2b-1b-c4 · Caddy Host 禁用入口 TLS 主机名不匹配的受限证据

2026-10-22。依赖已合入的签名 Bundle、#2323/#2324 私有运行窗口及 #2328 已启用入口本机正向 TLS 证据。**本 PR 是保守的只读 TLS 辅助观察，不是已完成的禁用入口负向验证。**

## 新增范围

- 包内 Go `privateProbeTLSNameMismatchAt` 使用真实 TLS 证书校验（不设置 `InsecureSkipVerify`），仅在收到可区分的 `tls.CertificateVerificationError` + `x509.HostnameError`、错误属于请求的规范 FQDN/IP，且再次以 Host 受信 Root CA/中间证书验证真实证书链、有效期、ServerAuth 后，才保留不导出且不可 JSON 序列化的弱观察摘要。
- 正式包内 wrapper 只对固定 Host `127.0.0.1:8443` 检测规范域名；私网 LAN 仅对真实宿主拥有的 RFC1918 IPv4:8443 和独立操作员 Local CA 做观察。通用目的地址仅为包内合成 TLS 端到端测试，不面向 Server API、浏览器或管理员输入。
- 真实 Go `httptest` TLS CA/leaf 证书测试：启用域名提供正确证书时必须拒绝弱负向信号；其他已由受信 CA 签发的名称不匹配可记录弱信号；CA 不可信、TCP 拒绝、畸形身份、取消、Host 非自有 LAN、CA 缺失全部拒绝。
- 已对 exact new source/test blob 进行隔离 Go1.23.2 的 `gofmt`、`go test -race`、`go vet`，并保存源 Blob SHA。完整 xDrive Go1.25、真 PostgreSQL API Race、Web/Desktop/Windows/Host/Rootless/制品/Final Gate 需要继承链合入后独立准确 HEAD CI，不能用隔离测试代替。

## 严格未完成内容

**主机名不匹配绝不等于域名/IP HTTPS 入口已禁用。** TLS 可能返回其他合法站点证书；Host Header 或别的 SNI/地址仍可能路由到同一服务。TCP/握手失败也可能由故障导致。因此本模块不得生成任何 `disabled-local-negative-observed` 签名宣称，不得复用为单次授权、采纳、Redeploy、恢复完成或 Applied Receipt。

后续仍须独立 Host Collector 采样来源、A→B→A 防护、同一固定部署实例的启用正向/禁用负向 TLS + 匿名拒绝/管理员授权对照、信任根私有 Server 消费、双修订单次 CAS、Rescue/watchdog/rollback。保持 `CandidateComplete=false`、`CanAdopt=false`、`ApplySupported=false`。

本 PR Draft 堆叠在 #2328 上，不修改运行网关、Docker、8443、DNS/证书或生产账号。生产环境专属安全验收 **按用户决定跳过（未验收）**；不索取生产账号/AK/JWT/Cookie/HAR/抓包，不作为源码或 CI 合并阻塞。源代码安全和自动 CI 仍必做。
