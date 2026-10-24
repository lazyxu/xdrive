# Places P0 · 双运行时共享可信照片地图（2026-10-24）

状态：源码改造候选；以实际 PR HEAD 的 CI、合并记录为准。不是已完成的 iOS27 真机、10k/100k 浏览器性能或百度真实上游验收。

## 目标与结构

- **唯一照片业务层**：`XDriveMediaGalleryBaiduIsolatedPhotoSurface` 继续作为可信 React Parent（未来可中性化命名）。同页和隔离版复用其 Owner-signed BD-09 `/cells`、Cell/Camera 精确 Count、`/cell-items`、`/viewport-items`、Album/收藏/日期/类型/排序、封面、最多 10 区域横条、Viewer/虚拟 Wall/返回锚点，以及 generation+Abort 防旧帧。
- **两个不同 SDK Host**：`xDriveMountBaiduInlineMap` 仅在现有可信 Gallery 主文档运行百度 Browser AK JSAPI；`xDriveMountBaiduIsolatedFrame` 仍在独立 HTTPS Origin Child 运行签名发布的 SDK，严格 Map-only Ticket、CSP、Cookie、Origin/nonce/generation/revoke。
- 新同页 Host **不再主动调用官方 Convertor 将当前视窗原始 WGS84 代表点上传给百度**。只渲染 Server 已明确授权且来源有效的 BD-09 Cell DTO。未授权的原始 GPS 照片不会因为打开默认地图被自动转坐标/外发；没有授权时数量可为 0。
- 同页版 **仍存在第三方 JS 与主 Gallery Document 同源运行的固有风险**，不是安全版的替代隔离。无 Cookie 安全保证；不向 SDK 主动提供 Token/媒体 URL/原图，但不能声称同文档恶意 SDK 无法读取父 DOM。
- Server `baiduJSAPI4SessionHTTP` 明确返回 `403 isolated_map_required`；**不可**为“共用 Loader”调用这一入口。Inline 沿用既有 `getBaiduJSAPIPrototype` + `loadBaiduJSAPI4` Browser AK loader；在启动和有界续期前额外核查 Server `authorized_signed_release`。隔离版仍只使用独立签名 Child Ticket，绝不降级或复用 Gallery-origin map Cookie。
- 缺失接口、未激活签名 release、Browser AK 失效时：显示“动态地图暂不可用”和诊断，不降级为旧未授权原始 WGS84 GPS 概览、静态 PNG 或第三方替代 Provider。

## 一致性要求

相同 Owner/PhotoScope/Camera 的两种 Host 使用同一个 Parent 的当前签名 Cell 响应；相同 Count、Cell 身份、筛选后的媒体集合、照片墙/Viewer 分页及返回状态。切换相册或筛选只使 Parent 的查询过期、重新查询，不在 Child 中暴露 Album/Owner/PhotoAsset/Thumbnail URL，也不让 Inline SDK 计算真正媒体范围。

普通图库当前已被 Server 验证的 Album/收藏/类型等子集现在可以进入**任一模式**的地图；不能因 URL 模式不同而扩大全图库。但涉及整个 Document 重载的**模式切换**仍遵守 #2520 的双向 fail-closed，受限 Scope 必须留在原模式，直到认证的一次性 Server 交接完成。

Desktop Electron `file:` 渲染器绝不运行 Inline SDK，仍只经独立 HTTPS 安全窗口，并遵守后续签名 Child Origin 受控网络准入。

## 本轮非目标与剩余工作

1. P0-4：受限 Gallery/Album/Map Scope 在整页模式切换下无损交接（Owner 验证、一次性 TTL、无 URL/Storage 敏感数据）。
2. P0-01：#2518 仅是服务器批量授权/入队内部基础；完整 Owner API/UI/调度 Worker/撤权执行链和真实 PG 还缺，不可把自动打开地图视为位置外发授权。
3. iOS27 移动端布局、真实百度 SDK/CSP/站点白名单、Electron 第二 HTTPS Child Origin、可控恶意脚本与跨账户测试、真实混合 10k/100k 配对性能及三端可访问性。
4. 旧 `XDriveMediaGalleryBaiduPrototypeMap` 仅保留原源码/历史回归兼容；不要再从产品入口挂载。待所有替换验收完成，单独清理其未用 WGS84 Convertor 与过时测试/文档，不在当前共用组件 PR 中删除已有回归资产。
5. 真实生产网络/密钥/许可证人工验收：**按用户决定跳过（未验收）**，不作为源码、CI、PR 合并门槛；代码级 Owner、Consent、Origin、撤销与回归依然必须执行。

## 源码级回归

`desktop/tests/gallery-places-inline-bd09-parity.cjs` 覆盖模式共用照片 Surface、签名授权状态、Browser AK Loader 合法来源、64 Cell 上限、真实 Cell 选择、SDK 原生手势立即失效、BD-09 相机、Source/Owner 请求失效以及 SDK 卸载。最终必须以准确 HEAD 的 Web/Desktop 构建和后端安全 CI 为准；Mock Native 回归不能替代真实浏览器、百度瓦片加载或 iOS 27 截图。
