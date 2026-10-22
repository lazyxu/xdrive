# D2b-1b-c1 · 受信 Caddy Host 运行窗口绑定（第一段）

日期：2026-10-22。基于父 Draft #2318 的私有签名 Bundle 读取锁隔离，后续独立阶段，不复用旧 CI。

## 本阶段真正交付

- 在原 `internal/caddyhostidentity` 中增加**不导出**的 Host 运行样本绑定函数，匹配当前 Host Control 已使用的五字段固定 Docker inspect 结果，严格要求真实采样窗口前后相同的固定容器 ID/启动时间/PID/运行与健康状态，以及非空 Caddy **内存态** /config/ JSON 的 SHA-256。
- 不完整样本、进程重启、在位 Caddy reload（配置摘要改变）、PID、时间戳、TLS 空值假数据、前后不一致全部拒绝，返回统一 `errUntrusted`，输出仅包含域分离散列，不输出 Docker ID、原配置或密钥。
- Go 回归覆盖正常窗口、A→B config、PID 与状态变化、伪造字段、时戳与摘要无效、JSON 对外零字段，源代码共享给 Host Collector，不增加 Server/浏览器 API。

## 不允许的推断

此纯代码配对函数**尚未采集真实 Docker/Caddy**；它不能证明样本来自可信 Host，也不能排除 A→B→A 变更。须由后续独立特权 Host Collector 负责固定实例观察、采样区间与真实启用/禁用入口正反验证，且签名受信发布、Server 私有消费和数据库修订授权均应分离。

特别是未经独立验证的“连接失败”**绝不构成禁用入口负向证据**；不得仅凭它签发有效 Host 身份或打开采纳／部署能力。`CandidateComplete=false`、`CanAdopt=false`、`ApplySupported=false` 均不变。

## 合并依赖与测试

父 #2318 合入后以完整最新 `master` 重建为唯一 scoped work commit，运行本 SHA 的原 Go/Linux/Windows、PostgreSQL API Race、Web/Desktop/Rootless、镜像/制品、Final Gate 并确认 clean；本 Draft 没有这些运行结果，不能先合并。生产环境验收**按用户决定跳过（未验收）**，源码安全和 CI 不跳过。
