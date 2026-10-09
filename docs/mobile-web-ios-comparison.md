# Mobile Web 与 iOS 文件、照片及预览体验对标

**日期：2026-10-09。状态：建议清单，未实施。**

本文把 Apple 官方使用手册的交互参照与 xDrive Mobile Web 的代码能力审计合并为 **77 条可评估、可排期建议**。优先级表示建议的处理顺序，不表示每项都是已复现缺陷。初始能力审计固定在 `a7eb62a`；先核对 `1f888d850fd746644bce6f9a962534e2f62805c2`，再随实际集成更新到 `b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68`，并叠加本次独立的全屏变更。已合入的交付不能继续按初始基准列为未修问题。

文档收口时进一步核对 [#1079](https://github.com/lazyxu/xdrive/pull/1079) / `0078294992938c7bb12f515a17bf8ee26c98a51c` 的文件上下文保留修复；它没有改变本报告的 77 项范围或 F09 的“待验证”性质。全屏浏览器测量对应 #1078 的集成生产树，文档冲突协调与后来源码的验证记录分开。

随后核对 `3f4d27db0b9e83579bee42e9904f3cd200572737` 已交付的拍摄/加入时间排序，将 G12 更新为“已有应优化”；剩余时区和跨排序定位工作仍保留在同一条目。本文未实现这项排序，也不改变既有图库审计的当前状态表或交付记录。

**本次实现范围仅为全屏呈现，已由 [#1078](https://github.com/lazyxu/xdrive/pull/1078) 独立修复并通过本地 renderer 验收；本文列出的后续建议未随报告实施。** 全屏修复的范围、验证环境和完成状态以 [Mobile Web](mobile-web.md) 的当前合同及交付记录为准，PR CI 与真机验收仍分别记录。本文不是推翻现有业务、架构、路由、缓存或预览协议的规范，也不把已有实现重新列为缺失。

### 初始审计与集成交付差异

| 阶段 | 固定基准或交付 | 对本报告的影响 |
| --- | --- | --- |
| 初始只读审计 | `a7eb62a023180c0bc51aa7d6ff0ad402ab36bcb3` | 保留原始能力边界；当时 mobile Inspector 未消费 `overlayZIndex` 只能形成静态候选，不能声称已复现。 |
| 属性与直接打开已交付 | [#1071](https://github.com/lazyxu/xdrive/pull/1071)，合入为 `27fe038ec87c2b2b8ca200f86977e6e8938925da` | Gallery 普通鼠标单击直达 Viewer，统一“打开 / 属性”菜单与“属性”标签；移动 Drawer 已消费 `overlayZIndex`。Viewer 打开属性时保留当前 Viewer，属性关闭冗余预览，Web 明确传 `showPreview={false}`。V01 因此改为真机完整链路验证，不再排期修复旧层级候选。 |
| 前次集成核对 | master `1f888d850fd746644bce6f9a962534e2f62805c2`，含 [#1077](https://github.com/lazyxu/xdrive/pull/1077) 的图库审计/文档协调 | 采用 [既有图库审计](gallery-ios-kfs-audit.md) 的交付记录与 backlog 作为图库候选来源；#1077 是文档交付，不表示其所有产品建议已实现。 |
| 共享属性集成基准 | `b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68`，包含 [#1076](https://github.com/lazyxu/xdrive/pull/1076) 的 FileExplorer 共享媒体属性交付 | Web / Desktop FileExplorer 已接通共享 Inspector，按需加载单个 `MediaItem`，合成文件上下文并保留普通属性回退。F09 改为跨入口完整任务验证，不再列为 adapter 接线缺口。 |
| 本次全 viewport 交付 | #1078，单一工作提交在实际冲突后重建于上述集成基准 | 全 App viewport、按需导航与 Viewer frame 已实现；集成生产树的本地 renderer 验收通过。图库 G02 的剩余范围为 App 内控件优化和真机完整任务验收，不重建 Shell。 |
| 文档冲突核对 | #1079 / `0078294992938c7bb12f515a17bf8ee26c98a51c` | FileExplorer 的附加文件信息保留 Node ID、来源和 adapter 自定义属性，值支持 React 控件；共享媒体字段仍由同一组件格式化。保留该交付原文，不重新列为新增接线任务。 |
| 排序阶段核对 | [#1082](https://github.com/lazyxu/xdrive/pull/1082) / [3f4d27db](https://github.com/lazyxu/xdrive/commit/3f4d27db0b9e83579bee42e9904f3cd200572737) | 已有 Server 拍摄/加入时间及升降序排序，Web/Desktop 共用 query，语义搜索保留相关度排序。G12 只完善统一用户时区与重新排序后的原资源定位。 |

本次集成对照了 `git diff a7eb62a origin/master -- ui/shared/src/mui/MediaGalleryInspector.tsx web/src/WebFileViewerApps.tsx ui/shared/src/mui/MediaGallery.tsx` 的实际变更，并核对 `b70ad74b` 的 FileExplorer / Web 接线及 `docs/file-explorer.md` 末尾的共享媒体属性合同。代码交付不代替 iOS Safari/Android Chrome 真机验收；#1071、#1076 的属性交付归属不计入本次全屏实现。[^E02][^E06][^E08][^E17]

## 范围与使用方式

先复用共同业务/controller 和 `ui/shared/src/mui`，再由 Web adapter 接通平台能力。下列建议不要求引入另一套移动路由、重新实现照片引擎，或一次性替换现有组件。Apple 的 Files、Photos 和 Preview 用于比较任务与交互；不要求逐像素复制其导航或视觉风格。

### 与既有图库审计共用 backlog

[Gallery iOS Photos / KFS 审计](gallery-ios-kfs-audit.md#consolidated-follow-up-backlog) 的 G01–G14 是下表“图库 Gxx”的来源；本报告中的 Gxx 是本页编号，两者不能混用。相同结果只建立一个实施任务，本报告补充移动端入口、验收和明确缺口，不另建竞争规范。已有任务的优先级、产品决策以及 Preview/性能/存储合同继续由其所属文档管理。[^E17]

| 既有图库审计条目 | 本报告对应范围 | 去重方式 |
| --- | --- | --- |
| 图库 G01 | F09 | 保留 #1071、#1076 已交付的共享媒体属性；合并 Gallery / Viewer / Files 跨入口完整任务验收。 |
| 图库 G02 | V01、G01、G02、O06、P05 | 合并全 App → Viewer → 属性 → 返回的移动验收；不重复修复旧 Info 层级。 |
| 图库 G03 | G03、G12 | 现有时间尺度/定位与排序的时区、跨排序锚点后续分开。 |
| 图库 G04 | G05、G11、G13、G14 | 现有相册管理、手动封面/顺序、固定集合及照片墙呈现按实际新增结果拆分。 |
| 图库 G05 / G06 | G10 / G21 | 筛选入口复用已有 query；真实来源路径由权威数据接口提供。 |
| 图库 G07 | G02、G15 | 工具栏布局不代替大结果集选择契约。 |
| 图库 G08 | G04、G16 | 现有属性展示/说明编辑不等于拍摄时间和位置纠正。 |
| 图库 G09 | V02、V13–V15、U08 | 先接通已有编辑，再补缩略图、对比、复制调整和导出，均消费同一配方。 |
| 图库 G10 | V08、V16、V17、U08 | 播放验收、整组资源编辑、资源检查与输出选择分开。 |
| 图库 G11 / G12 | G08、G17、G18 / G19、U08 | 已有清理与恢复流程、合并/质量复核、隐藏权限和导出元数据分别定义结果。 |
| 图库 G13 / G14 | G06–G08、G22 / G20、P01、P04 | 个体宠物是新增能力；协作、离线和接收分享不由现有集合或分享链接自动提供。 |

### 必须保留的全屏合同

- 小于共享 900 CSS px 断点时，**每个注册 Web App 的 app/main 占满整个浏览器可用动态 viewport**，包括原全局顶栏、底栏占用的区域；不能退回仅填充头尾之间的内容区。
- 全局 AppBar、常驻底部导航、Sidebar、补偿 spacer 和桌面外层 padding 不占移动布局。应用切换、账户/设置和上传下载通过按需打开的共享应用导航浮层进入。各 App 自己的工具栏可以保留在 App 内。
- Viewer 为现有工作区的 sibling overlay；背景 DOM、目录、Tabs、选择与滚动状态保留且在 Viewer 活跃时 inert。Text/PDF/Audio 保持独立程序语义，不新增目录邻居读取或上一项/下一项导航。
- 加载、失败、不支持格式时仍保留同一全屏 frame 和可达返回操作。Gallery 的媒体 chrome 显隐不应留下空白占位。
- `100dvh` 不等于所有软键盘问题已解决。本阶段保留现有 viewport metadata；不得因本报告直接打开 `viewport-fit=cover`，它需要 Viewer、登录、公共分享和安全区的共同验收。Desktop/宽 Web 保持现有 Shell。[^E01]

### 状态与优先级

| 标签 | 含义 |
| --- | --- |
| 已有应优化 | 功能、模型或基础流程已存在；建议改善移动可达性、反馈、交互或完整任务链。 |
| 共享已有Web未接通 | 共享组件及 adapter 已有业务能力，但 Web 路由入口未完整使用；优先接通，避免重复开发。 |
| 新增 | 当前审计范围内没有对应产品流程；需独立评估需求、数据与实现成本。 |
| 待验证 | 静态代码只能指出风险，或现有测试未覆盖目标环境；先实测，未失败不作推测性修复。 |
| P0 | 核心操作不可达、明确触控目标问题，或可能阻断操作的候选验证。 |
| P1 | 高频完整任务、现有能力接通、必要阅读控制与真实设备验收。 |
| P2 | 独立产品增强，如离线、接收系统分享、扫描、深度编辑和触控拖放。 |

### 已有能力基线

Files 已有触控单击打开、450 ms 长按/显式多选、52 px 行、44 px More、手机 List/Grid、桌面 columns 偏好的只读移动投影、Tabs、服务端搜索/筛选/分组、Tags、Smart Folders、收藏/最近、Trash、Properties 和版本历史。#1076 已为单选图片/视频/`.livp` 接通共享媒体属性，普通文件、目录、多选和媒体查询失败保留原属性流程。问题应具体定位到某个移动入口或任务链。[^E02][^E03][^E04]

Gallery 已有年/月/日时间线、密度、日期跳转、结构化筛选、智能相册、人物、猫/狗类型集合、地点、回忆、清理建议与批量操作；tile 的触控打开和 44 px 属性/Favorite/selection 入口已有。属性内容按“照片信息 / 整理 / 文件与资源”分区，当前标签和 Viewer 保留行为采用 #1071 交付。人物建议、命名和合并/拆分不代表已有个体宠物身份；Gallery Shift 选择的索引距离上限为 1000（含两端最多遍历 1001 项），且只消费已保留的稀疏元数据，不等于全日、全相册或全查询结果选择。[^E05][^E06][^E07][^E17]

共享预览已有原图/缩略图解码交接、1–6× 锚点缩放、pinch/pan/双击、1× swipe、Live Photo hold/release、signed Range 和 readiness。共享 Gallery Viewer 已有编辑、创作、删除及有界 filmstrip；已有非破坏配方保留原件，普通下载仍为原件。照片墙 pinch 密度、编辑后缩略图/导出、Live/RAW/Burst 整组编辑不能从这些基础能力推定已完成。[^E09][^E10][^E17]

上传已有 **8 MiB 分块、resume key 与 received chunks**；下载已有普通文件/版本、持久化归档准备及 Public Share 的浏览器下载票据。Settings、Source、Share、Properties 等 compact dialogs、共享 44 px ActionButton、窄屏 Tasks/Storage/Admin cards、Audit 虚拟化和 standalone manifest 也已存在。本文不将这些能力列为“从零补齐”。[^E11][^E12][^E13][^E14][^E15]

## 1. Files：10 条

原生 Files 的有效参照是位置层级、范围搜索、对象菜单、选择模式和批量操作，不是将其系统位置列表直接复制到网盘。[^A01][^A02][^A03]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| F01 | P0 | 已有应优化 | **接通手机结构化筛选入口。** Web 只经 `commandBarEnd` 注入 SearchFilters，而唯一渲染位置位于 compact touch 隐藏的 desktop command bar。将现有筛选、清除条件和保存搜索暴露到 compact bar/overflow 或按需面板；验收手机能组合条件、清除并保存搜索，宽屏仍复用同一引擎。 | [^E02] |
| F02 | P0 | 已有应优化 | **扩大位置 Drawer 的实际点击目标。** 当前树行 32 px、展开按钮 26×28 px、导航行 30 px。局部提升触控目标并区分展开与进入；验收深层树、长名称、展开/收起、当前目录与 Drawer 关闭，不改变已达 44/52 px 的主列表规则。 | [^E03] |
| F03 | P0 | 已有应优化 | **改善 Tabs 的触控投影。** 当前 strip 36 px、关闭 26 px、新建 34 px。让切换、关闭、新建可准确命中，多 Tabs 有溢出访问方式；验收关闭当前/非当前 Tab、恢复目录与选择、窄宽切换，不改桌面 Tab 状态模型。 | [^E03] |
| F04 | P1 | 已有应优化 | **明确搜索范围与返回路径。** 在现有搜索上显示当前位置/范围、有效条件摘要和清除入口；结果提供“打开”与“显示所在位置”。验收搜索后开文件、返回、清空关键字、切目录的状态一致，不能把已存在的服务端搜索再做一套客户端过滤。 | [^E02] |
| F05 | P1 | 已有应优化 | **使排序、分组和视图状态可理解。** 保留现有字段与分组能力，在 compact 菜单标明当前字段/方向/分组；长名称、类型和大小可查。验收 List/Grid、分组分页、文件夹顺序与窄宽往返，移动投影不写坏桌面 columns、列宽或密度偏好。 | [^E02] |
| F06 | P1 | 已有应优化 | **完善批量选择的状态说明。** 已有长按和显式选择，无需新增平行选择模型。说明选中数量及全选范围，保持滚动取消长按、鼠标实际 pointer 语义；验收跨分页选择、返回保留、退出选择和部分失败反馈，主要操作不必反复打开 More。 | [^E02][^E04] |
| F07 | P1 | 已有应优化 | **串起移动/复制/重命名与冲突处理。** 复用现有操作 controller 和 dialogs，展示目的位置、同名选择、处理中与结果；验收只读目标、父目录变化、取消、失败重试和刷新后的真实状态，避免 UI 提前宣称服务器操作完成。 | [^E04][^E13] |
| F08 | P1 | 已有应优化 | **提高标签、智能文件夹、收藏的可发现性。** 在位置面板/更多菜单提供清晰入口，展示智能规则和匹配状态；验收批量标签、保存搜索打开、规则编辑、收藏跳转，保持既有权限与字段定义。 | [^E02][^E04] |
| F09 | P0 | 待验证 | **验证已有共享属性的跨入口完整任务。** #1076 已让 FileExplorer 单选图片/视频/`.livp` 按需加载 `MediaItem` 并复用共享 Inspector，`showPreview={false}` 避免重复预览；#1079 进一步保留 Node ID、来源及 adapter 自定义属性与 React 控件。验收 Gallery/Viewer/Files 同资产媒体字段、各入口动作边界和文件上下文，覆盖换项/关闭后的迟到响应、未索引/版本变化回退、短屏操作；保留普通文件/目录/多选、版本历史和 Trash 的既有行为。 | [^E02][^E04][^E06][^E11][^E13][^E17] |
| F10 | P2 | 新增 | **按独立需求增加 touch drag/reorder。** 桌面拖放已有，手机当前以显式操作为主。若立项，复用原移动/排序业务，提供目标高亮、取消及无拖动替代入口；验收拖动不触发长按选择或页面滚动误操作，实际鼠标行为不回归。 | [^E02][^E04] |

## 2. Gallery：22 条

原生 Photos 可作为时间轴、集合、相册、媒体类型与信息面板的组织参照。xDrive 已有对应的主要数据和功能，重点应是呈现与流程优化。拍摄时间与加入时间是不同概念；缺少拍摄时间不应静默显示文件修改时间。[^A04][^A05][^A06][^A07][^A12]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| G01 | P1 | 已有应优化 | **整理导航与筛选的移动面板。** 次级 UI 仍有 raw MUI Button，Filters 仍用 Popover，不能因共享 ActionButton 已升级就假定全部可用。测量后按需改为 compact 面板，保留同一 query；验收筛选内容、清除/应用、软键盘和横屏短高度均可达。 | [^E05] |
| G02 | P1 | 已有应优化 | **压缩多选工具占用。** 当前顶部 sticky 整排动作会换行并包含相册 Select。投影为 App 内精简主操作与更多菜单/按需面板，保持选中计数；验收大量选择、相册选择、批量操作与取消，不能重新引入全局常驻底栏。 | [^E05] |
| G03 | P1 | 已有应优化 | **优化现有时间线、密度与日期跳转。** 保留年/月/日及各尺度密度记忆，改进日期定位、当前日期提示与短屏布局；验收密度变化、跳转、Viewer 返回及窄宽切换仍定位同一集合，不重建滚动宿主。排序的时区与跨排序锚点后续、照片墙 pinch 分别归 G12、G14。 | [^E05][^E16][^E17] |
| G04 | P1 | 已有应优化 | **完善现有照片属性阅读与整理路径。** 复用已分区的属性、说明/标签/人物入口和 canonical capture time；缺失数据明确显示未记录或不展示。验收长文件名、EXIF、说明文字、资源信息和保存反馈；新增拍摄时间/GPS 纠正归 G16，不把导入/修改时间写成拍摄时间。 | [^E06][^E08][^E17] |
| G05 | P1 | 已有应优化 | **检查手动相册与智能相册语义。** 将现有新建、改名、增删成员、智能规则等入口收敛到一致面板；清楚区分删除相册、移除关系和删除资源。验收规则修改、集合内搜索、相册删除后资源保留；当前 Viewer 相册上下文接线另见 V05，相册封面/手动顺序另见 G11。 | [^E05][^E06] |
| G06 | P1 | 已有应优化 | **改善人物整理及已有宠物类型入口。** 已有人物建议、review、命名、合并/拆分 adapter，宠物当前为猫/狗类型集合，不能称已识别和命名单只宠物。将现有人物纠错投影为触控流程；验收误归类、长姓名、分页、取消及 revision 冲突；个体宠物另见 G22（图库 G13）。 | [^E06][^E07][^E17] |
| G07 | P1 | 已有应优化 | **完善地点地图与列表互转。** 地点和地图已存在；优化缩放、聚类打开、返回、无位置资料及地图加载失败状态。验收 GPS 缺失、同一地点大量资源、地图/列表互转，不能用当前手机位置替代照片拍摄位置。 | [^E06][^E07] |
| G08 | P1 | 已有应优化 | **连通回忆、清理建议与既有批量操作。** 回忆、SHA-256 精确重复组和可解释连拍建议已存在；优化说明、保留选择、处理中和恢复入口。验收预览后回原组、批量处理部分失败及真实 Trash 根范围；新合并/近似质量能力归 G17/G18，不能把当前建议称为完整模糊/闭眼检测。 | [^E06][^E07][^E17] |
| G09 | P1 | 待验证 | **量测真实手机大集合浏览。** 已有 virtual grid/timeline、缓存与 100k 文档基线。先固定逻辑规模、设备、网络与冷暖缓存，量测滚动、缩略图解码、返回和内存；只对超出预算的已测瓶颈优化，不无证重写虚拟化、缓存或 Range transport。 | [^E05][^E16] |
| G10 | P1 | 已有应优化 | **让媒体类型、组合条件与搜索状态更易理解。** 复用已有 query/facets、词法与可选语义检索，显示范围、有效条件、逻辑资源数量和索引就绪/回退状态。验收类型与日期/人物/相册组合、空结果及清除；不把稀疏保留行数当总数，不仅凭后缀推断人像/慢动作；固定集合另见 G13。 | [^E05][^E06][^E17] |
| G11 | P2 | 新增 | **评估手动相册封面与自定义顺序。** 当前审计到的 album port 没有相应写入口，展示 `cover_node_id` 或人物“设封面”不能算已有相册封面设置。若立项，先确认并补齐共享业务契约，再提供明确操作；验收换封面、成员删除后的回退、分页重排和跨设备结果，不与全库拍摄时间排序混淆。 | [^E05][^E06] |
| G12 | P1 | 已有应优化 | **完善已交付排序的时区与跨排序锚点（图库 G03）。** `3f4d27db` 已接通 Server 的拍摄/加入时间、升序/降序排序及 Web/Desktop 入口，语义搜索保留相关度排序。后续增加用户选择的 IANA 时区，统一 Timeline、拍摄日期筛选边界、回忆与 Viewer 标签，并在重新排序后恢复原媒体资源锚点；验收跨午夜、夏令时、缺失原始时区和同时间项，保留现有服务端稳定排序与有界请求。 | [^E05][^E06][^E08][^E17] |
| G13 | P1 | 新增 | **固定和重排常用集合（图库 G04）。** 为相册、人物及同步文件夹提供用户选定的快捷集合与顺序，复用现有导航对象和账户偏好边界。验收 pin/unpin、重排、对象删除/无权限与切账户，返回保持原集合；不复制媒体或新增另一套 Gallery 导航模型。 | [^E05][^E06][^E17] |
| G14 | P1 | 新增 | **照片墙 pinch 密度与原始比例呈现（图库 G04）。** Viewer pinch 已有，不能等同照片墙缩放密度。复用现有各尺度密度和逻辑锚点，提供可选不裁切缩略图及显式菜单替代手势；验收捏合/滚动/选择不冲突、切比例和尺度后同一资源可定位，保持有界 DOM 与请求。 | [^E05][^E16][^E17] |
| G15 | P1 | 新增 | **扩展连续、日/月与全查询结果选择（图库 G07）。** 当前 Shift 只在索引距离 ≤1000 时遍历两端之间至多 1001 项，并只选择已保留的稀疏元数据。拖动选区、选择日期组和“全查询结果+排除项”需明确冻结/实时集合语义；验收未加载项、并发导入/删除、权限变化和部分失败，使用有界 query/snapshot 服务端契约，不把屏幕内选中项称为全选。 | [^E05][^E06][^E17] |
| G16 | P1 | 新增 | **单张/批量纠正拍摄时间与位置（图库 G08）。** 区分原始 EXIF、用户持久化覆盖和显示时区，提供预览、撤销与恢复原值。验收重新索引/升级后覆盖保留，图库、属性、筛选、回忆一致；无原始值仍明确未知，批量操作可报告冲突和部分失败，不直接改写原件。 | [^E06][^E08][^E17] |
| G17 | P1 | 新增 | **保留元数据的精确重复合并（图库 G11）。** 精确重复识别和删除已存在，新增的是合并逻辑资产时保留收藏、说明、标签、人物、相册和资源引用。验收较丰富资产不丢信息、确认/恢复与 revision 冲突；区分逻辑条目减少和 CAS 实际释放空间，不能承诺合并必然回收原件字节。 | [^E06][^E07][^E17] |
| G18 | P2 | 新增 | **独立的近似照片与质量复核（图库 G11）。** 将视觉近似、模糊/闭眼等真实信号与现有主文件 hash 重复、连拍建议分开，提供依据、比较和用户保留选择。验收不同分辨率/编辑版本、误报、资源完整性和批量部分失败，不自动删除“相似”项，不以未测模型声称质量改进。 | [^E06][^E07][^E17] |
| G19 | P1 | 新增 | **隐藏照片与跨入口权限政策（图库 G12）。** 现有隐藏人物不等于隐藏资产。先定义隐藏与受保护访问的区别，再覆盖 Gallery、搜索、地图、回忆、缩略图、Explorer、直接预览/下载及共享链接。验收各入口、账户切换和缓存一致，不把 CSS 隐藏或浏览器本地开关当访问控制。 | [^E02][^E05][^E06][^E08][^E12][^E17] |
| G20 | P2 | 新增 | **共享相册协作（图库 G14）。** 现有文件分享链接和个人相册不等于成员协作。定义所有者/成员权限、贡献/移除、撤销访问、并发变更和活动反馈，复用媒体与任务模型；验收退出相册、权限降低、删除关系与删除文件的区别，不复制相册数据库或另造共享认证。 | [^E06][^E12][^E17] |
| G21 | P1 | 新增 | **真实来源路径与“在文件夹中打开”（图库 G06）。** 已有同步文件夹浏览，但不能从 parent ID 或供应商元数据拼出权威路径。通过 owner-scoped 数据获取路径、同步来源及多来源关系，再接入现有 Explorer；验收移动/重命名、来源失效与无权限，区分拍摄设备和同步来源，当前直接子目录范围不冒充递归。 | [^E02][^E06][^E08][^E17] |
| G22 | P2 | 新增 | **个体宠物身份与人工纠正（图库 G13）。** 在已有猫/狗类型集合上新增单只宠物的持久身份、命名、候选归组和合并/拆分复核；不把类别标签显示成人名式身份。验收多只相似宠物、误分/取消关联、重建索引和隐藏偏好，区分派生建议与用户确定的决定。 | [^E06][^E07][^E17] |

## 3. Media 与 PDF：17 条

原生照片查看支持连续浏览、缩略图跳转及控件显隐；Preview 提供页码、缩略图、跳页、批注和页面编辑。这些是体验参照，具体实现仍遵守现有 Preview Engine。[^A08][^A09][^A10][^A11]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| V01 | P0 | 待验证 | **真机验证“Gallery → Viewer → 属性 → 返回”（图库 G02）。** #1071 已统一属性标签、让移动 Drawer 消费 `overlayZIndex`，并在 Viewer 属性中关闭重复预览（Web 为 `showPreview={false}`）。验收可见/可点击、短屏滚动、焦点、关闭属性后播放/缩放保留和最终返回原集合；旧 a7 层级候选已由 #1071 交付覆盖，不再列为未修缺陷。 | [^E06][^E08][^E17] |
| V02 | P1 | 共享已有Web未接通 | **接通 Web Media 编辑。** Web 的 `onOpenViewer` 走路由，绕过共享 Gallery Viewer；`saveEditRecipe/resetEditRecipe` 与编辑 dialog 已有。接线时保留单一配方/原件语义；验收编辑、恢复、失败、裁剪后缩放和返回刷新。此项只接线；图库 G09 的缩略图、对比、复制调整与输出分别归 V13–V15、U08。 | [^E06][^E08][^E10][^E17] |
| V03 | P1 | 共享已有Web未接通 | **接通已有创作入口。** 共享 Viewer 和 adapter 已具备 create/get/cancel generation。按实际支持类型暴露入口，复用任务状态；验收启动、取消、返回任务结果、失败重试与生成副本定位，不把既有创作能力重列为全新 AI 系统。 | [^E06][^E08][^E10] |
| V04 | P1 | 共享已有Web未接通 | **接通 Viewer 删除。** 共享 Viewer 已有删除及确认，Web route 尚无同等动作。复用删除/回收站业务；验收删除当前项后选择合法邻居或退出、最后一项、部分失败与回到原集合，不让旧 item metadata 留在画面。 | [^E06][^E08][^E10] |
| V05 | P1 | 共享已有Web未接通 | **补入当前相册上下文。** Web Inspector 未传 `currentAlbum`，无法显示“从当前相册移除”。从已有 route/context 传递准确相册与 revision；验收手动/智能相册、移除关系后当前项与数量更新、深链接无相册时隐藏动作，绝不把移除关系执行成文件删除。 | [^E06][^E08] |
| V06 | P1 | 共享已有Web未接通 | **复用已有有界 filmstrip。** 共享 Gallery Viewer 已有且有触控/横向滚动验收，Web route 未接通。使用已有 range/context 建立有界窗口；验收首尾可达、当前项可见、快速跳转/返回、候选刷新时 frame 不重挂载，不读完整相册。 | [^E08][^E10][^E16] |
| V07 | P1 | 已有应优化 | **补齐媒体手势和 readiness 的设备任务链。** 锚点缩放、pinch/pan、双击、1× swipe 与可用/失败状态已有。验收放大平移、回 1×、横竖屏、触控 chrome 与视频进度不抢事件，快速换项不留旧媒体；幻灯片继续使用仅 ready 且可见时计时的既有规则。 | [^E08][^E09] |
| V08 | P1 | 已有应优化 | **验证 Live Photo 的完整资源与播放生命周期。** hold/release 及签名 motion/still URL 已有。验收不同上传来源是否保留配对、按住/松开/取消、切项与后台返回、声音和 motion 失败的静态回退；明确支持的原件导出形式，不能仅因后缀给普通照片标 LIVE。 | [^E06][^E09][^E11] |
| V09 | P1 | 已有应优化 | **验证图片格式、颜色与原件回退。** 原图/缩略图解码交接已有；为实际支持的 HEIC、透明图、方向信息、超大图建立样本矩阵，保留兼容预览和原件下载。验收解码失败能退出/重试、颜色与方向正确；HEIC 支持不自动证明 HDR/RAW/空间媒体均支持。 | [^E08][^E09] |
| V10 | P1 | 已有应优化 | **整理视频播放能力与回退。** 已有 native controls，先确认系统已有速度/字幕/音轨入口再补产品入口；按能力处理内联、PiP、系统全屏和 `play()` 拒绝。验收拖动 seek、长视频 Range、切换暂停旧视频、转码失败及下载，不同时维护冲突的两套播放控制。 | [^E08][^E09][^E11] |
| V11 | P1 | 新增 | **增加必要的 PDF 阅读控制。** 基础为 iframe、`#page` 和下载，已有完整 App frame；评估页码/跳页、缩略图、目录、查找与阅读位置等专用 UI。验收多页、扫描件、密码/不支持文档、内嵌显示失败及下载；原生 PDF 可用性须实测，不以 iframe 成功加载认定全文可读。 | [^E08][^E09] |
| V12 | P2 | 新增 | **独立立项 PDF 批注、签名与编辑副本。** 在阅读稳定后评估填写、批注、页旋转/排序/拆分合并、OCR 与压缩导出；定义原件、配方或副本保存契约。验收撤销、取消、导出后再打开、可搜索文字及签名位置，不默认覆盖原件。 | [^E08][^E09] |
| V13 | P1 | 新增 | **编辑结果缩略图（图库 G09）。** 现有 Viewer/属性应用配方、网格标记已编辑；新增与配方一致的网格派生图。按原件指纹/配方版本更新缓存与缩略图，新增持久派生物遵守存储分类；验收裁剪、旋转、视频 poster 与恢复原件，旧缓存不覆盖新版本，不为全库同步生成堵塞首屏。 | [^E05][^E06][^E09][^E16][^E17] |
| V14 | P1 | 新增 | **编辑前后对比与可撤销会话（图库 G09）。** 复用已有非破坏配方和恢复入口，增加可理解的原始/当前对比及逐步撤销/重做。验收取消编辑、保存失败、重新打开、视口缩放保持与原件字节不变；不得把两套 Viewer 或独立配方存储用于对比。 | [^E06][^E09][^E10][^E17] |
| V15 | P1 | 新增 | **复制选定调整到多项媒体（图库 G09）。** 提供明确的可复制调整范围与目标预览，复用配方、资源绑定和批量任务。验收尺寸/方向差异、类型不适用、并发 revision、取消和逐项失败；当前基础配方排除的 Live/RAW/Burst 不静默接受部分修改。 | [^E05][^E06][^E10][^E17] |
| V16 | P2 | 新增 | **Live Photo 关键帧、静音与裁剪（图库 G10）。** V08 只验收已有播放；此项为整逻辑资产新增编辑意图，统一 still/poster、motion 时间和音轨。验收选帧、静音、裁剪边界、恢复与可靠配对，保留原始资源；静态/视频输出复用 U08 的导出路径，不分别编辑成损坏的资源组。 | [^E06][^E09][^E10][^E17] |
| V17 | P2 | 新增 | **RAW/JPEG 资源操作与 Burst 封面（图库 G10）。** 属性已有只读资源列表，显示角色、名称、MIME 和大小。新增范围为逐资源选择/定位、RAW/JPEG 配对检查与 Burst 封面选择，并定义逻辑资产和实际文件的操作范围；验收成对资源、封面变更/丢失、下载选择及恢复，不能用普通图像配方执行半组编辑。 | [^E06][^E09][^E17] |

## 4. Text：4 条

文本查看器已有只读 textarea、自动换行、下载、route line/column、compact 16 CSS px 文本和前 1 MiB 截断提示；以下补充不改变其独立程序语义。[^E08]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| T01 | P1 | 新增 | **提供查找与跳行入口。** 在已有 line/column 定位之上增加当前文档查找、命中计数、上一/下一处与可输入跳行；验收 CRLF、空文件、多字节字符、边界行列及被截断内容，说明搜索范围仅为已加载内容。 | [^E08] |
| T02 | P1 | 已有应优化 | **改善长文本的阅读与复制。** 保留只读、wrap 和下载，提供合适字号/行距选择并检查选择复制、长行横向滚动；验收放大文字、系统选择菜单、短屏操作条与返回，不能通过全局禁用手势破坏文本选择。 | [^E08] |
| T03 | P1 | 待验证 | **先验证编码与大文件提示。** 审计已确认 1 MiB 截断，未完整认证所有文本编码和二进制误分类。使用 UTF-8/BOM、非 UTF-8、异常字节、超长单行样本检查；必要时再加编码选择或分段读取，仍明确显示已载入范围并保留完整下载。 | [^E08][^E11] |
| T04 | P2 | 新增 | **按需求增加结构化/富文本只读呈现。** 可评估代码高亮、Markdown/JSON 视图及源文本切换；继续复用文件打开 classifier 和签名读取。验收不可信 HTML/SVG/Markdown 不能执行主应用权限下的脚本，长文档仍可操作，不悄然变成编辑器。 | [^E08][^E09] |

## 5. Audio：3 条

Audio 已有 native controls 和独立全屏 frame。增强应保持播放状态单一，并按 Safari 实际支持能力决定控制项；WebKit 已有 Media Session 与媒体控制相关能力，但具体系统面板和后台行为仍需设备验证。[^E08][^E09][^W04]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| A01 | P1 | 已有应优化 | **完善当前音频的信息与状态。** 在 native controls 周围呈现可用标题/封面、格式、时长、缓冲/错误；验收首播、seek、长标题、无元数据、不同编码和关闭行为，不伪造未读取的专辑信息。 | [^E08][^E09] |
| A02 | P1 | 新增 | **评估单文件继续播放与阅读型音频控制。** 按需求增加会话内位置恢复、固定秒数跳进/跳退、可用速度选择，避免重复系统已提供的控件。验收重新打开时需明确播放操作、不误恢复到另一文件/revision，短音频与未知时长可回退。 | [^E08][^E09] |
| A03 | P2 | 新增 | **单独评估队列和系统媒体控制。** 播放队列、Media Session 元数据/动作、跨重启恢复是新增产品范围；队列由明确用户行为建立，不让独立 Audio route 自动扫描文件夹。验收曲目切换、账户变更、锁屏/后台返回和不支持平台，不能承诺无条件后台持续播放。 | [^E08][^E09][^E15] |

## 6. Upload / Download / Share：9 条

这里的主要工作是恢复体验与真实浏览器交接，不是重写已存在的传输实现。浏览器拥有的 native download 不向网页暴露完整字节进度；页面应区分准备完成、已交给浏览器及可观测的自身传输状态。[^E11][^E12]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| U01 | P1 | 已有应优化 | **补“刷新后重新选择原文件 → 恢复上传”UX。** 当前历史 active 被置为 failed、`retryable:false`，提示重新发起；底层已有 8 MiB chunk、resume key、received chunks。让用户重新授权同一 File 后连接既有 session；验收匹配/不匹配原件、已收块复用、过期 session、取消与最终校验，不称底层不支持续传。 | [^E11] |
| U02 | P1 | 已有应优化 | **完善文件夹上传能力检测及回退。** Files/Home 已设置 `webkitdirectory`；Safari 18.4 已支持 iOS 目录选择。验收最低支持版本与当前版本、空目录/相对路径/长文件名/取消，失败时提供多文件或 ZIP 路径，不能用过时 UA 规则一律禁用 iPhone。 | [^E02][^E11][^E14] |
| U03 | P1 | 已有应优化 | **把选择、传输与服务器处理阶段说清楚。** 复用上传 controller、冲突 dialog、任务 store，显示目标位置、数量、同名策略和逐项失败；验收照片/文件选择器取消、权限改变、混合批次、重复点击、部分失败重试，不将“传完字节”等同于资源已可预览。 | [^E04][^E11][^E13] |
| U04 | P1 | 已有应优化 | **验收普通文件与版本的 native ticket 下载。** 现有方案已避免整文件 Blob；验收真实文件名/字节、GET/HEAD/Range 重试、票据到期与被撤销、后台返回。保持“已交给浏览器下载”文案，不伪造网页 100% 进度或已写入某个本地路径。 | [^E11] |
| U05 | P1 | 已有应优化 | **区分 ZIP 准备重用与下载流重试。** 持久化 archive prepare 已有；ZIP payload 断线本身不支持续传，不能写成全链路断点续传。验收大目录/多选准备、取消、复用已准备归档、票据再获取及 payload 失败说明，服务器任务状态仍为权威。 | [^E11] |
| U06 | P1 | 已有应优化 | **补真实 Public Share 下载与表单验收。** compact layout、密码/Enter 守卫与票据已有。验收错误密码后重试、到期/撤销、次数限制、文件/归档及手机系统交接；票据 HEAD/Range 重试不重复扣计数，客户端失败不自行消耗成功次数。 | [^E12][^E13] |
| U07 | P1 | 新增 | **增加“发送文件”系统分享。** 当前 `navigator.share` 仅传 title/url，不能算已有文件分享。按 `canShare({files})` 与用户激活支持，区分分享链接/文件并保留下载回退；验收取消、类型/体积受限、多文件及异步准备后用户重新点击，不保证系统必定出现“存储图像”。 | [^E12][^E11] |
| U08 | P2 | 新增 | **照片导出格式与元数据选择（图库 G09/G10/G12）。** 普通 Download 继续返回原件；另行提供真正可渲染的编辑结果、兼容副本和可选位置数据处理，消费与 Viewer 相同配方。验收像素/裁剪/方向、Live 输出、透明度和元数据；高成本导出复用可取消任务，不把缩略图冒充原件或默认覆盖源文件。 | [^E06][^E09][^E11][^E17] |
| U09 | P2 | 新增 | **评估专用拍摄与多页扫描流程。** 普通文件选择器可能已有相机选项，不能说 Web 无法拍照。新增范围是显式拍摄入口、多页预览/排序/裁边与合并 PDF；验收拒绝权限、重拍、取消、横竖屏、生成上传和原件策略，扫描/OCR 能力独立实现。 | [^E02][^E11][^E14] |

## 7. Offline 与平台能力：5 条

平台能力按特性检测和真实交互验证，版本说明用于测试矩阵，不构成永久 UA 黑名单。离线缓存、系统文件访问、浏览器下载与系统相册保存是不同能力。[^W01][^W02][^W03][^W05][^W06][^W07][^W08]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| P01 | P2 | 新增 | **评估用户主动离线 pin。** 现有 manifest 不等于已有 Service Worker 文件离线。若立项，定义可缓存文件/预览、占用、版本与清理界面，使用存储估算/持久化请求并处理清退；验收断网阅读、配额不足、退出/切账户和缓存版本，不承诺永久保留或任意路径写入。 | [^E11][^E15] |
| P02 | P1 | 已有应优化 | **验收已有安装与 standalone 体验。** manifest 的 identity/start URL/scope 已有，不重新立项生成图标和 manifest。验收实际安装、图标启动、登录后目的页、文件深链接、外链及返回；明确 normal tab 与 installed 的观测差异，不把安装等同于离线或后台备份。 | [^E15][^E01] |
| P03 | P1 | 待验证 | **建立前后台恢复的真机任务矩阵。** 传输与 Viewer 各自已有生命周期，但需检查切 App、锁屏、内存回收、网络变化、再进入后的真实表现；记录哪些继续、暂停、需重选或重新授权。U01 负责上传恢复 UI；本项先验证跨功能行为，不无证添加全局同步/取消机制。 | [^E08][^E09][^E11] |
| P04 | P2 | 新增 | **评估 incoming Share Target。** 现有向外分享链接不等于接收系统分享。先核实目标浏览器/安装模式是否暴露能力，再设计接收、选择目标目录、确认上传和取消；不支持时回退文件选择器，不承诺所有 iOS/Android 环境均可注册系统目标。 | [^E12][^E15] |
| P05 | P1 | 待验证 | **维护平台能力与视口验收矩阵。** 页面内全屏独立于任意元素 Fullscreen API；视频全屏、PiP、HEIC、目录上传、Web Share、文件选择器各自检测。验收 iOS/Android normal/installed、899/900 px、地址栏与键盘；保留已修复全 viewport 合同，不为“像原生”改变路由/历史或自动启用新 viewport metadata。 | [^E01][^E08][^E15] |

## 8. 其他 App 与可访问性：7 条

所有注册 App 继承同一全 viewport 合同；Source、Tasks、Storage、Admin 等已有 compact 表单或 cards，后续重点是填充真实数据后的任务验收。可访问性是整个任务能被理解和完成，不能仅用局部图标尺寸代表通过。Apple 的大字体标准也明确强调放大后布局与任务仍可用。[^A14]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| O01 | P1 | 已有应优化 | **减少 Home 最近/收藏打开文件的额外一步。** 当前文件 `openEntry` 进入父目录；主动作可复用已有 Open Resolver，“显示所在位置”作为副动作。验收目录、支持/不支持预览的文件、权限变化、返回和深链接，保持统一打开分类。 | [^E14][^E08] |
| O02 | P1 | 待验证 | **完成 Source 设置 round-trip。** compact settings、File Station picker、配置读取隔离/保存生命周期已修正；继续完整验收打开→修改→选择范围→保存→重开。覆盖迟到响应、失败重试、Save/Cancel、只改名称不改 scope、只读目标与真实软键盘，不再把历史已修问题列为待开发。 | [^E13] |
| O03 | P1 | 待验证 | **验收已填充 Tasks 与传输入口。** 窄屏 cards、个人/全局范围和共享 transfer popup 已有；检查多种任务、长错误、取消/重试/详情、实时更新及权限。验收按需应用导航进入、关闭/回 Viewer 不残留门户，不增设常驻全局传输栏。 | [^E01][^E11][^E14] |
| O04 | P1 | 待验证 | **验收 Storage 的手机管理任务。** inventory/history/diagnostics/local policy 已有窄屏布局；用真实长路径、容量与错误检查明细、跳转及允许的清理。保持 `docs/storage-inventory.md` 的分类/计量/安全清理语义，不因移动版重定义数据口径。 | [^E14] |
| O05 | P1 | 待验证 | **验收 Admin Users 与 Audit 的数据密集场景。** 响应式用户 cards 与 Audit 虚拟化已有。检查角色/筛选、展开长事件、分页/虚拟滚动、错误和无权限；按现有性能文档测量，不用少量 fixture 或 native CI 基线宣称 iOS 大量数据已经通过。 | [^E14][^E16] |
| O06 | P0 | 待验证 | **验收关键任务的 VoiceOver 与焦点。** 共享按钮、Drawer 和 Viewer 已有相应基础；逐步完成“打开导航→找文件→选择/操作→预览→返回”。检查名称/状态朗读、模态焦点、关闭后恢复及背景 inert，当前全屏变更的账户/设置/传输门户不能残留或自动重开。 | [^E01][^E02][^E05][^E08][^E13] |
| O07 | P1 | 待验证 | **统一检查大字体、对比度、减少动态与混合输入。** 以 200% 文字、深浅主题、reduce-motion 和实际触控/鼠标检验各 App 的主要任务；状态不只依赖颜色，自动动画可控制，按钮不被截断。明确“布局按宽度”与“触控交互按实际 pointer”的既有区别，避免统一粗暴禁用浏览器缩放。 | [^E01][^E02][^E05][^E09][^E13] |

## 排期建议与去重原则

1. **先验证/闭合 P0。** F01 是明确的入口隐藏，F02/F03 是明确的小触控目标；F09 验证 #1076 已交付的跨入口媒体属性，合并图库 G01 的验收。V01 验证 #1071 已交付的属性链路，O06 验证真实辅助功能行为；不能把旧 a7 层级候选或已交付的 adapter 重新当缺口修。全屏修复在独立工作中处理，不计入这 77 条后续建议。
2. **优先复用完成高频路径。** V02–V06 接通已有共享 Viewer/adapter；F04–F08、G01–G10 和 U01–U06 主要完善或验证现有能力。G12/G16 的排序时区和纠正使用统一数据契约，G15 的全查询选择建立明确范围，不将现有稀疏窗口改名为完整结果集。
3. **后续流程跟随既有图库 backlog。** G11–G22、V13–V17 和 U08 已映射到图库 G03–G14；按所属任务选择交付，不为两个报告重复开项。PDF/Text/Audio 增强保持独立程序语义，协作、扫描、离线和接收分享单独评估；“对标 iOS”不是一次实施全部功能的授权。
4. **保持每个结果的边界。** G02 是选择工具布局，G15 是大范围选择；G03 是已有时间尺度/定位，G12 是排序/时区；G04 是现有属性，G16 是元数据覆盖；V02 是编辑接线，V13–V15 是编辑体验/派生物，U08 是输出。上传恢复 UX 在 U01，跨功能后台检查在 P03；格式兼容预览在 V09。相关条目共用模型与任务，不产生平行实现。

## 验收与平台事实的边界

- **iPhone 任意元素系统全屏不是页面内全 viewport 的前提。** 查询时 WebKit 对应跟踪项仍为 NEW，且 2026-10-07 有更新。它说明需要能力检测，不能把所有 iPhone 版本永远判为不支持，也不能用它阻塞当前 CSS/App 全屏。[^W01]
- **iOS Safari 18.4 已支持目录上传。** 官方说明 `webkitdirectory` 可打开目录选择器；现有 xDrive 已使用该属性，应测行为与低版本回退。[^W02]
- **Safari 17 已支持 HEIC 图片。** 这不等于所有 HEIC 上传路径都保留原始编码，也不能推导 HDR/RAW/空间媒体支持。缩略图、原件与兼容副本须分开表达。[^W03]
- **Live Photo 可在 Web 播放。** Apple 提供 LivePhotosKit JS，但 xDrive 已有自己的 motion/still 与手势实现，不要求为对标而换库。Web 播放能力不保证系统照片选择器一定交付完整资源对。[^A15][^E09]
- **原生 Files 的 Keep Downloaded 与 Web 缓存不是同一保证。** WebKit 对空间、清退和持久化请求有策略，OPFS 为源私有存储，不能据此访问任意系统路径。离线 pin 必须能解释失效、重新下载和占用。[^A13][^W05][^W06]
- **后台能力避免绝对化。** Periodic Background Sync 的 WebKit 项目为 WONTFIX，但不代表每个短时后台请求都会立即中止。纯 Web 不能未经实测承诺锁屏/退出后持续照片备份；原生系统照片库及人物结果也不是现有网页可直接枚举的数据源。[^W07][^W10]
- **Web Share 需要用户激活且目标由系统决定。** 当前 URL 分享已有；File 分享与 incoming Share Target 是不同工作。文件分享支持不能证明能直接保存到系统相册，更不能保证固定系统菜单项。[^W08][^E12]
- **官方动态视口与安全区方案仍需整条链验收。** WebKit 明确指出响应式视口预设并不等同于设备真实地址栏/键盘行为；Chromium emulation、原生 CI 性能或一次本地 build 都不能替代 iOS Safari/Android Chrome 的真实任务。[^W02][^W09]
- **测试环境分开记。** 记录设备/OS/浏览器、normal/installed、真实服务器或 fixture、文件/集合规模、冷暖缓存与网络条件。至少包括窄屏竖屏、横屏、899/900 px、软键盘、安全区、真实下载/Range、后台恢复以及打开 Viewer 后返回原工作区。已通过的 100k 命名工作负载保留；新瓶颈先测量，再按各性能文档预算决定是否更改。[^E01][^E16]

## 代码证据索引

路径均相对于仓库根目录。以下文件用于定位已有能力、实际接线和待验证候选；其存在不等于所有移动设备行为已通过。本报告没有修改这些生产文件。

[^E01]: 全屏与 Shell：`docs/mobile-web.md`、`docs/web-app-runtime.md`、`web/src/App.tsx`、`ui/shared/src/mui/WorkspaceSidebar.tsx`、`ui/shared/src/mui/WorkspaceCompactNavigation.tsx`、`ui/shared/src/mui/WorkspaceContent.tsx`。
[^E02]: Files 主体与 Web 接线：`web/src/WebFileExplorer.tsx`、`ui/shared/src/mui/FileExplorer.tsx`、`ui/shared/src/mui/FileExplorerSearchFilters.tsx`、`ui/shared/src/mui/FileExplorerSearch.ts`、`docs/file-explorer.md`。关键定位：`commandBarEnd`、`compactTouch`、`touchSelectionMode`、`preferredViewMode`；末尾 One canonical media Properties content (Gallery / FileExplorer / Viewer) 段对应 #1076 已交付的 `loadMediaItem`、请求/版本校验、普通属性回退和 `showPreview={false}`。
[^E03]: Files 导航与 Tabs：`ui/shared/src/mui/FileExplorerNavigationPane.tsx`、`ui/shared/src/mui/FileExplorerTabs.tsx`。
[^E04]: Files 既有操作：`ui/shared/src/mui/FileExplorerOperationController.ts`、`ui/shared/src/mui/FileExplorerOrganizationController.ts`、`ui/shared/src/mui/FileExplorerPropertiesController.ts`、`ui/shared/src/mui/FileExplorerTrashController.tsx`、`ui/shared/src/mui/FileExplorerDeleteController.ts`、`ui/shared/src/mui/FileExplorerUploadController.ts`。
[^E05]: Gallery 交互与布局：`ui/shared/src/mui/MediaGallery.tsx`、`ui/shared/src/mui/MediaGalleryNavigation.tsx`、`ui/shared/src/mui/MediaGalleryFilters.tsx`、`ui/shared/src/mui/MediaGallerySelectionToolbar.tsx`、`ui/shared/src/mui/MediaGalleryVirtualGrid.ts`、`ui/shared/src/mui/MediaGalleryVirtualTimeline.ts`。
[^E06]: Gallery 业务与属性：`web/src/mediaGalleryAdapter.ts`、`ui/shared/src/mui/MediaGalleryAdapter.ts`、`ui/shared/src/mui/MediaGalleryDetails.tsx`、`ui/shared/src/mui/MediaGalleryInspector.tsx`。关键定位：`saveEditRecipe`、`resetEditRecipe`、`createCreativeGeneration`、`deleteItems`、`currentAlbum`；#1071 已让移动 Drawer 消费 `overlayZIndex`，不能继续按旧实现判断。
[^E07]: Gallery 已有集合：`ui/shared/src/mui/MediaGalleryPlacesMap.tsx`、`ui/shared/src/mui/MediaGalleryPlacesMapModel.ts`、`ui/shared/src/mui/MediaGalleryPets.tsx`、`ui/shared/src/mui/MediaGalleryMemories.tsx`、`ui/shared/src/mui/MediaGalleryCleanup.tsx`。
[^E08]: Web Viewer：`web/src/App.tsx`、`web/src/WebFileViewerApps.tsx`、`web/src/webViewerContext.ts`、`web/src/useWebViewerNode.ts`、`web/src/webTextViewer.ts`。关键定位：`onOpenViewer`、`WebViewerFrame`、`XDriveMediaDetailsInspector`、只读 textarea、截断提示与独立 Viewer route。
[^E09]: 共享预览引擎：`ui/shared/src/mui/MediaViewerContent.tsx`、`ui/shared/src/mui/FilePreviewSurface.tsx`、`ui/shared/src/mui/FilePreviewImage.tsx`、`ui/shared/src/mui/FilePreviewTransformedMedia.tsx`、`ui/shared/src/mui/FileOpenPreviewDialog.tsx`、`ui/shared/src/mui/usePreviewSlideshow.ts`、`docs/preview-engine.md`。
[^E10]: 共享 Gallery Viewer：`ui/shared/src/mui/MediaGalleryViewer.tsx`、`ui/shared/src/mui/MediaGalleryFilmstrip.tsx`、`ui/shared/src/mui/MediaGalleryEditDialog.tsx`、`ui/shared/src/mui/MediaGalleryCreativeDialog.tsx`。关键定位：`onSaveEditRecipe`、`onCreateCreativeGeneration`、`onDelete`、`filmstripEntries`。
[^E11]: Web 传输与下载：`web/src/api.ts`、`web/src/transfers.ts`、`ui/shared/src/mui/TransferPopover.tsx`、`ui/shared/src/mui/TransferCenter.tsx`、`docs/transfers-and-tasks.md`、`docs/file-explorer.md` 的 Durable archive preparation 段。关键定位：`chunkSize = 8 * 1024 * 1024`、`resumeKey`、`received_chunks`、刷新历史的 `retryable:false`、native download tickets，以及可重用 archive prepare 与不可续传 ZIP payload 的区分。
[^E12]: 共享与公共分享：`ui/shared/src/mui/ShareDialog.tsx`、`web/src/PublicShare.tsx`、`web/src/api.ts`。当前 `navigator.share` 参数为 title/url。
[^E13]: 既有 compact 表单与通用控件：`ui/shared/src/mui/SourceManager.tsx`、`ui/shared/src/mui/SourceManagerSettingsDialog.tsx`、`ui/shared/src/mui/SettingsDialog.tsx`、`ui/shared/src/mui/FileNameDialog.tsx`、`ui/shared/src/mui/UploadConflictDialog.tsx`、`ui/shared/src/mui/ActionButton.tsx`、`ui/shared/src/mui/AccountChrome.tsx`、`docs/mobile-web.md`。
[^E14]: 其他 App：`web/src/WebOverviewPage.tsx`、`web/src/App.tsx`、`ui/shared/src/mui/TaskCenterPage.tsx`、`ui/shared/src/mui/CloudStoragePage.tsx`、`ui/shared/src/mui/LocalStoragePage.tsx`、`web/src/AdminUsers.tsx`、`web/src/AdminAudit.tsx`、`docs/storage-inventory.md`。
[^E15]: Web 安装基础：`assets/icon/web/site.webmanifest`、`web/index.html`、`web/vite.config.ts`、`web/scripts/check-icon-assets.mjs`、`web/src/browserStorage.ts`、`docs/mobile-web.md`。
[^E16]: 既有性能与可复现验收：`docs/file-explorer-performance.md`、`docs/gallery-performance.md`、`docs/performance/2026-10-09-native-baselines.json`、`docs/performance/2026-10-09-local-baselines.json`、`desktop/scripts/file-explorer-mobile-browser.cjs`、`desktop/scripts/mobile-web-app-browser.cjs`、`docs/mobile-web.md`。
[^E17]: 集成后的图库审计与交付：`docs/gallery-ios-kfs-audit.md` 的 Scope and evidence baseline、Existing direct-open and Properties work、Consolidated follow-up backlog（图库 G01–G14）及 Delivery log；所属产品/资源合同为 `docs/gallery-product-roadmap.md`、`docs/photo-source-v2-roadmap.md`、`docs/preview-engine.md`、`docs/gallery-performance.md`、`docs/storage-inventory.md`。集成核对从 `1f888d850fd746644bce6f9a962534e2f62805c2` 更新至 `b70ad74bc8eb3435ed3f5001b28c8de0a4a1fc68`；#1071 交付 Gallery/Viewer 属性，#1076 交付 FileExplorer 共享媒体属性（具体合同见 [^E02]），#1077 交付审计文档，不代表其他提出的新产品功能已实现。

## Apple / WebKit 官方来源

检索日期均为 **2026-10-09**。Apple 的不带版本固定链接在本次查询中返回 iOS 27 手册，按钮位置、AI、星级等新增项可能随版本变化；本文使用其中明确的任务与能力描述，不将整套原生能力视为浏览器接口。WebKit 历史发布说明用于确定已交付能力；具体目标设备仍需行为检测。下面两项 W3C 文档为相关 Web API 的一手标准来源。

[^A01]: Apple，Find and view files and folders in Files on iPhone：[原文](https://support.apple.com/guide/iphone/find-and-view-files-and-folders-iphe4bff8827/ios) 。
[^A02]: Apple，Organize files and folders in Files on iPhone：[原文](https://support.apple.com/guide/iphone/organize-files-and-folders-iphab82e0798/ios) 。
[^A03]: Apple，Modify files and folders in Files on iPhone：[原文](https://support.apple.com/guide/iphone/modify-files-and-folders-iphc61044c11/ios) 。
[^A04]: Apple，Browse your photo library：[原文](https://support.apple.com/guide/iphone/browse-your-photo-library-iph7d24753a5/ios) ；Browse your photo collections：[原文](https://support.apple.com/guide/iphone/browse-your-photo-collections-iph4f36c4148/ios) 。
[^A05]: Apple，Sort and filter the photo library：[原文](https://support.apple.com/guide/iphone/iph2e66e2f2c/ios) ；Search for photos and videos：[原文](https://support.apple.com/guide/iphone/iph392d77d5f/ios) 。
[^A06]: Apple，See photo and video information：[原文](https://support.apple.com/guide/iphone/iph0edb9c18f/ios) ；Locate photos and videos by media type：[原文](https://support.apple.com/guide/iphone/iph8530ff6a2/ios) 。
[^A07]: Apple，Create and work with photo albums：[原文](https://support.apple.com/guide/iphone/iphc0fc668ab/ios) ；Filter and sort photos and videos in albums：[原文](https://support.apple.com/guide/iphone/iph9463b0c24/ios) 。
[^A08]: Apple，View photos and videos on iPhone：[原文](https://support.apple.com/guide/iphone/view-photos-and-videos-iph3d267610/ios) 。
[^A09]: Apple，Open and view PDFs and images in Preview：[原文](https://support.apple.com/guide/iphone/open-and-view-pdfs-and-images-iph7a0cdad0c/ios) 。
[^A10]: Apple，Annotate a PDF or image：[原文](https://support.apple.com/guide/iphone/iph73ca5c8e6/ios) ；Add, delete, rotate, move, or crop PDF pages：[原文](https://support.apple.com/guide/iphone/iphbf4977cff/ios) 。
[^A11]: Apple，Export or compress PDFs and images：[原文](https://support.apple.com/guide/iphone/iph61c20afe1/ios) ；Scan text and documents：[原文](https://support.apple.com/guide/iphone/scan-text-and-documents-iphd81075862/ios) 。
[^A12]: Apple，Find and name people and pets：[原文](https://support.apple.com/guide/iphone/iph9c7ee918c/ios) ；Browse photos and videos by location：[原文](https://support.apple.com/guide/iphone/iph390138909/ios) ；Share photos and videos：[原文](https://support.apple.com/guide/iphone/iphf28f17237/ios) 。
[^A13]: Apple，Transfer files from iPhone to a storage device, a server, or the cloud（含 Keep Downloaded）：[原文](https://support.apple.com/guide/iphone/iphe9aff429a/ios) 。
[^A14]: Apple，Larger Text evaluation criteria：[原文](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/larger-text-evaluation-criteria/) 。
[^A15]: Apple，LivePhotosKit JS：[原文](https://developer.apple.com/documentation/livephotoskitjs) 。
[^W01]: WebKit，Add Fullscreen API to iOS：[原文](https://bugs.webkit.org/show_bug.cgi?id=206854) 。跟踪项是状态证据，不代替所有发行版本的实机检测。
[^W02]: WebKit，Features in Safari 18.4：[原文](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) 。明确记载 iOS `webkitdirectory` 支持，并说明响应式预设与真实设备视口的差异。
[^W03]: WebKit，Features in Safari 17.0：[原文](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/) 。包含 HEIC 图片支持。
[^W04]: WebKit，New Features in Safari 15：[原文](https://webkit.org/blog/11989/new-webkit-features-in-safari-15/) ；New video policies for iOS：[原文](https://webkit.org/blog/6784/new-video-policies-for-ios/) 。用于 Web Share 文件能力、媒体控制、Media Session、内联和用户激活基础；较老文章不是当前所有后台/节电行为的认证。
[^W05]: WebKit，Updates to Storage Policy：[原文](https://webkit.org/blog/14403/updates-to-storage-policy/) 。
[^W06]: WebKit，The File System API with Origin Private File System：[原文](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/) 。只采用其源私有存储与用户可见文件系统的概念区分，不沿用旧文所有版本限制。
[^W07]: WebKit，Feature: Add support for Periodic Background Sync：[原文](https://bugs.webkit.org/show_bug.cgi?id=204117) 。WONTFIX 针对该 API，不能扩大成“所有后台网络请求绝对不可运行”。
[^W08]: W3C，Web Share API：[原文](https://www.w3.org/TR/web-share/) 。涉及 `canShare`、文件、用户激活、取消与系统分享目标。
[^W09]: WebKit，Designing Websites for iPhone X：[原文](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) ；New Features in Safari 15.4：[原文](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/) 。用于 `viewport-fit`、安全区和动态视口单位的依据；是否改变 xDrive metadata 仍遵守当前仓库合同。
[^W10]: W3C，File API：[原文](https://www.w3.org/TR/FileAPI/) 。用户选择文件与网页读取文件对象的基础，不等于读取整个原生 Photos 数据库。
