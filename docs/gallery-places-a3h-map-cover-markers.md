# P0-Places-A3h · iOS 27「照片」地图真实封面聚合代码候选

**2026-10-20 · 单一百度 Provider，xDrive 52px App Frame 与 Web/Mobile Web/Desktop 后端不变。** 本文件区分可执行源码、测试证据与尚待真机/安全验收；绝不把 `runtime_enabled=true` 等同于发布验收。

## 现状与新合同

- 已合入 A3c20 的签名 Owner `/api/v1/media/places/baidu-jsapi/cells` 使用已有真实 BD-09、单资产显式位置同意、Node/MediaMetadata 修订、Owner/Session/Epoch/AK 发布再校验。SQL 在 `/cells` 内对整个 Owner 可见集合 `COUNT(*) OVER(PARTITION BY ...)`，按 8×8 最多返回 64 个真实代表 Asset/Node 坐标；不复制 100k 点。
- A3h 在相同 DTO 每格增加**当前 Node 修订号** `node_revision`，来自同一经过版本 JOIN 的原始 `p.node_revision`，无新权限、新源 GPS、远端 AK 或图片 URL。旧服务端缺少字段继续走数字 Label / 原始 ClusterLayer，不接受未经版本检查的图片封面。
- 当前百度 JSAPI4 `BMap.Map.pointToPixel(BMap.Point)`（4.0 官方像素坐标）仅用于已签名允许的 BD-09 样本，React 独立 CSS cover layer 保留正确像素，最多显示 24 个按真实数优先的、不互相遮挡的代表封面和角标。碰撞/地图边缘未显示的区域仍在可访问的列表中，不将屏幕可见封面数冒充真实总数。一个位置一张缩略图，不默认伪造 1–3 张堆叠。
- 每张图片使用共享 `XDriveMediaGalleryCoverThumbnail` 和现有 Owner 媒体授权加载池，受当前 Node revision 及卸载/取消保护；可复用派生图/现有视频 Poster 和 Live Photo 静态封面，不能为了单个地图标记加载原视频/Live Photo motion。
- 旧 SDK 若没有像素坐标 API、旧 Server 无 revision、授权/会话失败时保留原有 JSAPI4 数字聚合/同 Provider 静态地图回退。地图加载和 Session 仍需当前受信签名，主文件页 Electron 仍不直接调用 JSAPI4。

## 执行与跨端协议

Web/Mobile Web 的 Gallery `loadThumbnail` → Shared `XDriveMediaGallery` → `MediaGalleryPlacesMap` → `MediaGalleryBaiduJSAPI4PhotoSurface` → `XDriveMediaGalleryCoverThumbnail`。Desktop 的独立 HTTPS BrowserWindow 仍打开同一 Web Gallery 路由和 REST Server，而 Desktop file: Renderer 不加载 SDK/图片地图。缩略图只进入受信 React DOM，不作为 BMap Label/Layer URL 或 HTML 属性传入 Provider。Map pan/zoom 调用原 Bridge `cancel()`，Abort 当前 Owner `/cells` 及卸载过期 React pins；旧 SDK 回调、旧 Owner session 不应重新渲染。

**第三方脚本隔离风险须独立审计**：共享文档中可执行的 Provider JS 原则上可以检查 DOM/脚本环境。尽管此实现不主动把缩略图 URL/JWT/AK 传入 BMap API，也**不能因此宣称 Browser SDK 完全无法观察 React DOM 或账号凭据**。生产个人照片的第三方脚本隔离、子资源原始 HAR 检查和独立受信上下文设计仍是正式发布前必须完成的安全验收，不得在日志/截图提供实际用户照片/GPS/AK。

## 测试与完成边界

- `desktop/tests/gallery-places-a3h-photo-cover-pins.cjs`：纯 TypeScript 原代码执行检测、真实投影/finite 尺寸/故障、64 cell→最多 24 non-overlap cover、synthetic 100k 算术、≤100 cover 优先、旧 Node revision 数字 Label 回退、pan 立刻 Abort/拒绝过期数据、Web/Mobile/Desktop 共享组件及无 Provider 私密 URL。
- `internal/api/baidu_jsapi4_native_cells_http_test.go`：新增修订号仍是 Server Owner 有界输出；无原始 WGS84、Browser AK、个人 Cookie。保留旧 A3 C20、本地图层/Viewer/Agent/Web/Go API/CI 全集，必须新 HEAD 全平台 CI/Final Gate、mergeable clean。
- 这**不是实际 100k PostgreSQL/浏览器性能证明**。实体 iOS 27「照片」1:1 尺寸、动态地图多个地点、多种视频/HEIC/LivePhoto 真实缩略图、单点 Viewer/多点区域照片墙、慢网/旋转/VoiceOver、安全独立审计与撤销后遗留像素仍未实测；全部通过后才可能关闭 #2188。

官方技术依据：百度 JSAPI 4.0 [Pixel / pointToPixel](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fbasicclass)、[Map SDK 4.0](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Findex)，Apple [iOS 27 Photos 地图](https://support.apple.com/ja-jp/guide/iphone/iph390138909/27/ios/27)。