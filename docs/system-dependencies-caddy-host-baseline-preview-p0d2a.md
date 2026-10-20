# P0-D2a — Caddy 现有宿主配置差异：手动只读预览

基于已合入的 [系统依赖 UI v1.0 + HTTPS 宿主 8443 规格](system-dependencies-ui-v1-https-8443.md) §4.2 与 P0-D1 数据正确性。**本阶段只交付预览，不开放“采纳”写操作。**

## 背景与证据边界

现有管理员 HTTPS 只读预检（`GET /api/v1/admin/services/caddy/https/preflight`）已经提供单次带修订一致性重检的 PostgreSQL 快照、可信 Host 观测、同一实例本机 TLS/配置证据，以及**已保存目标与本机观测**的 `matched-local/mismatch-local/unverified`。这些不是可复用的管理员采纳授权、已应用回执、WAN/客户端 CA、或实际运行配置的完整明文身份。Host 监视状态只给出脱敏摘要和本机状态，不能凭旧 `XD_DOMAIN`、目标相等或独立 `caddy:443` 弱探针生成可信采纳对象。

## 本阶段实现

- Caddy **配置**页追加一条轻量“现有宿主配置差异”入口，必须管理员明确点击才调用**已有的只读** `loadCaddyHTTPSPreflight()`；切换标签、打开配置页和展开其它技术说明不会触发新的请求；不会触发 AliDNS 在线配额 API、Host Plan Apply、Host/DNS、证书或容器操作。
- 使用原 `verifyCaddyPreflightContract` 强校验前端不可信 IPC/HTTP 数据；共享纯函数 `assessCaddyHostBaselineReadOnly` 对请求结果与同一 source、同一已保存目标 revision、同一配置对象及证据版本严格匹配。旧 Agent 缺 `revision_snapshot_consistent` / 同一容器代际 / Caddy live config，或 Host 未验证，全部显示阻断原因；本机匹配也**永远** `can_adopt=false`。
- 使用 MUI Dialog 展示只读域名与私网 IP 的三态差异及采纳阻断项。异步响应、错误、弹窗关闭均不向已有 Caddy 页 `Stack spacing` 插入临时高度，避免 iOS PWA / Web / Desktop 切换抖动。源切换、修订变化、离开配置页和关闭弹窗都取消旧结果的 UI 接受；未保存草稿时禁止发起预览。弹窗没有确认采纳/Apply/Restart 按钮。
- 纯函数使用 Desktop Node 真实运行时 TypeScript 模块测试；新增源码负向断言证明只请求管理员只读预检。保持已有 Caddy 三导航、AliDNS、历史、P0-D1 来源区分与 7 项原始预检完全不变。

## 剩余 P0-D2b

真正管理员采纳基线还需要：由 Host 独立可信快照提供完整可归属的运行候选、有效期/实例绑定、去敏差异预览；管理员明确确认；新签名/nonce 防重放；跨 Server 的数据库修订 CAS、Host Pending 围栏、权限与审计同事务及失败回滚。它**只能**新建已保存目标，不会触碰运行 Caddy。缺少任一条件不显示写入操作，`apply_supported=false` 不变；不得借已有普通 Save 接口冒充采纳。

完整新 HEAD CI/Final Gate、Web/Desktop Linux/Windows、Go 真 PostgreSQL API Race、Host/Rootless/安装包/镜像及 fresh clean 是源码合并门槛。生产环境安全验收依用户永久决定 **跳过（未验收）**，不请求生产账号/证书/HAR/密钥，代码安全测试仍必须执行。
