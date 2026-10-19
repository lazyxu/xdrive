# P0-Places-A3d2 · 三端可操作真实 Loader 验证（生产动态地图仍 NO-GO）

日期：2026-10-19；百度唯一地图 Provider。

## 实现范围

- 用户已经完成 Server AK、Browser AK、JSAPI 4.0 权限与 Referer 白名单配置，**不再索要密钥或同类确认**。
- 在共享的「系统依赖 → 地理位置与地图 → 百度 JSAPI 4.0 → 检测」显示一个真实的管理员手动检测按钮。Web、Mobile Web/PWA 与 Desktop 复用同一 MUI 管理面板、Server 端权限以及修订号。
- Web/Mobile Web 通过已认证的 `POST /api/v1/admin/services/baidu-jsapi/verify-loader` 请求；Desktop 使用限制输入的 Electron Main → 本机 Go Agent IPC → 已登录 Go Client → 同一 Server API。传输**仅带当前配置修订号**，不带 Browser AK、任意 URL、用户 GPS、Cookie 或脚本字节。旧 Server/Agent 无此端点时显示不可用，不能伪造成功。
- 管理员点击才尝试一次固定 HTTPS Loader 真实请求，可能消耗一次百度调用配额。Server #2139 负责审计先提交、30 秒手动冷却、当前加密 Browser AK/修订号检查、5 秒超时、固定上游、MIME/长度/反射 AK 检验，只返回 `loader_accepted | denied | unavailable` 与 `runtime_enabled=false`。界面再次严格验证状态/修订并只显示固定安全文本。
- 与百度 Static Map Server AK 完全隔离，不更改 52px App Frame、共享图库 Range/VirtualCollection/Viewer 和地图源。不自动加载任何第三方脚本，也不通过管理员按钮修改 `desired_enabled` 或获取动态地图许可。

## 明确不等价的状态

`loader_accepted` 只说明百度固定 Loader 在当前 Server 的受控请求中返回了满足安全包络要求的响应。并**不代表** Browser 端能执行整个 JSAPI、瓦片/字体/WASM 子资源完整、平移缩放聚合正常、私有 HAR 无泄漏或三端动态地图已获独立可信签名授权。即使 Loader 通过，完整用户地图仍被现有安全门禁阻止。

由于完整真实子资源审查、版本化 Host/Path/Query/MIME 白名单、私有 9 对 Browser/Server upstream HAR、独立发布签名和真机 Web/Mobile/Desktop 验收仍缺失，本 PR **不得**更改 `jsapi4PinnedProductionPublicKey=""`、`reviewedJSAPI4ChildResourceCount=0`，也不得增加 wildcard proxy、往浏览器发送 AK 或绕过 Owner/session/epoch/跨副本配额。

## 验收

- 原始共享 TypeScript 解析及真实 DTO 校验正反例；准确 Web/Mobile/桌面完整路由契约、独立 Go Agent 输入限制，密钥安全不变。
- 仅合并 #2139 Server 端真实固定 Loader 接口后，本三端按钮才可真正发起在线检测。PR 可独立构建，但部署必须包含两者；不能把 UI/模拟测试称为已生效。
- 仅一个工作提交；当前完整 master 为基线，`AGENTS.md` 保留全部历史。要求本提交 77+ 全 CI 含真实 PostgreSQL Go API Race、Windows/Linux、Web/Desktop、Rootless、打包/Final Gate、GitHub fresh clean；不改变 #2139 所有者分支，不追无关 PR。
