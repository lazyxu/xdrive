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
