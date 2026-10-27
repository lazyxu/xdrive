# Android 原生精选集：真实封面与 144dp 相册卡片（P0）

## 问题与目标
此前 #2805 已实现真实当前 Owner 相册列表和相册媒体墙，但「精选集」仍然只使用通用文件夹图标，和 iOS PWA 的照片代表封面不一致。本专项只完善视觉源数据与原生卡片，不扩展到未经实现的回忆、人物/宠物和地点 UI。

## 唯一真实数据链路
1. 从已认证的 `GET /api/v1/media/albums` 读取该 Owner 的 `id`、`revision`、`cover_node_id` 与 `item_count`；缺少 `cover_node_id` 就显示文件夹占位，不猜第一个相册成员，也不请求其他用户照片。
2. 相册卡片进入可见视口后，使用原 Android pinned TLS/SNI、Bearer Token、单一 Go API 读取 `GET /api/v1/media/items/{cover_node_id}`。严格校验返回节点 ID、文件类型、正数 Revision、图片/视频 Kind 和布尔 `has_thumbnail`。
3. 只有已验证的当前节点 Revision 且服务端表示缩略图可用时，才请求 `GET /api/v1/media/items/{id}/thumbnail?revision={revision}`；保留既有严格 JPEG MIME、4 MiB 最大响应与真实取消。图片在后台解码时复用已有尺寸校验与 256px 采样，使用当前 Owner 的内存 LRU，不落盘。
4. 当前 Owner 会话每次最多 4 个图库/封面 thumbnail 请求在途；切换图库/相册、退出登录、变更 Owner 和 Controller generation 时取消、拒绝过期结果。相册 Revision/封面 Node ID 改变会重置卡片；无封面显示中性占位、网络/解码失败提供显式长按重试，不做无限自动刷新。
5. 精选集采用 `LazyVerticalGrid(GridCells.Adaptive(144.dp))`，网格只加载已进入视口的卡片；卡片点击仍打开真正的 `galleryAlbumPage`。原本的「图库 / 精选集 / 搜索」和年/月时间胶囊维持不变，支持 TalkBack 名称与角色。Android 不请求存储权限，不接入 MediaStore，不新建独立 CDN、HTTP Client 或二次缓存数据库。

## 回归与范围边界
- Core MockWebServer 校验两个连续 Owner GET 的路径、鉴权、Revision 和图片 MIME；无 ID、无派生缩略图、节点 ID 不符、非法 Kind/Revision/字段必须 fail-closed，绝不能静默回退到其他照片。
- JVM 复现非合作性旧封面 GET 在切图库/退出后返回，不得写回过期 Owner，并确认伪造相册 Revision 不会触发请求。
- Android API35 Compose 使用真实生成的 JPEG fixture 验证卡片封面实际展示，再打开相册、返回和恢复图库；不把通用图标当成“真实封面加载通过”。
- 仍未实现：iOS PWA 精选集的固定/精选分组、回忆、人物、宠物、地点、完整相册管理/批量写入，和真机像素级 1:1。实机/生产验收**按用户决定跳过（未验收）**；源码准确 HEAD Android Native / JVM / lint / API35 与 GitHub Final Gate 仍必须真实通过。

## 相册导航入口一致性

同时修正原有 Android Header 左侧「返回文件」在相册视图总是直接退出至 Files 的问题：该按钮与系统返回键统一调用 Controller 的分层 `back()`，顺序是 Viewer → 当前相册 → 精选集 → 图库 → 文件；标题和 TalkBack 描述按相册名称、「精选集」、「照片」逐层更新。API35 Compose 在真实封面、相册载入后逐层点击顶部返回并检查页面，不把跳过层级算作成功。
