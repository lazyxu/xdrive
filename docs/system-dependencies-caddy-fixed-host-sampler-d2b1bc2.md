# D2b-1b-c2 · xDrive Caddy Host 私有固定只读 Docker 采样

2026-10-22。基于仍待自身准确 HEAD CI 的 #2323（进程 Generation / Live Config 前后窗口纯函数）。**本 PR 只实现安全采样零件，不开放任何新的用户或管理员权限。**

## 实际实现

- 仅允许两种固定 Linux Host 操作：固定 `xdrive-caddy` 的五字段 `docker inspect`；固定 `docker exec xdrive-caddy` 内 `127.0.0.1:2019/config/` 原始内存配置仅在容器内部 SHA-256，Host 进程不读取/返回完整 JSON、.env、AliDNS 明文。
- Go Host 私有命令参数白名单，不接收调用者指定的容器、路径、URL、Docker flags、shell 脚本或凭据；执行路径固定 `/usr/bin/docker`，Docker 上下文环境受限，超时 4 秒、输出 256B、stderr 丢弃、错误仅统一 `errUntrusted`。取消、Windows、未知命令、非官方/rootless 路径均 fail-closed。
- 严格只接受单行 `ID|StartedAt|PID|true|healthy` 与 `sha256sum` 固定格式，拒绝额外输出、畸形字段、坏哈希、空配置哈希；先后采两组，并围住调用方只读 Probe。使用父 PR 的进程代际/内存配置 SHA 一致性校验，检测重建、进程 PID 变化、配置 reload 等。
- 对抗测试涵盖固定命令、输出超限、超时取消、坏 inspect/hash、坏 Probe、缺采样器、配置在位 reload、容器重建和观察顺序。独立 Go1.23 标准库沙盒已运行 `go test`、`go test -race`、`go vet` 通过；完整仓库 Go1.25/真实 PostgreSQL Race/跨平台与 Final Gate 尚须 PR 合流后的 CI。

## 不等于可信采纳或部署

这是还未挂入真实高权限 Host Runner 的**包内零件**。固定命令及前后相等本身不证明样本出自可信宿主、无 A→B→A、禁用入口确实不接受 TLS/登录，也不证明公网可达。任意成功回调不能冒充独立负向证据。后续必须完成独立 Host Collector 的特权边界、禁用入口实际负向观察、独立签名发布/私有消费、单次双修订 CAS/审批、Rescue、Watchdog、Rollback 和不可伪造回执。

`CandidateComplete=false`、`CanAdopt=false`、`ApplySupported=false` 均维持。不得接入浏览器/Server API 来执行 Docker，亦不得修改运行中的 Caddy、DNS、8443、证书、路由器或容器。

本 PR Draft 依赖 #2323：父成功合入后，在完整最新 master 重建为一个 scoped work commit，运行自己的准确 HEAD CI（真实 PG API Race、Go Linux/Windows、Web/Desktop、Rootless、制品、Final Gate、fresh clean）后才能考虑合并。生产环境专属验收 **按用户决定跳过（未验收）**，源码安全和测试不跳过。
