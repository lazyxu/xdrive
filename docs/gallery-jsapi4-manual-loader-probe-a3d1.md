# P0-Places-A3d1 · 百度 JSAPI 4.0 Browser AK 固定 Loader 在线预校验

**2026-10-19 · 仅管理员手动执行 · 不代表 JSAPI4 生产 GO。**

## 为什么需要这一阶段

运营者已经保存独立的百度 Static Map **Server AK**、JSAPI 4.0 **Browser AK**，并验证 HTTPS 与静态地图。此前管理员界面只能展示 `configured` 与 `desired_enabled`，不能判断**Browser AK 是否能在 Server → 百度**这个独立链路上取得 JSAPI4 Loader。JSAPI4 完整动态资源仍被独立 release 门禁拒绝：源代码 pinned operator signing root 为空、批准的动态子资源清单 0 项、真实 Browser/upstream HAR 未完成。不能让运营者反复输入密钥或因缺证据绕过安全门禁。

## 最小安全探针

- 新增 **管理员唯一入口** `POST /api/v1/admin/services/baidu-jsapi/verify-loader`，请求体只需已保存的 **Browser AK revision**：`{"revision":1}`（示例，不填 AK）。真正使用当前加密持久化中的 Browser AK，不读取静态 Server AK；请求前写入不含 AK、GPS、URL 的审计记录。审计失败、未启用、错误 revision、Keyring/HTTPS 无效时**不发百度网络请求**。
- 明确手动触发一次、单 Server 30s 限流、5s 超时，固定 `GET https://api.map.baidu.com/api?v=4.0` 并由 Server 内存追加当前 Browser AK，固定官方 `BMAP_PROXY_URL` 来自受信配置 HTTPS Origin。Server 同时将出站 `Referer` 固定为已验证的 `AllowedOrigin + "/"`，使 Browser 类型 AK 能依其已配置 Referer 白名单鉴权；绝不透传客户端输入的 Referer、Host 或 X-Forwarded-*。拒绝重定向、环境代理及压缩回应，下载不超过 2 MiB JavaScript 响应；原始脚本与 AK 不返回浏览器、Agent、日志、审计或 CI。
- 结果仅为 `loader_accepted` / `denied` / `unavailable`，同时必定 `runtime_enabled=false`：成功**只证明当前 Server/AK 修订的一次 JSAPI4 Loader 响应符合保守 MIME/大小/AK 无直接回显规则**，不代表脚本真实执行、瓦片/字体/WASM 已审查、百度授权合同已核实、签名发布安装或三端动态地图可用。可能消耗一次百度 API 配额。
- 新路由完全复用已有 Admin Bearer/权限中间件；不生成 Cookie，不增加通配反向代理、不返回任何 JavaScript，不自动定时请求、不读取用户 EXIF/GPS，不更改已保存的 Server/Browser AK、上传下载同步、或 JSAPI4 `runtime_enabled`。
- 本阶段只交付 **Server 审计端点与 Go/Postgres 测试**；Web/Mobile Web/Desktop 共用的管理员检测按钮是独立 UI 收尾，不得凭后端存在就声称前端已可点击或上线。

## 仍缺的真实生产放行证据

1. 隔离授权环境的真实 9 组（3 平台 × 初次加载/平移/缩放）Browser 和 Server 上游 HAR，按私有安全流程存储、去敏，真实资源路径、Host、Query、MIME、字节额度逐项人工审核。
2. 完整代码所有权的精确子资源白名单、服务端同源 JS/tiles/styles/fonts/WASM 代理、Owner/session/配额/撤销和 AK 原始字节泄漏审计。
3. 独立可信 operator 签名根、公钥绑定、当前 build/policy/origin/AK revision/map epoch 的发布签名安装与撤销；**实例自己自动生成密钥不能当成独立受信发布证明**。
4. 真实 Web/Mobile Web/PWA/Desktop/Electron/iOS Safari/Android 手势、坐标和性能验收。

本 PR 的测试只使用假 Browser AK 和注入的假百度 HTTP 响应，不消费线上配额。**不能拿模拟 green CI 冒充真实生产放行。** 自测应包含严格固定请求、恶意回显、错误 MIME、压缩、跳转、大响应、取消、审计前失败、实际 PostgreSQL 管理员身份与版本、30 秒限流、结果去敏、Loader probe 后动态 runtime 仍关闭。合并要求单个当前工作提交及 77+ 准确-head GitHub CI（含 Go API Race、Windows/Linux Web/Desktop、Rootless、Final Gate）与 GitHub clean mergeability。
