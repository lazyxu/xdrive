# Mobile Web 与 iOS 文件、照片及预览体验对标

**日期：2026-10-09。状态：建议清单，未实施。**

本文把 Apple 官方使用手册的交互参照与 xDrive Mobile Web 的代码能力审计合并为 **61 条可评估、可排期建议**。优先级表示建议的处理顺序，不表示每项都是已复现缺陷。现状基于 `a7eb62a` 的只读能力审计，并与本次工作区的全屏变更及 `docs/mobile-web.md` 核对。

**本次实现范围仅为全屏呈现，已由独立改动处理；本文列出的后续建议未随报告实施。** 全屏修复的范围、验证环境和完成状态以 [Mobile Web](mobile-web.md) 的当前合同及交付记录为准，本文不代替该修复的验收完成声明。本文不是推翻现有业务、架构、路由、缓存或预览协议的规范，也不把已有实现重新列为缺失。

## 范围与使用方式

先复用共同业务/controller 和 `ui/shared/src/mui`，再由 Web adapter 接通平台能力。下列建议不要求引入另一套移动路由、重新实现照片引擎，或一次性替换现有组件。Apple 的 Files、Photos 和 Preview 用于比较任务与交互；不要求逐像素复制其导航或视觉风格。

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

Files 已有触控单击打开、450 ms 长按/显式多选、52 px 行、44 px More、手机 List/Grid、桌面 columns 偏好的只读移动投影、Tabs、服务端搜索/筛选/分组、Tags、Smart Folders、收藏/最近、Trash、Properties 和版本历史。问题应具体定位到某个移动入口或任务链。[^E02][^E03][^E04]

Gallery 已有年/月/日时间线、密度、日期跳转、结构化筛选、智能相册、人物、宠物、地点、回忆、清理建议与批量操作；tile 的触控打开和 44 px Info/Favorite/selection 入口已有。Info 已按“照片信息 / 整理 / 文件与资源”分区。共享预览已有原图/缩略图解码交接、1–6× 锚点缩放、pinch/pan/双击、1× swipe、Live Photo hold/release、signed Range 和 readiness。共享 Gallery Viewer 已有编辑、创作、删除及有界 filmstrip。[^E05][^E06][^E07][^E09][^E10]

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
| F09 | P1 | 已有应优化 | **验收属性、版本历史与回收站的完整链路。** 已有 compact dialogs；重点检查长路径查看、指定版本下载、恢复到变化的目录、同名处理与永久删除。验收键盘/短屏下主操作可达，恢复与永久删除语义不混淆，不虚构回收站保留期限。 | [^E04][^E11][^E13] |
| F10 | P2 | 新增 | **按独立需求增加 touch drag/reorder。** 桌面拖放已有，手机当前以显式操作为主。若立项，复用原移动/排序业务，提供目标高亮、取消及无拖动替代入口；验收拖动不触发长按选择或页面滚动误操作，实际鼠标行为不回归。 | [^E02][^E04] |

## 2. Gallery：11 条

原生 Photos 可作为时间轴、集合、相册、媒体类型与信息面板的组织参照。xDrive 已有对应的主要数据和功能，重点应是呈现与流程优化。拍摄时间与加入时间是不同概念；缺少拍摄时间不应静默显示文件修改时间。[^A04][^A05][^A06][^A07][^A12]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| G01 | P1 | 已有应优化 | **整理导航与筛选的移动面板。** 次级 UI 仍有 raw MUI Button，Filters 仍用 Popover，不能因共享 ActionButton 已升级就假定全部可用。测量后按需改为 compact 面板，保留同一 query；验收筛选内容、清除/应用、软键盘和横屏短高度均可达。 | [^E05] |
| G02 | P1 | 已有应优化 | **压缩多选工具占用。** 当前顶部 sticky 整排动作会换行并包含相册 Select。投影为 App 内精简主操作与更多菜单/按需面板，保持选中计数；验收大量选择、相册选择、批量操作与取消，不能重新引入全局常驻底栏。 | [^E05] |
| G03 | P1 | 已有应优化 | **优化时间线、密度与日期跳转。** 保留已有年/月/日和密度机制，改进日期定位、当前日期提示与控件短屏布局；验收密度变化、跳转、打开 Viewer 后返回及窄宽切换仍定位同一集合，不重建滚动宿主。 | [^E05][^E16] |
| G04 | P1 | 已有应优化 | **完善照片信息的阅读与编辑路径。** 复用已分区的 Info、说明/标签/人物入口和 canonical capture time；对缺失数据明确显示未记录或不展示。验收长文件名、EXIF、说明文字、资源信息和异步保存反馈，不把导入/修改时间写成拍摄时间。 | [^E06][^E08] |
| G05 | P1 | 已有应优化 | **检查手动相册与智能相册语义。** 将现有新建、改名、增删成员、智能规则等入口收敛到一致面板；清楚区分删除相册、移除关系和删除资源。验收规则修改、集合内搜索、相册删除后资源保留；当前 Viewer 相册上下文接线另见 V05，相册封面/手动顺序另见 G11。 | [^E05][^E06] |
| G06 | P1 | 已有应优化 | **改善人物与宠物整理流程。** 已有建议人物、review、命名、合并/拆分等 adapter，不重做识别系统。将支持的纠错与整理操作投影为触控流程；验收误归类修正、长姓名、结果分页、取消及 revision 冲突，宠物能力按实际模型显示。 | [^E06][^E07] |
| G07 | P1 | 已有应优化 | **完善地点地图与列表互转。** 地点和地图已存在；优化缩放、聚类打开、返回、无位置资料及地图加载失败状态。验收 GPS 缺失、同一地点大量资源、地图/列表互转，不能用当前手机位置替代照片拍摄位置。 | [^E06][^E07] |
| G08 | P1 | 已有应优化 | **连通回忆、清理建议与既有批量操作。** 回忆、重复组、连拍检查已存在；优化推荐依据、保留选择、处理中和撤销/回收站入口。验收从建议进入预览、返回原组、批量处理部分失败，不因“相似”自动删除文件。 | [^E06][^E07] |
| G09 | P1 | 待验证 | **量测真实手机大集合浏览。** 已有 virtual grid/timeline、缓存与 100k 文档基线。先固定逻辑规模、设备、网络与冷暖缓存，量测滚动、缩略图解码、返回和内存；只对超出预算的已测瓶颈优化，不无证重写虚拟化、缓存或 Range transport。 | [^E05][^E16] |
| G10 | P1 | 已有应优化 | **让媒体类型和组合条件更易访问。** 基于现有结构化筛选及 facets 展示照片、视频、Live Photo 等实际支持类别和数量；为常用集合提供快捷入口时复用既有状态。验收类型与日期/人物/相册组合、空结果和清除，不仅凭扩展名推断人像/慢动作等语义。 | [^E05][^E06] |
| G11 | P2 | 新增 | **评估手动相册封面与自定义顺序。** 当前审计到的 album port 没有相应写入口，展示 `cover_node_id` 或人物“设封面”不能算已有相册封面设置。若立项，先确认并补齐共享业务契约，再提供明确操作；验收换封面、成员删除后的回退、分页重排和跨设备结果，不与全库拍摄时间排序混淆。 | [^E05][^E06] |

## 3. Media 与 PDF：12 条

原生照片查看支持连续浏览、缩略图跳转及控件显隐；Preview 提供页码、缩略图、跳页、批注和页面编辑。这些是体验参照，具体实现仍遵守现有 Preview Engine。[^A08][^A09][^A10][^A11]

| 编号 | 优先级 | 现状 | 具体建议与验收要点 | 代码依据 |
| --- | --- | --- | --- | --- |
| V01 | P0 | 待验证 | **先实测移动 Info 层级候选。** Web frame 为 `zIndex:1250`，向 Inspector 传 `overlayZIndex:1251`；该 prop 仅 desktop Paper 消费，mobile Drawer 未覆盖 root z-index。实际点 Info，检查可见性、命中、滚动、关闭及焦点后再决定修复；目前不能称“已复现被遮挡”，也不自动扩大本次全屏修复。 | [^E06][^E08] |
| V02 | P1 | 共享已有Web未接通 | **接通 Web Media 编辑。** Web 的 `onOpenViewer` 走路由，绕过共享 Gallery Viewer；`saveEditRecipe/resetEditRecipe` 与编辑 dialog 已有。接线时保留单一配方/原件语义；验收编辑、恢复、失败、旋转/裁剪后缩放和返回集合刷新，不复制编辑业务。 | [^E06][^E08][^E10] |
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
| U08 | P2 | 新增 | **评估照片导出格式与元数据选择。** 明确原件、兼容副本、编辑结果和可选位置数据处理；Live Photo 静态/视频/配对导出按实际服务能力表达。验收导出后格式、方向、配对、透明度及元数据，不把预览缩略图冒充原件，也不默认改写源文件。 | [^E06][^E09][^E11] |
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

1. **先验证/闭合 P0。** F01 是明确的入口隐藏；F02/F03 是明确的小触控目标。V01 和 O06 先用实际交互验证，不把静态候选直接当缺陷修。全屏修复已在独立工作中处理，不计入这 61 条后续建议。
2. **优先复用完成 P1。** V02–V06 使用已有共享 Viewer/adapter；F04–F09、G01–G10 和 U01–U06 主要完善或验证现有能力。PDF/Text/Audio 新控制以实际高频需求选取最小范围，保留独立程序语义。
3. **P2 单独立项。** touch drag、相册呈现自定义、深度 PDF、富文本呈现、音频队列、导出、扫描、离线 pin 和 incoming Share Target 分别评估，不把“对标 iOS”当作一次实施全部功能的授权。
4. **一个条目只承担一个排期结果。** Gallery 批量工具布局在 G02，Web Viewer 删除在 V04；相册管理在 G05，Viewer 相册上下文在 V05；上传恢复 UX 在 U01，跨功能后台设备检查在 P03；格式兼容预览在 V09，导出策略在 U08。实施时按这些边界合并重复任务。

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
[^E02]: Files 主体与 Web 接线：`web/src/WebFileExplorer.tsx`、`ui/shared/src/mui/FileExplorer.tsx`、`ui/shared/src/mui/FileExplorerSearchFilters.tsx`、`ui/shared/src/mui/FileExplorerSearch.ts`、`docs/file-explorer.md`。关键定位：`commandBarEnd`、`compactTouch`、`touchSelectionMode`、`preferredViewMode`。
[^E03]: Files 导航与 Tabs：`ui/shared/src/mui/FileExplorerNavigationPane.tsx`、`ui/shared/src/mui/FileExplorerTabs.tsx`。
[^E04]: Files 既有操作：`ui/shared/src/mui/FileExplorerOperationController.ts`、`ui/shared/src/mui/FileExplorerOrganizationController.ts`、`ui/shared/src/mui/FileExplorerPropertiesController.ts`、`ui/shared/src/mui/FileExplorerTrashController.tsx`、`ui/shared/src/mui/FileExplorerDeleteController.ts`、`ui/shared/src/mui/FileExplorerUploadController.ts`。
[^E05]: Gallery 交互与布局：`ui/shared/src/mui/MediaGallery.tsx`、`ui/shared/src/mui/MediaGalleryNavigation.tsx`、`ui/shared/src/mui/MediaGalleryFilters.tsx`、`ui/shared/src/mui/MediaGallerySelectionToolbar.tsx`、`ui/shared/src/mui/MediaGalleryVirtualGrid.ts`、`ui/shared/src/mui/MediaGalleryVirtualTimeline.ts`。
[^E06]: Gallery 业务与 Info：`web/src/mediaGalleryAdapter.ts`、`ui/shared/src/mui/MediaGalleryAdapter.ts`、`ui/shared/src/mui/MediaGalleryDetails.tsx`、`ui/shared/src/mui/MediaGalleryInspector.tsx`。关键定位：`saveEditRecipe`、`resetEditRecipe`、`createCreativeGeneration`、`deleteItems`、`currentAlbum`、`overlayZIndex`。
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
