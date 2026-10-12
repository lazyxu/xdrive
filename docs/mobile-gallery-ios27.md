# Mobile Web Gallery：iOS 27「照片」1:1 视觉与交互合同

**决策日期：2026-10-10。状态：设计已批准；运行界面改造及真机 1:1 验收尚未交付。**

本规范是 Mobile Web 图库后续改动的**优先视觉与交互验收基准**。以 Apple **iOS 27 正式版「照片」App** 为参照，不再以笼统的「iOS 风格」或旧版 iOS 26 截图为最终验收目标。用户所说的「1:1」指在可控的 Gallery 内容区内复现相应结构、尺寸比例、视觉层级、交互流程和状态反馈；它不是在浏览器内重建 iOS 系统层，也不授权改写 xDrive 已批准的 Server、Agent、Web App Runtime 或文件操作语义。

## Web 与 Mobile Web 图库功能完全等价（2026-10-10，强制）

**功能完全等价不等于界面布局相同。** 宽屏 Web 和 Mobile Web 必须提供相同的 Gallery 业务能力、实际 Server 查询与文件结果，只允许页面编排、控件位置、密度默认值、动效及移动手势不同。iOS 27 是 Mobile Web 的视觉/交互基准，不是另建媒体系统的理由。

| 能力 | Web/Mobile 共同实现 | 移动端入口与验收 |
| --- | --- | --- |
| 查询/时间线 | 单一 `XDriveMediaGalleryPage`、`MediaGalleryQuery`、`MediaGalleryDataSource`、Server `listItemRange`；年/月/日/全部、拍摄/加入时间、升降序、时区、折叠副本 | 图库时间尺度、排序与更多；同条件查询返回相同逻辑资产顺序/数量；可使用独立排序**偏好**，但不能少选项 |
| 10k/100k 浏览 | `useXDriveVirtualCollection`、`MediaVirtualTileGrid`、`MediaVirtualTimeline`、共用 thumbnail scheduler、Range/AbortSignal | 视口内与少量 overscan；不能全量读取/渲染；打开/返回以 Node 身份和查询范围保持锚点 |
| 精选集/组织 | 共用相册/文件夹、回忆、人物宠物、地点、媒体类型、收藏、清理/回收站的 source 方法与回调 | 精选集卡片只是索引，进入后复用 Web 的原页面；每一类都可达，维护正确权限/错误/空状态 |
| 搜索/筛选 | 共用 `MediaGalleryFilters`、草稿与已应用查询、Server facets、索引状态和结果数量 | 图库、精选集首页支持全库搜索；具备共享 Server 查询契约的相册/收藏等保留自身范围。回忆、宠物、回收站等尚不支持集合内查询的类型不得伪装成已实现；关闭/取消不改已应用条件 |
| 多选/整理 | 共用 `MediaGallerySelectionToolbar`、查询级快照、收藏、标签、加入/移出相册、批量下载和回收站 | 移动选择工具栏和更多菜单涵盖所有可授权操作；部分失败/取消/重试结果一致 |
| Viewer/媒体 | 共用 `MediaGalleryViewer`、Preview Engine、Filmstrip、属性、编辑配方、Live/RAW/视频能力 | 相同媒体身份、原件输出和状态；移动仅布局/手势适配；不创建第二套播放器 |
| Web 传输 | 同一个 `web/src/mediaGalleryAdapter.ts` 与 REST、文件操作状态；Desktop 继续通过 Agent IPC 适配相同共享契约 | 原件/版本/分享与 Task Center 的实际权限、成功失败回执一致，移动不能只显示假成功 |
| 平台与可访问性 | 共享 MUI 组件/业务状态；Web App Runtime 的唯一 App/Viewer 上下文 | App Frame 保持 52px 标题栏及唯一 App switch；899/900 切换保持选择/滚动，44px 目标、读屏与安全区单独验证 |

**变更门槛：** 每次 Gallery 功能新增或修改，在同一 PR 更新 Web/Mobile 的入口覆盖、同一数据源/虚拟化的回归证据；不能只验证 UI 字符串就声称功能等价。桌面宽屏 Web、Mobile Web Chromium、实际 iOS 27 Safari/安装模式与 Desktop Agent IPC 的测量分别记账。移动专用增强必须只在呈现层实现；若后台需要新功能，先扩展共享 Server/DataSource 契约，两端同时接入。对 1:1 视觉验收仍以实机参照截图为准，浏览器模拟不能替代。

## 官方参照（固定 iOS 27）

- [Apple：浏览照片图库（27）](https://support.apple.com/zh-cn/guide/iphone/iph7d24753a5/27/ios/27)：图库、年/月/全部、缩放、网格选项。
- [Apple：浏览照片精选集（27）](https://support.apple.com/guide/iphone/iph4f36c4148/27/ios/27)：横向集合、固定、展开/折叠、布局密度、重排。
- [Apple：搜索照片和视频（27）](https://support.apple.com/zh-cn/guide/iphone/iph392d77d5f/27/ios/27)：独立搜索、建议、搜索结果和范围。
- [Apple：查找日期（27）](https://support.apple.com/guide/iphone/iph0ea0234e0/27/ios/27)：年/月精选与最近日期集合的区别。
- [Apple：相簿（27）](https://support.apple.com/zh-cn/guide/iphone/iphc0fc668ab/27/ios/27)：相簿内容与操作。
- [Apple：iOS 27 更新](https://support.apple.com/en-ie/guide/iphone/iphfed2c4091/27/ios/27)：新增特性另行评估，不伪装成已实现。

最终视觉验收必须使用**真实 iOS 27 设备所截取的参考图**，记录设备、iOS 次版本、屏幕 CSS 视口、系统文字大小、浅/深模式、照片内容与显示状态。Apple 官方界面说明用于确定交互；不能只凭 iOS 26 的网上图片判断 iOS 27 像素差异，也不能未经实测虚构 iOS 控件 px 值。

## 不得改变的 xDrive 边界

1. **App Frame 不变：** 宽度小于 900 CSS px 时，Frame 根覆盖整个动态视口。保留现有带真实顶部 safe-area 的 **52px App 标题栏**；左侧退出当前 App，右侧传输与唯一应用切换入口。不得增加第二个全局应用切换、全局悬浮导航、第二条 AppBar 或永久全局底栏。
2. **Gallery Chrome 仅属于 Gallery：** iOS 式图库底部导航是 Gallery 内部的一部分，不能变成覆盖全部 Web App 的全局底栏。应用级退出、Gallery 集合内部返回、Viewer 关闭与浏览器 Back/Forward 各自保持原合同；Viewer 打开时后台 Gallery DOM 和滚动宿主不得卸载。
3. **平台/数据复用：** Web 继续调用已有 REST；Desktop 继续走 Agent IPC；Server 提供真实的稀疏分页、排序、媒体、相册与索引语义。公共类型/业务逻辑在 ui/shared/src，通用 React/MUI 在 ui/shared/src/mui；平台适配器仍归 Web/Desktop。不得另建 Mobile-only Gallery API、平行 Viewer/播放器、平行照片身份与编辑配方。
4. **其他平台不回归：** Desktop Gallery、Mobile Files、Web App Registry、Task Center、同步文件夹、Viewer 的非照片类型（Text/PDF/Audio）和全局应用框架保持已批准行为。FileExplorer 短按/长按规则及 Gallery 现有直接短按打开媒体、450ms 静止长按菜单、有效目标拖动合同不变。
5. **可靠性语义不妥协：** 保留 PhotoAsset/PhotoResource 关系、Live Photo 证据配对、RAW/Video、去重折叠、用户时区、准确来源路径、权限、逻辑范围选择与 10k/100k 虚拟化；没有索引或不支持的功能必须真实说明，不得通过外观伪装能力。

## iOS 27 信息架构与可见交互

### A. 图库 Library：默认落点

- 底部**主导航**为「图库 / 精选集」的独立切换容器与独立「搜索」按钮，模拟 iOS 27 的轻量悬浮、半透明、圆角视觉；不是旧版「分类 / 年月日全部 / 搜索」。Tab 状态正确、可读屏，返回后的滚动和当前资产身份保持。
- 「年 / 月 / 全部」是**图库内的时间视图控件**，按 iOS 27 的条件展示与显隐位置对齐；现有「日」能力保留在最近日期等次级入口，但不作为主导航第四个常驻时间 Tab。
- 图库初始呈现紧凑、边到边的连续照片墙，默认以拍摄时间为准；未知拍摄时间独立分组，不静默用上传时间冒充。排序切换不会无故丢失当前照片锚点。
- 每个普通照片单元只保留必要的非交互媒体标识（Live、视频时长、同步/副本等）；不在照片上叠加收藏/属性/更多三个操作按钮。单击打开 Viewer；静止长按出现上下文菜单；选择模式有清晰的勾选与退出。
- 网格/时间轴两种虚拟呈现必须使用**相同的列宽、间隙和行高计算**，缩略图无额外圆角。通过双指缩放改变照片墙密度并保持 Node ID 与屏幕位置锚点；默认密度应对照真机，在 390 CSS px 的标准参考下避免目前默认 144px 所造成的两列稀疏外观。
- 顶部可见操作精简为 iOS 27 对应的「选择」「排序和筛选」及必要的更多；时区、精确日期跳转、重复副本折叠等 xDrive 专有高级设置收进次级菜单，不删除实际能力。
- 「最新照片位于底部并直接定位末尾」已由 [P0-B PR #1200](https://github.com/lazyxu/xdrive/pull/1200) 通过完整 CI 并合并（`8f0489e`）：100k 逻辑照片的稀疏末尾页为 `offset=99900`、`returned=100`，无需客户端全量遍历；三次配对采样 P50 普通 458.120ms、末尾 459.032ms，**不声称请求提速**。真实 iOS 27 滚动/布局/设备验收仍未完成，不另建第二套分页。

### B. 精选集 Collections：独立主页面

- 不再把一个纯文本分类 Drawer 当成精选集首页。渲染 iOS 27 式分组页面：固定项目、回忆、最近日期、人物与宠物、相簿、媒体类型和实用工具，并按已有权威数据决定是否显示地点、旅程等模块。
- 每个分组采用带真实封面的横向可滚动卡片/网格、标题进入完整列表、展开与折叠。支持现有的相册封面、固定与排列机制；iOS 27 提供的布局大小切换和重排在适配现有状态模型后实现。
- 回收站、清理建议、同步文件夹/来源目录是 **xDrive 特有集合**，放在符合 Collections 分层的次级「实用工具」或扩展区，不假冒 Apple 官方集合；不删除这些入口。
- 手动相簿删除只删除集合关系，不擅自删除原始照片；「从此相簿移除」与「移至回收站」明确区分。人物、宠物、地点、回忆、重复项和智能集合原数据规则不变。
- 当没有真实旅程、精选照片或 Apple Intelligence 等服务能力时，不渲染装饰性虚假结果。iOS 27 新增共享相簿反应、全分辨率共享、延伸/重构编辑等业务功能单独审批 Server/产品契约，不因视觉复刻自动开发。

### C. 搜索 Search：独立入口

- 通过底部独立按钮进入符合 iOS 27 的搜索展示，支持真实关键词、日期、位置、人物、类型等可用条件；现有草稿/已应用查询、全库/集合范围、精确结果数量、索引状态与清除操作继续复用。
- 搜索建议仅取已有可解释的 facet、已命名人物、历史与权威索引能力；不能将尚未运行的 AI/OCR、未知索引覆盖率冒充已可搜索。
- 打开结果、返回搜索、返回照片原位置与范围更改必须保留身份与适用滚动锚点；软件键盘弹出、收起及纵向可滚动面板不得遮挡完成/取消。

### D. Viewer：保持一个全屏媒体查看器

- 复用现有媒体 Viewer、单一播放器及 Gallery browse context；把顶部返回/时间、底部分享/收藏/编辑/属性/删除、filmstrip 的**布局与显隐行为**按 iOS 27 独立比对。
- 单击媒体切换 chrome，1× 横划切换，放大时拖拽平移，双击放大与双指缩放应避免手势冲突。Live Photo 保留按下才加载和播放、松手停止；视频由播放器拥有播放手势。
- 信息/属性继续共用 Gallery / Files / Viewer 媒体属性组件并保持 Viewer 现场；编辑复用现有非破坏性配方，下载和分享只声明真实可交付的文件、资源与字节。
- Viewer 是独立全视口 overlay，不得为了 iOS 顶栏视觉替换原有 52px App Frame，也不得在关闭后丢失 Gallery 缩略图、已选状态或滚动位置。

## 可量化视觉验收

| 维度 | 验收方法 | 失败定义 |
| --- | --- | --- |
| 页面层级 | 同内容的 iOS 27 真机与 xDrive 截图逐屏比对；Library / Collections / Search / Viewer | 旧「分类 Drawer」仍充当主导航、时间尺度充当主标签 |
| 排版/密度 | 360×780、390×844、430×932、短横屏逐屏测量网格列数、卡片大小、边距、间距、标题与控件位置 | 默认照片墙仍稀疏、照片尺寸或间隙明显偏离参考 |
| 玻璃质感 | 明/暗模式比对底部容器透明度、模糊、边框、圆角、选中态、对比度及降级表现 | 仅普通不透明 MUI 底栏却宣称 Liquid Glass 已对齐 |
| 滚动/手势 | 实机单指滚动、双指密度、长按菜单、返回锚点、底部控件显隐 | 误触、位置跳变、阻止原生滚动、Viewer/集合状态丢失 |
| 状态完整性 | 空、加载、缓存命中、失败、无权限、未索引、部分成功、离线恢复 | 无证显示能力、空白页面、错误吞没、旧响应覆盖新上下文 |
| 规模/资源 | 10k / 100k 照片、混合视频和 Live；记录冷/暖首屏、请求数、滚动帧率、内存、取消字节及恢复 | 新布局导致虚拟化失效、客户端全量枚举、无效请求未取消 |
| 平台 | iOS 27 Safari 普通标签和主屏幕模式分别实测；Android Chrome/安装模式列为兼容性回归 | 以 Chromium 模拟通过冒充真实 iOS 27 像素/触觉/安全区验收 |
| 可访问性 | 44px 触控目标、200% 字号、VoiceOver、Reduced Motion、主题对比度 | 完成/返回不可达、焦点丢失、读屏不知 Tab/选择状态 |

**真实 iOS 27 对齐证据是发布门槛**：至少保留参考/实现成对截图、控件尺寸差异、手势录像、设备/OS/浏览器版本、commit、测试命令与结果。固定 52px xDrive App Header、系统状态栏、Safari 浏览器 chrome 及平台不开放的系统动画/触觉反馈须作为明确的**合理例外**单独记录，不能混入 Gallery 内部布局已达成比例的统计中。未完成实机测量时不得使用「像素级 1:1 已实现」措辞。

## 代码落点与交付拆分

- **P0-1 内部导航：** `ui/shared/src/mui/MobileGalleryChrome.tsx`、`MediaGallery.tsx`、`MediaGalleryNavigation.tsx`；分离主 Tab、图库时间切换和搜索，不改 `XDriveMobileAppHeader`。
- **P0-2 密度/滚动：** `MediaGalleryVirtualGrid.ts`、`MediaGalleryVirtualTimeline.ts`、`MediaGallery.tsx`；共享可测几何、双指密度及锚点。先解决 #1200 的相关 PR/CI，不并行发明另一套 tail paging。
- **P0-3 精选集：** 新增轻量 Mobile Gallery Collections MUI 呈现组件，消费既有 `MediaGallery`/Navigation/Albums/Memories/People/Pets/MediaTypes/Places 业务数据；不增加移动专用服务端 API。
- **P1-1 搜索/选择与菜单：** 复用 `MediaGalleryFilters.tsx`、`MediaGallerySelectionToolbar.tsx` 等共享控制器；完善键盘、安全区、范围和失败反馈。
- **P1-2 Viewer 与视觉：** `MediaGalleryViewer.tsx`、共享 preview/filmstrip/Properties 和移动主题层，禁止创建第二个 Viewer。
- **验收：** 扩展 `desktop/tests/mobile-gallery-ios-chrome.cjs`、网格/时间轴/Viewer/10k/100k 测试，运行 Web build/typecheck、GitHub PR CI、iOS 27 真机；更新 `docs/mobile-web-platform-matrix.md` 和可复查截图。

## 与既有交付的状态边界

- [PR #1193](https://github.com/lazyxu/xdrive/pull/1193) **已合并**，交付独立 Gallery Chrome 基础；其 `docs/mobile-gallery-ios-chrome.md` 是历史 P0-A 交付记录。本文**替代其中「分类 Drawer + 年月日全部」作为最终目标的 UI 规定**，不否定已完成基础或相应测试。
- [PR #1200](https://github.com/lazyxu/xdrive/pull/1200) **已通过完整 CI 第 2 次运行并线性合并**，单独实现 Mobile Web 可选末尾首屏请求，宽屏 Web 保持原有默认排序；iOS 27 真机 1:1 验收仍待完成。
- [Mobile Web 逐项任务](mobile-web-followups.md) 的 M01–M56 已批准业务边界继续有效；**2026-10-10 新批准的 Gallery iOS 27 高保真呈现专项**覆盖其中旧的图库展示建议，并不自动批准原来标记为「新增」的全部后端能力。
- [Mobile Web](mobile-web.md)、[Web App Runtime](web-app-runtime.md)、[Gallery roadmap](gallery-product-roadmap.md)、[Preview Engine](preview-engine.md) 中的权限、媒体身份、取消、共享与应用级生命周期合同优先保持不变。碰到真实不可同时满足的约束，先记录冲突并请求产品决策，不得默默改变 App 架构。


## P0-2 · KFS 网格公式与 iOS 27 照片墙（2026-10-10）

**状态：列数优先虚拟网格与双指密度由 [PR #1220](https://github.com/lazyxu/xdrive/pull/1220) 通过完整 CI 并线性合并（`369856c`），相应分支已自动清理；真实浏览器 10k/100k、iOS 27 Safari/主屏幕截图与手势验收仍待完成。**

### 算法来源及差异

- KFS `develop@306cc635` 的 [`calImageWidth`](https://github.com/lazyxu/kfs/blob/306cc635b2da5163b0495c28bc0d478453e94d55/ui/packages/common/components/ThumbnailList/ThumbnailList.jsx)：`columns = max(minColumns, floor((gridWidth - scrollbarWidth) / 256))`；`cell = (gridWidth - scrollbarWidth - (columns - 1) * gap) / columns`，其中 KFS Web 原实现 `gap = 8 * spacing`。KFS Mobile 的 `ThumbnailListYear/Month/Day` 分别使用 **10/5/3 列**。
- xDrive 的共享 `MediaGalleryVirtualGrid.ts` 增加**可选** KFS-style `minColumns`、`referenceColumnWidth`；`MediaGalleryVirtualTimeline.ts` **调用同一** GridMetrics 得到列数/宽度，不复制算法。真实 DOM `clientWidth` 已扣除滚动条，不再另减一次。保持 xDrive 原有 **4px 间距、方形网格、0px 缩略图圆角**。
- **宽屏 Web/Desktop 完全保持原有默认** `minColumnWidth` 算法和 `xdrive.gallery.view-preferences.v1`；只在 Mobile Web（小于 900px）启用列数优先模式。Mobile 的参考宽度选择 **144 CSS px**（KFS Web 原值为 256px），避免接近 899/900px 时出现明显列数断层；参考值是列数增长阈值，不是固定缩略图宽度。
- Mobile 默认 **Year 6 / Month 5 / Day 3 / All 3 列**。Month/Day 借鉴 KFS；Year 没有照抄 10 列，因为 xDrive 的普通年份缩略图可以独立点击：320px 宽、4px 间距、默认 6 列时每格 **50px**，满足 44px 基础触控目标。KFS Year 原值 10 列在同宽度会得到小于 44px 的可点击单元，不能在未经 iOS 27 真机对照下直接照搬。用户可以主动在「更多 → 照片墙最少列数」设为 2–10；新偏好键 `xdrive.gallery.mobile.columns.v1`，不会覆盖宽屏 Web 的桌面密度设置。
- 最终列数仍须由**iOS 27「照片」相同视口和内容的截图**校准；这里仅确立 KFS 算法为基准，不宣称 1:1 像素级已达成。

### 手势与跨端功能契约

- Mobile 两指操作仅在 **Gallery 照片墙** 触发；不拦截 App Frame、52px 顶栏、底部主导航、搜索、设置、Viewer 或选择模式。第二根手指应取消现有 450ms 长按菜单意图。
- 手指移动期间仅更新 CSS 预览，不发 Server 请求、不重建 100k 索引；松开时把两指距离比例映射到 2–10 列、**提交一次**显示偏好更改。保留中心附近已加载图片的逻辑索引作为 `viewAnchorIndexRef`，由**既有** `restoreAnchorRevision` 恢复滚动位置；缩放后点击事件不能误打开 Viewer。
- `MediaVirtualTileGrid`、`MediaVirtualTimeline`、范围加载、Server/API、thumbnail scheduler、当前选择和 Viewer 均继续共用；绝不创建 Mobile Gallery 专属 API、另一套虚拟列表或媒体播放器。Web/Mobile 功能等价不要求列数、菜单摆放、默认密度一致。
- 回归验收覆盖 **320/360/390/430/899/900px、10k/100k**、双指开合、短按、长按、单指滚动、页面切换、返回位置、浏览器缩放与横屏；记录真实 iOS 27 Safari/主屏幕模式和 Android Chrome 与模拟环境的差异。偏好、缩略图密度、触控和滚动的端到端表现未经真机测量前一律标记**待验**。


## P0-2b：补齐密集回退网格的列数等价（2026-10-10）

**状态：该密集回退网格一致性修复已由 [PR #1232](https://github.com/lazyxu/xdrive/pull/1232) 经完整 CI 通过并以线性历史合并（`2a08e7d`）；仅 iOS 27 真机与真实 10k/100k 性能验收未完成。** 代码审计发现：#1220 已让 `MediaVirtualTileGrid` 和 `MediaVirtualTimeline` 采用 KFS 列数优先布局，但 `MediaTileGrid` 的非虚拟回退分支（包括时间分组和「全部」）仍使用桌面 `repeat(auto-fill, minmax(144px, 1fr))`。因此在同一 390px 内容宽度下，虚拟布局为 3 列，而回退路径仍可能只有 2 列。此问题是**可复核的功能/呈现一致性差异**，不是新的媒体分页需求。

修复方案：保持原 `MediaTileGrid` 组件，仅在 Mobile Web 布局传入原有 `minColumns` 和 `referenceColumnWidth`，使用**相同的 `xDriveMediaGalleryGridMetrics`** 根据该容器真实 `clientWidth` 计算列数，`ResizeObserver` 跟踪宽度变化并释放监听。宽屏 Web/Desktop 未启用移动列数时继续使用原样的 CSS `auto-fill` 布局，不新增监听；密集路径继续使用同一个 `MediaTile`、选择、加载缩略图和 Viewer 回调。共享虚拟 Grid/Timeline、Server Range、Agent IPC 与全屏 App Frame/52px 全局标题栏保持不变。

**验收：** 新增 `desktop/tests/mobile-gallery-dense-kfs-parity.cjs`，从原组件源码提取实际 React 渲染函数，验证 390px **3 列**、ResizeObserver 将宽度改到 899px 后 **6 列**、12 个 Node 身份与顺序不变、宽屏默认 CSS 不变、两个非虚拟回退入口均透传共享 KFS 参数；320/360/390/430/899px 与 10k/100k 的 GridMetrics 数学结果相同。此回归只证明候选布局实现及组件级行为，**不能证明 100k 的真实 FPS、HTTP 请求取消、Viewer 返回位置或 iOS 27 视觉像素 1:1**。这些仍以真实浏览器/真机数据验收。


## P0-2c：双指缩放后保留照片的屏幕相对位置（2026-10-10）

**状态：[#1241](https://github.com/lazyxu/xdrive/pull/1241) 已通过完整 CI 并线性合并；真实 iOS 27 触控验收仍待完成。** P0-2a/P0-2b 已使虚拟与密集布局具有相同的列数，但当前双指缩放只将中心照片的逻辑索引作为锚点；布局换列时，原 `scrollMediaGalleryHostToOffset` 仍把该索引所在行移到滚动视口顶部，导致视觉中心跳动。保持 Node 索引并不等于保持屏幕位置。

新方案不改变 KFS 网格算法和 Server Range：双指开始时读取命中的缩略图相对于**当前 Gallery 滚动宿主**的纵向位置，随同逻辑索引传递到原有 VirtualGrid/VirtualTimeline；仅在本次密度变更对应的 `viewAnchorRevision` 内，恢复该行在屏幕上的位置。原排序、时间尺度、日期跳转、Slider、更换集合和宽屏 Web 等路径继续采用原来的顶部锚点；不将缩放位置泄漏给下一次导航。

屏幕位置恢复继续使用共享的 `mediaGalleryScrollParent` 和同一个滚动宿主，以 `hostTop - viewportTop + rowTop - anchorViewportTop` 计算增量。先等待新几何的布局帧再恢复滚动，并可取消已排队的 RAF；Viewer 和全屏 App Frame 的 52px 标题栏均不在缩放作用域内。数学回归覆盖 320/360/390/430/899px、10k/100k、3↔5/6 列、滚动宿主偏移、非有限输入、有限虚拟窗口。**上述为确定性模拟，不是 iOS 27 实机的动画流畅度、手势冲突、无闪烁、请求取消或像素 1:1 的验收证据。**


## P0-2d：iOS 27 View Options 放大／缩小（2026-10-10）

**状态：[#1245](https://github.com/lazyxu/xdrive/pull/1245) 已通过完整 CI、单工作提交线性合并（`e3fe5bd`）并清理分支。** 复用现有 Mobile Gallery 偏好与共享媒体视图，实机视觉交互验收仍未完成。

## P0-2e：宽 Mobile Web 每次有效缩放都改变可见列数（2026-10-10）

**状态：[#1251](https://github.com/lazyxu/xdrive/pull/1251) 已通过精确提交的完整 GitHub CI 并线性合并（`ab1cc5e`）；真实 iOS 27 真机验收仍待完成。** 899px 宽 All 默认 3 列时 KFS 自动得到 6 列，用户按「放大」把最少列数改为 2 仍显示 6，这是明确的无可见变化缺口。

保持默认 KFS 公式和既有偏好，`GridMetrics` 增加可选 `baselineColumns`：

```text
defaultVisible = max(scaleDefaultColumns, floor(clientWidth / 144))
visibleColumns = max(1, defaultVisible + (userColumns - scaleDefaultColumns))
tileWidth = (clientWidth - 4 * (visibleColumns - 1)) / visibleColumns
```

390px：2←3→4；899px：5←6→7；默认 Year/Month/Day/All 列数保持原样。VirtualGrid、VirtualTimeline 和两处 Dense fallback 仍由同一个共享 GridMetrics 负责；Web/Desktop 宽屏不启用参数，不增加移动端 API/Viewer/Range，维持全屏 App Frame/52px App Header。

**未验收：** 真实 iOS 27 像素截图与手势、真实 100k 浏览器 FPS/HTTP 取消；2–10 是存储偏好边界，并非所有宽度下的实际列数上下限。这里只做确定性几何和 React 组件测试，不声称性能提升。


## P0-3a · 精选集复用 Web 相册固定偏好（2026-10-10）

**状态：[#1257](https://github.com/lazyxu/xdrive/pull/1257) 精确单提交 CI `final-gate` 通过，已线性合并（`e88c8733`）；真实 iOS 27 真机像素验收仍待完成。** 宽屏 Web 原有相册组织器按账号保存固定相册与用户顺序，Mobile「固定项目」此前只有四项硬编码快捷入口，导致宽/窄屏同一账号的固定项目不一致。本阶段不增加第二套固定业务逻辑：Mobile 精选集仅通过 `readMediaAlbumPreferences(accountScope)` 和 `sortedMediaAlbums` 消费既有偏好；最多展示 8 个固定相册预览，保留「查看全部」进入已存在的包含固定相册的相册列表，点击实际卡片仍调用同一 `onOpenAlbum`。

未知/已删除的相册 ID 不显示；账号切换不复用他人的固定偏好，未授权上下文不读缓存。回忆预览先排除 0 项再取 8 项，避免列表前端空回忆占满预览配额。其余固定分类、Web/桌面 Organizer、REST/Server Range、Viewer、虚拟化、全屏 App Frame 与 52px 应用标题栏均不变。测试覆盖原共享偏好真实读取、固定顺序、已删 ID、账号隔离、导航回调以及回忆边界。

**后续差距：** 苹果 iOS 27 原生还支持任意项目固定、拖放重排、分组折叠与大/小/混合网格；当前只对齐已实现的相册固定能力，布局像素、真机手势、100k 浏览器性能仍待独立验收。不得将 P0-3a 称为完整原生 1:1。


## P0-3b · iOS 27 精选集布局与收起（2026-10-10）

**状态：[#1265](https://github.com/lazyxu/xdrive/pull/1265) 精确提交完整 CI `final-gate` 成功并单提交线性合并（`3b328c2`）；真实 iOS 27 真机验收仍待完成。** 对照 [Apple iOS 27 官方「在 iPhone 上浏览照片精选集」](https://support.apple.com/zh-cn/guide/iphone/iph4f36c4148/27/ios/27)：原生支持大图标、小图标、混合图标、全部折叠和单组隐藏图片。Mobile Web 当前「精选集」原为不可调整的 144px 横向卡片，本项只补显示层的布局与折叠，不改变相册/回忆/人物/地点/同步文件夹或清理业务能力。

- **布局：** 在已有精选集内容顶部增加可访问的「布局」菜单，提供大图标 196 CSS px、小图标 104 CSS px、混合模式按组 132/144/184 CSS px 的候选宽度；实际最终像素值须以 iOS 27 同设备同视口截图校准。选择仅变更卡片宽度，保留原集合 NodeID、封面身份、媒体加载器与点击回调。
- **折叠：** 每个可见分组均提供至少 44×44 CSS px、正确 `aria-expanded` 的单组折叠按钮；「全部折叠／展开全部」从同一布局菜单触发。折叠时不再挂载图片封面，保留轻量文字入口、打开集合及「查看全部」操作，既降低无效封面消费也不隐藏功能。现有 Observer 生命周期由共享缩略图封面组件负责；此条是结构性结果，**并未实测性能提升**。
- **偏好：** `xdrive.gallery.mobile.collections.layout.v1:<accountScope>` 仅存储移动端展示偏好（布局与分组收起），按账号隔离，验证枚举值、去重非法组名；空身份和禁止存储环境使用默认值。既有宽屏 Web/Desktop 的固定相册偏好 `MediaGalleryAlbumOrganization` 完全保持原样，P0-3a 的固定相册仍按同一个业务排序。
- **架构：** 仍只有一个 `XDriveMediaGalleryPage` / Web REST `MediaGalleryDataSource`，共享 `VirtualCollection` / `VirtualGrid` / `VirtualTimeline` / Range、Viewer、Live、RAW、任务权限与错误语义；不建立 Mobile 专属数据控制器、服务端索引或 Viewer。全屏 App Frame 和 **52px** 应用标题栏不动。
- **测试与界限：** 真实 React 组件级覆盖三种布局、个别/全部折叠、卡片入口在折叠后的可达性、账户切换恢复、无效数据/存储保护，以及共享 Web/桌面契约。iOS 27 的**长按拖动分组重排**、固定项目编辑、真机视觉截图/安全区/系统触感和实际 10k/100k 浏览器内存/FPS/HTTP 取消均单列后续阶段；不要将本次声明为 1:1 全部完成。


## P0-3c1 · 精选集分组排序（2026-10-10）

**状态：[#1269](https://github.com/lazyxu/xdrive/pull/1269) 已通过精确提交完整 GitHub PR CI `final-gate`，单提交线性合并（`22b8844`）；真实 iOS 27 Safari 触控及截图验收仍待完成。** 参照 [Apple iOS 27「重新排序精选集」](https://support.apple.com/zh-cn/guide/iphone/iph4f36c4148/27/ios/27)：精选集布局菜单和列表末尾均可进入「重新排序」，排序模式只展示现有有内容（或有合法「查看全部」入口）的分组名称，不创建假集合。每项拥有最小 44px 触控手柄；触控按住至少 220ms 后拖动，通过手指命中的分组行更新顺序；提供独立上移/下移和方向键替代方案，再点「完成」回到同一 Gallery 页面。一般浏览不拦截上下滚动、Collection Cover 仍使用原来的懒加载、原来的 Click 打开操作。

**偏好与身份：** 分组顺序的唯一新存储是 `xdrive.gallery.mobile.collections.group-order.v1:<accountScope>`，其内容仅为七种固定的展示分组 ID 的有界、去重、合法化排列。账号不同不能相互读取，存储失败退回默认展示；后续新增分组自动追加。没有内容的分组可在排序编辑器中暂时隐藏，但其 ID 仍然保留于偏好，不得删除其排序位置。相册内部固定项及其由 Web/Desktop 共用的 `MediaGalleryAlbumOrganization` 完全不改，这是另一个 P0-3c2 范围。

**不变量：** 全屏 App Frame、52px 全局标题栏、一个 Web `XDriveMediaGalleryPage`、Web REST `MediaGalleryDataSource`、同一 Server Range 与共享 `VirtualCollection/VirtualGrid/VirtualTimeline`、Viewer、Live、RAW、Properties、任务和权限均不修改。加入真实 React 组件的 pointer 长按/拖动、键盘/按钮、账号边界和完成后顺序恢复回归。相关性能没有对比样本，无加速声明。iOS 27 真机像素级位置、触感、drag 动画、边缘自动滚动、真实 10k/100k Browser 请求取消和滚动帧率仍需后续验收。


## P0-3c2 · 编辑固定项目（2026-10-10）

**状态：[#1273](https://github.com/lazyxu/xdrive/pull/1273) 精确提交完整 CI `final-gate` 已通过并单工作提交线性合并（`fd79281`）；真实 iOS 27 视觉/触控验收待完成。** Apple iOS 27 官方 [固定精选集和相簿](https://support.apple.com/zh-cn/guide/iphone/iph4f36c4148/27/ios/27) 要求从「固定」标题右侧进入「编辑」，可移除、添加和通过触控拖动调整固定顺序，完成后关闭。此前 P0-3a 仅显示宽 Web 已固定的相册，这里补齐可操作的编辑界面，并显示真实可打开的精选集快捷项以及当前用户实际已有的相册。

- **共享语义：** 相册是否固定只由现有 `MediaGalleryAlbumOrganization` 中的 `readMediaAlbumPreferences`、`changeAlbumPin`、`writeMediaAlbumPreferences` 管理；Mobile 编辑后宽屏 Web 通过同一账号偏好获得一致的固定相册及顺序。没有独立的 Mobile 相册归属表或请求端点。保留当前已有的收藏、相册、人物与宠物、媒体类型为初始四个快捷项，候选补充已实现的回忆、地点、清理建议、回收站。
- **Mobile 展示顺序：** `xdrive.gallery.mobile.collections.pinned-order.v1:<accountScope>` 只保存真实项目的 ID 排列及移动端内置快捷项是否显示；**不会替代** Web/Desktop 的 `xdrive.gallery.album-organization.v1`。改变相册相对顺序时同时将相册子序列写回共享固定相册偏好；未加载的原有相册身份必须保留。非法、重复、超长、跨账号记录无法注入显示；用户明确全部取消固定时，固定栏目仍必须能再次打开编辑器。
- **交互：** 固定项目标题旁放置 ≥44px「编辑」入口，编辑器有「已固定」移除按钮、长按至少 220ms 的 44px 拖动手柄、方向键与上下移动可访问替代，以及真实精选集建议和「任何精选集或相册」搜索添加。预览最多 12 项，候选和已固定编辑列表按需筛选并限制 DOM 展示，避免把所有相册并行渲染进 DOM。关闭后回到同一个精选集滚动宿主与内部导航；不会打开新的 Gallery 应用、Viewer 或 API。
- **保护原架构：** 全屏 Mobile App Frame、52px App Header、Web/Desktop 一套 Server 与 REST `MediaGalleryDataSource`、`VirtualCollection/Grid/Timeline`、媒体身份、Viewer、Live/RAW、权限与批量操作全部保持不变。测试覆盖真实 React 编辑事件、两端共享偏好、相册真实 Node/ID、插入/移除/重排、账号隔离、空固定编辑入口、触控阈值、键盘，以及 120 个相册中候选最多 48 与搜索超出初始配额的项目。
- **待完成：** iOS 27 同视口真机截图、Safari 长按与滚动冲突、原生动作动效、宽 Web 多标签实时存储同步，以及所有个人照片/回忆/人物的完整固定项目可用性仍需后续真实数据/交互专项验收。当前候选的任何静态测试不能代替 1:1 真机验证或真实 100k 浏览器性能测量。


## P0-3d · 长按快速固定与移除确认（2026-10-10）

**状态：[#1279](https://github.com/lazyxu/xdrive/pull/1279) 已通过精确提交完整 GitHub CI `final-gate`，单工作提交线性合并（`9d0b0dd`）；真实 iOS 27 Safari 真机验收仍待完成。** Apple 官方 [iOS 27「照片」浏览精选集](https://support.apple.com/guide/iphone/browse-your-photo-collections-iph4f36c4148/27/ios/27) 明确要求：长按任意可固定的集合快捷键进入「固定／取消固定」操作；编辑固定栏目时先点移除图标，再确认「删除」（**只移除固定入口，不删除照片或相册**）。

- **复用共享相册偏好：** 只对现有合法入口（收藏、相册、人物与宠物、媒体类型、回忆、地点、清理建议、回收站，以及已加载、已有 `onOpenAlbum` 的真实相册）打开快速固定菜单。一个 `CollectionGroup` 中普通 `album:<id>` 和固定项 `pinned-album:<id>` 指向同一现有 `changeAlbumPin/readMediaAlbumPreferences/writeMediaAlbumPreferences`；Web/Desktop 相册组织器仍是相册固定及相对顺序的唯一权威。动态单个回忆/人物/宠物/地点与同步文件夹未获得通用跨端固定模型，本轮保守不展示虚假固定菜单，仍可按原流程打开。
- **iOS 类长按：** 可操作项目的移动端触控/触笔保持 **450ms、移动 ≥8px 取消**，横向滚动也会取消；右键与键盘原生 context-menu 事件走同一快速菜单。成功长按只吞掉该次合成短按，不能把固定意图和打开集合同时执行。组件没有在每项叠加按钮，也不接管图库主滚动宿主、网格双指缩放、Live Photo 按住播放或 Viewer 路由。真机 Safari/Android 长按的菜单动画、手势竞争和浏览器默认菜单仍待实测。
- **确认移除：** Mobile「固定项目 → 编辑」的移除按钮改为先打开确认菜单，明确提示「仅移除固定入口，不删除原内容」，提供 ≥44px「删除／取消」。取消后不更改账号相册偏好和展示顺序；确认后复用原有 `togglePin`。无需 Server 删除或媒体任务。
- **测试：** 真实 React 组件回归覆盖已加载真实相册快捷菜单、再次取消固定、跨账号不泄漏、450ms 长按、移动取消、合成点击抑制、删除确认/取消/保全真实相册、非法身份不露入口；同步保持 Web/Mobile 共用页面/API/`VirtualCollection`/Viewer/权限验证。未执行真实 iOS 27 真机、实际 10k/100k HTTP 取消/滚动/帧率或截图像素比较，不能称 1:1 已验收。

**延续边界：** xDrive 全动态视口 App Frame、52px 独立全局应用标题栏、Web/Desktop 共用 Server、一个 Web `XDriveMediaGalleryPage` 和 REST `MediaGalleryDataSource`、共享 `VirtualCollection/Grid/Timeline`、原始 Node/PhotoAsset/RAW/Live/Viewer 身份以及相册、筛选与传输流程全部保持不变。后续单独完善动态人物/回忆等可固定身份，及真实 iOS 27 对照验收。


## P0-3e · iOS 27 精选集标题直接打开完整内容（2026-10-10）

**状态：[#1282](https://github.com/lazyxu/xdrive/pull/1282) 精确提交完整 CI `final-gate` 通过、线性合并（`ab693be`）；真实 iOS 27 截图与 Safari 交互尚未验收。** Apple 官方 [iOS 27「在 iPhone 上浏览照片精选集」](https://support.apple.com/zh-cn/guide/iphone/iph4f36c4148/27/ios/27) 明确要求：在分类标题下水平滚动以浏览项目，或**轻点分类标题直接打开该类别的全部项目**。此前 xDrive Mobile 分类标题只是静态文本，右侧另有小「查看全部」按钮，产生额外的导航操作并与原生结构不一致。

- **单导航入口：** 只有已经拥有真实 `onViewAll` 业务回调的分类，才把原有 `<h3>` 标题内嵌至少 44px 的单一文本+右箭头按钮：回忆 → 原 `memories`、相册 → 原 `albums`、人物与宠物 → 原 `people`、地点 → 原 `places`、同步文件夹 → 原相册入口中已有的同步文件夹区（真实完整聚合页仍属 Albums）。分类仍可水平扫卡片，折叠后文字入口继续存在，不额外发起 Range 或 Viewer 读取；移除右侧重复「查看全部」按钮。
- **不伪造页面：** Pinned 的「查看全部」原先直接进入 Albums，但 Albums **不是**全部固定项目，包含收藏、人物、媒体类型及相册混合项；取消这种误导的聚合链接，只保留原生标题旁 ≥44px「编辑」及可横向浏览的预览。完整固定项通过现有可搜索编辑器可达；实用工具也没有合法的独立聚合页，标题保持普通文字。若以后交付真正的「全部固定项目」阅读页，再添加相应真实入口。
- **可验收边界：** 在真正渲染的共享 React 组件测试中，验证五种可点击标题的路由回调、44px 目标及 `aria-label`、折叠状态、仅有一个对应动作、Pinned 的完整编辑入口仍可达以及 Album/Node 身份不变。仍保持 Web 与 Mobile Web 一套 `XDriveMediaGalleryPage`、`MediaGalleryDataSource`、`VirtualCollection` / `VirtualGrid` / `VirtualTimeline`，使用相同 Server Range、权限、批量任务和 Viewer。全屏 App Frame 与 **52px** 全局应用标题栏不变。物理设备照片墙列数/间距/动效、真实 Safari、10k/100k 浏览器 FPS、HTTP cancel 均需另行实测。


## P0-3f · Web/Mobile Web 固定相册实时状态一致性（2026-10-10）

**状态：[#1286](https://github.com/lazyxu/xdrive/pull/1286) 精确提交完整 CI `final-gate` 成功并以单工作提交线性合并（`e06afeb`）；真实浏览器多标签及 iOS 27 实机交互仍待验收。** 之前 P0-3a～P0-3e 保证了固定相册使用相同的 `xdrive.gallery.album-organization.v1:<accountScope>`，但宽屏 Web 的 `MediaGalleryAlbumOrganizer` 只在首次挂载或账号变化时读取；已打开的宽屏和 Mobile 页面并不能保证同步看到另一个标签页写入的固定状态。原生照片应用的不同布局只改变展示，固定相册的逻辑身份与状态必须一致。

- **一份权威数据：** 沿用现有 `MediaGalleryAlbumOrganization` 的 `readMediaAlbumPreferences/writeMediaAlbumPreferences/changeAlbumPin`；增加零存储开销的 `subscribeMediaAlbumPreferences(accountScope, notify)`。当前窗口写入成功后只通知对应账号订阅者；其他标签页的 `storage` 事件更新相同账号，处理 `localStorage.clear()` 的空 key 并在组件卸载/账号切换时注销处理器。失败写入不虚报变更，未授权/空账号不订阅，不增添新的 Mobile Pin membership model。
- **两端接入：** 已有宽屏 Web / Desktop 公共 `XDriveMediaGalleryAlbumOrganizer` 订阅上述事件并重读原有排序与固定偏好；原 Mobile Collections 同样订阅并在数据变化时重渲染。任何 `album:<id>` 与 `pinned-album:<id>` 的渲染仍使用相同 `sortedMediaAlbums` 和同一 `onOpenAlbum`，不会重新获取全库图片或新增媒体任务。Desktop 的独立 `desktop:` 存储作用域、权限及运行时保持原样；不宣称不同设备自动同步本地偏好。
- **回归：** 从真实 TypeScript 业务函数编译运行的 Node 测试验证账号隔离、同窗口和跨标签事件、空键、写入失败、卸载后监听释放；实际 React Mobile Collections 渲染测试验证另一宽屏回调写入后直接出现/移除固定相册、跨账号不泄漏、无需组件 remount；静态契约验证仍使用同一 Web REST / Range / Viewer、虚拟列表及 52px 全局标题栏。最终浏览器多标签/移动真机与 899/900px 切换仍需测量，静态与 Test Renderer 不能代替。
- **系统边界不变：** 全屏 App Frame、52px 全局 App Header、一个 `XDriveMediaGalleryPage` 和 Web REST `MediaGalleryDataSource`、共用 `VirtualCollection`/`VirtualGrid`/`VirtualTimeline`、PhotoAsset/Live/RAW/Viewer、Server Range、权限、Task Center、原页面返回位置均保持原样。没有新后端 API、媒体缓存或专属移动端业务控制器；真正的 iOS 27 像素截图、触控交互、原比例照片墙、真实浏览器 10k/100k FPS/HTTP cancel 仍列为独立待验事项。


## P0-3g · iOS 27 统一「排序和筛选」入口（2026-10-10）

**状态：[#1293](https://github.com/lazyxu/xdrive/pull/1293) 精确单提交完整 CI `final-gate` 通过，已线性合并（`2db84f895`），相关旧分支已清理；iOS 27 真机视觉/触控仍待验收。** Apple iOS 27 [官方排序/筛选指南](https://support.apple.com/zh-cn/guide/iphone/iph2e66e2f2c/27/ios/27) 使用统一入口，xDrive 此前顶部拆成两个 44px 独立按钮。

- 将移动图库顶部排序、筛选按钮合为一个至少 44px 的「图库排序和筛选」按钮；原有四种拍摄时间/加入时间升降序完整保留，菜单末尾的「筛选图库」直接打开原来的共享 `filterContent` Drawer；没有可用筛选时该项禁用。保留清晰的 aria 名称和展开状态。
- `MobileGalleryChrome` 只变更编排，排序直接调用原 `onSort`，筛选仍消费同一个 Web Gallery 的业务状态与 Server REST 接口，不引入独立移动查询、虚拟列表、Viewer、任务或媒体索引。52px App Header、全屏 App Frame、4px 网格间距及 KFS GridMetrics 不变。
- React 组件回归 `desktop/tests/mobile-gallery-ios27-sort-filter.cjs` 覆盖单入口、原四种排序回调、筛选 Drawer 引用和无可用筛选时禁用。此次不声称真机像素匹配、性能提升或 100k 渲染/HTTP 取消已验收。


## P0-3h · 原生「排序和筛选 → 显示选项」菜单层级（2026-10-10）

**状态：[#1294](https://github.com/lazyxu/xdrive/pull/1294) 精确单提交完整 GitHub CI `final-gate` 成功，已线性合并（`68e4c9ac`），仅 iOS 27 真机视觉/触控验收仍待完成。** Apple iOS 27 官方 [浏览照片图库](https://support.apple.com/zh-cn/guide/iphone/iph7d24753a5/27/ios/27) 明确要求从图库的「排序和筛选」进入「显示选项」后再放大/缩小、切换网格呈现。

- **本轮实现边界：** 现有 `XDriveMobileGalleryChrome` 的「图库排序和筛选」菜单增加「显示选项」子级，并在同一原菜单内显示「放大、缩小、方形裁切、完整比例（方形网格）」；返回能回到排序和筛选。删除「更多」面板重复的缩放与长宽比入口，保留 xDrive 的精确列数 Slider、时区、跳转、折叠副本和扩展操作。每项实际调用已存在的 `onDensityChange/onAspectModeChange`，禁用状态与原边界一致，不改 Server 查询和媒体身份。
- **严格不伪称原生功能：** `aspectMode=contain` 只改变**方形单元内的图片完整显示**，不是 iOS 27 的真正「原始比例网格」（可变单元高度/行布局）。菜单必须使用「完整比例（方形网格）」而非「原始比例网格」，后者需另行设计共享虚拟布局、锚点与 10k/100k 可见范围测试，真机图像校准前保持未交付状态。
- **验收：** 原 React 组件测试移至真实菜单层级，验证 44px 触达、密度回调及 2/10 列边界；扩展回归测试验证显示模式回调、菜单返回与现有筛选 Drawer；新状态保持共用 `MediaGalleryDataSource`、VirtualGrid/Timeline、52px App Header 与完整 App Frame，不另建移动端后端或 Viewer。测试、CI 和 iOS 27 Safari 原生截屏的状态分开报告。

- **首轮 CI 边界回归：** 原有 `Collections overview does not expose the Library zoom controls` 在 Test Renderer 中发现“未展开但仍挂载的排序菜单”包含 Library 显示选项；第一轮 Desktop 统计 2002 pass / 1 fail / 1 skip。通过只在 `showCollection` 为真时挂载菜单项、离开 Gallery 列表时关闭/清空菜单状态，补充从打开的 View Options 跳至 Collections 总览的真实 React 回归。该问题属于展示/生命周期隔离，不改变 Server 查询或 100k 虚拟列表；修订后的精确提交完整 CI `final-gate` 成功并已合并。


## P0-3i · iOS 27 图库底部「年／月／全部」时间视图（2026-10-10）

**状态：[#1303](https://github.com/lazyxu/xdrive/pull/1303) 精确提交完整 GitHub CI `final-gate` 成功，单提交线性合并（`890b6e7454c8`），旧分支已清理；真实浏览器与 iOS 27 真机视觉验收仍待完成。** Apple iOS 27 [官方照片图库](https://support.apple.com/zh-cn/guide/iphone/iph7d24753a5/27/ios/27) 明确展示底部按年、月、全部切换。xDrive 目前将这三项放在 Gallery 顶部 48px sticky 条，属于信息层级错位。

- 仅将同一个 `XDriveMobileGalleryChrome` 的 **一份**「年／月／全部」按键组从顶部 sticky 移至 **Gallery 内部**底部浮层，位于原图库／精选集／搜索底部 Dock 的上方，保留时间尺度 `onTimeScale`、原年/月/全部偏好与稀疏 Timeline/VirtualGrid。原「日」仍从更多操作访问，不添加第四个原生底部标签，不改变 52px 全局 App Header 或第二套全局导航。
- CSS 采用可复核的候选双层底部几何：主 Dock bottom=0，时间视图 bottom=`calc(64px + env(safe-area-inset-bottom, 0px))`，时间控件触控高度至少 44px；图库最后一屏预留 `calc(140px + env(safe-area-inset-bottom, 0px))` 真实滚动空间，避免最后一行照片被两层浮动控件遮住。仅当移动端正在浏览 Library 照片集合且未进入选择模式时显示，不在精选集总览、Viewer 或宽屏 Web 展示。
- 这不是 Apple 27 已验收的精确双 Dock 层级、圆角/模糊数值或动态显隐：官方截图展示底部年/月/全部与搜索，而 xDrive 仍保留已确定的独立图库／精选集主 Dock；目前先以操作层级和可用性对齐，真机成对截图后再校准两层的排列与动画。原生 Year/Month 的精选内容语义与当前 xDrive 的时间线逻辑资产范围也需单独比对，不能只因按钮位置对齐就宣称原生 1:1。
- React 组件测试检查单一入口、真实 `onTimeScale`、选中态、44px 操作目标、底部 safe-area、精选集/选择状态的隐藏，以及共享 Web REST、`VirtualCollection/Grid/Timeline`、Viewer 和 App Frame 不变。真实 iOS 27 Safari/安装模式、390/430/899/900 几何、10k/100k FPS/取消及最终截图差异仍是后续验收门槛。


## P0-4a · Web Gallery 双层底栏真实 Chromium 验收（2026-10-10）

**状态：[#1309](https://github.com/lazyxu/xdrive/pull/1309) 已通过完整 PR CI 并合并；真实 Chromium 240 项多视口/交互验收已交付，iOS 27 物理设备验收仍待完成。** P0-3i #1303 将年／月／全部放到 Gallery 内部底部，但此前只有 React 测试和源代码断言，缺少真实已构建 Web 的多视口 DOM、点击命中与末行无遮挡证据。

- 复用 `desktop/scripts/mobile-web-app-browser.cjs` 的真实 Web build、原 `MediaGalleryDataSource` 与有界的 240 张照片 API fixture；新增 `--scenario=gallery-ios27-chrome`，不增加移动端业务接口、控制器或 Viewer。
- 同一 Gallery DOM 依次测量 360×780、390×844、430×932、844×390、899×700、900×700、390×844；保存 App Frame 52px 标题栏、时间视图/主 Dock bounds、44px 按钮 hit-test、共享 KFS 实际列数及宽屏退出移动模式。
- 390×844 滚动至第 239 张照片，检查磁贴完整位于两层浮动底栏上方且可点；操作选择／完成、月／全部、精选集／图库并验证业务回调、已挂载 DOM 与显示恢复。
- 为遵守 GitHub/GitLab **核心 job 集合一致性**，在既有 `web` job 中添加仅 `test/mobile-gallery-ios27-real-chrome-*` 分支执行的真实 Chrome 验收步骤，不另建 job；使用同一 Web 构建结果，产出 JSON、screenshots、runner 与源码 SHA-256、请求与错误日志。先记录 first-red，再区别 fixture/CI 与产品缺陷。
- **边界：** 240 张照片真实 Chromium 浏览器几何验收 ≠ 10k/100k 性能测量，更 ≠ iOS 27 Safari/安装模式、软件键盘、VoiceOver、真实安全区、同内容截图 1:1 验收；这些继续独立记录。

- **首轮 first-red（#1309 run 38037048117）：** `go-windows` 的 `internal/cicontract/TestGitHubAndGitLabCIStayInParity` 明确报新增 GitHub job 未在 GitLab 对应；原独立 Chrome job 则成功启动真实浏览器，但旧启动等待 `[data-xdrive-file-explorer-item]` 超时。截图/DOM 和实际 `GET /nodes/1/children` 证明 Mobile Files 已渲染 `document-001.txt`，无未知 API、PageError 或 ConsoleError；属于已有 Files presentation selector 漂移，并**非** Gallery first-red。本次在同一个工作提交中改为该场景等待实际可见文字，且 Chrome 步骤移入已有 Web job。保留 `results.json` 和 first-red artifact ID `11664064384`；后续要求重新运行同一个 Gallery 几何断言，不能把旧错误规避视为产品修复。

- **第二轮 fixture first-red（#1309 run 38037446695）：** 旧媒体 fixture 只接受 `sort_dir=desc`、不允许 `initial_position/unknown_first`，而当前已合入的移动 `MediaGallery` 首屏真实请求是 `range=true&limit=100&offset=0&time_zone=UTC&initial_position=latest&unknown_first=true&sort_by=captured&sort_dir=asc`；因此返回 501，图库展示失败，原几何断言尚未运行。真实 Chrome 启动、Mobile Files 加载、Web build 与 CI job-parity 均已正常。修正测试 fixture 以遵守现有 Server 合同：仅本 Gallery 验收场景接受这些字段，要求 `latest` 且升序、对 240 个样本返回 page-aligned `offset=200` 的末尾 40 项与 `anchor_index=239`；**未修改产品查询或绕过任何几何检查**。保留失败 artifact `11664528094`；等后续真实浏览器 first-red 才评估是否需要改产品 UI。

- **第三轮真实几何（#1309 run 38037744950 / artifact 11664785625，partial first-red）：** Chromium 在 360×780、390×844、430×932、844×390、899×700 的 **30/30 已执行 DOM 几何和点击断言成功**。实测 390×844：全局 App Header 52px、时间栏 x99/y726/w192/h54、主 Dock y788/h56，间距 8px；列数 3；844 横屏 5 列、899px 6 列。此时尚未跑完 900px 宽屏、最后一张照片与导航，不得声称全场景通过。宽屏阶段合法发送 `sort_dir=desc`，但 fixture 曾过严地只接受移动首屏 `asc`；真实缩略图请求也包含与 Node 版本一致的 `revision=1`，而旧 fixture 只允许 `v=3`，造成 501。修正 fixture 严格验证两种合法排序方向与最新页升序限制，并校验每个缩略图请求的 revision，不修改产品 Server/API。原 Chrome CI 截图的汉字变成方框，现仅该分支 Web 作业安装 `fonts-noto-cjk` 后重新留存截图；此举不是宣称匹配 iOS 27 字体像素。第三轮真实浏览器失败原始工件 ID 为 `11664785625`。

- **第四轮跨断点（run 38038095042 / artifact 11665200752）：** 同一真实 Chrome Gallery 从 360 到 900px 并返回 390px 的 **38/38 已执行布局断言均通过**；在宽屏 900px 不保留任何 Mobile-only 底栏，返回后 Header/缩略图网格与滚动容器身份仍符合现有设计。但滚至末张前触发已合入的“返回原位置” API：`anchor_node_id=1000`，旧 fixture 未允许它，导致 501、后续末张图片与选择动作尚未验收，非 Gallery 产品故障。本轮仅在此验收场景按真实 Node 身份验证 `anchor_node_id` 为授权范围内的正整数，返回对应的绝对 `anchor_index`（ID1000→index0），并拒绝与 `initial_position` 同时设置；完整原 UI/交互断言保留不动。第一次真正的产品 first-red 仍待测。源证据与截图继续保留，绝不声称物理 iOS 27 已达到 1:1。

- **第五轮真实浏览器进度（run 38038427444）：** 真实 DOM 的 7 个响应式视口、最后一张可点击照片和真实时间/精选集操作均已执行，唯独精选集预览触发两个之前未建模的**正常读取**：`GET /api/v1/media/memories?limit=8&time_zone=UTC&anchor_date=<当日>` 和 `GET /api/v1/media/sync-folders`，原 fixture 返回 501 导致最终网络审计失败。仅为当前测试场景加严格 query 验证、返回真实空集合 `[]`，不调整生产代码，不禁用未知请求审计。此前通过的几何和交互断言保留。后续仍以精确提交全 CI 及网络审计为合并门槛。

## P1-1a · Mobile 精选集首页直达图库上传（2026-10-11）

**范围：共享操作可达性修复与测试；不声称 iOS 27 真机像素验收完成。** 原来宽 Web `contextualHeaderActions` 能直接调用 `onUploadRequested`，移动图库在「精选集」首页却隐藏「更多」入口；底部图库／精选集／搜索并不能代替真实上传入口。现在仅当共享 Gallery 上传回调在当前范围合法存在时，允许精选集首页展示至少 44px 的「更多」；点击后使用原 `data-xdrive-gallery-upload` 和 Web `galleryUploadInputRef` 的原生 `multiple` 文件选择器，不创建另一套 Mobile API、上传控制器、任务或 Viewer。回收站内容页仍禁止上传；从回收站返回全局「精选集」首页则恢复共享上传入口，900px 宽屏断点重新应用当前范围限制；未提供上传回调时不新增入口。权限/账号改变使入口消失时，已打开的 More 操作面板会随之关闭。精选集首页 More 只复用同一共享上传按钮，不继承从相册、人物等嵌套范围切换而来的专属操作；不显示属于图库照片墙的列数、时间设置、重复副本折叠和查询级全选。精选集自身的布局与固定项目编辑仍使用其现有入口。

测试分层：现有 React `mobile-gallery-ios-chrome.cjs` 检查启用/禁用、真实同一回调、44px 与回收权限收回；`mobile-gallery-web-parity.cjs` 保护 REST/VirtualCollection 与 Web 多文件 picker 的唯一绑定；分支命名 `test/mobile-gallery-ios27-real-chrome-*` 启动已构建 Web 的 `gallery-ios27-chrome`，在原 360–900px / 240 张 fixture 之后实际触发浏览器 `filechooser` 并验证 `multiple`，保留严格未知网络请求审计。该测试不提交文件，因此不冒充真实上传完成、批量任务收据或 100k 性能数据。真实 iOS 27 Safari/主屏幕、语音辅助、图片像素与完整文件传输验收继续待办。

**P1-1a 首轮真实 Chromium 红灯，2026-10-11：** [PR #1347 源码提交 `e7b204ca`，CI run 38072959971](https://github.com/lazyxu/xdrive/actions/runs/38072959971) 的真实 Web 测试完成 50 项布局、交互与多文件选择器检查，失败仅发生在末尾严格网络审计：本测试 fixture 对 `photo-*.png` 的 thumbnail URL 仍硬编码 `v=3`，而已合并 #1337 的 Go Server、共享前端对可透明的 PNG 使用 `v=4`；浏览器实际发起 `?v=4&revision=1`，老 mock 返回 501，连带 console error。原始 Chrome artifacts ID `11677456824`。这是**测试夹具陈旧**而非已证明的产品功能 bug；在同一工作提交内按源 MIME 严格校验 PNG=v4 / JPEG=v3，原 50 项交互、原生 filechooser 和未知请求失败门禁保持不变。修订后必须以新 HEAD 再跑 Web Chrome 及完整 PR CI，不借用旧运行作为通过证据。


## P1-1b · Web/Mobile Web 高级筛选 facets 请求一致性（2026-10-11）

**实施候选；提交、CI、合并及 iOS 真机验收须分开记录。** 宽屏 Web 打开图库的高级筛选时，通过现有 `XDriveMediaGalleryFilterToolbar.onRequestFacets` 调用 Page 的 `requestFacets`，由同一 `MediaGalleryDataSource.listFacets → api.mediaFacets` 加载真实拍摄设备、格式等候选项。Mobile Web 的内嵌筛选表单此前只在改变多选值时触发候选请求，没有在打开「排序和筛选 → 筛选图库」或底部「搜索」时主动请求，导致首次进入候选缺失。本阶段在移动 Gallery-local Chrome 的筛选 Drawer *从关闭到打开* 时调用同一 Page `requestFacets`；无任何移动端 API、媒体索引、业务控制器或虚拟窗口分叉。

生命周期：初次挂载及单独展开排序菜单不请求；每次真正打开筛选/搜索只请求一次；输入/偏好导致 Page callback 更新时不重复获取；「精选集 → 搜索」先回到共享 Library scope，再在 effect 中读取该范围的 facets；关闭/重开允许刷新。现有 Page `facetRequestID` 负责丢弃过期响应和呈现错误，不修改其请求/缓存策略。真实 Chromium 的 `gallery-ios27-chrome` 场景保留原 360–900px 几何、末张点击、上传 filechooser 和严格未知 API 检查，再附加排序/筛选与精选集搜索两次来源明确的 `GET /api/v1/media/facets` 断言。物理 iOS 27 Safari 与真实 100k、失败重试、ARIA 焦点验收另行记录。


## P1-1c · Mobile 排序与时间轴操作服从 Web 共享可用性（2026-10-11）

**状态：实现及代码/组件回归候选，GitHub PR 精确提交 CI 与 iOS 27 真机验收需分别记录。** P1-1b 的 Server facets 已交付，但 Mobile Gallery 在搜索生效、回收站及部分不支持排序的照片集合中仍显示「按拍摄／加入时间排序」入口；当 Page 的 `onSortChange` 不存在时，点击会通过可选回调变成空操作。宽屏 Web 原本按 `showPhotoCollection / isTrashSection / searchActive / currentMemory / currentPet / currentCleanupReview / onSortChange` 隐藏这组控制。

**共享门槛：** 在唯一 `XDriveMediaGalleryPage` 中提取 `canSortPhotoCollection`，由宽屏控制和 Mobile 本地 Chrome 同时消费；Mobile 在不可排序时只显示真正可用的共享筛选和显示选项，不假装操作成功。图库内的「年／月／全部」、次级「按日浏览」、日期跳转与返回锚点使用原有 `showCollectionTimeScale` 限制：搜索结果、Trash/清理等不支持时间轴的上下文不可显示不会生效的时间操作。现有密度、方形/完整显示选项、上传/批量、权限及错误语义不变。

**验证边界：** 用真实 React `MobileGalleryChrome` 组件测试不可用及可用两种门槛、菜单项、标签和无副作用；静态回归保护 Page 与 Web REST/VirtualCollection 的唯一性。未添加移动专属媒体 API、业务控制器或列表。后续仍需实际宽 Web/Mobile Web 请求/任务配对、899/900px、iOS 27 Safari/安装模式截图与辅助功能验收；不得宣称 1:1 已验收。


**P1-1c 精确提交初轮 CI 回归修订：** 初轮 [GitHub CI #38106365175](https://github.com/lazyxu/xdrive/actions/runs/38106365175) 的 `desktop-tests` 发生两项测试夹具失败，定位到旧 `desktop/tests/mobile-gallery-ios27-sort-filter.cjs` 的 `baseProps` 未传入新增的 `canSort/showTimeScale` 必填项，使 P0-3g 的菜单测试落在未授权排序的模拟状态。原两个测试的可用排序及不可用筛选断言均保留，本轮仅向既有组件测试夹具补齐真实 Page 会传入的 `true/true`，不修改用户运行时权限/排序逻辑。用原始固定父提交重建恰好**一个**工作提交，提交变更后必须重新等待全量精确 SHA CI 及 `final-gate`，旧跑次通过的其它步骤不得当作新提交的门禁。


## P1-2a · 细指针移动设备仍使用原生型全屏 Gallery Viewer（2026-10-11）

**目标：代码与真实组件回归；iOS 27 Safari 真机 1:1 对照仍未验收。** 已确认 `FileOpenPreviewDialog` 原先仅以 `(max-width:899.95px) and (pointer: coarse)` 判定移动全屏，因而移动端外接鼠标/触控板或系统将主指针报告为 `fine` 时，图库照片 Viewer 降级为桌面弹窗，底部 filmstrip/分享、收藏、编辑、属性、下载、删除等共享操作回到小型桌面顶栏，违反图库全屏与跨指针功能可达性要求。

**实现边界：** 在唯一共享 `FileOpenPreviewDialog` 内，保留非沉浸式 Files/Quick Look 原来的粗指针门槛；仅当调用方已选择 `immersive` 且视口小于 900px 时，不论 primary pointer 为 `fine` 或 `coarse`，均使用原有移动全屏、顶部 safe-area、底部 `44px` 按钮 rail 与 filmstrip、触控轻点显隐控件；在窄屏细指针模式下，鼠标移动仍能唤醒自动隐藏的控件，粗指针触摸不因模拟 mousemove 意外唤醒。900px 及以上宽屏保留现有桌面 Viewer 弹窗/手动全屏与键鼠操作。切换指针不会创建第二套页面或更改媒体回调；Live Photo 按住才播放、照片缩放/横划、视频原生交互仍由同一个 `MediaViewerContent/FilePreviewSurface` 拥有。

**验收：** 新增真实 React 挂载测试矩阵（390、899、900px × 主指针 fine/coarse × immersive/Quick Look），包括全屏 Dialog、safe-area、filmstrip、同一操作回调、控制显隐与交互媒体例外；已有 Web REST `MediaGalleryDataSource`、Server Range、VirtualCollection、Viewer 复用契约继续校验。完整 GitHub CI 及最终门禁按精确工作 SHA 验收；iOS 27 真机截图/辅助功能、动态地址栏/已安装模式和 10k/100k 实体媒体真实性能仍是独立缺口，不以测试模拟冒充真机已复刻。


## P1-2b · Viewer 的 iOS 27 全画布与浮层 Chrome（2026-10-11）

**状态：已实现代码与 React 组件回归候选；CI、合并、iOS 27 真机像素差异必须分开记录。** P1-2a 修复了细指针移动设备打开 Gallery Viewer 会变成桌面 Modal 的问题；本阶段又确认原有 `FileOpenPreviewDialog` 的窄屏 Header/Filmstrip/Actions 只是改变 opacity，三块在不可见时仍占据正常 flex 布局高度，导致照片可用画布缩小，不能满足 iOS 27「照片」轻点隐藏控件后全屏沉浸查看的结构。Apple 的「查看照片和视频」说明亦规定返回图库、横向浏览、缩略图快速导航、轻点隐藏/显示控制；但实际控件颜色、玻璃、动画仍需同版本设备截图校准。

**仅图库专用展示开关：** `XDriveMediaGalleryViewer` 在原有唯一 `XDriveOpenPreviewDialog` 上明确传入 `mobileEdgeToEdge`。仅当 `immersive && mobileEdgeToEdge && compactTouch` 才在 390/899 等小于 900px 的移动/细指针图库启用覆盖式 Header、贴底带安全区的原 `44px` actions、同一 Filmstrip，令 `DialogContent` 在 `100dvh` 内占满一整块画布；隐藏浮层不改变照片缩放/横划及 Live/RAW/Video 内容尺寸，也不凭空新增媒体接口/身份/任务/Viewer。顶部单个图标改为返回方向且复用现有 `onClose`，不创建另一条 App Back；普通 Files Quick Look、其他使用共享预览组件的调用者、900px 及以上宽屏、既有全屏切换均保持原结构。半透明遮罩/模糊是可用视觉初稿，**不称为已校准的 iOS 27 Liquid Glass 像素值**。

**验收门槛：** 扩展 `desktop/tests/mobile-gallery-viewer-pointer-parity.cjs` 的真实 React 渲染：390/899 × coarse/fine 验证同一个 Canvas 高度、绝对定位的上下浮层、safe-area、Filmstrip、单个返回回调、下载/其它操作保留、2200ms 自动隐藏不占位；900px 和 Quick Look 禁用图层回归；保持 Web REST、`XDriveMediaGalleryPage` 与共享 `VirtualCollection/VirtualGrid/Timeline` 的一套数据合同。源代码测试、CI 和真机验收分别计账。iOS 27 Safari 标签/安装模式、VoiceOver、原生截图对比、滚动/动画和真 10k/100k HEVC/RAW/LIVP 设备性能仍待外部证据。


**P1-2b 首轮精确提交 CI 回归修订：** [CI #38109891574](https://github.com/lazyxu/xdrive/actions/runs/38109891574) 的 `desktop-tests` 运行中，新增 3 项 P1-2b mounted React 验证均通过，但旧 `desktop/tests/shared-viewer-touch.cjs` 以完整单行文本匹配 `'& .MuiIconButton-root': { width: 44, height: 44, flexShrink: 0 }`，误将新增的浮层对比色字段判为 44px 触控目标缺失。本轮仅将该旧静态断言改为可允许额外字段/换行的 44px 尺寸断言，保留真实 mounted 44px、浮层关闭/隐藏与共享 API 验证；**没有放宽按钮尺寸要求或改动产品文件**。同一固定 GitHub 父版本重建仍恰好一个工作提交，新 SHA 需完整 PR CI/final-gate 验证；旧跑次其它通过项不得移作新提交依据。


## P1-2c · 实际 Web/Mobile Web 路由 Viewer 的 iOS 27 响应式等价（2026-10-11）

**状态：代码与真实浏览器测试候选，完整 CI、合并及真机须分别验收。** Web App.tsx 的 Gallery onOpenViewer 实际进入独立一级 media-viewer App，使用 WebMediaViewerApp → WebViewerFrame。此前 P1-2a/b 主要修复 MediaGalleryViewer/FileOpenPreviewDialog，不能据此断言真正的 Web Viewer 获得相同窄屏特性；独立 App 路由必须保留，因为其承载原来返回历史与媒体浏览上下文。真实 WebViewerFrame 在 390/899 CSS px 但 primary pointer 为 fine 时仍使用桌面 Header，失去移动底部操作栏，与相同宽度粗指针模式不等价。

**本阶段只修复实际路由的呈现门槛：** 仅 WebMediaViewerApp 向现有 WebViewerFrame 传入 photosViewer。当 immersive 且宽度小于 900 CSS px 时，不论 mouse/trackpad/touch，均走同一移动顶部覆盖栏、44px 操作、底部 safe-area 与真正共享媒体预览；细指针依然可以通过 mousemove 唤醒自动隐藏的控制。900px 及以上保留宽屏，其他 Files Quick Look、Text/PDF/Audio App 沿用原指针条件。现有 Web REST MediaGalleryDataSource、useViewerNode、Server Range、共享 Gallery VirtualCollection/Grid/Timeline、MediaViewerContent 和浏览上下文 Node ID 不变；绝不引入第二套 Mobile API/媒体缓存/Viewer 或替换全屏 App Frame、52px 全局标题栏。

**验收：** 完整真实挂载 Web Viewer 测试覆盖 390/899/900 × fine/coarse 与非媒体 Viewer；另在 CI 的 Web Job 运行实际构建 Web + 原生 Chromium gallery-ios27-viewer，采用细/粗指针独立上下文，从图库点击实际虚拟 Tile 打开路由，验证 Server 媒体读取、PNG 解码、操作位置/尺寸、隐藏/唤醒、900px 跨断点、Keyboard Next、返回原 Gallery mounted DOM/scroll、未知请求/Console/PageError，保留精确源 SHA、截图和 HTTP 审计。Fixture 仅 240 个 PNG 样本与严格模拟 REST，不代表真正 100k HEVC/RAW/Live、生产 Go Server/CAS 或真实 iOS Safari 测试。

**剩余差距：** WebMediaViewerApp 尚未复用 Desktop Gallery 的 Filmstrip，也没有完成全部相册媒体编辑/删除等操作入口、业务权限及真实 Task Center 回执的配对验收。这些必须后续在共享服务契约下逐步补齐，取得真实 iOS 27 Safari/安装模式的配对截图和 VoiceOver 验收之前不得宣称像素级 1:1。


**P1-2c 首轮真实 Chromium first-red（2026-10-11）：** [CI #38113291931](https://github.com/lazyxu/xdrive/actions/runs/38113291931) 真实 Chrome **27 个已运行验收点中仅 2 个返回锚点失败**，粗/细指针相同：`sameMain=true`、`sameGallery=true`、`backgroundRestored=true`，但比较打开前旧 `main.scrollTop=620` 与返回时得到 `101px` 差异，且旧虚拟 Tile DOM 被回收。全部未知请求/Console/PageError 均为 0，真实 Viewer 路由、PNG decode、移动/桌面断点、隐藏/唤醒与下一 Node 都通过，原始 [浏览器证据 artifact 11691614725](https://github.com/lazyxu/xdrive/actions/runs/38113291931/artifacts/11691614725) 已保存。审计确认初始代码把 `Playwright.click()` 之前的 scroll 误认为实际 Viewer 进入时的 scroll，并错误要求在 390→899→900→390 虚拟列表几何变化后**同一个 Tile DOM 对象**仍挂载；这与已批准的以 Node/逻辑索引为权威的虚拟化合同不符。下一轮在同一工作提交内补齐实际点击之后的 scroll 基线和点击照片的 Node/Index 身份，返回时等待原逻辑资产重新出现在虚拟窗口，然后要求它仍可见、同一 Gallery/main 仍挂载、背景恢复并检查“实际 Viewer-entry scroll”严格 ≤2px；并继续完整记录 pre-click→return 偏差，**若仍有真实丢失，不许放宽门禁，先修真实业务再跑**。不修改 Server/虚拟化生产代码、不伪造历史项，也不拿首轮其它绿项冒充新 SHA 成功。


**P1-2c 原生 Chromium 真正的返回锚点 first-red（2026-10-11）：** [CI #38113760709](https://github.com/lazyxu/xdrive/actions/runs/38113760709)，[截图/请求与原始 JSON artifact 11692228248](https://github.com/lazyxu/xdrive/actions/runs/38113760709/artifacts/11692228248) 再次在细指针与粗指针两种真实 Web BrowserContext 触发相同产品差距：点击真实照片后进入 Viewer 时滚动值 **589px**，返回时 **721px**，漂移 **132px**。原逻辑照片 15 / `photo-016.png` 仍可见，Gallery 根节点与 `main` 均相同、背景可操作、无未知 HTTP/Console/PageError，因此是真实的**滚动位置偏移**而不是文件丢失，也不是测试旧 DOM 假设。本轮不再修改容差；在现有 Web `App.tsx` 仅为**从 Gallery 打开的 Viewer**记录其真实 `main` 宿主、点击后的 `scrollTop`、原 Hash 和视口宽度，在 Viewer 返回同一路由/同一宿主/同一视口宽度时，于 layout commit 与下一帧精确恢复该位置。其他 Files、Viewer 深链接、不同账号/路径及横竖屏最终视口不同的返回不使用这个像素快照（继续走原 Server Node 锚点策略）。既不冻结后台媒体请求也不取消上传/下载、改变虚拟化/GO API 或注入第二个 Viewer；需要更新真实 Browser 测试并以严格 ≤2px 重新验收。旧提交的通过项不能算新 SHA 验收。


**P1-2c 真实 Chromium 已绿、Desktop 旧静态断言误报（2026-10-11）：** [CI #38114239293](https://github.com/lazyxu/xdrive/actions/runs/38114239293) 的真实构建 Web + native Chrome `gallery-ios27-viewer` 已 **全部通过**：含两种 primary pointer、390/899/900/390px、媒体解码、浮层操作、控制显隐、下一 Node，以及 <2px Viewer return-position 恢复；未知请求/Console/PageError 均为 0。Go Linux/API/Windows、Web、镜像和制品测试均绿。然而 `desktop-tests` 运行 2124 项为 2122 通过、1 失败、1 跳过，唯一失败 `desktop/tests/web-shell.cjs` 的 AppBar 静态检测错误地以源代码第一次出现的 `data-xdrive-workspace-background` 作为起点：新 P1-2c `useLayoutEffect` 在渲染前引用了这个选择器，于是旧测试把登录页 AppBar 错认成工作区 AppBar。生产工作区 AppBar 仍明确定义 `display: { xs: 'none', md: 'flex' }` 和 48px 宽屏标题，而移动全屏 App Frame 仍使用自身 52px 标题。本轮**仅将测试定位限定在 `<Box\n        data-xdrive-workspace-background` 的实际 JSX 元素**，保持其原 AppBar 尺寸、权限、唯一菜单及其它断言，不修改产品渲染或缩小视觉验收范围。按 AGENTS.md 从原父提交重建恰好一个工作提交，新 SHA 必须完整 CI 与 final-gate 全绿才可合并；CI 实测 Chromium 不等于 iOS 27 真机像素级 1:1。


## P1-2d · 实际 Web/Mobile Web Viewer 共享 Filmstrip（2026-10-11）

本阶段将已有 XDriveMediaGalleryFilmstrip 直接用于真实 WebMediaViewerApp / WebViewerFrame，并通过相同 useViewerNode / createXDriveWebViewerSession 查询当前浏览位置前后各五个媒体条目，最多 11 项。第 127/128 个索引的分页边界仍由原有 128-item 授权 Server Range 会话加载，最多两个相邻分页请求，不从 10k/100k 虚拟图库导出全量列表。选择缩略图仍调用现有 Web media-viewer Node ID 导航和 session 索引；无 Gallery 浏览会话的 Files Quick Look、Text/PDF/Audio 不添加 Filmstrip，也没有新建 Mobile REST、媒体缓存和第二套 Viewer。

小屏 Filmstrip 浮动在底部原有操作栏及 safe-area 之上；宽屏 Web 仍显示同一个 Filmstrip，操作仍在桌面 Header。控制自动隐藏时它不占媒体画布，不抢按键/手势；Filmstrip 自有 aria-current、58px thumb、XDriveMediaAsyncThumbnail 和横向滚动逻辑完全复用。App Frame、52px 全局标题栏、共享查询/分页/虚拟化、Live/RAW/视频和任务中心不做结构改变。

回归矩阵：真实 WebViewerApp 挂载（Gallery 240 逻辑项、索引 127/128 跨页、11 个条目、仅 offset 0/128 两个分页、点击切换正确 Node 和 session、单项无 Gallery 上下文时不显示）；原生 Chromium gallery-ios27-viewer 场景在 fine/coarse、390/899/900px 下验证 Filmstrip 的 bounded window、唯一活跃项、位置/按钮不重叠、真实缩略图导航/图库返回，并保留严格未知网络与 Console/PageError 检查。使用已有 GitHub opt-in 真实浏览器 CI 前缀运行，不改变 GitHub/GitLab CI 工作合同。Fixture 为模拟授权 REST 的 PNG 样例，不代替 iOS 27 真机、10k/100k 实体 RAW/HEVC/LIVP、VoiceOver、像素级视觉校准或完成任务收据。Filmstrip 产品功能验收与真实 Safari 1:1 必须分开记录。


**P1-2d 首轮精确 HEAD 真实浏览器通过、组件测试回归修订（2026-10-11）：** [CI #38119168559](https://github.com/lazyxu/xdrive/actions/runs/38119168559) 的原生 Chrome gallery-ios27-viewer 场景全绿，Filmstrip 的两种指针/390/899/900px、有限窗口、唯一 aria-current、缩略图实际导航、返回原 Gallery 都通过，未知 API/Console/PageError=0，原始 artifact [11694444286](https://github.com/lazyxu/xdrive/actions/runs/38119168559/artifacts/11694444286)。同一 HEAD 的 Desktop 2135 项中 2133 通过、1 失败、1 跳过；唯一失败在新增挂载测试的 Filmstrip 容器计数：React-test-renderer host adapter 同时暴露包装组件和内层 div，按 props 计数因此为 2，实际 Chrome 只渲染一个真实容器。本轮仅把新增测试的容器计数限定为真实 div DOM 宿主，保留原始 11 项、跨 127/128 Range 分页、Node/session 导航及真实浏览器断言，**没有改产品功能或放宽功能权限**。在同一固定父提交上重建恰好一个工作提交，旧跑次不能替代新 SHA 的完整 CI/final-gate。


**P1-2d 真实 Viewer 返回滚动的随机红灯（2026-10-11）：** [CI #38119376342](https://github.com/lazyxu/xdrive/actions/runs/38119376342) 完整 Web 构建通过，真实 Chrome Filmstrip 组件/点击/缩略图/双指针及全部 API 审计通过，但 fine-pointer 的原 Gallery 返回出现 `entryScroll=589`、`returnScroll=620`、差 31px（coarse 本轮通过）；[原始 artifact 11694738940](https://github.com/lazyxu/xdrive/actions/runs/38119376342/artifacts/11694738940)。不是能放宽的断言：P1-2c 产品只在 Gallery `onOpenViewer` 点击回调捕获早期 scrollTop，异步焦点及布局稳定后 Viewer 背景实际滚动位置可变化。修复只在真实 media Viewer 激活时，确认仍是 Gallery、同一 DOM host、同一视口宽度后，在 layout effect 和最多两帧内把滚动快照更新为稳定的 Viewer-entry scroll；前后 Node 身份、原 2px strict return、无新增移动 API/10k 全量项与用户滚动阻断条件不变。更新相同的 Web shell 源码契约断言以覆盖快照仅在合法 Gallery Viewer 激活时写入；随后仍需完整最新 SHA CI，包括真实 Chromium、Desktop、Go 和 final-gate。此记录不声明 iOS 27 真机已验收。


**P1-2d 二次真实 Chrome 返回滚动复测仍为红（2026-10-11）：** [CI #38119665964](https://github.com/lazyxu/xdrive/actions/runs/38119665964) 的最新 Desktop 2134/2135 通过、失败 0、跳过 1；实际 Filmstrip 的加载/唯一选中/点击正确 Node、未知 HTTP/Console/PageError 也全绿，但 fine/coarse 两种指针都出现 `entryScroll=589px`、`returnScroll=458px`，差 131px，原始 [artifact 11694960571](https://github.com/lazyxu/xdrive/actions/runs/38119665964/artifacts/11694960571)。这说明此前仅靠 Viewer 激活时立即/两帧捕获的 scrollTop 仍会被随后异步浏览器焦点/虚拟列表布局覆盖。继续保留原 <2px 严格门禁，产品改用**同一已挂载的 Gallery 主滚动宿主的 passive scroll 事件**捕获真实 Viewer-entry scroll，首次视口宽度发生变化立刻冻结快照，Viewer 退出立即解除事件监听；返回阶段在 React layout effect 加上最多两次后续 RAF 恢复，仍校验同一 Gallery route、DOM host、最终视口宽度。没有轮询、后台定时任务、100k 全量媒体读入、第二套 REST、或者更新其它文件/媒体浏览会话；桌面静态合同测试同时验证监听注册、宽度冻结和解除，全部 CI 需在重建的**单工作提交**新 SHA 上重新执行。物理 iOS 27 Safari 仍未验收。


**P1-2d Native Chrome 连续返回位置仍红的物理滚动锚点修正（2026-10-11）：** [CI #38119925170](https://github.com/lazyxu/xdrive/actions/runs/38119925170) 的 2136/2137 Desktop 项通过、失败 0、跳过 1；实际 Chrome Filmstrip 悬浮/点击、媒体身份、控制显隐、授权请求都通过，却在 390→899→900→390 并导航时再次发生两种指针一致的 `589px→458px`、差 131px（原始 [artifact 11694778517](https://github.com/lazyxu/xdrive/actions/runs/38119925170/artifacts/11694778517)）。连续尝试 Viewer-entry 的 rAF 和 passive scroll 事件快照均无法阻止返回后一个**虚拟网格行高**的变化；这是后台仍挂载的 Gallery 虚拟窗口随视口宽度/可见项回收产生滚动锚点，浏览器原生 CSS `overflow-anchor:auto` 与 Gallery 自己的索引/Node 行定位叠加竞争。此次仅对 **Gallery 的现有主滚动容器**设置 `overflowAnchor:'none'`（其它 Files/任务应用仍沿用原生行为），让唯一共享 VirtualGrid/Timeline 继续独占可见 Node 和复位位置；App Frame、52px 标题栏、授权请求、媒体内容与任务均保持。真实 Chromium 在保持原严格 ≤2px 与同 Node 可见条件之余，会读取最终 Main computed style 确认为 `overflow-anchor:none`，增加静态源合同回归。不删除旧证据，也不放宽门槛；最新工作 SHA 必须重新通过完整 CI/Chrome/final-gate 才能合入。若仍红，转向实际布局与恢复事件时序的进一步观测，不能宣称修复。


### P1-2d：返回位置在虚拟行异步提交后仍漂移的修复候选（2026-10-11）

最新真实 Chrome CI [#38120407453](https://github.com/lazyxu/xdrive/actions/runs/38120407453)、[原始截图和 JSON 11695500444](https://github.com/lazyxu/xdrive/actions/runs/38120407453/artifacts/11695500444) 确认：Filmstrip、真实照片/Node 导航、11 项有界范围、390/899/900px 粗/细指针、Server 调用与 Console/PageError 均通过，唯一两项失败为返回图库时 `scrollTop=589→458`，固定偏移 131px（一行高度），逻辑照片与原 Gallery DOM 均未丢失。已尝试的 Viewer entry 双 RAF、被动滚动捕获和 `overflow-anchor:none` 仍不能阻止返回后虚拟行/浏览器延后修正。

本轮只在 Web App 的既有 Gallery Viewer 退出恢复逻辑中加 **650ms 上限的事件驱动 scroll 守卫**：原有 React layout effect 与双 RAF 先恢复真实入口 offset；随后如果同一宿主、同一 Gallery Hash、最终宽度不变时又发生虚拟行修正的 `scroll` 事件，再将非用户发起的偏差校正到 ≤1px。任何真实 pointerdown/touchstart/wheel/keydown 立即取消守卫；超时、组件生命周期结束、断点再变化都会卸载所有监听，绝不阻止用户主动滚动、不轮询/扫描 100k、无额外 Server/Agent 请求。不涉及 Files、音频、文本、PDF 独立 Viewer。仅属于源码及 CI 候选，原生 Chrome 的 **≤2px 精确返回门禁不可放宽**，不能在下一 SHA 通过前标记修复完成。


**P1-2d 新版事件驱动守卫的实测结果与旧测试修订：** [CI #38125620829](https://github.com/lazyxu/xdrive/actions/runs/38125620829) 的 **真实构建 Web + 原生 Chromium 45/45 检查全部通过**，两种输入指针均将 Viewer 返回滚动偏差从之前 131px 降为 **0px**，共享 Filmstrip 仍为最多 11 项，所有未知 API / Console / PageError 均为 0；[原始浏览器证据 11696916935](https://github.com/lazyxu/xdrive/actions/runs/38125620829/artifacts/11696916935)。Desktop 2139 项中 2137 通过、1 失败、1 跳过，唯一失败是旧 `web-viewer-shell.cjs` 仍要求过去的 `host !== saved.host || !saved.host.isConnected` 字符串，而新生产代码用等价且更严格的 `return host === saved.host && saved.host.isConnected`，并同时检查原 Gallery Hash 与视口宽度。仅更新该旧测试断言来检查真实新语义，保留其他所有已有恢复/输入取消/监听清理契约，**产品代码无变化**。仍由固定父提交重建恰好一个工作提交，旧 CI 不能当作新 SHA 的最终交付门禁；完整 GitHub PR CI 和 final-gate 必须在最新 SHA 全绿后才能合并。


## P1-2e · 实际 Web/Mobile Web 媒体查看器复用共享编辑流程（2026-10-11）

**范围：** P1-2d 已复用现有 `XDriveMediaGalleryFilmstrip`，但实际 Web/Mobile Web `WebMediaViewerApp` 尚缺内嵌 Gallery Viewer 已有的编辑/撤销编辑入口。本阶段仅将相同的 `XDriveMediaGalleryEditDialog` 接入实际 `media-viewer` 路由，调用唯一的 `MediaGalleryDataSource.saveEditRecipe/resetEditRecipe` 和原有 Server `PUT/DELETE /api/v1/media/items/:id/edit`，不改媒体字节、上传/下载路径、Server 身份或原生 App Frame。

**权限/身份：** 仅当 DataSource 暴露 `saveEditRecipe` 且现有 `xDriveMediaItemSupportsBasicEditing` 允许时显示「编辑媒体」；不支持编辑的 Live Photo、未授权来源和非媒体 Viewer 不出现无效按钮。编辑器绑定 Node ID/Node revision，浏览 Filmstrip 切换或关闭后不继承上一张的编辑器状态。Server 成功回执通过原 `useViewerNode.updateMediaItem` 写回原浏览会话及其有界 Range 缓存；旧图异步回执不得篡改当前媒体。Server 409/500 等失败由共享 Dialog 显示，未经确认不更新本地数据，也不能显示虚假成功。

**验收：** Web/Mobile 两种布局运行相同按钮/同一 Dialog、真实 Rendered Viewer 组件测试覆盖有权／无权、图片/Live Photo、保存/撤销以及 Filmstrip 导航时自动关闭。复用已存在 `fix/mobile-gallery-ios27-web-viewer-` PR CI 的构建 Web + 原生 Chromium，验证细/粗指针实际授权媒体经 `PUT` 保存 90° 配方、`DELETE` 按 revision 撤销、原始 Viewer Node 和返回 Gallery 滚动位置未丢失，未知 API/Console/PageError 为零，保留精确提交与截图。

**待办：** 仍需为实际 Viewer 补齐删除确认及真实任务中心回执、创作操作等能力，并在 iOS 27 Safari/安装模式进行像素/动画/VoiceOver 同帧比对；10k/100k 原始 HEVC/RAW/LIVP 的性能/真机测试不可由 240 张 PNG Fixture 替代。不能因此宣称总体 1:1 已完成。

## P1-2f · 实际 Web/Mobile Web Viewer 的删除任务功能等价（2026-10-11）

**状态：实现及精确源验证候选；GitHub PR CI/合入、真实 Chromium、实体 Go Server 及 iOS 27 Safari 真机分别验收，不以提交代码代替交付。** P1-2e 之后的真实 Web `media-viewer` 已共享编辑、Filmstrip、Viewer 数据源、收藏和属性，但缺少内嵌 `XDriveMediaGalleryViewer` 已有的“删除媒体 → 确认 → 文件操作”的入口；390px Mobile Web 与宽 Web 实际运行同一个路由，因此两者都存在功能缺口。

- **仅一条权威写入链路：** 在真实 `WebMediaViewerApp` 增加有权限才出现的“删除媒体”控制和已共享的 `XDriveConfirmDialog`，调用现有 `MediaGalleryDataSource.deleteItems([MediaItem]) → web/src/mediaGalleryAdapter.ts → api.createFileOperation('delete', [{id,revision}])`。回收站上下文不显示再次普通删除（仍使用已有 Trash 控制），不新增 Mobile API、删除专用缓存/Controller/虚拟化索引或重复 Viewer。
- **任务状态而非假成功：** POST 成功仅表示已提交或得到异步任务回执；提示用户在现有 Task Center 查看真实进度/失败/取消；`FileManager` 复用现有 `refreshFileOperations`，不在 Viewer 层自行推断物理删除完成或立即改写 100k 集合。HTTP 403/409/网络失败保留弹窗及目标以供明确重试，同一请求期间防双击提交；只有接受了请求后才使用原 `onClose` 返回 Gallery。
- **生命周期与规模：** 确认框绑定精确 Node ID、revision 及 Viewer browse context；Filmstrip 切项、历史路由变化不能让旧确认或迟到删除回执关闭新照片。保留同一 52px 应用标题栏、全屏 App Frame、Web REST/Agent IPC、`useXDriveVirtualCollection`、共享 `MediaVirtualTileGrid/Timeline` 和 128-item Range/最多11项 Filmstrip。
- **验证范围：** 真实 React mounted Viewer：可授权单提交/Task Center 回执、无能力禁用、Trash 禁用、403 失败重试与旧请求返回不关闭新路由；已有原生 Chromium `gallery-ios27-viewer` 场景追加真实构建 Web 对同一 `POST /api/v1/file-operations` 的 403→手动重试→200 queued，分别跑 fine/coarse 与 390/899/900 视口，继续保留原 Viewer 编辑/缩略图/滚动 ≤2px 和零未知 HTTP/page/console error 门禁。模拟 HTTP 的 Chrome CI 不等于真实 Go/PostgreSQL/CAS 删除完成，也不等于 iOS 27 实机像素 1:1；实际任务终态和物理设备仍待单独验收。


**P1-2f 首轮精确 HEAD Chromium First-red（2026-10-11）：** [CI #38135712821 的 web job #114459084145](https://github.com/lazyxu/xdrive/actions/runs/38135712821/job/114459084145) 的源版本为 `3c54fc33b0e2d74db2a0041b019c2fb90c316018`。除 `web` 外实际运行的 12 个构建/测试作业均成功；真实构建 Web Chrome fine pointer 在第 24 项验收点进入 `delete-403-then-queued` 阶段后，新增测试的 `getByRole('dialog', {name:'确认操作'})` 超时。随失败结果保存的真实无障碍树确认对话框已正确出现且可访问名称为 `删除这张照片或视频？ 关闭弹窗`，包含正确的警示正文、取消和删除按钮；截至该失败，没有发出删除 POST，故不得声称 403/重试/任务回执已通过。本轮**仅修正浏览器脚本定位器**为以业务确认标题为前缀的 accessible role/name 查找；不修改删除产品代码、后端权限、任务生命周期、测试门槛或放宽既有滚动 ≤2px 和零未知网络/console/page-error 断言。仍从固定父提交重建**恰好一个**工作提交，新 SHA 需重新完整 PR CI、真实 fine/coarse Chromium 与 `final-gate`，不能复用旧 HEAD 的绿项。


## P1-2g · 实际 Web/Mobile Web Viewer 的下载数据源一致性（2026-10-11）

**状态：依赖 P1-2f #1404；当前为独立单提交的叠加工作，须区分组件测试、最新 PR CI、合并与真机。** 同一 `XDriveMediaGalleryPage` 的图库原本通过 `MediaGalleryDataSource.downloadItems`（单项原始字节、批量 ZIP 下载），内嵌 `XDriveMediaGalleryViewer` 也使用该共享合同；但独立一级 Web `media-viewer` 的通用按钮此前直接调用 `api.download(node)`，绕过了图库操作入口，且请求失败没有交给同一 Viewer 错误反馈。

只在现有 `FileViewerActions` 增加可选下载动作覆盖，实际 Web/Mobile Gallery 路由在已加载当前 `MediaItem` 时传入 `gallerySource.downloadItems([mediaItem])` 并将 Promise 错误上报原 `onError`；保持一个 Viewer、同一 Web REST、Server 下载票据/Range 与 Task Center，不新增媒体下载端点、缓存或 Worker。非图库的 Files Quick Look 仍调用原 `api.download(node)`。数据源未提供下载时保留现有单文件 API 回退，不凭前端实现声称 Server 权限通过。照片 Node/revision 不被替换为文件名猜测。

真实 React mounted 验收覆盖 390px/900px 相同媒体 Node+revision 的共享动作、禁止绕开媒体 Source、拒绝后保留 Viewer 并允许明确重试、Files Quick Look 仍走通用文件 API；已有 `fix/mobile-gallery-ios27-web-viewer-` 原生 Chrome 55 项回归不修改，继续要求 fine/coarse、390/899/900 及 ≤2px 返回位置、零未知 HTTP/Console/PageError。**本阶段不会宣称**浏览器端到端下载实际字节、iOS 27 Safari/PWA 1:1 截图或 100k RAW/HEVC/LIVP 性能已通过，这些还需要独立真实 Server/设备证据。保留全屏 App Frame、52px App Header 和 Web/Desktop 共享后端及虚拟化组件。



## P1-2h · 真正路由 Web/Mobile Web Viewer 复用已有创作任务（2026-10-11）

**状态：候选实现，完整 GitHub CI、合并、实体 iOS 27 和真实 Server 任务终态分别记账。** P1-2g 的共享下载已由 PR #1408 通过精确 HEAD 全量 CI 并线性合入 `master@2612ed193631`；原远端分支已清理。当前实际 Web/Mobile Web 的独立 `media-viewer` 尚缺内嵌 `XDriveMediaGalleryViewer` 的 AI 抠图/智能消除创作能力。P1-2h 仅补**同一共享图库创作 Dialog 与 API**，不增设移动端业务 Controller、媒体索引、后端接口或第二套 Viewer。

- **唯一功能合同：** 路由 Viewer 和 Desktop/内嵌图库共用 `XDriveMediaGalleryCreativeDialog`、`xDriveMediaItemSupportsCreative` 与 `MediaGalleryDataSource.createCreativeGeneration/getCreativeGeneration/cancelCreativeGeneration`；保存生成的新媒体文件仍使用 Server 原有后台创作任务（`POST /api/v1/media/items/:id/creative`、`GET /api/v1/media/creative/:id`、`POST .../cancel`）。不改变源图、Edit Recipe、Live Photo 配对、下载/上传、后端执行者或 Task Center 的持久任务。
- **真实能力门禁：** 仅 DataSource 同时具备 `createCreativeGeneration`、`getCreativeGeneration`、`loadPreviewURL` 且共享图片合法性判定为真时显示「创作图片」。Live Photo、RAW/未就绪/视频、回收站及缺能力来源不得展示空操作按钮。Mobile Web 和宽 Web 均在同一个实际 `media-viewer` 上使用此按钮与原共享 MUI 弹窗，390px/900px 业务路径一致。
- **任务生命周期：** 创作对话框已负责输入标记、同步创建失败、轮询、取消、结果图预览与重新创作；路由只持有当前 Node ID+revision+Gallery browse context。切换 Filmstrip、返回或关闭不得自动取消 Server 上的持久任务，旧图迟到完成不能自动刷新/关闭新图。仅当前来源和 Node 版本的 *completed+output_node_id* 回执调用既有 `Gallery uploadRevision` 刷新已挂载的同一个稀疏图库列表；不直接插入伪造 Node、全量遍历 100k 或改变 Viewer 的文件 identity。
- **可验证范围：** React 真挂载测试覆盖 390/900 共享 API 的创建/查询/取消、成功刷新一次与错误结果拒绝，Live/视频/RAW/未就绪/无能力/Trash 门禁、旧异步完成与返回。真实构建 Web + 原生 Chromium 应在 fine/coarse 指针、390/899/900 下新增 Server fixture 403→明确重试→queued/running/completed、输出预览及单独创作取消；保留 P1-2g 55/55 编辑、Filmstrip、删除权限/任务回执、返回偏差 ≤2px、未知 HTTP/Console/PageError=0。请分别记录 fixture 原生 Chromium、真实 Go/PostgreSQL/CAS 和实体 iOS27 Safari/PWA/VoiceOver；模拟任务绝不算真实 Worker 已生成有效 bytes。
- **架构边界：** xDrive 既有全屏 App Frame、独立 52px 全局 App Header、Web/Desktop 共享 Server / Agent IPC、唯一 Web REST `MediaGalleryDataSource`、`VirtualCollection/VirtualGrid/VirtualTimeline` 和 128-item sparse Range/≤11项 Filmstrip 全部保留。iOS 27「照片」仍是版本锁定的 1:1 视觉与交互验收目标，未取得对照同帧实机截图前不得写成已完成。


**P1-2h 首轮真实 Chrome First-red 及共享 Creative Dialog 预览生命周期修复（2026-10-11）：** [CI #38139437432 Web Job #114470069502](https://github.com/lazyxu/xdrive/actions/runs/38139437432/job/114470069502) 的真实构建 Chromium fine-pointer 流程在第 24 项新增创作验收阻塞：已有 `POST /media/items/1011/creative` 403→200 queued 两次真实请求、`GET /media/creative/qa-gallery-creative-1` 两次；UI 正确显示「已生成」且已发出结果文件 `POST /files/2601/preview-ticket`，但 10 秒后仍是原图 `photo-012.png`，未出现 `img[alt="创作结果"]`。未知 HTTP=0、ConsoleError=0、PageError=0，浏览器证据 [artifact 11701164726](https://github.com/lazyxu/xdrive/actions/runs/38139437432/artifacts/11701164726) 记录了失败现场。不是可忽略的“超时测试”：共享 `MediaGalleryCreativeDialog` 原先在同一个 `useEffect` 中先 `onCompleted(generation)`（使原 Gallery 刷新，导致回调身份变化），随后开始异步 `loadPreviewURL`，新回调触发 Effect cleanup 后设置 `disposed=true`，而 `completedRef` 又阻止了预览重试。

**本轮限界修复：** 创作完成通知与结果下载拆为两个独立的 `useEffect`。通知通过最新回调 Ref 加原来的 `completedRef` 去重，只按 job ID/output/state/open 调度；结果下载仅由真正的 output、loader、state 或打开状态变化控制生命周期，不能被回调身份变化无故取消。实际关闭、切换资源或卸载仍及时废弃旧预览，并且不会取消 Server 已持久化的创作任务。新增共享 `media-gallery-creative-race.cjs` 回归验证完成通知恰好一次、Owner 回调刷新时原生成图仍解码显示、实际关闭/切换时旧结果不穿越；原有 Chrome “必须看见创作结果”严格断言、403/重试/取消和原 55 项 Viewer 回归均不放宽。**首轮旧 HEAD 的其它绿色作业不能作为新版验收**；修复必须重建在同一固定父提交上的单工作提交并重新通过全套精确 HEAD CI + `final-gate`，iOS 27 真机/真实 Worker 字节仍未验收。


## P1-2i · 创作 Go Server / PostgreSQL / CAS / Unix 协议真实验收（2026-10-11）

前置 P1-2h [PR #1410](https://github.com/lazyxu/xdrive/pull/1410) 已合并，原生浏览器 61/61、Desktop 2,159 通过。本阶段只验 Go Server 真实创作链路，不修改 Web/Mobile Web 共同使用的 Viewer、MediaGalleryDataSource、虚拟化列表、全屏 App Frame 或 52px 应用标题栏。iOS 27「照片」仍以实体 iPhone 的 1:1 同帧对照作为最终视觉/交互标准。

**服务界限：** Go `internal/mediaworker` 仅提供 FFmpeg/FFprobe 相关能力；创作任务由 `PhotoCreativeAnalyzer` 经 `internal/photointelligence/creative_unix.go` 访问 `services/photo-face-analyzer` Unix Socket。新的 `internal/api/media_creative_cas_integration_test.go` 在实际 PostgreSQL 创建独立并可清理的 Schema，启动真实 Go Router、鉴权、后台 Scheduler、文件上传及创作预览衍生链路，使用真正的 Unix 创作协议和本地 CAS。仅 Unix Socket 末端的 EfficientSAM 推理被**可解码确定性 PNG**替代，不能声称已测生产 AI 模型。

**可验证行为：** 相同已授权 Node+revision 经 Web/Mobile 共用 POST 创建 cutout/erase，Worker 实际 GET 签名预览、生成任务 GET 返回持久终态，成功产物同父文件夹的 canonical Node 与 File SHA256、Blob CAS 路径、实际下载字节和 PNG 解码一致；同内容可复用 CAS，但不复用错误的 Node 身份。原图永不被重写；异账号读取任务、原图或输出必须失败。运行中取消不得提交输出；Worker 给出与 JPEG/PNG MIME、尺寸不符或损坏/截断的字节不得将状态置 completed。

**发现并修复的服务端缺口：** 现有 `photointelligence.ValidateCreativeResult` 只确认声明的大小、MIME、Width/Height。额外在 Go `runMediaCreativeGeneration` 写入 CAS 前先执行 `validateMediaCreativeDecodedImage`：校验真实图片头格式及像素尺寸，再完整解码 JPEG/PNG；伪造尺寸、错误 MIME、损坏或截断数据使持久任务进入 failed，不产生新的可见 Node/File/Blob。输入大小与最大宽高保持现有上限，避免失控图片分配。MP4 另需视频特定完整验证，不将图片门禁误称为视频验收。

**仍未覆盖：** 实际 Python EfficientSAM/ONNX 模型推理和性能、实体 iOS 27 Safari/PWA/VoiceOver 同帧像素/动画/交互、真实 100k RAW/HEVC/LivePhoto、全部 Web/Desktop 上传下载取消的实测。PG/CAS/Unix 协议门禁和原生浏览器 fixture 必须分别标记，任何一个都不能冒充这些真实设备与模型验收。当前提交只在最新 SHA 的 PR CI 和 final-gate 全绿后允许合并；不得借用历史通过值或更改并行性能/race 专项。


## P1-2j · iOS 27「照片」Viewer 移动操作栏：主操作与可达「更多」（2026-10-11）

**工作基线：** P1-2i [#1419](https://github.com/lazyxu/xdrive/pull/1419) 已通过完整 CI [#38144329650](https://github.com/lazyxu/xdrive/actions/runs/38144329650) 和 `final-gate` 后线性合并，合并 SHA 为 `fd8c9d976a6b19652722d49b9473b274c657b4b2`；单独受阻的 Desktop 100k 性能 PR #1185 等不归本专项处理。本阶段仅修改实际 Web/Mobile Web 共用的 `WebMediaViewerApp` 操作按钮**呈现方式**、原生 Chrome 验收与 React 回归，不再发明平行的照片业务操作或移动端请求。

**确定的界面缺口：** 原移动底栏把收藏、AI 创作、编辑、删除、属性、实况导出（有则）、标签、分享、下载和前/后照片导航全部各自作为宽/高至少 **44px** 的按钮铺在同一行。宽 375/390 CSS px 明显不足、`overflowX:auto` 将右侧项目藏在横向滚动后面；这不是 iOS 27「照片」预期的可发现的主操作栏，不能把“功能可横向找到”误称 1:1。

**有限的修正：** 在实际 Web/Mobile 共用的单个 Viewer 中，宽度小于 900 CSS px 且粗/细指针两种情况仅保留最常用的收藏、编辑、删除、分享及 `更多照片操作` 控件，既有前/后照片导航继续在原 Frame 所有，不删除真实业务能力。移动「更多」是共享 MUI Menu/MenuItem 呈现，展示当前权限允许的创作图片、查看属性、标签、下载，以及已证据配对 Live Photo 的完整实况原件导出。宽 Web 900px 及以上继续用原全部直接动作按钮。自动隐藏 Viewer Chrome 在菜单打开时保持，ESC/取消关闭菜单；切换 Filmstrip Node/context/revision 或从 899px 切到宽 Web 900px 会关闭旧菜单，切回 899px 不会意外重开，迟到旧动作不能进入下一张；原始 Viewer 身份及 Gallery 虚拟滚动宿主完全不变。

**操作合同未变：** 媒体下载、完整实况、创作、收藏、非破坏编辑、删除（Task Center 仅 queued 回执）、标签、分享、媒体属性仍通过原 `MediaGalleryDataSource`、`FileViewerActions` 及服务器 REST；不添加新的 Mobile-only Controller/API、Gallery 节点、虚拟化网格/时间线、持久状态或 CSS 假按钮。继续保留全屏 App Frame、52px 独立应用标题栏和 Web/Desktop 共享后端/Agent IPC、单一 Web `XDriveMediaGalleryPage`、`VirtualCollection/Grid/Timeline`、128 项 Range / 最多 11 项 Filmstrip。

**严格验收计划：** 已有真实 React 挂载 `web-viewer-shell.cjs` 验证 375/390/899/900 下主/次菜单布局权限、每种能力的真实 Callback 与 Node revision、无法创作的 Live Photo 不出现创作菜单项但完整实况可导出、下载失败/明确重试、旧 Node 切换关闭菜单、宽 Web 功能不退化。原生构建 Web + Chromium `gallery-ios27-viewer` 对 fine/coarse 和 390/899/900 验证 DOM 的菜单**实际可点击**、每个主按钮至少 44×44 CSS px、`rail.scrollWidth <= rail.clientWidth + 1`，所有原可授权次菜单能力可达、无浏览器页面溢出，并保留 P1-2i 之前实际通过的创作 403→重试→输出与取消、编辑 PUT/DELETE、删除 403→queued 回执、返回滚动差 ≤2px、未知 HTTP/Console/PageError=0。首轮真实失败不可降低此门槛。

**不是 iOS 真机 1:1 验收声明：** 当前无实际 iOS 27「照片」截图、配对 Safari/PWA/VoiceOver 报告；MUI 更多菜单实现仅为与版本锁定交互层级接近的可测试迭代。真机玻璃质感、系统 safe area、OS 手势、动效时序仍是独立发布门槛。真实 100k HEVC/RAW/LIVP、传输取消与性能等同样不在本次呈现改动范围，不能借任何浏览器 Fixture 声称完成。


## P1-3a · iOS 27 多选照片操作栏与 Web/Mobile Web 等价（2026-10-11）

**状态：候选改动，完整 CI、合入和真实 iOS 27 真机 1:1 待验收。** 共享的 `XDriveMediaGallerySelectionToolbar` 在小于 900 CSS px 时仍让全部操作按钮横向滚动，不适合 375/390px 的 iOS 27「照片」多选操作层级；这与 #1424 的单图 Viewer 操作栏是不同缺口。

小于 900px 的选择模式保留收藏、删除或回收站恢复/永久删除作为直接按钮；加入相册、标签、下载、拼图和自动电影仅按共享 DataSource 授权能力提供单个 44px「更多已选项目操作」入口，不假增业务能力、不水平滚动操作栏。宽 Web ≥900px 保留原全部直接操作。更多菜单必须在选区数量/身份变化、任务 busy、能力变化与 899/900 断点切换时关闭；同一手动相册选择器、查询级选择、失败反馈、任务收据和操作回调不变。

React mounted 回归覆盖操作回调、身份防串、空相册、零选区、回收站及宽窄切换；新增 opt-in 原生 Chromium 组件浏览器 360/375/390/899/900px 的真实工具栏溢出、44px 命中、弹窗焦点与键盘/失败/重试/选区隔离门禁，必须在本 PR 精确 SHA 跑绿后才能声明该层验收。实际 iOS 27 Safari/PWA/VoiceOver 截图/手势和 100k 真数据仍单独记为待验证，不能声称 1:1 完成。全屏 App Frame、52px 应用标题栏、共享 Server REST/Agent IPC 和 `VirtualCollection/Grid/Timeline` 不变。


## P1-3b · 实际构建 Web 的 Gallery 多选／相册与移动焦点等价（2026-10-11）

**基线：** P1-3a PR #1431 已通过实际 Chromium 44/44、完整 GitHub CI/final-gate，并线性合入 `master@dd55a443523a`；工作分支已清理。#1185 的独立 100k Electron IPC 进度测试仍有真实失败，保留 Draft，不混入图库 UI 专项。

**源码确认缺口：** 旧实际 Web 浏览器脚本 `gallery-selection` 仍访问小于900px `display:none` 的宽 Gallery Toolbar，并认为「加入相册」是直接按钮；实际 iOS27 Mobile Web 已使用 `MobileGalleryChrome` 的「选择」及 P1-3a 的「更多 → 加入相册」。同时添加相册成功后原 `MediaGallery` 的 `selectionControlRef` 仍绑定到隐藏的宽 Web 「选择」，真实移动页面无法可靠恢复键盘焦点。

**最小产品修复：** `MediaGallery` 向唯一 `MobileGalleryChrome` 传入选区按钮 Ref，小于900px 将焦点引用绑定于可见移动「选择」，900px及以上仅绑定宽Web按钮，不双绑隐藏控件。唯一 Page、同一 `MediaGalleryDataSource`、服务端 Range、选择 Map、相册 Drawer、任务与后端 REST 均不改变；全屏 App Frame、52px 标题栏和 Desktop Agent IPC 不动。

**交付门槛：** 已有实际构建 Web 原生 Chromium 端到端脚本迁移到移动选择和「更多」，核对同3项 Node 的375/390/899/900→390跨断点状态、44px控件、24个真实手动相册、取消与返回焦点、844×200/200%字体、原HTTP 403→显式200重试同 Node IDs/相册revision，以及成功后移动可见「选择」焦点；不降低原断言。精确单提交 GitHub PR 的 Web/Chromium、Desktop、Go、Windows、打包和final-gate 全绿才合入。本阶段没有真实 iOS27 Safari/PWA/VoiceOver 同帧截图，也不冒充真实100k RAW/HEVC/Live Photo 性能。


**P1-3b 原生浏览器首次红灯：** [GitHub CI #38151659236](https://github.com/lazyxu/xdrive/actions/runs/38151659236) 的 Web lint/build 成功，真实 Chromium 测试在 `loadFiles()` 旧启动预检上等待 `[data-xdrive-file-explorer-item]` 内 `document-001.txt` 10秒超时。Mobile Files 已使用独立呈现；此前其它 iOS27 Gallery 真实浏览器场景用当前可见文案成功等待。失败发生于进入图库之前，`unknownRequests=[]`；不能解释为新焦点修复或 Server REST 已通过。原始 [job #114506196362](https://github.com/lazyxu/xdrive/actions/runs/38151659236/job/114506196362)、[artifact #11705989391](https://github.com/lazyxu/xdrive/actions/runs/38151659236/artifacts/11705989391)。仅让 `gallerySelectionScenario` 复用 iOS27 Gallery 已有的真实 Mobile Files 就绪分支，并增加源合同回归；没有跳过图库测试、消除原相册/权限/焦点严格断言或修改 Go/App Frame。重建同一固定基线上的恰好一个工作提交，新 SHA 的原生 Chromium + 全套 CI/final-gate 必须重新执行。


**P1-3b 第二次首次图库请求红灯（2026-10-11）：** [CI #38151910674 Web job #114507015452](https://github.com/lazyxu/xdrive/actions/runs/38151910674/job/114507015452) 已通过 Web lint/构建，启动预检成功并进入 Gallery，但其旧 `gallerySelectionScenario` `GET /api/v1/media/items` fixture 不接受当前 Mobile Gallery 已交付的 `initial_position` 查询参数，严格网络审计以 `Unexpected query initial_position` 报错，后续照片单元未能加载；[原始 artifact #11707450346](https://github.com/lazyxu/xdrive/actions/runs/38151910674/artifacts/11707450346)。本轮只在同一 Server Range fixture 将 `gallerySelectionScenario` 纳入已有 `galleryIos27Fixture` 的明确 `initial_position/unknown_first/anchor_node_id` allowlist、升序末尾首屏及 anchor 索引检查；不忽略未知参数，不增新前端/Go API，不放松 403/重试/真实 Node 及焦点门槛。新增静态回归要求这四处合同维持一致，重建相同单工作提交且必须对最终新 SHA 重新执行完整 CI 与原生 Chromium。


**P1-3b 第三次真实浏览器红灯（2026-10-11）：** [CI #38152266949 / Web job #114508101146](https://github.com/lazyxu/xdrive/actions/runs/38152266949/job/114508101146)，[artifact #11707152534](https://github.com/lazyxu/xdrive/actions/runs/38152266949/artifacts/11707152534)。`GET /api/v1/media/items` 的最新在底部、时间轴范围已经通过，但旧 `gallerySelectionScenario` 缩略图夹具仍拒绝真实 Web 请求的 `revision` 查询参数；24 个可见页内缩略图请求被判未知，导致后续选择测试没有成功进入。仅把该场景纳入已有 Gallery iOS27 缩略图严格 allowlist，同时继续验证真实 PNG=v4 / JPEG=v3、精确 Node revision 和未知参数拒绝，不改变 Go API、缩略图请求、媒体任务/选择状态，也不降低后续相册提交、焦点/缩放等门禁。重建当前固定基线上恰好一个工作提交，新 SHA 所有 CI 必须重新通过。


**P1-3b 第四次原生 Chromium 首次选择红灯（2026-10-11）：** [CI #38152985119、Web job #114510121354](https://github.com/lazyxu/xdrive/actions/runs/38152985119/job/114510121354)，[artifact #11706898639](https://github.com/lazyxu/xdrive/actions/runs/38152985119/artifacts/11706898639)。图库相册 Range/缩略图均经过严格 API 审计，`unknownRequests=[]`，但此前旧「多选」脚本假定默认渲染第0/1/2号照片；现行 iOS27 Library 默认落在最新的底部，虚拟化只挂载视口加 overscan，零号逻辑行未挂载。生产行为符合已合并的稀疏分页规范，不应要求全量渲染来使测试成功。仅让真实构建 Web 的测试在开启可见移动「选择」后显式滚动**同一个 Gallery main 宿主**到顶部，等待零号单元进入虚拟窗口，仍选择精确 ID 1000/1001/1002，检查选区及最终 REST revision/失败重试，不放宽任何业务或性能语义。增加静态回归；在相同固定基线重建恰好单工作提交，重新通过新 SHA 全部 CI/final-gate 才可合入。


**P1-3b 第五次真实 Web 宽窄切换红灯（2026-10-11）：** [CI #38153285286 / Web job #114511055958](https://github.com/lazyxu/xdrive/actions/runs/38153285286/job/114511055958)。显式回到前部逻辑图片、选择动作已执行；在 899/900 响应式切换导致原客户端发出合法新查询 `GET /api/v1/media/items?range=true&limit=100&offset=100&sort_dir=desc`，旧测试仅有24张图片而 `integerQuery(offset,max=24)` 错误拒绝。已核对 Go Server `internal/api/media.go::mediaListWindow` 真正的规则：`offset >= 0` 即允许，没有不超过 totalCount 的检查；空结果页必须按正常契约返回。仅让当前 `gallerySelectionScenario` 允许 **最多一个按 limit 对齐的越界空页**，其余不合理越界预取仍拒绝；保持同 Node ID、可见/隐身控件、用户级权限和真正相册 POST 的严格断言。没有修改 Server、排序、虚拟化或性能主线；重新构建单提交及原生 CI，不能使用旧 HEAD 的绿项冒充验收。


**P1-3b 第六次原生 Chromium 找到真实功能缺陷（2026-10-11）：** [CI #38153660210，Web #114512259545](https://github.com/lazyxu/xdrive/actions/runs/38153660210/job/114512259545)、[原始 JSON/900px 截图 artifact #11707417534](https://github.com/lazyxu/xdrive/actions/runs/38153660210/artifacts/11707417534)。真实构建Web进入图库、稀疏尾部滚回第一项、精确选择 Node 1000/1001/1002 后，前24条断言全通过（含375/390/899三宽度仍选3张、44px操作目标、无未知HTTP）；**切到900px时选区工具栏消失**，且 `unknownRequests=[]`。这是运行时真实功能回归，而不是夹具偏差：Page 的 `mediaGalleryCollectionKey(target)` 包含 `target.requestID`、`sort_by/sort_dir`、`unknown_first`，它被传给共享 `XDriveMediaGallery` 后用于多选清理 `useEffect`，而 899/900px 的默认排序偏好切换必然触发 `loadFirstPage` 以及新虚拟列表请求代次，误触发 `clearMediaSelection()`。 

**产品修复：** 保留原 `collectionKey` 作为 Server 稀疏分页/虚拟窗口/排序/Viewer身份的权威代次；单独引入纯共享 `xDriveMediaGallerySelectionScopeKey(target, preferenceScope)` 作为**多选业务范围**，排除 requestID、排序/未知首位、初始位置与锚点等纯呈现字段，仅当当前账号、相册/集合或真正改变照片集合的筛选/折叠/时区等语义变化时清空选择和使旧任务回执失效。排序与分页代次改变只清空旧 `selectionAnchorIndex`，防止 Shift+Click 锚点落在新的错误逻辑行；不清空已选 Node 身份。Desktop/Wide/Mobile 使用相同共享组件与 DataSource，不增移动 API/索引，也不破坏全屏 App Frame/52px 标题栏。

**验收继续：** 新增纯 TypeScript 选择范围键单元测试（同筛选排序/断点/请求ID等价、异账号/不同相册/筛选不同非等价）、静态清理依赖合同；保留完整真实 Chromium 375/390/899/900→390、同 Node 批量相册 POST/403→200、原焦点以及整个 Go/Desktop/Windows/打包 CI/final-gate。未跑绿的当前新 SHA 不算完成；真实 iOS27 Safari/PWA/VoiceOver/像素比对和100k RAW/HEVC/LIVP 分别待验。


**P1-3b 真实逻辑范围修复首轮验收（2026-10-11）：** [CI #38154363890](https://github.com/lazyxu/xdrive/actions/runs/38154363890)、原生浏览器 [artifact #11707842532](https://github.com/lazyxu/xdrive/actions/runs/38154363890/artifacts/11707842532) 记录前 60 条检查中 **58通过/2失败**，全部真正的选择、375/390/899/900→390 跨越、原三 Node ID、24手动相册、未确认不提交、取消焦点、实际Web REST POST 403→显式重试200、完整修订标记和成功后焦点返回移动「选择」均通过，unknown HTTP/PageError/ConsoleError=0。失败仅在相册「更多」MUI菜单*刚展开*时量测最小44px点击目标：`getBoundingClientRect()` 返回72×24.75，随后实际点击成功。数值恰好对应 CSS Grow/Popover 嵌套动画的缩放而非静态样式，原 `MenuItem` 已有 `sx.minHeight=44`。本轮保留 `target44` 的原严格断言，仅调用测试现有 `finishTransition()` 等待非无限动画结束后再测量稳定目标，同时增加菜单截图。不能通过忽略高度或更改CSS伪造通过。

同轮 Desktop 总计2200项，2197通过、2失败、1既有跳过。新增纯选择Scope键三个语义测试全部通过；两个失败分别是旧 `media-gallery-selection-scope-race.cjs` AST测试仍要求 `collectionKey` 触发清理，以及新增 `mobile-gallery-web-parity.cjs` 源合同测试误用未定义 `browser` 变量。仅将既有 Race 断言从虚拟请求代次更新为稳定 `selectionScopeKey`（仍严格验证跨真实业务范围时迟到操作不得释放新任务busy或清除新选区），并修正该测试本地变量。生产修复逻辑不变，绝不声称旧SHA CI通过；新单提交需要重跑所有Desktop/Web/Go/Windows、真实Chrome与final-gate，iOS27真机仍为not-run。
  **P1-3b 第七次原生 Web 断点验收红灯（2026-10-12，新精确 HEAD 待验证）：** [CI #38154872541](https://github.com/lazyxu/xdrive/actions/runs/38154872541) 的真实 Web Job 已成功 lint/build， Desktop/Linux/Windows、Go、镜像、source-agent 与单工作提交检查均通过，但原生 Chromium `gallery-selection` 60 项中 **59 通过、1 失败**（[原始 artifact #11708127302](https://github.com/lazyxu/xdrive/actions/runs/38154872541/artifacts/11708127302)）。 只有原 `Gallery 900px: identical canonical selection stays mounted` 断言失败： 切换为宽 Web 的稀疏新排序时，真实工具栏仍显示「已选择3项」，但 DOM 上 `input:checked` 数组暂时为空。 真实相册 POST 的三个 Node ID `1000/1001/1002`、明确 `403→200` 重试、修订头、焦点恢复、 375/390/899/900→390 和零未知 HTTP/页面错误均通过；故**不能把可见虚拟 DOM 行缺失判成选择 Map 丢失**， 也不应强迫 100k 虚拟列表保持旧选中单元挂载。 本轮只修复此验收口径：在 375/390/899/390px 继续检查精确 `[0,1,2]` 已挂载勾选项； 900px 改为实际打开共享 `查看已选项` 的有界复核对话框，并逐条验证精确 Node ID `1000/1001/1002` 及对应三个文件名，关闭后继续保持 3 项选择，最后仍检查全部真实 REST 拒绝、修订、重试、提交和焦点门槛。 增加对应静态回归和 900px 复核截图，**不修改生产代码/API/虚拟化，绝不跳过真实 ID 验证**。 旧 SHA 的成功检查不算新 HEAD 通过；本单提交改写后必须对新准确 HEAD 重跑完整 CI、原生 Chrome 与 final-gate。 真实 iOS 27 Safari/PWA/VoiceOver/1:1 成对截图与 100k 实体 RAW/HEVC/Live Photo 仍单独待验。

**P1-3b 第八次真实 Chromium 验收定位修正（2026-10-12）：** [CI #38155788544](https://github.com/lazyxu/xdrive/actions/runs/38155788544) 精确 HEAD `574c5a800a7a7546eb448702ca23ade728c89e4c` 的 Web lint/build 成功， 原生浏览器 26 项已执行检查均通过，随后 Playwright 超时在 `getByRole('dialog', {name:'查看已选项'})`。 [失败 artifact #11708004138](https://github.com/lazyxu/xdrive/actions/runs/38155788544/artifacts/11708004138) 的实际 900px 截图/可访问性树证实**共享 Review 真实已打开，DOM 含 Node 1000/1001/1002 和三份准确文件名**， 对话框真实可访问名称为标题「已选择 3 项」，而「查看已选项」是触发按钮的可访问名称： 因此失败是 Playwright 角色名称选择器错误，不是生产状态或虚拟化缺陷。 本次只把测试定位改为对实际 MUI Dialog 名称的严格正则 `^已选择\s*3\s*项$`， 独立断言相同可访问标题，并保留真实三 Node ID 的 Review、实际 POST 的 revision/403→200/焦点、跨断点、44px 门禁； 不改 Gallery/REST/虚拟化/52px App Frame，增加静态回归。 本轮新单提交仍须重新通过原生 Chromium、完整 CI 与 final-gate， 真实 iOS 27 Safari/PWA/VoiceOver 1:1 成对截图及实体 100k RAW/HEVC/Live Photo 继续为未验收项。


## P1-3c1 · 真实 Gin/PostgreSQL17 的 Web/Mobile Web 图库 Range 等价（2026-10-12）

**状态：待新提交真实 CI/Final Gate 验收的候选改动，不代表已合入或真机 1:1 已通过。**

**前置依据：** P1-3a #1431、P1-3b #1434 已通过精确头 CI 合并并清理分支；独立物理 CAS 首屏性能基线 #1439 已合并。Gallery 性能进度 #1185 仍是阻塞中的 Draft，不能关闭。固定新工作基线和唯一提交以本 P1-3c1 PR 记录为准。

**针对现有未测试场景：** 之前 P1-3b 的构建 Web 浏览器相册选择使用受控 HTTP fixture，不能证明真实 Go JWT 权限、PostgreSQL 所有者查询及 10k 虚拟 Range 正确性。此轮复用仓库已有 mediaGallerySeedFirstOpenScaled 数据构造器，建立 10,000 个逻辑 PhotoAsset，含 70% JPEG / 15% MP4 / 15% Live Photo（11,500 个媒体 Node）。数据为投影元数据，**不是** 11,500 个真实物理 CAS 原件或浏览器解码性能测试。通过独立 PostgreSQL17 schema、生产 Gin Server.Router、真实 JWT、真实构建 Web 与原生 Chromium，不制造任何 /api/v1 响应。

**精确场景：** 375/390/899/900 CSS px，每个宽度在真实路由 /#/app/gallery 上记录 Go GET /api/v1/media/items 的 Range 响应，验证 HTTP 200、Cache-Control:no-store、total_count=10000、单次返回不超过128项、真实 Node 身份/修订、浏览器只挂载有界的虚拟照片单元以及唯一 Gallery 与原移动52px标题栏。使用第二账号的有效 JWT 验证空列表和禁止访问原账号 Node 的 404；无效 JWT 须401。原生浏览器记录精确提交、代码 SHA256、范围偏移/大小及截图；JWT 只保留于 Runner 私有 0600 ready 文件，决不上传。新测试仅在 test/mobile-gallery-ios27-real-go- 前缀 PR 的现有 go-linux-api PostgreSQL17 Job 执行，且完整 Desktop/Web/Windows/打包/Final Gate 仍是合并门槛。

**不能冒充的结果：** 本测试既不测真实图片、HEVC/RAW/.livp 原件，也不覆盖缩略图解码、去重、性能 FPS/时间、相册写入、Task Center 任务终态或实际 iOS 27 Safari/PWA/VoiceOver/同帧像素级1:1。10k 有界 DOM 与真实 Go Range 是功能正确性而不是提速声明。以上分别留待 P1-3c2 真实写入/权限与后续物理媒体/真机验收。生产 Gallery DataSource、虚拟化列表、全屏 App Frame、52px 全局标题栏和 Web/Desktop Server 完全不改。


**P1-3c1 首次真实 Chromium→Gin/PostgreSQL17 红灯（2026-10-12；修正后须重跑精确 SHA）：**
[完整 CI #38161093303](https://github.com/lazyxu/xdrive/actions/runs/38161093303) 的真正 go-linux-api Chrome/Postgres 结果和 [原始截图、请求 JSON/Go 日志 artifact #11710606958](https://github.com/lazyxu/xdrive/actions/runs/38161093303/artifacts/11710606958) 证实四个真实宽度已完成业务验收：
375/390/899 的共享 iOS27 Mobile Gallery 请求相同 Gin 路径及拍摄升序尾部 offset=9900, returned=100, total=10000；900px 宽屏同路径、排序降序 offset=0, returned=100, total=10000，有效 Node revision=1。虚拟 DOM 在四视口分别 27/27/42/12 个 Tile，52px 移动 App Header 测量通过。第二 JWT 访问 PhotoAsset 详情为真实404，另一 Owner 的媒体 Range 200/空集，无效 JWT 为401，浏览器 PageError=0。

但该首测最终**未通过**：浏览器严格网络审计发现28个 HTTP500（每视口重复，实际端点为人物建议/身份、宠物、地点、文件操作、配额和活动任务）；SQL 日志准确显示独立测试 schema 未迁移 xd_photo_person_clusters、xd_photo_people、xd_photo_visual_labels、xd_photo_place_labels、xd_file_operations 和 xd_upload_sessions。另外105个 HTTP503 均为 /api/v1/media/items/<id>/thumbnail，是本阶段刻意只写元数据、无物理 CAS 原片的**预期不可生成缩略图**响应，不是已验证缩略图加载成功。第一张图的占位图标不等于真实图像解码。

**有限修订：** 补齐隔离测试所需且生产已存在的模型 AutoMigrate（人物/宠物/地点/文件操作/上传会话），生产 API、媒体模型和真实 Server 访问权限均不修改；浏览器只把此 metadata-only 运行下精确 /media/items/<id>/thumbnail 返回503计入独立 metadataOnlyThumbnail503，其它任何 5xx、陌生请求、JS 异常继续严格失败。新增对应静态回归，不忽略 500、不伪造响应、不声称真实缩略图成功。需对新同一工作提交重新通过实体 Go/Chromium、Go race、Desktop/Web/Windows、打包、Final Gate，不能以旧 SHA 的部分通过项替代。iOS27 真机视觉与物理媒体性能仍为 not-run。

**P1-3c1 第二次精确 HEAD 真实 Chromium 红灯（2026-10-12）：** [CI #38162226990](https://github.com/lazyxu/xdrive/actions/runs/38162226990)（工作提交 e7c6e553）的 23 个非跳过 Job 通过，go-linux-api 中原生 Chromium、依赖它的 Final Gate 失败。
四宽度的 Go Range / 10k 逻辑媒体、Node revision、27/27/42/12 个虚拟 DOM、52px 移动标题栏、外部 Owner 空集/404、无效 JWT 401 均得到真实证据。108 次仅元数据缩略图 503 已精确独立计数（不是物理 CAS/成功解码）；JS PageError=0。
仍有恰好 **4 次意外 HTTP 500**，全部来自 GET /api/v1/background-tasks/active-summary。Go SQL 明确报 xd_sync_runs 不存在；隔离测试 AutoMigrate 迁移了 meta.Source，却遗漏已有的 meta.SyncRun。
本次只在原分支同一唯一工作提交中补充隔离测试的 meta.SyncRun 迁移和静态回归。生产 Gallery/API/Task Center/虚拟列表/52px App Frame 未变，任何其他 5xx 继续失败。必须在新精确 HEAD 重跑完整 CI 与 Final Gate 才能宣布验收/合并；真 iOS 27 Safari/PWA/VoiceOver、真实物理媒体解码仍待测。

## P1-3c2a · 真实手动相册写入 Web/Mobile Web 等价（2026-10-12）

**状态：验收候选（非已合并、非真机）**。前置 P1-3c1 #1452 已以完整 25 个成功 Job（包含原生 Chromium/Gin/PostgreSQL17 与 Final Gate）线性合入 master@1147159a，并确认短期分支删除。独立性能专项 #1450 与 Desktop IPC 进度 #1185 尚未完成且不在本轮范围。

这一阶段在已验证的真实 10k 元数据 Gallery Fixture 中仅扩展 **实际 UI 发起的手动相册写入**。用真实生产 Web 在 375px 移动入口与 900px 宽屏入口分别进入同一个 Gallery 页面/虚拟选择/操作工具栏；先使用已授权生产 REST 创建独立手动相册作为测试前置状态，再通过 UI 真正选择两个带 canonical Node ID 的媒体，打开共享已选复核，实际提交 POST /api/v1/media/albums/{id}/items，验证请求的两个 Node ID、If-Match 引号修订 1、HTTP 200、返回修订 2/成员数 2 及独立 GET 读取的持久 PhotoCollectionAsset 成员。取消/重试/其他权限规则不绕过已存在的事务隔离。

进一步以有效 Owner JWT 的旧修订触发真实 HTTP 409；以另一个有效用户 JWT 修改他人相册触发真实 HTTP 404；拒绝后成员关系原样保持。Go 仍检查原 10,000 逻辑 PhotoAsset 不被相册成员创建改动。浏览器不得拦截 /api/v1；记录实际视口、同一共享 REST、请求/响应修订与 Node ID、截图、精确源码哈希，JWT 仅出现在 0600 私有临时 ready 文件。严格判定任何非预期 HTTP 5xx/JS 异常失败；没有物理原件的缩略图 HTTP 503 单独标示为不可用而非成功解码。仅在 test/mobile-gallery-ios27-album-live-go- 前缀 PR 下复用现有 go-linux-api PostgreSQL17 CI，保留全量 Go/Desktop/Web/Windows/打包/Final Gate。

明确不包括：真正图片/RAW/HEVC/Live Motion CAS 原件字节、iOS27 Safari/PWA/VoiceOver 成对像素截图、Task Center 持久工作队列终态，或全部 Web 相册增删改功能。此处相册加入为**同步资源成员操作**，不伪报为上传/删除后台任务。生产 Gallery API、DataSource、虚拟列表、全屏 App Frame 和 52px 全局应用标题栏均不修改。精确 HEAD 的原生 CI 尚未运行，未获得任何新阶段通过记录。

## P1-3c2b · iOS27 手动相册移除成员的 Web/Mobile Web 真实验收（2026-10-12）

**状态：测试候选，未完成精确 HEAD 真实浏览器/完整 CI/Final Gate，不可冒称已合入或真实 iOS27 1:1。** 固定基线 GitHub master@64da6fd1（P1-3c2a #1457 完整 PR CI #38189164498 包括原生 Chromium、25 Job、Final Gate 通过后线性合并且自动清理分支）。之前 P1-3c1 的 10k Gin/PostgreSQL17、Mobile/Wide JWT/Range/虚拟化也已交付。独立物理媒体 P032 性能 PR #1450 已合入；Desktop 100k IPC #1185 仍是 blocked Draft，勿误删。

**本轮缺失的真实业务维度：** 前一阶段只证明实际 UI 可加入手动相册与同步的 PhotoCollectionAsset 成员持久化，不能证明移除不会删除原始照片。复用既有 10k metadata-only Go/Gin/PostgreSQL17、JWT 和真实构建 Web。在同一 Owner 账号中以真实 Server POST 创建两个独立手动相册，各通过真实带 If-Match: 1 的 POST 加入两个不同 PhotoAsset（明确仅为独立测试前置状态，不计 UI 成功）。375px Mobile Web 从 iOS27 精选集的真正相册卡片进入，使用真实 450ms 静止 touch pointer long-hold → Gallery 上下文菜单「属性」→ 共享 Inspector「从当前相册移除」；900px Wide Web 从既有 Gallery 的相册索引卡片进入，以鼠标右键打开相同 Inspector 执行删除成员。

浏览器捕获真实 DELETE /api/v1/media/albums/{manualID}/items/{nodeID}，核对选定真实 Node 在当期 Album、If-Match 引号 2、HTTP200、revision3、item_count1、相册 GET 中只剩未选中的另一张；随后 GET 原 canonical /api/v1/media/items/{removedID} 仍必须 200（不入回收站、不删原片）。每组使用真实旧修订 DELETE 得409、另一有效用户 JWT 得404；两种拒绝均不能改变已持久化成员；图库范围中仍有 10000 个逻辑资产。另对375px Mobile「移除」的稳定触控高度设严格至少44 CSS px 门禁；如首次真正 Chromium 发现不满足，应优先保存 first-red，仅修复共享 MUI Inspector 相应目标，不能将测量改为静态虚假通过。

测试只允许元数据夹具无 CAS 原件而产生的精确 thumbnail 503 单独计数，其他任何 HTTP5xx、PageError 必须为0；禁止伪造 /api/v1、明文 JWT artifacts、重复移动端 Server/controller/虚拟列表。采用 test/mobile-gallery-ios27-remove-live-go- 专属 PR 下已存在的 go-linux-api PostgreSQL17 Job 原生 Chromium 验收，完整 Go API race、Desktop/Web/Windows、打包和 Final Gate 仍是合并必需。该阶段不声明 iOS27 Safari/PWA/VoiceOver/Liquid Glass 同帧像素 1:1，也不声明 100k 真实 RAW/HEVC/.livp/CAS decode 性能或 Task Center 终态；保留全屏 App Frame、52px 全局应用标题栏及 Desktop/Web 共享业务后端。

 **P1-3c2b 原生 Chromium 第一次真实红灯及修订（2026-10-12）：** [PR CI #38190461429](https://github.com/lazyxu/xdrive/actions/runs/38190461429)、[原始 artifact #11720982903](https://github.com/lazyxu/xdrive/actions/runs/38190461429/artifacts/11720982903)，精确候选 HEAD d6a7d52e794113be65d9b37380169d504dcd4fad。 Go API race、Desktop/Web/Windows/Server/产物多数前置 Job 已通过；真实 Chromium 在 375px 的 iOS27 精选集进入手动相册、静止 touch pointer 500ms、共享 Context Menu「属性」、共享 Inspector「从当前相册移除」后，测得该 Button 稳态高度 **36.5 CSS px**，小于严格 **44px** 移动命中规范，浏览器 AssertionError 首红，尚未执行任何实际 UI DELETE（nativeRemovals=0）；900px 亦尚未执行，不能称两端移除验收通过。 原始网络同时准确记录两个意外 HTTP500（/api/v1/media/album-folders 与 /api/v1/nodes/<id>/location），对应隔离测试 schema 遗漏既有 meta.PhotoAlbumFolder、meta.SourceItemMetadata 两张表；另外 metadata-only fixture 30 个 thumbnail503 仅表示无原始 CAS 字节，与真实缩略图解码无关。 **修复范围严格有限：** 只为共用的 MediaGalleryDetails Inspector「从当前相册移除」按钮增加小于900px断点 minHeight:44，保持普通 Web/Desktop布局和功能不变；仅给既有 Gin/PostgreSQL17 测试夹具 AutoMigrate 补入 PhotoAlbumFolder、SourceItemMetadata，绝不修改生产 Server schema/业务接口/身份。新增测试源守卫，而原生 ≥44px、真实 DELETE Node/If-Match/原资产GET200、零意外 500 仍全部保持严格失败条件。仅在相同固定基线的单工作提交改写后重新运行完整 CI/Final Gate；不能把第一次红灯计为已验收。

## P1-3c2c · 真实跨端相册 409 后修订刷新与明确重试（2026-10-12）

**状态：PR #1468 真实 Gin/Chromium 验收进行中；初始生产缺陷 409 未刷新已实证，修复候选复测出现测试监听器 URL 解码缺陷；最新工作提交尚须通过完整 CI/Final Gate，未合并、非真机 1:1。** 先验记录：P1-3c1 #1452、P1-3c2a #1457、P1-3c2b #1463 已通过真实 Chromium→Gin/PostgreSQL17、完整 PR CI 与 Final Gate 合并，旧分支清理完毕。100k 物理媒体 P032 #1450 已独立合并；Desktop IPC 进度 #1185 是仍被阻塞的独立 Draft，保持不动。

**本阶段新的正确性假设：** XDriveMediaGallerySelectionToolbar 的宽屏直接下拉/移动底部相册选择器复用同一个 onAddItemsToAlbum 和选区逻辑；当另一持权客户端提交同一手动相册将 revision 由1推进为2时，当前缓存可能仍使用旧的 If-Match:1。真正服务端给409应保持原两张选择和其他客户端新增成员，不得盲目自动重放写入。必须通过现有 source.listAlbums 从 Owner JWT 权威后端获取 revision2、将最新相册记录提供给两种布局，提示用户需要再次确认；下一次明确点击以 If-Match:2 添加原选两张，返回200/revision3/item_count3。任何账号/集合切换期间的迟到刷新不得污染新的相册与选区。

**精确测试：** 先由真实 Gin/PostgreSQL17 创建每个布局的独立手动相册 revision1；实际构建 Web 原生 Chromium 在375px Mobile Gallery 选择两项、展开移动更多→手动相册选择器，或900px Wide Gallery 使用同一选择工具栏。第一次尝试之前，测试通过第二个 Owner 授权的真实 REST 请求写入不同真实 Node，形成 revision2/item_count1；读取当前数据库确认。前端第一次提交仍须用 If-Match:1/两个真实 canonical Node，得到409；在不重载页面的情况下实际监听到 GET /api/v1/media/albums 的200，得到新 revision2，原选两项不丢失，显示“相册已更新”通知；用户在原界面主动再点击，POST 必须携原 Node ID + 引号 If-Match:2、200、revision3/item_count3，并以独立 GET 确认三个成员均持久保留。两种布局各自成功才可过关。

**边界与验收：** 复用原 10k metadata-only PhotoAsset 夹具、生产 Go Server.Router/REST、唯一 Web Gallery 与 VirtualCollection；无 /api/v1 伪造、不自动重试、不复制原片、不新增 mobile API。未持久化真实 CAS bytes 的 thumbnail 503 单独计数但不宣称缩略图加载成功，任何其他 HTTP 5xx/JS Exception 为失败。精确 SHA、请求/响应、截图、选择 Node ID 及数据库成员保存为仅含公开测试元数据的 CI artifact；JWT 只在临时 0600 文件。真实 iOS27 Safari/PWA/VoiceOver/成对像素截图、Task Center 持久任务、物理 100k RAW/HEVC/Live Photo 解码不属于此阶段，继续明确 not-run。不得修改全屏 App Frame、52px 全局应用标题栏、共享 Web/Desktop Server 架构。

**测试优先：** 先以无生产修复的原生 Chrome 完整 CI 记录首个实际 red，再在同一固定基线唯一工作提交里修复 shared 业务处理、补纯逻辑单元测试并重新跑精确 HEAD。仅一个完整通过的 PR 才能线性合并、清理分支。

**P1-3c2c 首次真实 Chromium 409 红灯及复核修订（2026-10-12）：** [精确 HEAD CI #38194312754](https://github.com/lazyxu/xdrive/actions/runs/38194312754)、[go-linux-api #114633528395](https://github.com/lazyxu/xdrive/actions/runs/38194312754/job/114633528395) 的产品代码仍是原始缓存修订实现。完整 23 个其他非跳过 Job 通过，go-linux-api 和依赖它的 Final Gate 失败；浏览器已经通过真实用户会话从生产 Gin/PostgreSQL17 收到该手动相册的 `POST /api/v1/media/albums/:albumID/items` **409**。在后续30秒内没有出现预期的权威 `GET /api/v1/media/albums` 刷新，实证表明共享 Gallery 不能从旧 If-Match 修订自行恢复。失败日志中的另一个独立测试缺陷：未处理的 `page.waitForResponse` TimeoutError 导致 Node 直接退出，`results.json` 未写出，不能据此捏造完整第二次重试结果。

**本轮修复范围：** 原有共享 `ui/shared/src/mui/MediaGallery.tsx` 的批量 `addItemsToAlbum` 对带结构化 `status=409` 的错误执行一次已有 `source.listAlbums()`，只更新该 Owner/相册 ID 的更高版本记录，按 `preferenceScope`/拥有者 Ref 在网络完成及 React setState 提交时二次隔离；不清空原 Node 选区、不全量刷新虚拟列表、不自动重新 POST。移动端相册 Drawer 保留选中项并明确提示“相册已更新，已获取最新版本，请确认后重新点击加入相册”；宽屏 Web 同一共享业务错误提示并保留选择器，下次由用户显式点击才发送带新 If-Match 的 POST。原源网络获取失败必须保留旧409，不得误称已刷新成功。测试 `refreshResponse` 立即接入捕获 rejection 并转为严谨失败断言，在 `finally` 持久保存 JSON 与截图，不得改变真实 409/200/3个成员的门槛。

**重新验收要求：** 修订后的唯一工作提交须重新通过 375/900px 原生 Chromium → 同一生产 Gin/PostgreSQL17 写入与权威目录刷新、旧修订409→用户再次点击新版修订200、并行成员不丢失，其他 Go race/Desktop/Web/Windows/打包和最终 Final Gate 全绿。旧 SHA 23 个通过项不等于新 HEAD 成功；iOS27 真机 Safari/PWA/VoiceOver/成对 1:1 像素、实体 RAW/HEVC/Live CAS 解码、Task Center 持久任务仍 not-run。

**P1-3c2c 第二轮精确 HEAD Desktop TS 红灯（2026-10-12）：** [CI #38195189927](https://github.com/lazyxu/xdrive/actions/runs/38195189927)，源码 `a91a3459` 的 Windows Desktop `tsc -p tsconfig.renderer.json --noEmit` 在共享 `MediaGallery.tsx` 第2199/2206/2209行报告 **TS18048：MediaAlbum.revision 可选（undefined）**；不能以Go测得的实体记录revision>0推断TypeScript静态字段必填。Windows打包“runtime exe missing”是后续症状。仅将旧版、新版及缓存版的 revision 比较操作改为 `?? 0`，仍只在新修订严格大于旧版本时更新，不改 Go Server、DataSource、选择或自动重试语义；在 static contract 加入可选修订守卫。修订必须再走精确HEAD的 Web/Windows/Desktop/Go/原生Chromium/Final Gate，旧 SHA CI 不计绿。


**P1-3c2c 第三轮精确 HEAD 原生浏览器红灯与监听器修正（2026-10-12）：** [CI #38195536315](https://github.com/lazyxu/xdrive/actions/runs/38195536315)、[go-linux-api job #114637453579](https://github.com/lazyxu/xdrive/actions/runs/38195536315/job/114637453579) 测试修复候选 `3b9a02d44c25bb4b3e2590a9cd0fb787eab1475d`。真实 PostgreSQL17/Gin 日志已观测第二持权写入 **POST 200**、Mobile Web 旧修订 **POST 409**、紧接着 Owner 权威相册清单 **GET 200**，证明修复至少发起了合法服务端刷新。**但不能称通过**：Playwright `postObserver` 用原样 `albumPath(album)`（`manual%3A...`）作为 expected，与 `decodeURIComponent(new URL(response.url()).pathname)`（`manual:...`）比较，造成真实 409 已发生却被错误过滤，最后 `waitForResponse` 30 秒超时。测试 JSON：`accepted=[]`、`pageErrors=[]`、`httpErrors=[]`、仅 metadata-only CAS thumbnail 503 共30个；尚未执行完整 409→选择保留→明确重试→200/三成员持久化、900px 宽屏。另 13 个适用基础 Job（Desktop/Web/Go/Windows/镜像等）通过，不代替原生门禁及 Final Gate。

修订仅修正 `desktop/scripts/gallery-ios27-real-go-conflict-browser.cjs` **期望路径与实际 URL 同时解码**，并在 `desktop/tests/gallery-ios27-real-go-conflict-contract.cjs` 追加 `manual:` 资源 ID 的路径规范化测试；保留原所有真实 409/GET/200/成员断言及 `MediaGallery.tsx` 的 Owner 隔离/显式重试业务修复，绝不放宽通过条件。此改动仍归属原 #1468 的**同一个工作提交**，重新触发精确 HEAD 原生 CI 后再决定 Ready/merge；不涉及 Desktop IPC #1185、性能、Race 或其它 PR。


## P0-L1 · 六列年份图库实况角标越界修复（2026-10-12）

**交付状态：仅修复候选，尚待精确工作提交完整 GitHub PR CI / 真实 iOS 27 Safari 验收；不可将源代码或 Chromium 验证冒充像素 1:1。** 用户提供的真实 Mobile Web 截图中，年份图库 19 个条目在约六列方形照片墙内显示过宽的黑色「实况」Chip：20px 实况图标加文字、背景及内边距超出小图格，遮挡缩略图并在边缘裁掉图标。少数灰色格子也显示相同角标，这只证明角标独立于缩略图加载状态，尚不能证明它们不是合法 Live Photo 或定位到缩略图 503/无派生封面的具体原因。

**限定修复：** 仅修改共有的 `ui/shared/src/mui/MediaGallery.tsx` 中 `MediaTile`，对有确切 `live_photo` / `asset_kind=live_photo` 的资产，将文字 Chip 改为位于右上角、20×20 CSS px 圆形半透明背景内的 13px 共享 `XDriveLivePhotoGlyph`；语义 `aria-label` 归属可聚焦的缩略图按钮，不为小图标创建第二个按钮。小网格其它 badge Stack 限定到图格宽度以内，进入多选模式时暂不显示装饰性媒体角标，让左侧 44px 选择框拥有视觉优先权。无实况证据的普通图片不新增 Live 标识；大视频/RAW/GIF 等原有媒体类型、操作、过滤仍在共享数据源里，不改变原件。

**架构不变量：** Web/Mobile Web/Desktop 仍共用一个 Gallery Page、`MediaTile`、`MediaGalleryDataSource` 对应的 REST/Agent 适配及 `VirtualCollection` / `MediaVirtualTileGrid` / `MediaVirtualTimeline`。不改变全屏 App Frame、52px 全局标题栏、网格列数和虚拟布局、照片选择/Viewer/450ms 长按、Live motion 首次按住才加载、PhotoAsset 配对身份、Server API 或上传/下载/持久任务。该展示改动无需重新测试已验收的同负载 P032/P033 性能基线；如果真实浏览器发现新请求、DOM 数、帧率、锚点退化，应单列性能回归。

**验收计划与未完成项：** 在共享 MediaTile 真正 React mounted 测试中，检查有/无 Live 语义、禁用文字实况 Chip、20px 最大角标、触控/鼠标、缩略图无资源时不遮图、选择模式与单击打开、视频标识保留；完整 Web/Desktop/Go/Windows/Final Gate 均需通过。截图中的灰色缩略图原因（`has_thumbnail=false`、真实 GET 状态、原图 CAS、iOS 专有配对封面或派生海报）须另用原资产与请求证据定位，禁止将隐藏角标充当加载修复。最终 iOS 27 Safari / PWA 与 Apple 同版真机参考双图、VoiceOver 仍为 not-run。

## P0-L2 · 缩略图 Blob 获取成功但图片解码失败时恢复占位（2026-10-12）

**状态：独立的共享 UI 修复候选；精确 GitHub PR CI/Final Gate 和真机 iOS 27 对照仍待运行。** P0-L1 #1479 已以单提交线性合并，修复小网格实况文字 Chip 越界。对其截图中余下的灰色缩略图进行源码审计发现另一类**可独立复现的显示缺陷**：`XDriveMediaAsyncThumbnail` 异步调用 `loadThumbnail` 得到 Blob/ObjectURL 就挂载 `<img>`，而图片元素本身在浏览器解码或读取失败时此前没有 `onError`，因此可能留下一张损坏／空白图而不走已有回退。请求成功不代表真实浏览器图片解码成功。

**本阶段最小修复：** 只在共享 `ui/shared/src/mui/MediaGalleryPreviewMedia.tsx` 的图库 async image 元素挂接 `onError={() => setFailed(true)}`，直接复用现有 React fallback，保持源数据、无进度条伪完成、正常加载、图片 URL 所有权、缩略图请求取消及来源 revision fence。**不自动重试、不额外请求原始图片、不对 100k 列表扫图、不改媒体后端或静态 API。** 新的 `desktop/tests/media-gallery-thumbnail-img-error.cjs` 使用实际生产组件的 React mounted 状态机，验证 URL 已成功但图片失败的回退、零重复网络请求、同 Node 新 revision 可重新获取、无 Node/已有请求拒绝的回退与正常可显示路径；全套测试/CI 仍为合入门槛。Web/Mobile Web/Desktop 继续使用同一共享组件、Server API/Agent 适配与 VirtualCollection/Grid/Timeline，全屏 App Frame 与 52px 顶栏不变。

**仍待真实原件诊断：** 截图中的 3 张灰格还可能来自 `has_thumbnail=false`（Server 格式支持标记，非缓存存在证明）、后端缩略图生成失败、原始 still CAS 缺失、陈旧 revision、无可解码资源或网络取消。需要相关 Node IDs、实际状态码、索引/派生任务与 PhotoResource still/motion 的真实证据才可定位具体起因，不应把这个浏览器 fallback 修复称作灰格彻底解决。原生 Safari/PWA、VoiceOver、真机像素 1:1 和实体 Live 图片解码状态单独 not-run。

## P0-L3 · 实况角标仅在静态封面成功加载后显示（2026-10-12）

**状态：共享界面修复候选，完整精确工作 SHA CI / Final Gate 及真实 iOS 27 真机仍需另验。** #1479 已把六列年份图库中的黑色「实况」文字胶囊改成 20px 非交互图标，#1482 已为图片 `<img>` 解码失败补已有 fallback。但截图中灰色格子仍带「实况」装饰角标，和已有 FileExplorer Thumbnail 的“只有实际缩略图才露出角标”规则不一致。无图片的灰格不等于成功加载的照片，应隐藏此**装饰层**而不是误改 Live Photo 类型或媒体 API。

**仅共享 UI：** `MediaTile` 使用 `node_id:revision` 标识当前已成功加载的实况静态图；`XDriveMediaAsyncThumbnail` 通过真实浏览器 `<img onLoad>`（自然宽度非 0）报告就绪，开始加载、失效、`onError` 报告不可用。只有当前修订就绪且非选择模式才显示 20px 实况图标；无图、503/415/404/409、坏 Blob、滚动取消或缩略图正在加载时不渲染装饰图标。逻辑 `item.live_photo / asset_kind` 原样，整个 Tile 可聚焦元素的 `aria-label=实况照片` 仍保留。图片 Loader 不重试、不增加 HTTP、Blob/Agent IPC 所有权不变，`VirtualCollection`、Grid/Timeline、52px App Frame 完全保持。新/旧版本竞态仅以当前图片 ID+revision 显示角标，旧回调不能令新图显现或隐藏。

**验收：** 实际共享 `MediaTile` / `XDriveMediaAsyncThumbnail` React 挂载回归覆盖图像尚无 src、浏览器 onLoad（自然宽度0与非0）、onError、版本变更、旧回调、选择模式、视频/普通图片与单一共享虚拟化/API，源代码与完整 Web/Desktop/Go/Windows CI 必须精确头绿色。P032/P033 既有 100k 实际性能基线不可借作当前新渲染代码的实测加速，后续若发现 Long Task/内存变化再使用性能登记簿比较。灰格的**原始失败原因仍未确定**，需要相关 Node/真实 HTTP/派生任务/原件 CAS 和有效 still/motion 资源凭据；Safari/PWA/VoiceOver/像素 1:1 仍 not-run。


## P0-L4a · 修复 LIVP 内嵌 HEIC/HEIF 静态照片缩略图缓存版本与渲染策略（2026-10-12）

**状态：已定位并修复候选的真实服务端合同不一致，待精确 PR CI / Final Gate 验证；不是用户截图灰图的最终根因结论。** 此前图库六列实况标签遮挡由 #1479 修复，浏览器解码错误回退由 #1482 修复，加载成功后才显示实况图标由 #1483 修复并合入。继续沿着原图/静态帧/缓存生成路径核查发现：Server 读取合法 `.livp` 描述符中的真实 still MIME 才判断 `has_thumbnail`，却继续以容器 `application/x-livp` 生成缩略图 ETag、派生缓存键和生成方法。这使 HEIC/HEIF 静态封面误落不支持 alpha 的 v3 JPEG 缓存语义，而非应有的 v4 可透明缩略图缓存，缓存版本和服务端声明不一致。

**修复：** 以经过 `ParseLIVPContainerDescriptor` 验证的 still MIME 为唯一有效缩略图源 MIME，统一格式可支持性、ETag、StorageKey、派生任务版本及 `ThumbnailJPEG/ThumbnailWithAlpha` 策略。嵌入式 JPEG 的 LIVP 仍用旧 v3 共享缓存；内嵌 HEIC/HEIF 正确切换到隔离 v4 `.thumb`，避免重用错误的 v3 衍生结果；损坏描述符不猜测类型，不新增 MIME 外部来源、后台扫描或媒体身份模型。普通 Web/Mobile Web/Desktop 都复用现有同一 Go Server 和 `MediaGalleryDataSource`，无新 API、无图片墙全量渲染、无对原片的修改、无自动重试；全屏 App Frame 和 52px 全局标题栏不变。

**验收门槛：** Go 回归分别核对 JPEG/HEIC/HEIF LIVP、错误描述符、旧新缓存键隔离、ETag/derivative version 一致性；完整 Desktop/Web/Go/Windows/打包与 Final Gate 才可合并。真实 HEIC/LIVP 原始文件、用户截图缺失的三张 still、iOS 27 Safari/PWA 视觉及 VoiceOver 尚未提供原始测试证据，继续标注待验，不能虚称灰图原件已经恢复。下一步应以被影响 Node 的真实缩略图 HTTP 状态、CAS still/motion 与派生队列为边界做证据驱动的补修。


## P0-L4b · 实况封面在媒体队列短暂繁忙时的真实恢复（2026-10-12）

**状态：修复候选，精确工作提交 PR CI / Final Gate 及 iOS 27 真机尚待执行。** 此前 P0-L1 #1479、P0-L2 #1482、P0-L3 #1483、P0-L4a #1490 均已合并并清理分支。源码与已有原生 Gin 集成用例证明：当缩略图派生任务队列满时，Go 返回 HTTP503 + `Retry-After: 1`，但 `mediaThumbnail` 在失败之前已给成功图片设置 `Cache-Control: private, max-age=3600`，导致失败响应沿用 1 小时正向缓存；Web/Mobile Web 的唯一 `XDriveApi.mediaThumbnail` 抛错后，共享 AsyncThumbnail 直接进入错误占位，当前可见格不会恢复。这是**可重现的瞬时错误处理缺陷**，不是对截图中三张原件错误原因的猜测。

**P0-L4b 同一后端与 REST 恢复：** 所有媒体派生失败响应（503/504/409/415/500 等）显式 `Cache-Control: private, no-store`；冷视频海报 404 和成功派生后意外 500 不允许继承成功图片缓存；实际成功的缩略图和视频海报继续保留 `private, max-age=3600`。统一 Web REST `mediaThumbnail` 对真实 HTTP503 **仅在合法 `Retry-After` 整数 1–8 秒存在时**，等待一次并以 `cache:'no-store'` 执行**最多一个**后续请求，绕过升级前可能缓存的旧 503。缺少合法信号、404/409/415、无限重试、超过8秒等待一律拒绝；使用同一视口 `AbortSignal`，滚动移出、账号/页面变更或窗口关闭应立刻清除等待并阻止重试。原 `XDriveMediaThumbnailScheduler` 仍限制视口请求并发 6；无全量 100k 扫描或额外永久任务。相同 Web Adapter 供 Mobile Web 和宽屏 Web 使用，Desktop Agent 平台传输保持独立、Go 后端相同；不改变全屏 App Frame、52px 顶栏、MUI 网格、Live 身份/导出或 PhotoResource。

**新验收：** 对已有实际 PostgreSQL17/Gin 调度队列满 503 用例，补 `Retry-After:1` 和响应 `no-store`；真实视频海报 GET 404→PUT→GET200 集成链验证错误不缓存、成功仍可缓存。新 `desktop/tests/media-gallery-thumbnail-http-retry.cjs` 从实际 Web `api.ts` 抽取执行已提交的原函数，测试合法一次延迟重试、恶性/永久状态完全不重试、第二次503后立即终止、Abort 清计时器、共享 DataSource/虚拟化和52px约束。只能把 CI 日志称为自动测试，不可冒充真实 iOS27 Safari/PWA/VoiceOver 或截图里三张原件的字节恢复。

**后续未解决：** 真实 HEIC/HEIF 的实体 LIVP 解码仍缺用户原件与具体 Node/HTTP 数据，真正 404/415/500/504 需查看 owner-scoped CAS 原件、MediaMetadata.index_error、资源 still/motion 与后台派生错误后再最小化修复。不得把本次一次性 503 恢复当成全部灰图已经解决；不要重复做 P032/P033 已归档的 100k 负载或自行声称性能提升。

**P0-L4b 首个源准确红灯与 CORS 修订（2026-10-12）：** [PR #1497 首次 CI #38212695632](https://github.com/lazyxu/xdrive/actions/runs/38212695632) 在 Desktop 源码契约测试中出现首红：已有 `media-gallery-thumbnail-http-revision-wiring.cjs` 仍只识别旧版 `cache: sourceRevision ? 'default' : 'no-cache'` 字符串，无法识别本轮保留原行为并允许强制刷新的 `cacheOverride ?? (sourceRevision ? 'default' : 'no-cache')`。新增真实 Web 重试的五个测试全部通过，故首红是测试静态合同未同步，而不是网络重试未生效；**不能因此称完整 CI 通过**。此外发现实际跨域缺陷：Go Server `cors()` 对允许的 Web Origin 暴露 ETag 等头，但未暴露 `Retry-After`，跨域浏览器无法读到 503 等待指令。现于**同一个工作提交**更新旧版源码契约测试（同时严格验证原默认缓存与 `no-store` 重试），向允许 Origin 的 CORS 暴露 `Retry-After`，新增真实 Gin CORS 测试（允许来源、非允许来源、无 Origin；HTTP503+no-store 保留）。要求重新走新精确提交完整 Web/Go API/Desktop/Windows/Final Gate，不以首红 CI 的部分绿灯代替。截图中原件与 iOS 27 真机仍需额外验证。


## P0-L5 · 视频封面终止失败与浏览器解码错误回退（2026-10-12）

提交时状态：源码确认缺口，精确单提交 PR CI / Final Gate 尚待确认。共享 XDriveMediaAsyncVideoPoster 遇到实际持久封面缺失且原视频帧无法捕获、Promise reject 时，曾始终保持进度层；已经获得 URL 的图片在真实浏览器解码失败时也无 img.onError 回退。修复仅把当前 Node ID 与 revision 的明确失败显示为既有 fallback 并停止误导性进度；更换修订后沿现有流程重新获取，旧修订错误不得隐藏新封面。无自动全量原片下载、无增加请求、无修改 Live 配对与服务端接口，保留可见窗口限流、取消、Blob URL 生命周期、共同的 Web/Mobile REST/VirtualCollection、全屏 App Frame 和 52px 标题栏。新 React mounted 回归覆盖 null/reject/img-error/过期版本及等价架构。用户截图三张灰色实况静态封面、真实 HEIC/LIVP 解码、真机 iOS27 Safari/PWA/VoiceOver 仍需要原件与真实 HTTP/CAS 证据，不声称已恢复。


## P0-L4c1 · 清除无法解码的缩略图 Blob URL 缓存（2026-10-12）

**源码确认的恢复缺口，精确 PR CI 待验，不能冒充用户三张灰色 Live Photo 原件验收。** #1497 修复 HTTP503 失败缓存，#1482 的真实浏览器 `<img onError>` 切换占位后，`XDriveMediaThumbnailScheduler` 却仍可能把同一个无法解码的 Blob URL 保留在 512 条 LRU 中。虚拟照片墙下一次返回相同 Node/修订时直接取得损坏对象 URL，无法在该应用会话中通过重新请求恢复。

**最小变更：** 保留既有可见视口六并发、业务状态、abort 与 512 条 LRU。只有实际 `<img>` 解码错误才报告原 URL，并且调度器只有在 `node_id + revision + failed_url` 三者精确匹配当前缓存项时才删除并释放该对象。错误现场本身不自动重试、不额外读取原件；下次用户访问可见缩略图才按既有 REST/Agent 请求重新获取。旧 revision / 旧 URL 事件不能误删新的封面，正常成功缓存/其它相册不清空，不能以此保证服务端实际文件字节可解码。组件通过同一 `MediaTile`、`XDriveMediaAsyncThumbnail`、Web/Mobile `XDriveMediaGalleryPage`、DataSource/VirtualCollection/Grid/Timeline 覆盖；52px App Frame、Live 语义/播放、Desktop Agent、服务器 API 不变。

**回归：** 真实共享 Scheduler 运行测试包含错误 URL、旧 revision、错 Node、缓存重新命中、准确失效、只有下一次显式 load 才重新下载、旧解码事件隔离以及无关 LRU 不受影响；真实挂载共享 React 图片 `onError` 验证精确 URL 上报与零现场重试。完整 Web/Desktop/Go/Windows/CI Final Gate 与实际三张 HEIC/LIVP 原件解码、iOS 27 Safari/PWA/VoiceOver/成对截图分别验收。性能不作无数据提升承诺。


## P0-L4c2 · 实况静态封面 DOM 回调按修订和 URL 隔离（2026-10-12）

**源码确认的独立失败路径；用户截图中三张灰图的物理原因尚未实证。** 先前共享 `XDriveMediaAsyncThumbnail` 的源 URL 与 `failed=true` 都没有当前 Node revision 的身份约束。React 更新同一 Tile 后，旧图片迟到的 `onError` 可能把新修订已经获取成功的静态封面变为灰色 fallback，旧 `onLoad` 也可能错误上报已就绪。P0-L4c1 的精确 LRU 失效仍需要这个 DOM 层防护。

**候选修复：** 将图片 URL 与失败状态归属到 `node_id:revision`，新修订渲染不得展示旧源；真实浏览器 `onLoad/onError` 仅在当前身份与当前 URL 同时匹配时才报告就绪、失败或失效原有缩略图缓存。组件卸载后旧事件无效。不改变 AbortSignal、Blob URL 所有权、已有成功缓存、失败后的零自动重试和不获取原件政策。Web/Mobile Web 共用同一个 REST DataSource 与 VirtualCollection/Grid/Timeline；Desktop 走原 Agent IPC 和同一共享组件。全屏 App Frame、52px 标题栏、iOS 27 1:1 参照、实况按住才播放均不变。

**验收：** 新增生产 React 挂载回归，覆盖旧版本失败与就绪回调不影响当前版本、同版本新 URL 不受旧错误影响、当前失败仍正确回退、卸载后不发送失效通知与零额外下载。必须在精确单工作提交上通过 Web/Desktop/Go/Windows/Final Gate 后合入。真实 LIVP/HEIC CAS 原片、用户截图三项与 iOS 27 Safari/PWA/VoiceOver 及像素成对截图仍待验，不能由组件测试推定成功。


**P0-L4c2 第一轮 CI 首红与必要修订（2026-10-12）：** [PR #1512 的 CI #38219332763](https://github.com/lazyxu/xdrive/actions/runs/38219332763) 在 Desktop 新增两个测试中分别于旧事件模拟后看到当前图片消失。真实失败由 React Test Renderer 测试夹具取得 `oldImage` TestInstance、更新后才调用 `oldImage.props.onError/onLoad` 所致；其 `.props` 指向已复用实例的**新**事件处理器，不是旧浏览器回调。因此这轮红灯不能当成“已证实生产修复仍失败”。在同一单工作提交里，改为旧修订更新前快照真实旧回调函数，同时对图片 DOM 设置 `key=[sourceIdentity, src]`，强制不同修订/URL 的原生 `img` 分离，使挂起旧浏览器事件无法落在新元素上。保留旧回调不得触发 fallback/缓存失效、正确当前错误仍失败及卸载隔离的全部严格断言，不跳过测试、不降低门禁。所有构建与测试需在重写后的**精确新 SHA** 上重新通过，旧红灯 CI 不计成功。


## P0-L6 · Live Photo 按住播放的异步状态与静态封面隔离（2026-10-12）

**范围：共享 Viewer/Preview Engine Live Photo 组件；不是用户截图中三张灰色缩略图的物理根因结论。** 在 `XDriveLivePhotoSurface` 中，旧实现先将 `playing=true` 才等待 `video.play()`，黑色不透明视频层可能在等待浏览器实际开始播放时遮住静态照片；若在 `play()` Promise 未完成时松手，`pause()` 所造成的迟到拒绝可能错误地设为“实况不可用”，后续按住无法重试。

**修复合同：** 用每次播放尝试的序号及资源 generation 围住 `play()` 的成功/失败回调，只有当前来源、当前视频元素且手指仍按住时才提交状态；成功后才显示视频画面。松手立刻回到静态封面并隐藏等待进度。`AbortError`／`NotAllowedError` 不把媒体标记成永久损坏，用户下一次显式按住可以重试。若在首次请求仍进行时再次按住，沿用原请求，不重复请求 motion URL。保留声音、按住才加载、Web/Mobile 一套 Viewer 与 Preview Engine、Desktop 共享 MUI、独立 52px App Header 和已有真实 Server/Agent 签名资源与 Range 合同。

**验收：** 新增生产组件挂载回归，检查 `play()` 待决时封面可见、松手后旧 Promise 拒绝不致死、下一次按住恢复播放、真实播放异常继续显示静态封面，以及首次请求期间松手/再次按住不会重复请求。精确 GitHub PR work SHA 的 CI/Final Gate 及 iOS 27 Safari/PWA 设备画面对比须分别确认；用户受影响三张 `.livp`/HEIC 封面仍需授权原件或 Node/HTTP/索引证据，不能声称已恢复。


### P0-L6 交付核验（2026-10-12）

[#1517](https://github.com/lazyxu/xdrive/pull/1517) 已在精确提交 `84566066` 通过完整 GitHub CI 与 `final-gate`，其中 Desktop tests 2351 passed / 1 skipped / 0 failed、新增共享 Live Photo React 挂载测试 5/5 成功；以 rebase 线性合并至 `master@46941b1e`，任务分支已确认自动删除。仅证明浏览器播放状态与回调修复，不代表用户截图中的三个原始 LIVP/HEIC 灰格已完成真实 CAS 诊断或 iOS 27 真机截图验收。

## P0-L7 · 松手后迟到的动图票据不得预加载、失败不能污染封面（2026-10-12）

**源码确认：** 上一阶段已修复 `video.play()` Promise 过期回调，但新的 `motionURL` 可以在用户松手后才抵达，此时旧共享 Live Photo 组件仍挂载 `preload="metadata"` 的播放器，导致已经没有按住意图的组件可能主动发起新的 HTTP Range 元数据读；旧 `video.onError` 无条件 `setFailed(true)`，也可把已经松手的静态封面误标“实况不可用”。若源静态封面在播放途中变成不可用，旧组件不会停止 motion/audio。

**最小修复：** 同一 `XDriveLivePhotoSurface` 仅在 `holdActive && stillReady` 时使用 metadata 预加载；松手后才到达的 URL 挂载为 `preload=none`，不主动启动新媒体预加载（该属性并不保证取消已启动的浏览器网络请求）。视频的 onError/onCanPlay/onProgress/onLoadedMetadata/onEnded 严格检查当前 DOM/video URL，onError 额外要求仍持有有效按住意图和静态封面可用。stillReady 变为 false 时立即隐藏视频并在 effect 中 pause，避免未就绪静态图下面继续播放音频；恢复 stillReady 不自动启动动图。重按复用仍有效的同一签名 motion URL，不添加额外服务器读、无限重试或视频转 Blob。

**验证边界：** 扩展既有的真实生产组件 React 挂载测试，覆盖松手后票据迟到、当前/旧视频错误与静态封面失效；静态检查仍保障一套 Web REST / Mobile Gallery 控制器与虚拟化集合、Desktop 共用 MUI、52px 全屏 App Frame。真 iOS 27 Safari/PWA 在多码率/弱网/安全区的 Network Range、影片解码与原生 1:1 截图仍需独立实机验证，用户原始灰图的 Node/HTTP/CAS 证据依然未提供。


**P0-L7 首轮精确 CI 首红与修订（2026-10-12）：** [PR #1524 第一轮 CI #38225608191](https://github.com/lazyxu/xdrive/actions/runs/38225608191) 的 Desktop tests 实际 2362 pass / 1 fail / 1 skipped；三个新增 P0-L7 生产 React mounted 回归全部通过，唯一失败是 `desktop/tests/shared-open-preview.cjs` 仍断言旧的 `preload="metadata"` 常量。这是与新的“按住时 metadata、松手后 none”产品合同冲突的过期静态夹具，不是媒体组件执行失败。仅把该断言改为明确匹配新条件式，同时保留共享 LIVP URL 释放和有界请求检查；保留单工作提交，完整 CI 必须对修订后的精确 SHA 重新运行。


## P0-L8 · 实况视频票据失败后的显式重试与旧进度隔离（2026-10-12）

**现象与源码根因（不替代三张灰色 still 原件的诊断）：** 在共用 `XDriveLivePhotoSurface` 的首次按住中，`loadMotion` 若返回 null 或 Promise reject（例如临时网络异常），旧代码会将 `failed=true`，却始终保留 `loadStartedRef.current=true`；`requestMotion` 随后因 `failed` 直接返回。即使网络恢复，用户松手后再次按住也无法恢复，不得用重新安装/刷新整个 Gallery 的方式掩盖这个状态错误。

**修复与安全边界：** 仅被当前 source/revision 证实的一次 motion-ticket 获取失败可标记为“下一次明确按住可重试”；完成的失败请求必须释放 inflight 标记。随后新按住才发起**至多一个**同一 Web REST/桌面 Agent 授权请求，不做定时、自动、递归或指数退避重试，不获取整段视频 Blob；请求中途松手与重复按住仍复用在途票据。用单源的单次请求序号围住所有进度、成功、失败回调，禁止前一次已结束的进度覆盖新请求。已获得签名 URL 的真实视频解码/编码失败仍保持终止状态，不能当成短暂票据失败无限重播；切换 Node/sourceKey 清除旧请求身份与重试权限。保持原图库 still 封面、52px 全屏 App Frame、同一 Web/Mobile Web `MediaGalleryDataSource`、共享虚拟化集合、用户授权、原有 Range 传输和音频能力。

**验收：** 扩充既有实际生产共享 React 组件挂载测试，核对首按请求失败、长按不自动重试、松手后新按恢复、null 结果恢复、旧进度回调忽略、迟到 URL 不自动播放、真正 codec 失败不重复取票据，以及 Web/Mobile Web 统一 Viewer/虚拟化/REST 传输的回归。完整源准确 GitHub CI 和 Final Gate 是合并条件；实际 iOS 27 Safari/PWA/VoiceOver 同视口截图与用户真实三张灰色 LIVP/HEIC still 原件恢复仍单独待验。服务端静态图 CAS / `MediaMetadata.index_error` / 真实缩略图 HTTP 状态仍需实证才能判定具体截图根因。


## P0-L9 · 有效 LIVP 原始 still 的缺失派生资源行只读恢复（2026-10-12）

**已定位的代码级故障路径，不等于用户截图三张灰格的物理确诊。** 既有 Server 的 `has_thumbnail` 只报告媒体格式可生成缩略图。`ensureMediaMetadata` 对当前 `node_id:revision:sha256` 且 `derived_resource_version` 最新的有效 `.livp` 直接返回现有索引，但 `currentMediaDerivedResource` 若独立的 `xd_media_derived_resources` 行缺失，直接报 NotFound。于是尚未缓存的 still 缩略图需要读取内嵌 still 时会失败为 415，原始静态图的签名 ticket 和 Motion 也可能返回 404/500；移动、宽 Web 与 Desktop 共享这个 Server 失败。

**最小恢复路径：** 仅当某个**授权 Node 的当前角色查询发生资源行缺失**，才额外读取**owner、Node、当前 revision、当前 SHA 严格匹配**、`index_state=ready` 且达到当前 LIVP 资源描述符版本的本地 canonical MediaMetadata。必须成功解析本地校验过的 `container_json`，仍需检查 still/motion **两段字节都完全落在当前原文件大小以内**，才能仅用合法原文件的嵌入式 offset/size 在本次请求中投影 read-only `MediaDerivedResource`。图库详情也仅对缺失的角色做同样的投影；现有成功路径、原媒体索引和 100k 稀疏 Gallery range **不新增扫描或常规 DB 查询**。不修改 Source/PhotoAsset、Node 或 derived-resource DB 行，不写入新的 CAS、不得以文件名/时间或第三方相册配对推断，也不重试不支持的格式。无匹配元数据、坏描述符、越界、不同账号/版本/SHA 都必须失败关闭；已存在但非法的资源行不隐式修好以免绕开原签名票据的失效检查。

**验收与限制：** 在现有真实 PostgreSQL17/Gin 全功能 media 集成用例中，先上传有效 `.livp`、确认有完整 still/motion，然后模拟丢失两个辅助资源行，要求同一授权 Node 的 Details/冷 thumbnail/直接 still+motion/短期签名 ticket+HTTP 206 Range 均正确，且整个恢复**不会重建或改写 DB/CAS**。再核对错误 Owner/Revision/SHA、损坏的描述符和原先已有的失效票据检查。此修复只是证明恢复一个确定可复现的残缺索引场景；用户截图的三张真实灰色 still 若是 CAS 不存在、HEIC 不可解码、真实网络 5xx 或文件格式不受支持，仍需受影响 Node 的本地证据。iOS 27 Safari/PWA/VoiceOver 与同设备照片墙/Viewer 逐像素 1:1 验收继续明确为未运行。


## P0-L10 · 实体 HEIC 静态帧在 LIVP 中的真实解码/冷封面验收（2026-10-12）

P0-L9 #1534 已合入并清理分支，但此前集成样本的 LIVP 静态帧为 JPEG，不能充当真实 HEIC 解码证据。本阶段建立明确来源和 MIT 许可的真实 512×512、HEVC 编码 HEIC 二进制样本，用既有图片解码器、Go Server、Gin/PostgreSQL17/CAS、签名 still/motion Range 与缓存进行端到端回归；刻意删除辅助派生资源行验证冷缩略图的只读恢复，核对浏览器可解码 JPEG 响应和版本化缓存。不使用虚假 /api/v1 fixture、第二套 Mobile API、第二个虚拟网格、自动原片批量读取或照片名猜配对。Web/Mobile Web 功能等价、共享 Gallery/VirtualCollection、52px 全屏 App Frame 和 iOS 27 1:1 验收准则不变。

**状态：新增测试候选，尚待精确 SHA CI 真执行。** CI 通过后也不等于用户截图内三张私人原图已恢复；仍需要对应 Node/revision/index_error、缩略图真实 HTTP/CAS 状态及 iOS 27 Safari/PWA/VoiceOver 原机成对截图。没有这些数据，不得作出物理 1:1 达标声明。


### P0-L10 first CI: invalid MIME-test assumption (2026-10-12)

[Exact-head CI #38236577183](https://github.com/lazyxu/xdrive/actions/runs/38236577183) on `99be030c` reached the actual `TestRealHEIC8BitThumbnailPixels` test and decoded the 512×512 real HEIC bytes; `image.DecodeConfig`, `image.Decode` and `Extract` returned valid dimensions and no errors. The assertion at `heic_real_decode_test.go:29` nonetheless required only `image/heic`, while `Extract` truthfully returned `image/heif` for this HEIF-family encoded source on the runner. Both are recognized in existing xDrive media thumbnail policy. **Invalid assertion, not a first-red product decoder regression.** No production-code change was made.

The replacement exact one-work-commit test accepts only the already supported pair `image/heic` / `image/heif`, and then requires one consistent observed MIME through persisted LIVP metadata and direct/signed still transport; it does **not** skip actual pixels, disable thumbnail/signed Range/CAS comparisons, lower dimensions, or relax the real DB fixture. Old CI cannot authorize delivery; new exact-head tests/Final Gate and physical affected-file evidence remain required.


## P0-L11 · 损坏实况缩略图派生缓存的有限检测与原格式恢复（2026-10-12）

真实 HEIC/LIVP 服务端回归 #1542 已通过 Final Gate 并线性合入；本轮独立排查发现：即使原件和已生成的 still 缩略图曾经正常，恢复/损坏的派生缓存文件仍可能只剩 JPEG 开头或 PNG 部分头。旧 Server 仅因缓存文件可打开就返回 HTTP 200，浏览器因此显示灰图，且同一修订的下次请求继续命中同一坏服务端缓存。最小修复仅在共享 Go 缩略图缓存命中路径做常数大小 JPEG/PNG 文件头尾检查，损坏条目以已有 Scheduler/原文件进行同一 keyed 派生重建，完整真实 HEIC-LIVP/PostgreSQL/CAS 回归断言重新返回有效 512px JPEG，不更改原片/关系/相册/权限。正常图片不全量解码或批量扫描 100k，也不修改唯一的 Web/Mobile Web `MediaGalleryDataSource`、虚拟网格、Viewer、52px 全屏 App Frame。

本修复不能诊断用户截图的三张具体原件；非首尾型内部损坏和浏览器过去已缓存的坏 HTTP 200 需要后续有界证据及针对性措施。真机 iOS 27 Safari/PWA/VoiceOver 视觉/手势 1:1 仍未运行，完整 GitHub 精确 SHA CI/Final Gate 是合并门禁。


### P0-L11 first exact-head CI: test fixture type mismatch

[First CI #38240121520](https://github.com/lazyxu/xdrive/actions/runs/38240121520) for work head `caa10f33` failed `go-linux-api` and `go-windows` at compilation: `media_livp_real_heic_integration_test.go:174` passed a `nodeDTO` (from `uploadTestFile`) to the existing `mediaThumbnailStorageKey` function expecting a `meta.Node`. This is **an invalid test fixture/wiring assumption, not a product behavior first-red**: the integration test did not execute its malformed-cache assertions. Production code is unchanged by this correction. The fixture now loads the current owner-scoped `meta.Node` with File preloaded from the real PostgreSQL schema before computing the same physical derivative key; all original HEIC/JPEG recovery/CAS checks remain intact. Old-head CI is not authoritative; a new exact single-commit HEAD must pass full checks and Final Gate.


## P0-L12 · 浏览器历史 HTTP200 坏封面缓存的有限恢复（2026-10-12）

P0-L9～L11 已交付，其中 #1549 通过 25 项 CI 和 Final Gate 后修复了 Server 侧已损坏缩略图缓存；但是旧浏览器可能依然缓存一份已损坏、HTTP200 的同 revision JPEG/PNG。既有 Web `mediaThumbnail` 对此正常缓存 URL 使用 `cache:default`，使虚拟列表下次显示同一图格时重复获取坏像素。P0-L12 仅在已经读到的可见缩略图响应里做固定 JPEG/PNG 头尾结构验证，明确无效才对**相同 Node/Revision、同一授权**追加至多一次 `cache:no-store`。重取失败、再次坏图或 404/409/415 应终止并回退；既有 503 有界重试后不追加第三次请求。支持 AbortSignal 立即取消，不自动加载整段图片/视频，不改变成功缓存、Web/Mobile Web 共用 REST 与虚拟化、52px 全屏 App Frame 和按住才加载实况 motion 规则。校验只覆盖显然损坏的结构，不承诺图片内部任意位损坏皆可检测。

新增以真实产品 Web API method、真实 Blob 读流配合受控 fetch 返回模拟浏览器旧坏 HTTP200 与 Server 修复后好 HTTP200，明确归类为自动化 HTTP/Blob 合同验证，不是用户原始三图、iOS 27 Safari/PWA/VoiceOver 真机或像素 1:1 验收。CI 精确 SHA 全套与 Final Gate 是合并要求；真实 iOS27 同版本参照仍要独立补证。


## P0-L13 · 实况封面真实浏览器解码失败后的下一次可见请求恢复（2026-10-12）

**首轮真实 red：** #1563 `0ceecabd` 的 Desktop 已执行测试证实，共享缩略图组件发生真实 `img.onError` 后虽然释放旧 Blob，Scheduler 并不会通知 Web API 下一次按同一 Node/revision 无缓存重取；当 HTTP200 的 JPEG/PNG 文件头尾合法但内部损坏时，P0-L12 的常数字节校验仍无法判断，用户可反复看见灰色回退。首轮测试的另外两项失败来自 Scheduler Promise 已解决而 finally 尚未退出的测试时序，属于无效夹具，已在同一单提交中修复测试而非产品逻辑。

只在已挂载的共享 `MediaTile` 实际解码错误后，为该 Node/revision 的下一次可见加载保留一次独立缓存重取权；失败事件本身零现场 GET，成功封面零额外请求，第二次仍无法解码则终止当前 Gallery Session 的该身份自动请求，滚动取消不消耗唯一机会。继续沿用相同认证 REST、同源 revision URL、既有 503 处理与 `AbortSignal`，不加载完整原片，不引入 Mobile 专用 API/业务 Controller/虚拟化组件，不修改 Desktop Agent 路由和 Live Photo 按住才加载动图的规则。

此阶段只证明源码组件、受控网络与浏览器事件合同，不冒充真实原始灰格的诊断，不冒充 iOS27 Safari/PWA/VoiceOver 真机视觉与手势 1:1。保持既有全屏 App Frame、52px 全局应用标题栏和 Web/Mobile 功能等价。


### P0-L13: amended exact-head CI static adapter test contract (2026-10-12)
[First-red test-only CI #38253097385](https://github.com/lazyxu/xdrive/actions/runs/38253097385) established missing one-shot HTTP cache bypass after true decoder failure. On the first **production-fix head** `20e441e7`, [CI #38253914544](https://github.com/lazyxu/xdrive/actions/runs/38253914544) ran all six P0-L13 source-executed scheduler/HTTP tests **PASS**, but Desktop tests were RED because five historical static source contracts still looked for the old four-argument `loadThumbnail` adapter path, rather than validating the new optional `bypassHTTPCache` parameter. These are obsolete assertion shapes, not a failed code-path test. Keep the original JWT, revision, progress, desktop Agent and sparse Gallery checks, and **strengthen** each static contract to require forwarding the fifth parameter through the one Web/Mobile Gallery port. No production-code change in this amend. A fresh exact new work-head CI/Final Gate must pass before merging; old-head partial green checks are not completion evidence. The user's three physical gray files and iOS27 Safari/PWA 1:1 remain unverified.


### P0-L13 second exact implementation CI: final obsolete test-format assertion

[Source-exact CI #38254765079](https://github.com/lazyxu/xdrive/actions/runs/38254765079) on `e82809f0` ran all six P0-L13 actual production Scheduler/Web API regressions successfully, with one remaining old Desktop-only source assertion failing: `media-gallery-thumbnail-http-revision-wiring.cjs` expected the legacy single-line `this.loader(task.nodeID,...)` shape. Production correctly invokes the SAME shared loader with a multiline `this.loader(` and the new explicit fifth `task.bypassHTTPCache || undefined` parameter. This is a stale regex/test formatting contract, not a demonstrated product regression. The replacement asserts the full exact argument order including both Progress and the one-shot cache hint while tolerating whitespace, and does not weaken revision/Agent/Web shared-wire guards. All source edits remain in ONE commit on the frozen baseline, and full CI/Final Gate are required anew. Physical affected Live photos and native iOS 27 Safari/PWA/VoiceOver remain unverified.

## P0-L14 · 普通相册和日期分组实况静态封面恢复统一（2026-10-12）

P0-L13 [#1563](https://github.com/lazyxu/xdrive/pull/1563) 已在完整精确 HEAD CI/Final Gate 通过后合入；后续核查发现：虚拟 Grid/Timeline 已使用共享 `XDriveMediaThumbnailScheduler`，但非虚拟的 `MediaTileGrid`（包含本地相册与年份/月/日分组）没有传递 Scheduler，所以不会记录真实 `img.onError` 的一次无缓存恢复机会。该代码级缺口在不同视图中造成不一致，不能推定截图中三张真实灰格一定来自此路径。

仅给已有两个非虚拟调用点接入**同一个页面级 Scheduler**，统一调用既有 `MediaTile` / `XDriveMediaAsyncThumbnail`，在父页面统一保留所有分组的 Node IDs，退出普通相册/概览时取消不再消费的缩略图；不在每个日期分组清空其他组的排队请求。100k 仍走原来的共享 `VirtualCollection`、Grid/Timeline；Web 和 Mobile Web 使用原有同一 REST/DataSource/Viewer，Desktop 不增额外 Agent 接口。无立即 onError 网络请求、无原件批量拉取、保持 52px 全屏 App Frame、按住才加载 Live motion。待专门 PR 精确 HEAD 完整 CI 验证；真实 iOS 27 的像素/手势 1:1 和用户原件仍未验收。

## P0-L15 · Viewer 胶片条实况封面解码恢复（2026-10-12）

P0-L14 [#1576](https://github.com/lazyxu/xdrive/pull/1576) 已完整 CI 和 Final Gate 通过并合入。进一步核查发现同一个 Web/Mobile Web Viewer 的 11 个邻近胶片条缩略图仍绕过 P0-L13 的 Scheduler，真实浏览器解码出错后只能回退而无法记录下一次可见加载的有限无缓存恢复。

仅在既有 `XDriveMediaGalleryFilmstrip` 复用**相同 Scheduler 实现**并限定独立 Viewer 生命周期（并发 3、缓存 32）：不允许图库滚动/日期分组的 retention 取消正在看的 Viewer 缩略图；关闭 Viewer 只取消自己的缩略图，不取消照片墙。继续保持按住才加载 Live motion、相同授权 Web/Mobile REST、Desktop Agent transport、共享单一 Viewer、虚拟化 Grid/Timeline 和 52px 全屏 App Frame。覆盖成功正常缓存、解码失败下一次可见加载最多一次无缓存恢复、修订号隔离及退出取消；不声称用户三张原件或 iOS 27 真机 1:1 已验收。
