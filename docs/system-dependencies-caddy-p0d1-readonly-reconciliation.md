# P0-D1 — Caddy 运行、管理目标与应用回执的只读核对

2026-10-20 · 对照已合入的 [系统依赖 UI v1.0 + HTTPS 8443 规格](system-dependencies-ui-v1-https-8443.md) 第 4.2 节。

## 源码证实的差距

Server Caddy HTTPS GET 在 revision #0 时可从校验过的 `XD_DOMAIN` / `XD_LAN_HTTPS_IP` 填充仅用于初次编辑的宿主环境提示。先前共享 Caddy 概览却可将 `desired_domain` 误显示为已经保存的管理目标，并在 revision #0 下用 LAN 字段进行 drift 判定。这混淆了未持久化部署提示与 PostgreSQL 管理修订。

## 本轮修复

- 新的共享纯函数 `caddy-reconciliation.ts` 仅在 **安全整数且 revision > 0**、来源 saved/host-import、两个 LAN 目标字段完整、可信 Host 已观测、且 Host LAN 本机 TLS/IP 证据验证通过时，才输出 matched-local 或 mismatch-local。revision #0、旧 Agent 缺字段、Host 不可证、独立 `caddy:443` 弱探针、证书失败与不规范启用目标全部输出 unverified。
- 区分可信 Host 域名 TLS 与固定 `caddy:443` HTTPS/Ready 探测；公网域名和私网 IP 的部署声明不升格为实际运行证明。配置页始终清晰区分运行、**确实已保存的 PostgreSQL 目标**和不存在的修订绑定 Applied Receipt。字段相等、Host Pending、host-import 均不是 Apply。
- 保留 Caddy 概览／配置／历史、未保存编辑草稿、按需历史、AliDNS 密文及最长 30 秒查看，七项人工预检和其它 10 项服务不变。手动“重新检测”并行刷新服务与管理目标，只读且在编辑草稿未保存时禁用；不自动产生额外远端请求。无新 Server、Desktop Agent、DNS、CA、Caddy 容器、8443 或 Host Apply/Restart 操作。

## 验证与未完成事项

新 Desktop Node 回归**实际执行 TypeScript 纯函数**验证 revision #0、saved/host-import、旧 Agent 缺字段、真实 mismatch 与不具备可信 Host/本机 TLS 时的 fail-closed；原 Caddy Desktop 检验同步加强，不能删除既有事实/草稿/API 断言。新 HEAD 必须通过 Go/PostgreSQL API Race、Web/Desktop、Host/Rootless、Windows/Linux 制品、镜像及 Final Gate，合并前重新取得 GitHub clean。

本代码不提供管理员采纳宿主基线的写接口。此能力仍需独立可信新鲜快照、差异预览、管理员显式确认、DB 修订 CAS、审计、失败回滚，并只写目标 DB 而不操作 Host。生产环境安全验收按用户决定**跳过（未验收）**，不阻塞源码/CI；实际生产客户端 CA/WAN/LAN、Applied Receipt 与 Host Apply 仍未验收/实现。
