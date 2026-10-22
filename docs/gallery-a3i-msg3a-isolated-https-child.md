## 2026-10-22 · Child IPC replay/resource-boundary hardening

- 继续原 #2299（不新增重复 PR）：Parent iframe 每次 load 必须重新生成随机 nonce 和 generation；旧 Child 消息即使来自正确 WindowProxy/Origin 也不能跨 reload 复用。相同 generation 的 `ready` / `map-ready` 只消费一次，防止异常 SDK 借重放反复触发一次性 Session Ticket/地图挂载。
- 原 Child `viewport` 消息视为**不可信工作建议**：仅在 Map-ready 后接收、120ms 合并为最后一次边界，防止大量请求；`cancel` 必须同步清理待发视窗并立即通知 Parent Abort（Go ctx.Done 的真实延迟仍需独立测量）。离开页面、Child map-failed、iframe reload 同样取消定时器。
- 增加直接编译原 FrameHost TypeScript 的 Node 回归，验证重放、重载失效、20 连续 viewport 仅发一个、cancel 立即生效。不将这些源码测试当作生产验收；生产项按用户永久决定跳过（未验收）。

## 2026-10-22 · A3i-Msg4 已接线隔离地图与 BD-09 返回相机修复

- 本 PR 继续在原 #2299 Draft 推进，当前代码已新增地图专用 25s 一次性 Ticket、Owner/SessionVersion/MapEpoch/AKRevision 验证、独立 Child Origin 的 Partitioned HttpOnly Cookie、受签名保护的 Loader/子资源路径、Child 中真实 BMap 地图渲染与 Parent 原有签名 Cell 照片墙链路。下方 Msg3a 无 SDK 描述仅为历史阶段记录，不代表当前代码。
- **本次代码**：返回 Viewer 后 initialCamera 以前被丢弃；现加入仅四个白名单字段的 BD-09LL restore-camera 协议，必须在 Child map-ready 后发出，阻止 WGS84/Node/Asset/JWT/照片 URL 注入，支持导航/撤销时代际失效。增加原协议 TypeScript 编译回归、frame host 回归以及运行实际 Child JS 的 VM 对抗测试。
- **未完成**：本 PR 最新准确 HEAD 的完整 GitHub CI 与可合并状态、真实受控站点/百度子资源/三端/100k/ctx.cancel 定量证据。运行仍以实际安全门禁为准，失败时回退静态地图，不冒称 P0-03 已验收。
- **仓库已存在永久规则**（#2227 / AGENTS.md）：生产环境安全验收一律“按用户决定跳过（未验收）”，不索取生产账号、AK/JWT/Cookie/HAR、抓包或人工签字，不以此阻塞源码/CI/PR；Owner/Consent/撤销、独立 Origin/CSP、受控恶意 SDK 回归继续强制。

---

# P0-03 A3i-Msg3a · 独立 HTTPS 子文档与受控恶意脚本隔离

日期：2026-10-21。本阶段为可构建源码与独立安全测试，不是完整百度动态照片地图运行交付，更不是生产环境安全验收。

## 已实现

1. 新增 deploy/baidu-isolated-child/index.html 和 child.js：专用独立子站的静态子文档，固定路径 /_xdrive_baidu_isolated/index.html，与已合入 #2263 Msg1、#2287 Msg2 父 iframe 的消息格式相容。默认不执行第三方百度 SDK，也不构造伪地图，不访问 Parent DOM、JWT、Cookie、图库媒体、私有 API 或原图 GPS。只有部署时静态确认的 Parent HTTPS Origin 可以建立零 Cell 握手，要求精确 event.origin、parent WindowProxy、nonce、generation、版本、消息容量和最多 64 个已经授权的匿名 Cell。
2. deploy/baidu-isolated-child/Caddyfile.example 是**可选择启用但不自动部署**的独立 HTTPS 虚拟主机样例，未接入原 deploy/Caddyfile、Caddyfile.common、Docker Compose、PWA 缓存或当前 Gallery Loader。限定两个静态子站资源，拒绝其他路径，不代理任何 API 或百度 SDK。默认 CSP 为 default-src none、script-src self、connect-src none、精确 Parent frame-ancestors、sandbox allow-scripts allow-same-origin，配置最小权限、no-store、no-referrer、nosniff 和不设置 Cookie。
3. validate-site.mjs 提供保守的**必要非充分**两站点校验，拒绝相同 Cookie 站点的兄弟子域、HTTP、带端口的模糊 Host、IP、localhost 和测试占位域。它不是完整 PSL 检验，不能单靠检查通过就允许 Provider 运行。部署必须由可信安装流程验证真实不同注册站点及其 Domain Cookie/独立 Cookie/Storage/TLS/Host，再把 HTML 中的 REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN 设为精确可信 Gallery Origin；绝不从浏览器请求反射 Origin/Host、Query 或 API Header。
4. desktop/tests/gallery-baidu-isolated-child-runtime.cjs 直接执行产品原始 child.js 的 Node VM 测试：无秘密访问、严格握手、消息来源与重放/撤销、旧 Cell 清理。另有独立静态 Caddy/配置测试；本地已进行合成源码测试，不能充当浏览器验收。
5. 独立 GitHub Actions 包含真实 Chromium 浏览器的受控双 HTTPS 站点恶意子脚本回归。用临时 OpenSSL 本地测试证书、合成 gallery.example.net 和 map-isolated.example.org 的 host mapping，尝试从 Child 读取 Parent DOM/localStorage、请求 private API 并导航父页面，同时检查跨站 Cookie 不发送。浏览器临时忽略自签证书只限此测试命令，绝不在产品、Server、Caddy 关闭 TLS 验证。必须以 CI 真实结果为准，不能先声称已通过。

## 严格未完成的 P0-03 后续

- 该子文档和 Caddy 示例没有接入真实用户部署、生产 Gallery 或百度脚本。接下来必须完成可信受控安装/证书域名/PSL 验证、严格 Parent frame-src 与 Child frame-ancestors/双向 CSP、无共享 Cookie/Storage、Server 独立地图会话以及安全资产路径。
- 真正迁移百度 JSAPI4 可执行 SDK、受审查 Loader、瓦片/字体等资源到隔离子站；Child 不能获得 Gallery JWT、图片 URL 或 Owner 私有接口。Parent 接收 Cell 点击后仍需按签名 Owner/Consent/revision 的原 Media Range 重新授权，再进入虚拟照片墙/Viewer。完成前，动态地图不能因该阶段而激活，继续安全回退 Static Map。
- 受控恶意脚本 Browser E2E、PWA/Android/iOS27/Electron parity、100k/Go ctx.cancel 和真实媒体撤销需要各自独立证据；当前不报告产品 P0-03 完成。
- **生产环境安全验收：按用户决定跳过（未验收）**。禁止索取生产账号、AK、JWT、Cookie、HAR、真实抓包、生产权限与人工签字，且不阻塞源码、CI、PR、合并；Owner/Consent/撤销/Origin/CSP/可控浏览器安全验证仍必须执行。

## Msg3a 安全测试防假阳性补充（本 PR 同分支修订）

- 受控恶意脚本不再通过永远成立的 `top !== window` 认定导航隔离；Child 仅回报已尝试跳转，真实 Chromium 在延迟后再次核对 Parent 原始 Origin、路径、私有标记仍完整，并复核 Parent 私有 API 请求为 0。
- 对 Parent DOM 和 localStorage 的测试要求浏览器实际抛出跨 Origin 访问错误；如果成功读到任何内容，即使内容恰好缺失，也不判定安全。Child 对 Parent Private API 的 fetch 只要能读取任何响应就判定失败。
- 浏览器实际使用此 PR `Caddyfile.example` 的 CSP 策略原文（仅代入合成 Parent Origin），而不是另一份可能漂移的测试策略。该测试仍采用合成站点/临时证书，**不代表用户真实部署、安全生产验收或第三方 Baidu SDK 已移入子站**。
