# Android Gallery「精选集」真实相册最小可用（2026-10-27）

## 范围与依赖

- 此实现 **依赖 #2799** 的 `GalleryAlbum` / `galleryAlbums` / `galleryAlbumPage`（现有 Go Server 的 PhotoCollection 与 Owner 范围）。在 #2799 源码和测试通过并合入前，本 PR 不可独立合入 master。
- Android 仍为 Kotlin/Compose 原生 App，复用和 PWA 相同的服务端相册/成员接口，不使用 WebView、不新建图库媒体数据库、不复制照片或重复上传。优先交付已经存在的真实数据，不编造「照片回忆、人物、地点」集合。
- 入口为 Gallery 底部明确的「图库 / 精选集」，在「精选集」显示当前登录 Owner 真正返回的相册：导入、手动、智能及文件夹类型、名称和服务端已知项数。缺乏当前 revision 的封面不能擅自用其他照片代替；首轮显示文件夹图标。相册列表空状态只在已成功查询后展示，失败保留错误和重试。
- 打开相册仅查询该原有 `/media/albums/:id/items?range=true`，重用原 Gallery 的 60 项 Range、缩略图、视频 poster、图片/视频/Live Viewer、双向页、可靠时间索引及已验证 Owner 传输；不创建第二 RecyclerView/ExoPlayer 或媒体写入路径。
- 当前相册内部暂不启用全库媒体类型筛选、全库搜索及含糊的批量写操作；返回到相册列表后可切回图库全库搜索。相册内部仅使用真实的时间索引（若由 Server 返回）。返回/切换账户/离开 Gallery/旧 A→B→A 请求均通过现有 Controller generation 与 Viewer epoch 取消并隔离响应，私有数据不持久化。
- Gallery 与 Collections 页面使用当前 Owner 相关的保存态区分滚动位置，图库图像缓存只属于当前 Owner 活跃会话。原生 Android 顶栏维持系统安全区域；相册界面控件还须在 #2792 的 iOS PWA 双层胶囊最终合入后视觉收敛，避免两个并排仍未合并的底栏变体互相覆盖。

## 受控验证

- JVM：真实当前 Owner 相册、成员分页与 Viewer、返回相册/图库、非法/旧相册选择、退出清空、非合作性旧 GET 迟到后不得显示。
- API 35 Compose：登录 → 图库 → 精选集真实一行 → 打开相册 → 返回 → 切图库。所有点击均要实际改变已验证的 UI/Controller 状态；不伪造本地假 API 成功。
- 保留并执行既有 Android Core/JVM、Lint、Debug APK、API35 Compose 与 GitHub 平台要求的 CI/Final Gate；准确 HEAD 完成前只标候选，不写完成。
- 设备实机、iOS PWA 截图逐像素、精选集封面、人物/宠物/地点/回忆、批量操作与完整编辑：**按用户决定跳过（未验收）**或仍属于未实现事项，不能算通过。
