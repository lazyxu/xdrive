# NET-M5-B2 — Caddy HTTPS 双入口宿主应用计划（只读准备阶段）

本阶段把 xDrive「系统依赖 → Caddy」已审计、已保存的目标配置导出为**规范、无密钥的版本化运维计划**，并在宿主机只读复核配置一致性。它准备最终的“保存 → 安全应用 → 受控重启 → 实效验证 → 超时回滚”流程，**本阶段没有实际应用能力**。

## 实现与证据边界

- 仅管理员可访问 `GET /api/v1/admin/services/caddy/https/host-plan`。该接口使用既有管理员认证、PostgreSQL repeatable-read 的 HTTPS 与 AliDNS 双修订快照，生成 Canonical JSON。未保存修订、双入口均关闭、非法域名或私网 IP、域名启用却缺少加密 AliDNS 凭据，全部拒绝导出。
- 本次修复期望快照中遗漏的 LAN 开关及 LAN IP 对比。生成计划前后核对两项开关、两种地址、两种修订及已加密凭据元数据。快照复核不等于跨进程、跨时段的 Host Manager CAS。
- 只有操作员在受信任宿主机上执行 `scripts/caddy-https-host-plan.py`；它读取独立校验的计划 SHA-256 及当前私有 `.env`、Compose，拒绝软链接、无写入端 FIFO、不可信权限、重复字段、非法 IPv4/FQDN、错误 Bind/端口与文件中途替换，计算现有入口/目标模式差异及固定风险代码。
- 结果不包含原始域名、IP、AliDNS Secret、Token、CA 或原始 Compose。所有成功的本地预览均报告 `apply_supported=false`。它**不调用 Docker、网络、DNS、Caddy 或操作系统信任库，也不写宿主机文件、不能重启**。
- 既有 `apply_state=pending`、七点预检、`restricted-apply=blocked`、`public-https=unknown` 不变；任何计划哈希或本机 TLS 成功都不能冒充“已生效”。

## 规范输入

Canonical JSON 是严格小写 ASCII 字段值、键名排序、紧凑编码、末尾一个 LF。下列为无密钥、IP-only **示例**：

```json
{"credential_revision":0,"desired_revision":7,"domain":"","domain_enabled":false,"lan_enabled":true,"lan_ip":"192.168.2.4","protocol":"xdrive.caddy.https.host-plan.v1"}
```

字段固定：`protocol`、`desired_revision`、`credential_revision`、`domain_enabled`、`domain`、`lan_enabled`、`lan_ip`。整数修订小于 2^60；至少启用一个 HTTPS 入口；域名只接受规范小写 ASCII FQDN；IP 只接受规范 RFC1918 IPv4；启用域名必须有正的 AliDNS 凭据修订。额外/重复字段、浮点、IPv6、CIDR、URL、通配符、八进制/缩写 IPv4 都被拒绝。

## 宿主机只读预演

通过现有可信 HTTPS 管理员会话，安全地获取上述管理员 API 的**原始响应字节**，在操作员机器以模式 0600 保存为私有文件，并在**独立可信通道**核对其 SHA-256。不要把浏览器会话 Token、Secret 或 Caddy Root CA 写入该计划或命令行。

```bash
python3 scripts/caddy-https-host-plan.py \
  --plan "$HOME/.xd/state/caddy-host-plan.json" \
  --env-file "$HOME/.xd/config/.env" \
  --compose-file "$HOME/.xd/config/docker-compose.yml" \
  --expected-plan-sha256 "$TRUSTED_PLAN_SHA256"
```

仅从同一不可信文件计算哈希，再把它冒充“独立批准”没有认证效力。工具输出 `current_mode`、`desired_mode`、`changes`、`blockers`、`candidate_sha256`、`host_environment_sha256`、`host_compose_sha256` 与修订号，均无敏感明文。阻断时以固定 `invalid-or-changing-input` 报错，不泄露路径和异常文本。

## 尚未完成：真实自动应用 NET-M5-B3/C

真正让系统依赖页面“保存、应用、重启生效”还需独立交付：可信的宿主 Host Manager 版本化双修订 CAS、经过审核的 Operator Rescue 与异机登录实测、安全交付 AliDNS 凭据、原子替换环境和备份、独立限时回滚看门狗、两个真实 HTTPS 入口与登录/刷新/退出测试、失败恢复回执、不可变审计及 UI 真实进度。任何一项缺失均不得开放危险的 Apply/Restart 开关。

目前新部署优先直接配置 **IP HTTPS**；域名需要单独配置；两者可同时启用但不能全部关闭。对私网 IP 使用本地 CA：**浏览器/手机首次登录前仍须从可信通道核对并信任 Caddy 私有 CA，不能跳过 TLS 证书警告输入密码。**

## 回归

CI server-validation 执行 `python3 scripts/test-caddy-https-host-plan.py`。离线测试覆盖 IP-only、双入口、启停/切换、错 IP/FQDN/端口/Bind、双关、缺少 AliDNS 修订、重复与未知字段、错误摘要、损坏或可替换文件、FIFO、软链接与保守无密钥输出。Go 纯函数输出与 Python 严格规范必须一致，新的管理员只读路由仍在 requireAdmin 保护下。只有本工作提交完整准确 HEAD CI（Go PostgreSQL Race、Linux/Windows、Web/Desktop、Rootless、制品、Final Gate）全绿且 GitHub clean，才可合并。
