# P0-D2b-1a：Caddy 管理基线——受限只读候选证据

基于 [UI v1.0 + HTTPS 宿主 8443 规格](system-dependencies-ui-v1-https-8443.md) 与 [#2253](https://github.com/lazyxu/xdrive/issues/2253)。本阶段是 **D2b-1 的第一段合同，不是 D2b-1 完成、更不是 D2b-2/3 或 Host Apply**。

## 已确认的源码边界

当前 `caddy-runtime-status.json` 仅保存受信 Host Control 的新鲜度受限状态、TLS 校验后 SNI / IP 的 SHA-256 摘要、固定 Caddy 同一实例代际的粗粒度判定、Live Config 是否可读的摘要。**它没有独立、可复核、签名且可授权的完整宿主域名、LAN 地址、运行身份或原子候选快照**。Saved PostgreSQL desired 与旧宿主导入不是独立运行来源，`XD_DOMAIN`/`XD_LAN_HTTPS_IP` 属部署提示；证书校验成功亦不能证明运行目标已经应用。

## 本阶段新增代码

- 管理员专属 `GET /api/v1/admin/services/caddy/https/adoption-candidate`，通过原 Router `requireAdmin()`；独立的 no-store / no-cache / no-referrer，只读，无任何写路由。
- 在两个 PostgreSQL Repeatable Read 快照以及两次 Host 状态读取之间进行保守一致性复核；目标、AliDNS 密文修订、Host Pending 或状态发生变化则 409，读失败 503。**这仅约束当前读窗口，不构成未来写 CAS / 防重放授权。**
- 返回限定枚举的 host generation / live config / domain 与 LAN 三态比较、目标及 AliDNS 修订编号、Host Pending 标记、阻断码；**不返回**原始域名/IP、指纹、Caddy JSON、Docker/CA/AliDNS 密钥、宿主路径、证书、凭据或运行环境。
- 完整本机 TLS 匹配仍必须 `candidate_complete=false`、`can_adopt=false`、`apply_supported=false`，并显式保留 `independent-running-identity-unavailable` 阻断码。不存在采纳请求、SQL 目标改写或容器操作。
- Go 原生单元测试覆盖双入口匹配、缺失快照、陈旧 Agent、Host Pending、修订 #0、TLS 指纹不匹配、关闭入口无法被负证据证明及敏感内容泄漏。真实 PostgreSQL 原 HTTPS 集成测试增加管理员/非管理员鉴权、私有响应、不泄漏、不可 POST 以及只读响应检查。

## 后续仍未实现

**D2b-1b** 需要新、独立的受信 Host 运行候选协议：真实规范域名和 RFC1918 IPv4 的独立来源、完整双入口状态、容器/宿主身份及实时运行配置一致性、签名/时间戳/TTL 与去敏输出。当前 digest-only Host 状态**不能**恢复运行值，也无法证明关闭入口真的关闭。不能仅因本阶段接口出具 matched-local 就开放采纳。

**D2b-2** 独立受信管理员授权、短效 nonce/签名、跨 Server 双修订 PostgreSQL CAS、不可变审计与事务回滚；**D2b-3** 独立确认 UI，仍未开始。最终生效回执永远是独立证据，Host Apply/Restart 继续不可用。

生产专属安全验收依用户决定 **跳过（未验收）**，不作为源码/CI 门禁，不索取生产密钥/HAR/权限。准确 HEAD 77+ 全量 CI、Go 真 PostgreSQL API Race、Web/Desktop、Linux/Windows、Rootless/镜像/制品/Final Gate 及 fresh GitHub clean 全部通过前保持 Draft。
