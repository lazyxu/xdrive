# Android Files Owner 媒体缩略图 · iOS PWA P0 对齐（2026-10-27）

## 范围
- 原生 Files 浏览列表/图标网格、最近、收藏、全库搜索共用一个只读 Owner thumbnail 组件。只有当前栏目可见的 file、有效 ID/revision、非空媒体文件才尝试真实 JPEG 缩略图；无派生图保持原图标。文件夹/PDF/文本继续保持原图标，不伪造预览。
- 复用已有 `GET /api/v1/media/items/{id}/thumbnail?revision={revision}` 以及 Gallery 的 Owner Bearer、选定 IP/TLS Host、4MiB JPEG 检验、4 并发、256px 下采样；不取大原图 fallback，不引入 Android MediaStore 和额外索引。
- `Files` 组合生命周期内最多 48 张内存缩略图与 64 个失败提示。资源键为 `nodeId:revision`；离开 Files、切换 Server/Owner 后全部丢弃，不持久化私人字节/URL/凭据。懒列表不可见项目请求由 Compose 取消；Controller 在请求前后验证当前 Owner、栏目、Node 与 revision，generation 变化拒绝迟到返回。
- 失败仍显示原生文件图标；同一文件长按菜单新增“重试缩略图”，不自动无限重试。没有虚假的“成功获取”状态。

## 验证和非范围
- Android JVM 用例覆盖媒体后缀、revision、目录/非媒体、旧 Owner 当前列表、栏目切换期间未完成请求；真实 thumbnail 解码复用既有 `decodeGalleryThumbnail`。
- PR 准确 HEAD 仍需 `cd android && ./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:connectedDebugAndroidTest` 及平台必需的 CI/Final Gate；未跑完不得声称通过。
- 本 PR 不做文件分享、复杂排序分组、文本/PDF/音频独立 Viewer、全量照片地图、后台传输和 iOS 像素级验收；实机/iOS 截图按用户要求记“跳过（未验收）”，不阻塞代码安全测试。

- API35 Compose：`DriveAppTest.filesThumbnailFailureRetriesOnlyFromMenuThenReusesImageInGrid` 使用真实合成 JPEG、一次 503 失败、长按原生文件菜单重试、成功渲染语义节点、切网格不再请求相同 Owner/revision 的 thumbnail。
