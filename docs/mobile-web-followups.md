# Mobile Web：已批准的逐项完善与验收

**2026-10-10 Mobile Files F-iOS-01A delivery:** [PR #1207](https://github.com/lazyxu/xdrive/pull/1207) passed full CI and was linearly merged as `51464cb3`; its merged branch was automatically cleaned. It implements scroll-owned titles, grouped surfaces and context-action metadata, not full native pixel/interaction acceptance.

**Merged parity follow-ups (2026-10-10):** #1211, #1215, #1222 and #1224 passed their exact-head full PR CI and merged; associated short-lived branches were deleted. Files has shared recursive Properties, Web undo/redo/history/path-copy, virtual-window kernel, saved Smart Folder editing, Web Quick Look and external browser tabs. These do not establish native iOS 27 1:1 screenshot or physical-device acceptance. #1229 typed path and #1233 external file/folder drops have since merged with full CI and obsolete branches cleaned. #1243 merged the bounded shared inline index (F-PARITY-07A); F-PARITY-07B real nested child-range disclosure is submitted for validation. Physical iOS 27 1:1 remains unverified.

**New approved F-iOS27-02 target:** [iOS 27「文件」1:1 visual and interaction benchmark](mobile-files-ios27.md) supersedes generic iOS-style comparison. Keep the full-screen App Frame, **52px App Header** (with shared Web transfer actions), Server/API/controllers and shared virtual collection/windowing. Mobile/width-Web business features must be equivalent except internal multi-file tabs. New shared-action/windowing work continues after merged F-PARITY-07A #1243; Apple-native capabilities missing from xDrive remain explicitly unimplemented, never visual impostors.


**2026-10-10 新批准 Gallery 专项：** 用户明确指定 [iOS 27「照片」1:1 Gallery 视觉与交互合同](mobile-gallery-ios27.md) 为 Mobile Web 图库的新基准。它授权 Gallery 内部展示层按 iOS 27 对齐，并覆盖此前「分类 Drawer / 年月日全部底栏」作为最终目标的旧约定；不解除全屏 App Frame + 52px 标题栏、共享后端、既有业务、生命周期/安全区/100k 规定。此项设计已批准，**代码实现与 iOS 27 真机验收未因此自动变为已完成**；原先未批准的 iOS 功能后端增强仍需单独评估。

本清单对应 2026-10-09 用户的明确指令：**只做以下项目，依次完善**。它是后续 Mobile Web 工作的范围和顺序；[iOS 对比](mobile-web-ios-comparison.md) 中未出现在这里的建议不自动进入实施范围。用户重复提出的平台矩阵合并为 M49，持续随每项变更更新。

实现继续复用 shared controller / React / MUI 与现有 Server 契约。**2026-10-09 新版 Mobile App Frame 合同：**应用根占满可用动态视口，顶部由 App 自己维护统一返回、应用导航和传输入口；不再使用遮挡内容的全局悬浮按钮，不恢复全局 AppBar/底栏。Files/Gallery 短按打开、静止长按弹出 Context Menu，Files 可拖到有效文件夹；不在每个文件或照片上叠加收藏、信息或 More 操作按钮。术语统一为“同步文件夹”和“属性”。

**新增已批准 Mobile Files 专项（Q1–Q6）：** Mobile Web Files 使用独立 iOS 风格呈现层，仅复用现有 Web API/Controller。最近/浏览/收藏三分类、首次浏览首页/再次恢复、滚动折叠全库搜索、右上角 ··· 命令、蓝色文件夹与两行列表/图标视图、全库 Server 搜索范围全部锁定。单一真正规范见 [Mobile Files](mobile-files-ios.md)。原 M01–M11 的旧 Desktop-like UI 证据属于历史阶段，不可误写成新版真机验收。

状态含义：**进行中**仅代表当前代码变更；**待完善/验收**代表用户已批准，但尚未逐项完成；**已验证**必须附真实命令、版本和结果；**真机待验**不能用 Chromium 模拟或源代码检查代替。

## 固定顺序

| ID | 已批准项目与完成条件 | 当前记录 |
| --- | --- | --- |
| M01 | 手机文件管理器只呈现一个浏览上下文，不显示 tab 栏；新建、切换、恢复标签等入口一致收起，当前目录及返回状态正确。 | 实现已验证；宽屏桌面标签状态保留，窄屏无 tab 栏及内部 tab 命令。见本页交付记录。 |
| M02 | 扩大位置面板的实际点击区域；目录树行、展开按钮和导航行容易点中，展开与进入独立。 | 实现已验证；展开/导航各自实际 44px，深层目录边缘点按通过。 |
| M03 | 接通手机结构化筛选入口，能筛选、清除条件和保存搜索。 | 实现已验证；共享筛选、单项/全部清除、保存搜索、键盘与返回焦点通过。 |
| M04 | 明确搜索范围、当前条件、清除入口；搜索结果提供打开与显示所在位置，并保留返回状态。 | 实现已验证；共享有界返回 104 项、实际 Web Search/Viewer/返回 48 项通过，含失败重试与结果变化回退。 |
| M05 | 清楚展示排序字段、方向、分组和视图状态；手机 List/Grid 与桌面列视图偏好正确衔接。 | 实现已验证；显式字段/方向/分组/有效视图，保留 Columns 偏好；手机状态条位于列表上方，实际文字无遮挡。 |
| M06 | 完善批量选择的数量、范围、退出方式和部分失败反馈，减少主要操作反复打开“更多”。 | 已由PR #1105通过完整CI并合并；共享浏览器286项通过，数量/范围/退出和真实操作反馈均有证据。 |
| M07 | 串起移动、复制、重命名、目标选择、同名冲突、取消和重试。 | 已由PR #1105通过完整CI并合并；共享操作315项、实际Web操作72项通过，含目标、冲突、取消和重试。 |
| M08 | 提高标签、智能文件夹、保存搜索、收藏的可发现性，明确规则和匹配状态。 | 已由PR #1105通过完整CI并合并；共享组织184项、实际Web组织33项/操作72项/搜索返回48项通过；整合后的完整Desktop1532项通过、零失败。 |
| M09 | 验收 Files/Gallery/Viewer 已共享的媒体属性：字段、文件上下文、迟到响应、未索引和版本变化回退。 | 已由PR #1111通过完整CI并合并为`43426b4e`，工作分支已清理；Files121、Gallery25、实际Viewer170项通过，三处字段逐项一致；修复迟到保存覆盖新目标、紧凑关闭按钮和阅读后返回焦点。完整Desktop1557项通过、零失败；同文件RAW新版本预览错配也已复现并修复。 |
| M10 | 增加触控拖动/重排，覆盖目标高亮、取消、滚动冲突；保留无需拖动的入口。 | 已由PR #1125通过完整CI37914259268，合并3ad7e73a，远端及已整合本地分支已清理；Files135、重排162、实际Web49有源版本证据，真机待验。；新版文件静止长按菜单/直接拖动见 PR #1146，真机待验。 |
| M11 | 完善手机筛选与导航面板，短横屏和键盘弹出时操作仍可达。 | 已由PR #1125通过完整CI并合并3ad7e73a；Files22、Gallery57、实际Web37通过。真实软件键盘、地址栏、安全区与读屏保持M49待验。；新版 App Frame、标题栏应用导航与传输入口见 PR #1146，真机待验。 |
| M12 | 整理图库多选工具、选中数量和相册选择器；操作保持在应用内部。 | 基础PR #1127已合并；相册短屏与成功焦点补充完成本地验收，同14项12/2→14/0、扩展35复用、实际Web同40项39/1→40/0；已由PR #1143完整CI37917029455合并0e90a0fd并清理。 |
| M13 | 完善已有年/月/日、缩略图密度、日期跳转、当前日期提示和返回定位。 | 基础PR #1132已合并75b2af90；实际年月框44px补充及日期/密度/返回同45项41/4→45/0，本地验收完成；已由PR #1143完整CI37917029455合并0e90a0fd并清理。 |
| M14 | 完善属性、EXIF、描述、标签、人物的阅读和编辑反馈，明确未知值和保存状态。 | 逐字段保存/成功/草稿反馈、44px保存与未知旋转补充完成；相同21项11/10→21/0、旋转5项3/2→5/0、整合28/28，完整Desktop1613/0；已由PR #1143完整CI37917029455合并0e90a0fd并清理。 |
| M15 | 改善人物确认、命名、合并、拆分的触控流程；保留猫/狗类型集合。 | 触控、短横屏、确认/拒绝/重试与成功焦点本地完成；相同40项17/23→40/0、同70项68/2→70/0；整合70通过，M15–M16完整PR CI/合并待完成。 |
| M16 | 完善地点地图聚合、缩放、列表联动、返回、无 GPS 和错误状态。 | 本地完成；同38项27/11→38/0，边界6通过；返回按钮同32项30/2→32/0，最终地图40通过。M15–M16完整PR CI/合并待完成；真机/原生双指/1000地点性能待验。 |
| M17 | 完善回忆、重复项、连拍建议的选择、处理、恢复和部分失败反馈。 | 待完善/验收；建议由用户确认处理。 |
| M18 | 明确媒体类型、组合条件、搜索范围、结果数量、索引准备状态和回退。 | 待完善/验收。 |
| M19 | 设置相册封面和相册内手动排序；补齐保存、恢复和跨设备一致性。 | 待完善/验收。 |
| M20 | 拍摄/加入时间与升降序排序已交付；继续统一用户时区，并在重新排序后定位原照片。 | 排序基础已交付；原照片定位 PR #1085 已合并（`66f9f2c8`），后续核验并复用；用户时区待完善。 |
| M21 | 照片墙双指调整密度、原始比例展示；与单张 Viewer 缩放分别处理。 | 待完善/验收。 |
| M22 | 拖动选择、按日/月选择、跨未加载结果选择；明确全选范围和数量。 | 待完善/验收；选择必须基于完整逻辑集合。 |
| M23 | 增加相似、模糊、闭眼等质量整理候选，由用户确认处理。 | 待完善/验收；不可把候选变成自动删除。 |
| M24 | 隐藏照片和相应权限，覆盖搜索、地图、回忆、缩略图、文件、预览、下载和分享。 | 待完善/验收；必须具有 Server 入口一致性，不能仅前端隐藏。 |
| M25 | 展示权威来源路径和同步来源，准确“在文件夹中显示”。 | 待完善/验收；不得用推测路径代替权威路径。 |
| M26 | 在猫/狗类型之外增加个体宠物身份、命名、确认、合并和拆分。 | 待完善/验收。 |
| M27 | 将共享编辑界面和编辑配方接入 Web Media Viewer，覆盖保存、恢复、失败和返回刷新。 | 待完善/验收；已有共享编辑与配方基础。 |
| M28 | 接通已有创作入口，复用生成任务的启动、取消、结果定位和失败反馈。 | 待完善/验收。 |
| M29 | 接通 Viewer 删除；成功后切换邻项或退出，处理最后一项和失败。 | 待完善/验收。 |
| M30 | 传递当前相册上下文，支持从当前相册移除，明确其与删除文件的区别。 | 待完善/验收。 |
| M31 | 复用已有缩略图胶片条，窗口有界、当前项可见并可快速跳转。 | 待完善/验收。 |
| M32 | 完善缩放、平移、双击、滑动切换、旋转、媒体就绪和手势冲突。 | 待完善/验收；保留已交付手势基础。 |
| M33 | 完善 Live Photo 按住播放、松开停止、成对资源、取消、生命周期和静态回退。 | 待完善/验收；配对必须有可靠的本地证据。 |
| M34 | 完善 HEIC、透明图片、方向、大图、色彩和原件回退兼容性。 | 待完善/验收。 |
| M35 | 完善视频控制、进度拖动、Range、画中画、全屏和自动播放拒绝反馈。 | 待完善/验收。 |
| M36 | PDF 页码跳转、缩略图、目录、查找和阅读位置恢复。 | 待完善/验收；保留单文件 Viewer 契约。 |
| M37 | 编辑后的缩略图和预览派生结果一致，正确处理配方版本和缓存更新。 | 待完善/验收。 |
| M38 | 页面刷新后重新选择同一文件，接续已有分块上传；区分过期、不匹配、取消和恢复。 | 待完善/验收；已有确定性 resume_key 和分块校验基础。 |
| M39 | 目录上传能力检测，覆盖相对路径、空目录、长文件名、取消、多文件/ZIP 回退。 | 待完善/验收；不得声称普通文件选择器能保留空目录。 |
| M40 | 区分文件选择、传输、Server 处理阶段，展示目标、冲突和部分失败。 | 待完善/验收。 |
| M41 | 验收普通文件与版本下载的文件名、实际字节、Range、票据过期和撤销。 | 待完善/验收；已有票据及 Range 基础。 |
| M42 | 明确 ZIP 准备结果复用与下载流重试，分别展示准备进度和下载状态。 | 待完善/验收；准备 manifest 与 ZIP 下载流不是同一生命周期。 |
| M43 | 完善公开分享密码、有效期、撤销、计数和真实下载。 | 待完善/验收。 |
| M44 | 系统“分享文件”：分享真实文件字节、能力检测、取消与不支持时回退。 | 待完善/验收；已有链接分享不等于文件字节分享。 |
| M45 | 支持文件夹、照片、视频、实况、相册、智能文件夹分享。 | 待完善/验收。 |
| M46 | 完善安装模式：图标启动、登录后目的页、文件深链接、外链和返回。 | 待完善/验收。 |
| M47 | 建立切 App、锁屏、内存回收、网络变化、重新进入的传输与 Viewer 恢复矩阵。 | 待完善/验收；与 M49 一起维护。 |
| M48 | 评估接收系统分享：支持检测、目标选择、上传确认、取消和文件选择器回退。 | 待评估/验收；能力可用才呈现对应入口。 |
| M49 | 维护 iOS/Android、普通标签页/安装模式的视口、地址栏、键盘、安全区和平台能力矩阵。 | 维护规范与能力证据见[平台矩阵](mobile-web-platform-matrix.md)；真实设备结果保持待验。 |
| M50 | 主页最近/收藏的主要文件操作复用统一打开规则，并保留“显示所在文件夹”。 | 待完善/验收。 |
| M51 | 同步文件夹设置的打开、编辑、范围选择、保存、重开，覆盖长响应、错误和键盘。 | 待完善/验收。 |
| M52 | 用真实数据验收任务与传输浮层的长错误、取消、重试、角色权限及打开/关闭生命周期。 | 待完善/验收。 |
| M53 | 存储页面真实路径、容量、错误、详情和清理，保持统一容量口径。 | 待完善/验收。 |
| M54 | 用户管理和审计日志的数据密集场景：角色、筛选、长事件、虚拟滚动、错误和无权限。 | 待完善/验收。 |
| M55 | VoiceOver 完整任务：导航、找文件、选择/操作、预览、返回；朗读、模态焦点、恢复和背景不可交互。 | 真机待验；DOM/focus 自动化只能提供部分证据。 |
| M56 | 200% 文字、对比度、浅/深色、减少动画、混合输入和页面缩放。 | 待完善/验收。 |

## 平台能力与恢复矩阵（M47/M49/M55/M56）

详细的采样字段、平台能力检测边界和真机验收步骤以[平台矩阵](mobile-web-platform-matrix.md)为准。以下仅作环境索引，不继承其他设备/显示模式的结果。

每次记录必须包含日期、代码 commit、部署/fixture、设备型号、OS 版本、浏览器版本、显示模式、真实/模拟、数据规模、步骤、预期、实际和证据。未知能力保持“待检测/待验”；使用实际 feature detection，不能仅根据 UA 判定支持。

| 环境 | 视口/地址栏/旋转 | 键盘/安全区 | 传输/Viewer 恢复 | 文件系统/分享/媒体能力 | 辅助功能 |
| --- | --- | --- | --- | --- | --- |
| iOS Safari 普通标签页 | 真机待验：地址栏展开/收起、短横屏、缩放 | 真机待验：搜索/重命名/密码/目标选择及 Home indicator | 真机待验：切 App、锁屏、内存回收、离线/重连 | 运行时检测目录选择、文件分享、Range、原生全屏/PiP、格式解码；真实文件验收待完成 | VoiceOver 全链路、200% 文字、减少动画：真机待验 |
| iOS 主屏幕安装模式 | 真机待验：图标启动、独立窗口、deep link、返回 | 真机待验：顶部/底部安全区、键盘关闭后恢复 | 真机待验：重新进入目的页和任务/当前媒体状态 | 与普通标签页分别记录，不继承其结果 | 真机待验 |
| Android Chrome 普通标签页 | 真机待验：地址栏、旋转、短横屏和页面缩放 | 真机待验：键盘 resize/overlay、手势导航区 | 真机待验：后台、锁屏、进程回收、网络切换 | 运行时检测目录选择、文件分享、分享接收、PiP/全屏、下载能力 | TalkBack、混合输入、文字缩放：真机待验 |
| Android 安装模式 | 真机待验：启动页、返回栈、外链和文件 deep link | 真机待验：独立窗口、键盘与系统栏 | 真机待验：后台恢复/进程丢失/重新选择上传源文件 | 分享接收单独评估；不把 manifest 声明当作端到端交付 | 真机待验 |
| Chromium 桌面触控模拟 | 自动化使用 360×780、390×844、430×932、844×390、899×700、900×700，并检查同一 main/scroll host | 可测试缩短 viewport 与焦点可达；不能证明软件键盘或物理安全区 | 可测试页面生命周期/断网模拟；不能证明 OS 后台限制 | fixture/浏览器 API 测试与真实 Server 字节测试分列 | 可测 DOM、焦点、inert、200% 字体；不能宣称 VoiceOver/TalkBack 通过 |

### 每项验收必须覆盖的状态

- **视口：** portrait、short landscape、地址栏变化、899→900→899、键盘打开/关闭、200% 文字、页面缩放；只允许需要的内部滚动。
- **操作：** 加载、空、成功、部分失败、完全失败、主动取消、重试；长名字/长错误可以阅读，主要动作可以触及。
- **生命周期：** 层叠面板关闭、返回恢复、当前目标变化、会话变化、后台/前台、断网/重连；意图取消不显示伪失败，迟到结果不得覆盖新目标。
- **辅助功能：** 名称/角色/状态、可见焦点、模态焦点限制、背景不可交互、关闭后焦点恢复、完整任务朗读；真实读屏和浏览器检查分别记录。

### M15–M16：人物触控与地点地图（2026-10-09）

**本地整合验收完成，完整 PR CI 与线性合并待完成。** 固定父版本为 M12–M14 的合并点 `0e90a0fd`。M15、M16 分别在已有依赖上实现，整合仅使用各自的完整三方补丁；保留已合并的默认图库请求取消、权威位置接口和只读副本整理计划。生产检查点为 `18b5f248`。

M15 将人物确认、命名、合并、拆分的实际控件补足窄屏44px，并整理现有四个弹窗的固定关闭、滚动内容和操作区。844×200／200%文字下，字段、候选、长错误和确认均可通过真实滚动触及。相同40项从17通过／23失败到40／0；完整成功、拒绝、保留草稿和同参数重试均验证原人物ID、文件ID和版本。新建人物与归入已有的人物成功后，原建议卡消失会使焦点落到BODY；新增两项先复现后，通过一次成功焦点交接回到仍挂载的当前标题，同70项68／2→70／0。取消和错误保留原入口，合并／拆分成功仍回到原按钮；现有猫／狗类型集合保留。

M16 复用现有触控拖动工具，解决精细指针点击标记被过早捕获吞掉的问题；原生拖动、Escape停止、重置和键盘操作保留。聚合数字使用真实主题颜色，缩放／重置窄屏至少44px。地图的纬度、经度、缩放值留在现有图库组件中，进入地点后返回恢复刚才视角。Web和Desktop上限与已有Server／Agent的1000一致，概览仍取24项；加载、失败与成功无GPS分别显示。相同38项27／11→38／0，实际两端边界6项通过。整合额外复现地点返回按钮34px：相同32项30／2，补入现有`activePlaceID`条件后最终40／40。

最终共享人物70、地图40及实际构建Web相册操作40全部通过，零意外浏览器／请求错误。完整Desktop **1622通过／0失败／1项既有可选跳过**，完整汇总已核对；类型检查、Web lint/build通过。精确源文件／fixture／构建哈希、相同首次失败、原始断言及独立复查见[人物与地点证据](validation/mobile-gallery-people-places-2026-10-09.json)。M17回忆、恢复和整理反馈在下一项继续；本节不提前宣称交付。

M49.V13–V14分别维护上述流程。真实iOS／Android普通标签页／安装模式、软件键盘、地址栏、安全区、VoiceOver／TalkBack及原生双指手势仍为 **not-run**；浏览器结果不表示这些平台已经通过，也不表示1000地点性能已验收。

### M12–M14：相册选择、日期触控与属性反馈（2026-10-09）

**已由[PR #1143](https://github.com/lazyxu/xdrive/pull/1143)通过完整CI `37917029455`，线性合并为`0e90a0fd`，远端与已整合本地工作分支均已清理。** M10–M11 已由 [PR #1125](https://github.com/lazyxu/xdrive/pull/1125) 的完整 CI `37914259268` 通过并合并为 `3ad7e73a`，远端工作分支已清理。本批固定在该合并点，只叠加 M12/M13/M14 自己的补充，不重复实现已合并基础。最终生产检查点为 `c55d5ad1`，随后仅增加文档与证据。

M12 在现有相册选择器中整理固定关闭、搜索、候选、错误和确认操作的滚动关系。844×200／200% 文字时，原本被压到0px的列表行恢复为可滚动到的56px；相同14项12通过/2失败→14/0，扩展35项使用完全相同的已记录依赖复用。实际 Web 同40项39/1→40/0：取消回到“加入相册”；加入成功并清空选择后，焦点回到仍挂载的“选择”。403失败保留选择和草稿，显式重试发送同一组三个文件ID及相册版本。整合期间曾错误挂接焦点ref，实际同40检查发现后，已恢复经复查的持久按钮和原effect位置。

M13 保留已交付的年/月/日、各尺度密度、日索引、当前日期提示及返回锚点，仅将窄于900px的年月选择框实际命中区由40px补足至44px；900px仍为40px。最终同45项在合并父版本上41/4→45/0，覆盖原生上下边缘点按、Escape返回、空白日期最近匹配、日期提示和原锚点返回。新主线明确的`fold_duplicates:false`只需要测试契约适配；不因该测试比较错误改变产品行为。

M14 的描述、标签和人物各自显示正在保存、已保存和未保存更改。服务端返回的规范化值及随后父组件更新保留已保存提示；新编辑、当前目标变化和错误保留既有作用域规则。三个保存按钮在窄屏分别至少44×44px，900px原密度不变。视频旋转优先使用已记录的有限数值，再读现有video元数据；两处均缺失时显示“未记录”，明确记录的0°仍保留。相同21项11/10→21/0，旋转同5项3/2→5/0；最终扩展28项全部通过，含844×390／200%文字下原生滚动读到保存状态。

最终构建的实际 Web 相册40项、面板37项及共享属性28项均通过，零意外请求/浏览器错误。日期45、共享面板57、相册35明确复用其相同源码与测试记录。完整 Desktop **1613通过／0失败／1项既有可选跳过**；完整结果摘要已显式核对，类型检查、Web lint/build均通过。[整合证据](validation/mobile-gallery-selection-timeline-properties-2026-10-09.json)与[保留的M12/M13首次失败](validation/mobile-gallery-controls-m10-m13-2026-10-09.json)记录真实命令、完整断言、独立复查、源码和构建哈希，数量不相加。

M49.V10–V12 继续区分实际渲染与真机结果。iOS/Android 普通标签页/安装模式、真实软件键盘、地址栏、安全区、VoiceOver/TalkBack均为 **not-run**。这里的逻辑360项日期样本不表示100k渲染或真机Viewer往返已经验收。

## 交付记录

第一批 M01–M03 的固定基线为 `6d48604dd9948cd7d14ceb00a4921d282155a247`。实现已通过共享组件行为、实际矩形/边缘点按、键盘、响应式焦点和完整应用视口验证；由 [PR #1092](https://github.com/lazyxu/xdrive/pull/1092) 通过完整 PR CI（run `37887795483`）并合并为 `daf35bce`，原远端分支已清理。详细命令、首次失败与修复记录见 [Mobile Web](mobile-web.md#m01m03-renderer-delivery--2026-10-09)，原始计数及源文件哈希见[证据 JSON](validation/mobile-files-controls-2026-10-09.json)。

- **M01：** 900 CSS px 以下隐藏 tab 栏并禁用内部 tab 快捷键、中键和菜单入口；保留宽屏标签状态、当前 crumbs 和同一滚动宿主。
- **M02：** 展开、进入和辅助操作分别至少 44px；实际按钮/轨道同步扩大，限制深层缩进，保留独立操作和滚动。
- **M03：** 宽度决定可达的单一筛选入口；显示当前值，单项/全部清除和保存搜索可达，嵌套菜单正确关闭，Enter/空格不再触发背景文件，宽度变化后恢复焦点。

第二批 M04–M05 已由 [PR #1093](https://github.com/lazyxu/xdrive/pull/1093) 通过完整 PR CI（run `37891182368`），线性合并为 `b2e1d8d1`，远端工作分支已清理。实现和验收记录见 [Mobile Web](mobile-web.md#m04m05-search-return-and-ordering--2026-10-09) 与[证据 JSON](validation/mobile-files-search-return-2026-10-09.json)。在 `daf35bce` 基线上，最终共享搜索返回 104 项、控件 174 项、Files 54 项、实际 Web Search/Viewer 48 项和完整 App 视口 901 项均通过；Desktop 完整测试 1,327 项通过、零失败、保留一项既有可选性能跳过。实际 App 发现并修复了悬浮导航遮挡数量/排序文字，未增加全局底栏或占位。

第三批M06–M08已由[PR #1105](https://github.com/lazyxu/xdrive/pull/1105)通过完整PR CI（run `37899346096`），线性合并为`eff2cd92`，远端及本地工作分支已清理。交付前接到`31defbde`时，已保留新的Organization意图区分/首帧隔离、Live Photo属性、相册和缩略图能力，并重跑受影响的实际流程及完整测试；详见[M08证据](validation/mobile-files-organization-2026-10-09.json)的`latestAcceptedIntegration`。M09已由[PR #1111](https://github.com/lazyxu/xdrive/pull/1111)通过完整PR CI（run `37902685808`，含PostgreSQL的`go-linux-api`），线性合并为`43426b4e`；远端及本地工作分支已清理。精确源文件、首次失败、相同检查转绿及边界见[M09证据](validation/mobile-shared-properties-2026-10-09.json)，随后按表推进M10。用户重复提出的M49作为持续维护规范随每批更新；没有把模拟浏览器结果写成真机通过。

## 2026-10-10 Mobile Files F-PARITY-07B handoff

F-PARITY-07A [PR #1243](https://github.com/lazyxu/xdrive/pull/1243) is merged, full CI [#38016476708](https://github.com/lazyxu/xdrive/actions/runs/38016476708) passed, branch cleaned. The current F-PARITY-07B **implementation submitted, exact-head PR CI still required** covers separate 44px folder disclosure, the shared sparse index, real child `api.listRange` with AbortSignal and bounded cache, child Node identity participation in ordinary shared FileExplorer actions, and one mounted Mobile scroll/thumbnail owner. This **does not** establish real iOS 27 1:1 or the 100k physical browser acceptance. The ungrouped List only has inline disclosure; grouped List requires an additional measured interaction pass. Desktop/wide Web are not given a forked transport or new file-business controller. See [iOS 27 Files](mobile-files-ios27.md).


## 2026-10-10 F-PARITY-07C · grouped Files List continuation

**Prerequisite merged:** F-PARITY-07B [PR #1249](https://github.com/lazyxu/xdrive/pull/1249), exact-head [CI #38018768047](https://github.com/lazyxu/xdrive/actions/runs/38018768047) success, linear merge `19e81621`, branch removed. F-PARITY-07C **implementation prepared / PR CI pending**: Mobile Files extends its existing shared run-length folder disclosure to `type/modified/size` grouped List without client regrouping, reusing Server root group-index boundaries, the same Web REST adapter, bounded virtual child windows and one scroll owner. Static/mounted behavior and 100k logical index tests are delivery evidence only after executed; real 10k/100k browser measurements and iOS 27 hardware screenshot/VoiceOver acceptance remain not run. Keep dynamic full App Frame, separate 52px title header, Web/Desktop shared backend and only the Mobile internal multi-tab exception.

## 2026-10-10 F-PARITY-07D · Nested Copy Paths parity

F-PARITY-07C grouped List disclosure is **merged** via [PR #1264](https://github.com/lazyxu/xdrive/pull/1264), full exact-head [CI #38020921422](https://github.com/lazyxu/xdrive/actions/runs/38020921422) green including Final Gate, linear merge `f6b0bf66`; branch cleaned. Audit of the mounted child-operation path found that Web's Copy Paths adapter used only browsing-root crumbs for an expanded nested file. F-PARITY-07D **staged, not yet CI-validated** uses the existing child owner/ancestor breadcrumbs with the same shared path utility. Search paths and Desktop semantics stay unchanged; real iOS 27 physical parity and 100k end-to-end browser measurements remain open.

## 2026-10-10 F-PARITY-07E · selected Node retention during 10k/100k scroll

**Test-first implementation pending full PR CI.** The existing Mobile Files Select map outlives visible parent/child virtual pages, but shared Web node resolution formerly used only the currently loaded `nodeByID` map. Local isolated reproducer: select nested ID 41 at revision 7, evict its first 100k range page, then the shared mutation validator returns incomplete Node information. The fix pins only at most 200 real selected Node IDs/revisions + owner breadcrumbs in the existing Web workspace, not 100k pages; existing root/Search interaction retention is reused. Mounted Select/Complete, owner-scope reset and real shared-range/operation tests are the PR gate, with full CI/Final Gate before merge. iOS 27 Safari screenshots, 1:1 pixel diffs, VoiceOver/keyboard/soft-safe areas and real 10k/100k browser resource measurements still lack physical evidence.


## 2026-10-10 F-PARITY-07F-A · >200 Select All wide/Mobile parity

**Merged:** [PR #1285](https://github.com/lazyxu/xdrive/pull/1285), exact-head [CI #38031123253](https://github.com/lazyxu/xdrive/actions/runs/38031123253) succeeded, linear merge `34036439`, branch cleaned. Original mismatch: wide Web batches authoritative root/Search `VirtualCollection.collectRange` for 10k/100k logical selection with cancel and progress, but Mobile refused `totalCount > 200` before requesting anything. F-PARITY-07F-A switches Mobile to the same 200-entry virtual range primitive with atomic commit, progress, cancel-generation/scope guard and invalid/duplicate-page rejection. Shared operation limits remain 200 for mutations and 1000 for downloads, with bounded actionable selected Node retention. User-visible cancellation suppresses further page requests and late completion but this phase does not certify immediate abort of the current Server HTTP request. Full 375/390/899/900px paired real Server, 10k/100k browser perf and authentic iOS 27 device pixel/VoiceOver acceptance are not run.


## 2026-10-10 · F-PARITY-07F-B Mobile selection-action state parity

**Merged:** [PR #1292](https://github.com/lazyxu/xdrive/pull/1292), successful exact-head [CI #38032617100](https://github.com/lazyxu/xdrive/actions/runs/38032617100) including Final Gate; linear master commit `38e2b5e4` and branch verified cleaned. Mobile's selected Copy/Move/Delete, Cut/Copy To and Download/Manage Tags controls reuse the same Web `getSelectionActionDisabledReason` used by wide FileExplorer. A 257-item Select All shows disabled over-200 mutations, permits under-1000 download, and displays a shared reason; direct disabled callbacks are guarded. No Mobile mutation API/controller is added. The merged F-PARITY-07F-A [PR #1285](https://github.com/lazyxu/xdrive/pull/1285) had successful exact-head CI #38031123253 and its branch was deleted. Its full exact-head CI and Final Gate succeeded; physical iOS 27 device and real 10k/100k browser metrics are still not run. In-flight Select All HTTP abort remains a separate unimplemented verification target.


## 2026-10-10 · F-PARITY-07F-C Mobile multi-item Properties

**Merged:** [PR #1297](https://github.com/lazyxu/xdrive/pull/1297), exact-head [CI #38034184362](https://github.com/lazyxu/xdrive/actions/runs/38034184362) passed Web/Desktop (2006 tests passed, zero failed, one skipped), Go/API, artifacts and Final Gate; linear master commit `dccebda0`, temporary branch verified removed. Wide Web has selected multi-file/folder Properties but Mobile previously exposed only single-item Properties. The Mobile selection More menu now passes selected Node snapshots to the existing shared Properties Dialog and cancellable Server stats controller; mixed folders use Web's original `filePropertiesStats`, pure files sum locally. Owner, folder, Search, Trash and collection changes close the inspector and abort old requests; single-item media Inspector, selected item state, App Frame/52px header/virtualization and shared backend remain intact. Mounted tests exercise real selected IDs, counts/size, no redundant file-only HTTP call, abort and stale completion. Real wide/mobile Server error parity, iOS 27 screenshots and 10k/100k browser measurements remain separately pending.


## 2026-10-10 F-iOS27-08A · explicit Files Icons/List options in More

**Merged:** [PR #1305](https://github.com/lazyxu/xdrive/pull/1305), exact-head [CI #38036163945](https://github.com/lazyxu/xdrive/actions/runs/38036163945) with green Final Gate and linear merge `eed0ed80`, temporary branch cleared. Real iOS 27 screenshots and physical accessibility remain unverified. Official iOS 27 Files More displays separate Icons and List choices. Mobile now groups two genuine touch-ready (≥44px) `menuitemradio` options with icons, selection checkmarks and one unchanged authenticated virtual scroll owner. Clicking the active mode preserves scroll; switching modes changes only Mobile view preference and persists it without changing wide-Web Columns, Server sort, backend, or tabs. Existing grouped/sort commands continue to call the original Web `onSortChange/onGroupingChange` and retain 44px targets. Mounted tests cover menu state, persistence and backend/view separation; exact-head CI/Final Gate required before merge. Authentic iOS 27 screenshot/pixel diffs, VoiceOver, physical Safari/installed mode, real Web/Mobile permission matrix and 10k/100k request/abort measurements remain unverified.


## 2026-10-10 F-iOS27-08B · Mobile file-row pitch and collection context parity

**Merged:** [PR #1331](https://github.com/lazyxu/xdrive/pull/1331), exact-head [CI #38066135499](https://github.com/lazyxu/xdrive/actions/runs/38066135499) success including Final Gate, linear merge `593033e3`, temporary branch verified deleted. Fix the concrete 64px Recent/Favorites mounted row versus shared 68px virtualization pitch mismatch, align inset separators to the true item-name start for normal/selected/nested rows without adding a second list kernel, and bring `ContextMenu`/`Shift+F10` to collection rows using their original authorized context menu and >=44px touch entries. Existing 10k/100k range semantics, UI operation callbacks, single App Frame and 52px title bar are unchanged. Mounted and pure tests provide contract evidence only; no physical iOS 27 screenshot/VoiceOver or live Web vs Mobile permission matrix is claimed.


## 2026-10-11 F-iOS27-08C · Mobile rename rejection and UTF-8 rule parity

**One-work-commit implementation, pending exact-head PR CI and merge.** The existing real Wide Web FileExplorer rename form already uses the shared `FileNameDialog` validation view; Mobile Files had a separate form that did not guard 255 UTF-8 bytes and swallowed Server rejection without inline feedback. Mobile now mounts the same shared `XDriveFileNameDialog`, reusing the unchanged one-Web-adapter `onRename → api.rename(Node ID, Revision)` path for success, denial, conflict, retry and scope cleanup. Mounted real shared React component tests cover 403 rejection, draft retention, identical id/revision retry, 258-byte name guard and stale account rejection isolation. The original 52px global App Header, one Files virtual scrolling owner and Mobile-only internal multi-tab exception are retained. Paired live Web vs Mobile real Server errors at 375/390/899/900px, iOS 27 physical screenshot/VoiceOver and 10k/100k performance are not proven by these tests.


## 2026-10-11 F-iOS27-08D / 08E · Search cancellation parity handoff

- **Merged:** [#1341](https://github.com/lazyxu/xdrive/pull/1341) at `d0960742`, green [CI #38070529849](https://github.com/lazyxu/xdrive/actions/runs/38070529849); the short-lived Files branch was removed. Explicit Select All Cancel now aborts its dedicated shared Directory/Search HTTP range without aborting independent viewport work.
- **08E submitted / CI pending:** fill the narrower remaining first counted Search request gap in the same shared Workspace/Search and Web API for both wide and Mobile Web; generation fencing alone is not HTTP cancellation. Mounted regression verifies new query, Clear, workspace/account switch and unmount. No extra Mobile REST, virtualizer, server endpoint, fake scoped Search, or internal tabs.
- **Still open:** physical iOS 27 1:1 measured screenshots/interaction and live 375/390/899/900 Web/Mobile authorization matrix, true 10k/100k browser/per-request CPU/RSS/HTTP abort timings and Desktop Agent IPC for first-page Search cancellation.


## 2026-10-11 F-iOS27-09A · single-item context action parity

- Prior Mobile Files F-iOS27-08D [#1341](https://github.com/lazyxu/xdrive/pull/1341) and 08E [#1345](https://github.com/lazyxu/xdrive/pull/1345) merged with green exact-head CI and short branches removed. No viable unfinished Files-specific PR/branch existed before 09A.
- Source-backed discrepancy: Wide Web context supports Cut/Copy/Move To/Copy To with real shared operation eligibility. Mobile long-press context omitted Cut and Copy, while Move To/Copy To lacked their disabled reasons. 09A stages one Mobile *presentation-only* correction reusing the same Web controller and all Node ID/revision ACL checks.
- Paired mounted tests cover file/folder/denied/Trash/duplicate menu cases. Actual 375/390/899/900px Web vs Mobile authenticated Safari/Chromium, 10k/100k CPU/RSS/request timing and iOS 27 physical pixel/VoiceOver remain pending. Do not mark 1:1 or complete functional parity solely from this stage.


## 2026-10-11 F-iOS27-09A / 09B · exact Files context and keyboard parity

- **Merged 09A:** [PR #1353](https://github.com/lazyxu/xdrive/pull/1353), exact-head [CI #38104145868](https://github.com/lazyxu/xdrive/actions/runs/38104145868) green including Final Gate, linear rebase merge `0110ff8b`; verified no 09A branch on GitHub after cleanup. Restored direct item Cut/Copy in Mobile context with one shared eligibility and no new API.
- **09B candidate, CI pending:** use wide Web's exported keyboard command interpreter in the existing iOS-style Mobile presentation. Support direct selected/focused Copy/Cut/Delete, full sparse Select All, Paste (including iPad Cmd+Option+V move semantics), Undo/Redo, Esc cancellation and Search focus. Keep editable inputs, dialogs/IME and Trash isolated, maintain same Web/Server clipboard/business requests. Mount the *actual shared parser* in tests and assert ownership/abort.
- **Not yet accepted:** real iOS 27 screenshot pixel diff and VoiceOver/Safari/PWA, paired authenticated 375/390/899/900 Web/Mobile Server operations, measured 10k/100k browser performance, Desktop Agent initial Search cancellation, or unimplemented Apple Shared/Scanner capabilities. Do not claim native 1:1 completion from CI unit tests.


## 2026-10-11 F-iOS27-09C1 · real Chromium Web/Mobile acceptance

- **Prior verified:** 09A [#1353](https://github.com/lazyxu/xdrive/pull/1353) and 09B [#1357](https://github.com/lazyxu/xdrive/pull/1357) merged, full exact-head Final Gate green, short branches deleted. Current task starts from GitHub `master@db3f55d6`; unrelated open Gallery performance PR #1185 is untouched.
- **New browser phase, pending exact-head CI:** Extend the *existing real built-Web* Chrome Playwright fixture and opt-in `web` job to verify at 375/390/899/900: correct responsive Files surface, full App Frame and independent 52px title, one viewport/virtual owner, 44px item-context actions, and exact same Web/Server Copy→Paste HTTP payload from Mobile long/right press and 900px wide Web keyboard. Fail on any unknown HTTP/JS error; upload screenshot/JSON/built-artifact hash evidence with exact tested SHA.
- **Evidence tier:** Native Chromium is real browser interaction, but the API backend is a deterministic fixture, not live Server ACL, iOS 27 native UI, Safari/PWA, VoiceOver, 10k/100k real browser performance or true cancellation latency. Those and native iOS 27 screenshot pixel comparisons remain explicit *not done*; no false 1:1 claim or decorative fake backend.


### 2026-10-11 F-iOS27-09C1 native Chrome first measured result and correction

- [Chrome CI #38108538342](https://github.com/lazyxu/xdrive/actions/runs/38108538342) **actually ran** the built Web at 375/390/899/900 with ~97 root fixture Nodes. One responsive Files/scroll owner, correct xDrive full Frame/52px header, four identical actual Web Copy→Paste HTTP POSTs, and zero unknown API/JS errors passed. **CI failed** only because first-frame MUI Grow animation scaled Mobile context menu item bounding boxes to 20–26px even though computed `minHeight` was specified as 44px in source; do not assert this is an enduring layout defect until measured after entrance animation.
- The runner now captures both opening bbox, computed CSS minimum and paper transform, and **after-transition** bbox, requiring 44px steady-state hitboxes. The test remains strict; no alteration to production Menu styles or virtual owners was made without a steady-state failure. The new exact-head CI and final gate must pass before merging #1365.
- Real native iOS 27 screenshots/VoiceOver, live authorized Go Server and 10k/100k CPU/RSS/abort remain unmeasured, regardless of browser fixture success.


### 2026-10-11 F-iOS27-09C1 responsive MenuItem hitbox fix

- Chrome [#38108924989](https://github.com/lazyxu/xdrive/actions/runs/38108924989) measured the four exact shared Node/Revision API copy operations, 375/390/899/900 responsive owners, one scroll host, preserved 52px App bar, and no unknown requests/JS errors. After CSS transition, 375/390 context options had **44px computed minimum**; **899px remained 0px**, a real MUI `sm` breakpoint style override.
- Scoped repair uses higher-specificity descendant `& .MuiMenuItem-root` on existing Mobile context Popover paper to restore 44px native-like touch sizes for all context entries, without modifying wide UI, operation/Server semantics or virtualization. Added static guard; rerun real built-Web Chrome and full GitHub exact-head CI before merge.
- Real iPhone iOS 27 Safari/PWA/VoiceOver screenshots and live authenticated Go permission tests, 10k/100k measurements are still not done.
