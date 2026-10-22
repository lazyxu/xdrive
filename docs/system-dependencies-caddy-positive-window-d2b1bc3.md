# D2b-1b-c3 · Caddy 已启用入口本机 TLS 正向证据绑定

2026-10-22。此阶段依赖原有签名 Reader/Bundle、[#2323](https://github.com/lazyxu/xdrive/pull/2323) 固定运行身份配对以及 [#2324](https://github.com/lazyxu/xdrive/pull/2324) Host 私有只读 Docker 采样。仅新增包内代码/测试/说明，不改真实 Server/Host/DNS/ACME/8443 或用户配置，不开启浏览器权限。

## 实施内容

- 已存在的 `probeCaddyDomainReady` 对固定宿主 127.0.0.1:8443 做真实 HTTPS SNI/系统 CA 与 Ready 校验；`probeCaddyLANReady` 对宿主拥有的 RFC1918 IPv4:8443 做 IP SAN/受信 Local CA 与 Ready 校验。调用该正式验证器，而不是将 HTTP 200 或回调成功当作任意可信证明。
- 新增不导出的 `privateObserveEnabledIngressWith`：只接受独立可信 Host 配置（不能从 DB Desired、用户 Cookie、浏览器输入、Host 导入 hint 推断）；合法域名/LAN IP/CA 及至少一个入口启用；把启用入口顺序正向校验夹在两次固定 Docker 实例 / Caddy Live Config SHA 的读取之间。both-on 任一 TLS 失败、配置进程代际变化、取消、无证书/非法目标都拒绝，返回统一脱敏错误。
- 返回类型 `privateHostPositiveOnly` 含不导出的域名/IP 本机正向证明 digest 和窗口身份；禁用入口对应 digest 为空**只代表未测**，绝不当作关停负向证据。JSON 编码不暴露真实域名/IP、运行身份或配置。
- 默认包内 wrapper 仅调用既有 `runPrivateFixedDockerSample`、`probeCaddyDomainReady`、`probeCaddyLANReady`。其他 callback 注入仅限同包对抗单测，不是独立特权 Host Collector。
- Go 单测：both-on 顺序、domain-only / LAN-only、both-off、格式错误、公共 IP、私网 CA 缺失、失败的域名/局域网 TLS、配置在位重载、取消、零 JSON/Owner 泄漏。本轮已在真实 Git Blob 内容与 Go1.23.2 隔离 harness 下运行 `gofmt`、`go test -race`、`go vet`；完整仓库 Go1.25/真 PostgreSQL Race/跨平台 CI 需后续独立完成，不能误报为全绿。

## 未实现与安全门禁

本阶段仅为**已启用入口的本机正向证据**。没有可信 Host-owned 配置读取源的全链闭环、对禁用域名/IP 的独立负向 TLS+认证验证、A→B→A fencing、签名 Host Collector 产出、私有 Server 消费、一次性双修订 CAS、操作员确认、only-Caddy Apply、Rescue/Watchdog/自动回滚、签名 Applied Receipt。即使函数通过，`CandidateComplete=false`、`CanAdopt=false`、`ApplySupported=false`，不显示重新部署操作。

本 PR 是基于 #2324 的独立 Draft。先完成 #2323/#2324 自身准确 HEAD 全量 CI/合入，最后把这次四文件 scope replay 到完整 master，执行自身 Go、真实 PostgreSQL Race、Web/Desktop、Host/Rootless、制品、Final Gate 与 fresh clean 后才可合并。生产环境专属验收 **按用户决定跳过（未验收）**，源码安全和自动测试仍强制。
