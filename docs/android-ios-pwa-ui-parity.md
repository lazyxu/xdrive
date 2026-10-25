# Android → iOS PWA 移动 UI 对齐清单（2026-10-25）

**基准**：iOS PWA 的 MobileFiles、Gallery、Viewer 与共享 MUI 组件。Android 仍保持 **Kotlin / Jetpack Compose 原生客户端**，通过共享设计 Token、图标派生脚本、Server API、状态与交互契约实现 1:1；绝不增加只显示却无法使用的入口。允许在原生能力上超越 PWA（如内网 IP、SAF、后台任务），但 TLS、Owner、会话安全不得降低。

## 已实现与验证边界

- Android：CONNECT / LOGIN / PASSWORD / FILES、根及子目录、100 项 Server 分页、刷新/重试、文件元信息、UI 图标颜色派生、更新检查；**不是完整 Files/Gallery/Viewer 产品**。
- #2613 已合并：Auto / LAN / Public 连接路径、源域名和 TLS 主机名验证、会话内选定 IP；不得另做 DNS/HTTP 降级。HTTPS 私有 CA 需明确在系统建立信任；HTTP 需要显式许可。
- 本 PR：把现有 100 项分页转换为连续滚动追加和列表/图标两种呈现，失败保留旧记录、明确重试、同一请求代际取消。准确提交 `8dc9a3e3` 的真实 API35 模拟器 25 项中有 1 项列表→网格锚点回归失败：旧版先显示网格顶部，再通过异步 `scrollToItem` 恢复。现改为按文件夹/模式建立 LazyState 时直接设置首次可见索引；内存 LRU（64 目录）在本次登录内保留文件夹和模式切换的首屏浏览位置。跨页超出当前已加载节点范围及应用重启恢复仍待补，不声称完整 UI。

## 完整优先级与缺口（验收必须是实际 UI + 后端行为）

| 优先级 | 事项 | Android 当前缺口 / 完成标准 |
| --- | --- | --- |
| P0-01 | 原生 App Shell | iOS PWA 52/56px 顶栏、返回、当前标题、更多操作、全屏安全区域、状态与导航栏；Android Back/IME 适配 |
| P0-02 | Files 连续分页 | **本 PR 首轮实现** 100 项增量追加、同页重试、已载入行不被下一页替换、列表/网格开关；待补目录返回及视图切换时的锚点保持 |
| P0-03 | 最近 / 浏览 / 收藏三入口 | **本 PR 接入** Go Owner 最近（最多50项）与文件收藏（最多256项）、真实三入口、文件位置跳转、收藏 PUT/DELETE；未实现全量视觉图标细节与搜索 |
| P0-04 | Files 全局搜索 | 现无；必须复用 Server 全库搜索、过滤和取消语义，不能把本页筛选冒充全局搜索 |
| P0-05 | 文件操作 | 新建文件夹、上传文件/文件夹、下载、删除到回收站、移动/复制、重命名、批量选择、冲突对话框与可靠撤销 |
| P0-06 | 文件排列与交互 | 列表/图标状态及菜单、排序/分组、长按上下文菜单、文件夹拖放、路径面包屑、快速访问及虚拟列表 |
| P0-07 | Gallery 照片墙 | 未实现；最新在底部、按年/月/日/全部切换、缩略图/视频 poster、列数算法、收藏/分类/搜索/选择/更多 |
| P0-08 | Gallery Viewer | 未实现；打开照片/视频/Live、返回原位置、Info、更多、滑动切换、全屏工具栏、图片缩放/平移、视频播放 |
| P0-09 | 预览/字节取消 | PDF/文本/媒体预览与下载、渐进进度扇形、Content-Length、离开即取消 Owner Range/渲染；避免无关请求继续 |
| P0-10 | 传输中心 | 现无；上传/下载队列、速度/ETA、取消/可暂停时暂停、重试、最近完成和 Android 通知 |
| P0-11 | 账号及设置 UI | 账号头像、个人设置、Server/版本、主题、连接管理、退出、设备信息；与移动 MUI 同功能结构 |
| P0-12 | 安全与竞态 | 登录/退出/变更服务器清空旧 Owner 视图；跨目录迟到请求、A→B→A、分页/Viewer 回退、重试与取消 |
| P0-13 | Android 专属连接 | 已有 Auto/LAN/Public 及显式 HTTP；需要配置 UI 截图对齐、HTTPS 域名/证书诊断与受信 LAN IP 操作说明 |
| P1-01 | 目录恢复 | 本轮支持同一次 Files 会话内已加载文件夹的可见项索引恢复；仍待当前目录持久化、跨页加载后精确恢复及应用重启恢复；跨账号严格隔离 |
| P1-02 | 照片功能 | 相册、Live Photo .livp、重复折叠、人物/地点、地图、离线建议、媒体属性统一 |
| P1-03 | 离线与弱网 | 用户允许的只读离线目录、断点续传、联网恢复、失败可见、禁止跨 Owner 旧缓存污染 |
| P1-04 | Android 文件能力 | SAF、系统 Photo Picker/MediaStore、分享、Android 后台前台服务与通知权限、文件打开位置 |
| P1-05 | 多设备/Push | 只读设备页，Android 本机备份能力按独立产品路线设计，不能引入第二个上传 Runner |
| P1-06 | 可访问性与大字体 | TalkBack、焦点/IME、横屏、折叠屏/平板、减弱动画、对比度、≥48dp 触控目标 |
| P2-01 | 像素对照 | 390px 同尺度截图，比对布局、字重、间距、蓝色文件夹、暗色、Header、弹窗、动画与安全区域 |
| P2-02 | 发布与性能 | 100k/115k 冷启动、滚动/取消/内存基线、安装包稳定签名、快照更新来源和崩溃诊断 |

## 本 PR 的边界

- 重用 `DriveController` 与 `XDriveService.children`；不新增 WebView、数据队列、媒体下载或伪造收藏/最近页面。
- `loadMore` 仍是 Server 原始顺序和 100 项分页；结果检查当前目录、返回 offset 和请求代际，只向相同路径追加并去重 ID。
- 加载中打开现有文件会取消下一页，避免迟到结果关闭详情；失败页保留已显示行，重试追加；刷新从 0 重新读取。
- 列表/网格设置独立保存在 Android 本机非敏感 UI Preferences，非法值默认安全回退列表；不会保存账号凭据。
- 文件夹短按打开、文件/文件夹长按展示实际可用操作（文件夹打开、属性），文件属性沿用同一详情对话框；未实现的复制/移动等操作不出现虚假按钮。
- Native 列表/网格采用同一行模型、文件类型 SVG 派生资产、可访问的点击区域；切换视图尽量锚定相同 item index。
- 顶栏把刷新收敛进更多菜单；当前文件夹标题可展开已验证的祖先路径并跳转（仍需要 Server 重新获取），不伪造完整路径搜索。
- 空分页或重复且未终止的范围触发明确错误，防止 totalCount 与实际结果冲突导致无限自动请求。

## 必须执行的验证

```sh
cd android
./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
./gradlew --no-daemon :app:connectedDebugAndroidTest
node --test scripts/shared-ui.test.mjs
node scripts/shared-ui.mjs --check
```

逐次以 PR 准确 HEAD 的 Android emulator API35 与 Final Gate 结果为准；未运行不能写通过。生产环境无法访问的专项验收：**按用户决定跳过（未验收）**，但源码级安全、权限及 CI 不跳过。

## Android 最近 / 收藏真实接口增量（继 #2621）

- REST 契约沿用 Go Server 已实现的 `GET /api/v1/file-recent?limit=50`、`GET /api/v1/file-favorites`、`PUT /api/v1/file-favorites/{id}` 和 `DELETE /api/v1/file-favorites/{id}`，不得新建第二条网络链路或新表。收藏只支持文件，Recent 可包含文件夹。
- `XDriveApi` 的两类 JSON 返回共用已有可取消、禁止自动重试、2 MiB 上限的同源 Bearer Client；校验 crumbs 对应 node ID、父级和最终名称，错误时拒绝替代为“空收藏”。
- `DriveController` 使用同一 generation、Owner/session 刷新机制管理 Recent/Favorites/Browse，切换页面取消旧请求，退出/更换服务器清除列表；浏览目录数据在切换回来时保留。
- Recent 文件夹短按通过已验证目录根 + Server children 进入浏览；文件短按显示现有属性（Viewer 尚未实现）；长按真实加入/取消收藏操作在服务端确认后更新，失败不能谎称成功。
- 当前未实现“在 Android 真正打开媒体后记录 Recent”（待 Viewer）、全库搜索、批量操作以及 iOS PWA 最终图标与细节校准；不得把这些标为已验收。
