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
| P0-04 | Files 全局搜索 | 新增原生全库关键词搜索与真实 Server cursor（100 项页）、取消旧查询、错误重试、定位结果；复杂结构化过滤与排序 UI 仍未完成 |
| P0-05 | 文件操作 | 已提交 **新建文件夹 / 重命名 / 移到回收站** 和本轮单项 **复制 / 移动 + 服务端目录选择器**；均使用真实 Node API，移动/重命名/删除带 If-Match；上传下载、批量选择、冲突解决及撤销仍未完成 |
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

## P0-04 · Android 全库搜索实现边界（接续最近/收藏）

- 搜索走已经存在的 Go `GET /api/v1/search?q=...&limit=100&sort=name&order=asc&cursor=...`；搜索范围是 Owner 全库，非当前目录/已加载行。不会新增 Server API 或本地索引。
- `XDriveApi.searchFiles` 沿用当前 Bearer/signed-Origin/HTTP/TLS、不重试和 2 MiB JSON 上限，复用现有 Node 解码和响应上限，按真实协议区分面包屑：Search 文件只返回父目录链，Recent/Favorites 文件返回含文件末级的完整链，目录项以自身结尾；Server cursor 原样传输，不解析/伪造分页 Token。
- Compose 的「浏览 / 最近 / 收藏」均提供可见的「搜索全部文件」，查询结果仍能修改关键词，返回恢复搜索之前的栏目；显示真实路径和无结果/失败区分。结果点击文件先沿用现有属性展示，文件夹通过 Owner 根和 Server children 重新验证定位，后续 Viewer 另行实现。
- Controller 搜索属于同一 generation：输入新 query、切栏目、退出、密码失效均取消旧请求及旧结果；仅游标存在才预加载下一页；失败保留本页，手动重试原 cursor；A→B→A 不跨 Owner 回写。
- PWA 的完整结构化筛选、搜索条件保存、排序分组、Viewer，以及 100k 分页性能与像素级测量需要后续真实源码/CI 对照，不能因上述功能而标记完成。

## P0-05 · Android Files 最小真实文件操作（独立增量）

- 「新建文件夹」从 Files 浏览右上角更多菜单进入；「重命名」「移到回收站」从已加载条目的列表/网格长按菜单进入，复用统一 Compose 对话框。删除文件或文件夹时必须明确确认，后端进入 Trash（包括子树），不是永久删除。搜索、最近与收藏集合不提供未验证的直接改写按钮。
- 请求仅使用现有 `XDriveApi` 会话、Owner Bearer、TLS/SNI/Host 和可取消的同一 OkHttp transport；对应 Go `POST /api/v1/nodes/{parent}/directories`、`PATCH /api/v1/nodes/{node}`、`DELETE /api/v1/nodes/{node}`。PATCH 与 DELETE 以被打开时读到的节点 revision 提供 `If-Match: "revision"`；不可凭空构造 revision、绕过 409/412，也不自动重放不确定结果。
- 写入失败保留 UI 旧行并显示明确错误；服务器确认后刷新目录。若写入已 ACK 但随后目录 GET 失败，保留已确认结果并提示“操作已提交，但目录刷新失败”，用户只能刷新 GET，不重复执行不可幂等的变更。
- 服务端文件名策略为 Windows 兼容子集：保留名（CON/PRN/AUX/NUL、COM1..9、LPT1..9）、特殊字符、末尾空格/点及最大 255 UTF-8 字节。Android 本地提前检查，Go Server 保留最终校验。跨 Owner、路径迁移、受管 Yike 目标及所有修改冲突由既有 Go Handler 拒绝。
- 单个目录操作与安全对话框完成后，继续推进复制/移动、批量、上传下载与 Trash 恢复等产品能力；本轮不宣布完整 1:1。

## P0-05 续：Android 文件复制 / 移动 · 原生目录选择器

- 仅在当前 Owner 已加载的 Browse 页面发起单项复制/移动；从长按菜单打开共享目标文件夹选择器，既不伪造目录 ID，也不拿“目标路径字符串”充当授权。按 Server 已有 `nodes/root` 与 `nodes/{id}/children?offset=...&limit=100&folders_first=true` 逐层读取与分页；取消、退出/更换账号、切目录都使用同一 Controller generation 隔离。进入子文件夹失败时保留刚请求的目标路径，重试仍然读取该子目录，不错误退回上级。
- 复制走现有 `POST /api/v1/nodes/{source}/copy`，请求 `{\"parent_id\":number}`，并允许服务端为重名副本生成新名称；移动走原有 `PATCH /api/v1/nodes/{source}`，请求 `{\"parent_id\":number}` 且携带源节点当时的 `If-Match: \"revision\"`。两种写操作都只提交一次，不自动通过 Token 刷新重试。 对可能丢失 ACK 的复制/移动暂时锁定目标确认及旧浏览快照，必须关闭选择器并重新 GET 后才能操作，绝不在不确定状态下重复发送写请求。
- 移动到原父目录、将目录复制/移动到自身或后代、目标根路径无法验证的情形禁止确认；Go Server 的 Owner、受管目标、冲突和祖先判断仍是最终准绳。页面上不自行预测复制或移动成功；只有服务端 ACK 后才更新已读列表并重新 GET，ACK 已到而 GET 失败时只允许手动重新读取。
- 新增 MockWebServer JSON/If-Match/Owner HTTP 契约、Controller JVM 延迟结果与 401 无重放、目标 100 项分页、API35 Compose 真实目标选择回归。所有测试须等待各自准确提交 CI 实际执行；不能借用 #2641 的先前结果。
- 批量选择及批量操作、冲突策略、Undo、回收站浏览和恢复、大文件上传/下载/Transfer Center 仍在后续任务中，不把本增量标记为完整 iOS 1:1。

## P0-05 · Android 多选及批量回收站（最小独立增量）

- 原生 Browse 的列表和网格共用 Selection Mode：点击「选择」后轻触切换当前已加载节点的选择状态，最多 200 项；长按普通上下文菜单在该模式内不执行。离开 Browse、切换目录或 Owner、刷新目录及退出登录都会清理旧选择，不持久化用户私有 ID。
- 仅提供已核对的批量「移到回收站」：用户在二次确认后请求 Go 原有 `POST /api/v1/nodes/batch/delete`，每项提交数字类型 `{id, revision}`，限 1–200 且不能重复/不可为根，Server 执行 Owner 范围/版本/同步受管目标与事务校验。Response 必须有非空 `operation_id` 以及与请求匹配的 `deleted_ids`；否则客户端不得显示成功。
- 沿用当前唯一 OkHttp/TLS/Bearer 会话与 `authenticatedMutation` 单次写入契约，任何超时/断开/丢失 ACK 都冻结该页已选择快照，不能用 Token 刷新重新提交，直到 Server GET 重新读取已确认状态。返回明确结果后才更新列表并刷新。
- 本增量不做跨目录未加载项的全库选择、批量复制/移动、Undo 与复杂冲突 UI。相应单项复制/移动仍由前置 PR #2646 承担；测试以本 PR 的准确 Android Native / API35 模拟器 CI 为准，不得借用父 PR 测试证据。

- Android 根目录多选必须先拦截系统 Back 并清理选中项，保留 Owner 浏览状态；根目录未选择交还 Android 系统。顶栏以 iOS PWA 52dp 内容高度为基准，叠加 Android 状态栏安全区域，仍须后续真机截图校准。

## P0-02 · Android 原生单文件下载 / 保存（SAF）
- 文件浏览列表/网格的 Owner 已加载 file 条目才显示「下载到设备」，真实 Android SAF CreateDocument 选择保存路径；不新增 WebView、第二条上传/下载服务端 API、通用存储权限或假动作。
- 下载复用会话级钉选 IP、TLS Host/SNI/OkHttp 与已有 GET /api/v1/files/:id/content。禁重定向、禁自动重试、Bearer 只放请求头，不放 URL；下载需要精确当前 revision ETag、Content-Length（已知时）及可用 SHA-256 校验。
- 按 64KiB 流式写入 SAF OutputStream，带可取消进度；退出登录、换服务器/目录或显式取消均撤销任务并尽力删除不完整目标 URI。旧文件选择器的迟到结果在请求前重新验证 Owner/目录/节点。
- 本轮只支持单文件下载，不声称批量上传/下载、续传、历史记录、通知、完整传输中心或真实机器产线验收已完成。

- 导航到其他目录、栏目或密码变更页时清理等待中的 SAF Owner 文件身份；保存成功才显示「已保存到设备」，失败和取消不得误显示完成。

- 新 Owner 请求（切目录、搜索、刷新、分页等）必须取消同一代下载 HTTP，并同步清空下载进度与 SAF 待保存节点；旧流的 finally 负责删除未完成文档，不能保留“下载中”或成功状态。

## P0-02 · Android 手动单文件上传 (SAF)
- Files 更多 > 上传文件，通过 Android OpenDocument 选择来源；Controller 仅接受当前 Owner、当前已读 Browse 文件夹且名称/大小可用的迟到选择器结果。SAF URI 不进入 State/日志/偏好设置。
- 复用服务端普通 /api/v1/uploads UploadSession、PUT 8MiB Chunk、POST finalize 与原有 CAS，不自建 Mobile 上传 Runner。每 Chunk 发送 SHA-256，仅 Server ACK 增加字节进度，默认同名冲突 fail，不覆盖/跳过。
- 操作取消/失效清空 UI 并取消网络，已有 session 尽量 DELETE，丢失 finalize ACK 不重放写入；Server 的 UploadSession TTL 清理作为兜底。
- 待后续：批量、历史、后台前台服务、严格断点续传、完整传输中心、Gallery/Viewer 和 1:1 UI 截图验证。准确 API35 CI 未通过前不认定完成。

- 终态 409/传输失败要解除「上传中」但不能假报提交；409 展示明确名称冲突，其余不确定 ACK 提醒刷新目录核对且不自动重放。SAF Provider 连续返回 0 字节达到 16 次时停止，避免上传线程无限循环。

- 对齐 #2651 的可访问性修复：被动 Checkbox 通过 `Semantics.selected` 与实际 Owner 选中 ID 和已选择数量验证。Go CAS Finalize 可能超过普通 JSON 30s 总时限或默认 10s read-idle，因此仅该请求继承同一加密/路由 Client 后使用 10min read-idle、无总时限，并保持调用者取消；不得放宽其他 HTTP 请求。


## P0-07 · Android Gallery 原生照片墙首轮

- 入口：Files 的原生账号更多菜单打开「照片」App，照片顶部返回上一 App 后仍使用此前已验证 Files Owner 目录；不新增 WebView、独立媒体 DB 或第二索引。
- 查询：直接复用 Go `GET /api/v1/media/items?range=true`、`sort_by=captured&sort_dir=asc&unknown_first=true&fold_duplicates=true&initial_position=latest`。首次从已验证总数的最后稀疏页开始，页长 60；如尾页很短，预拉上一页。继续向前加载时校验绝对 offset、总数及重复 ID，绝不把变更范围悄悄合并。
- 资源：Owner Bearer + session pinned 原域名/TLS/SNI 的二进制缩略图 GET；带节点 revision，4 MiB 上限、最多四并发、只保留会话内 48 个缩略图，虚拟项取消即结束网络请求，不保存 token/URI/私人图片磁盘缓存。
- UI：原生 390dp 下默认为约三列正方形、缩略图加载中显示文件/视频主图标；较短尾页照片位于页面底部；Live/视频只显示真实标记，点击仅展示已有属性，不伪装已支持的 Viewer。
- 本轮 **不等同于完整 iOS PWA 1:1**：精选集、年月日分组控件、Gallery Viewer/Live 播放、地图、搜索、选择、上传/下载与彻底像素校准仍未完成。CI 必须在本独立准确 HEAD 验证。

- Gallery API35 端到端登录夹具继承基础 Android `IME Done` 收起键盘与单次点击合同；其余照片查询继续共享 Owner 安全会话。

## P0-08 · Android 原生图片 Viewer（Gallery 后续独立增量）

- 点击真正的图片项目进入全屏图片 Viewer，视频/Live 播放继续保持未实现，不用元数据弹窗冒充播放。
- 沿用现有 Go `files/:id/content` 和 Android SAF 下载共享的 Owner/TLS/SNI/选定 IP/ETag/大小及 SHA-256 链路，不再建第二套媒体服务；仅以 Android RAM 暂存压缩文件（上限 32 MiB），后台采样到不超过 2048px 长边，拒绝无限制内存。
- Viewer 具备原生返回、Info、双击缩放、双指缩放和平移；退出时取消请求，viewer epoch 屏蔽旧请求 A→B→A 迟到回包，退出登录清除图片与 UI。
- 此阶段尚未实现超过 32 MiB 原图的磁盘短期/Tile 解码、视频与 Live、相邻照片滑动、iOS 27 年/月/日/全部、相册、地图、端到端截图校准。对应 Controller JVM 与 Compose API35 测试必须以当前 PR 准确 SHA 为准；不可访问生产验收按用户决定跳过（未验收）。

- 图片 Viewer 返回位置 P0：将 Gallery 的 LazyGrid 可保存位置与初次定位标志在同 App Shell 中保存，仅跨 Viewer 临时离开时恢复；新 Owner Range 重置定位。API35 真实 Compose fixture 在第 30 项打开图片、返回后断言同项仍可见，不能只断言页面回到了 Gallery。任何 Owner 私有缩略图/Token 都不进入保存状态。

## P0-08 · Android Gallery Viewer 相邻照片切换

- 新增原生水平手势切换相邻照片：只在已加载的当前 Owner chronological Range 内移动，视频/未加载范围均为真实边界；绝不猜下一页、跳过视频或新建第二套索引。单指左右滑动且缩放为 1x 时切换；放大后单指操作保留给图片平移。
- Controller 相邻项仅由同一已验证 `galleryItems` 中当前 `GalleryAsset` 的直接邻居确定，切换会递增 Viewer epoch；旧原图读取无论正常取消还是丢失 cancel ACK 均不得覆盖新 Viewer。
- 不叠加常驻切换按钮。通过 TalkBack 的「上一张照片」「下一张照片」可访问性操作触发同一 Controller，避免屏幕浮层污染 iOS 27 视觉。
- 增加 Controller JVM（边界、视频阻挡、旧原图取消）和 API35 Compose（真实水平手势、打开照片后返回位置）回归。真实播放视频、Live 与跨未加载 Range 衔接继续待做；以本增量准确 SHA CI 为准。

## P0-08 · Android 视频播放（Media3 MVP）

- Gallery 视频 Tile 实际进入 Media3 ExoPlayer/PlayerView（播放、暂停、缓冲、Seek、返回），不再用 Info 冒充播放。
- DataSource 继承现有 XDriveApi 固定 Owner IP/DNS、TLS Host/SNI；每次 GET 和 seek 的 HTTP Range 都校验原始 revision ETag、206 Content-Range 总长度/偏移及可用 body 长度。仅确切 Owner Node URI 注入 Bearer；拒绝跨域、重定向、200 Range 降级与静默重试，不添加 Token URL、第二套 Server/代理/本地缓存。
- 单独 Dispatcher 会在 Viewer 返回、退出登录、换 Server 时取消/释放，Files 和 Gallery 普通请求不被取消。
- 核心 MockWebServer、Controller JVM、API35 Compose 均已提交测试源码；准确 SHA CI 未通过之前不得声明验收。真实生产安全专项按用户决定跳过（未验收），代码权限和 CI 不跳过。
- 未完成：Live Photo 可靠 pair/.livp 的长按播放、跨 Range Viewer、codec 实物样本覆盖、iOS 27 视频控件逐像素对齐、后台恢复。

- Media3 依赖修正：真实 Android Native CI 证实 `1.11.1` 要求 `compileSdk>=36`，现保持应用 API 35 基线并选用官方稳定 `1.7.1`（官方说明与 1.6.1 相同代码）；需要准确新 SHA CI 重新验证。

## P0-07 · Gallery 无限向前分页（独立增量）

- Android 原生 Gallery 保持 iOS 照片墙最新在底部，不再显示与 iOS 不符的永久“加载更早的照片”列表项；触达照片墙顶部自动按 Go Owner Range offset 向前加载 60 项。
- 首次 sparse latest 末页若少于 24 项，仅预取一页后定位最新照片，绝不在首次进入就把 100k 全库扫描完；真正靠近顶部才继续分页。LazyVerticalGrid 稳定 item key 维持已可见照片锚点，不因 prepend 回跳到底部。
- 错误明确提供“重试加载更早的照片”，不清除已显示 Range，不重新读取 last page；Owner/total/offset/ID 一致性继续由 Controller 验证。自动加载在错误状态停止，避免循环请求。
- 核心 Controller JVM 覆盖失败 Range 的原 offset 重试和保留已读图片，Compose API35 fixture 覆盖首次 bounded prefetch、滚到顶部续页与旧尾部照片不丢失。准确提交 CI 未通过前不标记完成，生产环境安全验收仍按用户决定跳过（未验收）。

## Android Gallery P0 · Native Owner-wide search

- Bottom-right Search opens an actual search sheet; applying a keyword makes the
  existing pinned Owner Gallery Range call with `q`, not an in-memory filter of
  the loaded photos. The displayed total and sparse tail come from Server.
- Query changes and clear cancel old requests, reset the Viewer and visible
  Range, and never re-use another Owner's private rows. Leaving the Gallery
  clears the query. This is the first functional bottom control, not a claim
  that Year/Month/Day/All, Collections, sort and batch actions are done.
