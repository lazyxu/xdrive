# Android 手动相册管理 · Rename/Delete · 2026-10-28

## 目标及 UI 对齐

在现有原生 Android 精选集（真实 Go Owner PhotoCollections）中，每个 **manual**
卡片保留真实封面及 144dp 网格，新增 48dp 的「更多」入口，仅显示 **重命名**、
**删除相册**。智能、导入和来源相册保持只读，绝不提供假操作。
改名显示校验名称对话框；删除必须经明确的确认对话框，说明只删除
PhotoCollection 与成员关系，**不会删除原始 Node、PhotoAsset、CAS 字节**。

## 一套真实写入门控

沿用单个 Session-pinned `XDriveApi` 和 Go 的现成接口，不新增服务端路由或存储：

- `PATCH /api/v1/media/albums/{albumID}`，JSON `{"name":"..."}`，必须携带原相册 revision 的 `If-Match`。Go 是名称、Owner 和 revision 的最终权威。响应必须匹配目标 manual ID、名字、所属文件夹和递增版本。
- `DELETE /api/v1/media/albums/{albumID}`，必须携带同一版本围栏的 `If-Match`，预期 204，无文件字节操作。URI 中 opaque Album ID 始终以单一 path segment 编码，不能用目录字符串或本地表替代身份。
- 共用 `mutateGalleryManualAlbum`：提交前必须验证当前 Owner、真实已载入卡片、有效 manual ID/Revision、无其他写入或不确定状态。真实 PATCH/DELETE 只执行一次，不通过 401 刷新或网络错误重放。
- ACK 失败/丢失：冻结写入，公开显示“结果未确认”，只允许手动重新 `GET /media/albums` 核对；收到合法 ACK 后但 GET 失败：显示“已提交，列表刷新失败”，只能重读 GET。永不乐观隐藏卡片或伪造成功。
- 原生页面切换、选择相册和退出时遵守 Owner 路由 / 请求代际；错误未确认期间保留可见的 GET 重试入口，不能悄悄重试写请求。

## 测试

- Core MockWebServer：Bearer、If-Match、PATCH Body、编码 Album ID、合法 ACK、错误版本、409、204 DELETE、只读相册被本地拒绝；无自动重试。
- Controller JVM：改名和删除后真实 Owner GET、拒绝旧 revision/smart 相册、丢失 ACK 冻结、合法 ACK 后 GET 失败只读恢复。
- API35 Compose：真实空精选集→新建→更多→重命名→删除确认→空相册状态，校验原始媒体路径不被触及。

仅在该 PR **准确 HEAD** Android Kotlin/JVM、Lint、APK、API35 和实际 GitHub
Final Gate 全部通过后才允许合入。真机 OEM/生产账号/iOS 像素对照按用户规则
**跳过（未验收）**，不可假称已通过。

接续工作：相册文件夹/排序、成员移除、设置封面、批量下载/导出、系统级发布安装与大库真实性能。