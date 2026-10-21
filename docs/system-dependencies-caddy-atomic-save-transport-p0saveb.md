# P0-SAVE-B · Caddy v1.1 双修订原子保存跨端传输（仅传输层）

日期：2026-10-21。正式产品规格为 `docs/system-dependencies-ui-v1-https-8443.md` v1.1。
前置 Server 实现位于独立 Draft PR #2272；单页面位于独立 Draft PR #2270。本 PR 仅补充这两者尚未覆盖的 Web / Mobile Web / iOS PWA / Desktop / Go Agent **同一目标保存事务传输链**，不接线现有页面、不新增第二个控制通道，也不执行任何 Host 操作。

- Web 经既有管理员授权 HTTP Client 提供 `adminSaveCaddyConfiguration`，一次 PUT `/api/v1/admin/services/caddy/config`。
- Desktop 经受控 Electron preload/Main IPC、现有 `admin-services` capability、Agent loopback IPC `PUT /v1/cloud/admin-caddy/config`、Go Client 转发同一个 Server PUT。旧 Agent 没有新接口，明确返回 501，绝不自动退回 HTTPS/AliDNS 两笔独立保存。
- 输入强制双修订 `https_revision` / `alidns_revision`。HTTPS 四字段完整保留（域名启用/FQDN、LAN 启用/RFC1918 IPv4）；AliDNS 显式替换或清除，不能空输入默默清除。边缘 IPC 限制 JSON 正文字节、禁止未知字段、拒绝漏填/超长/两入口同时关闭。Server 继续负责最终管理员鉴权、FQDN/IP 校验、加密、双修订 CAS 与 SQL+审计事务。
- 成功响应只含双修订和 `saved=true`、`host_applied=false`、`apply_supported=false`；任何返回均不能作为生效证据。无 Caddy/Docker/DNS/证书/8443 变更。
- 后续独立 P0-SAVE-C 接线一张共享 Caddy 页面上的**唯一「保存配置」**动作；在旧服务器/旧 Agent 或缺少任一可信修订时禁用，不得自动回退两阶段写入。已合并历史恢复入口仍是单独的目标历史事务。独立受信重新部署 #2075 继续 NO-GO。

交付门禁：完整最新 master，单一 scoped commit，准确 HEAD 全 CI（真实 PG API Race，Go Linux/Windows、Web/Desktop、Host/Rootless、安装/镜像/Final Gate）、新鲜 clean 后才 Ready/Rebase。生产环境专属安全验收**按用户决定跳过（未验收）**，并非源码安全免检。
