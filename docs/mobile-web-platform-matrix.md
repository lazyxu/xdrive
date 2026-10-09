# Mobile Web 平台与视口验收矩阵

更新日期：**2026-10-09**。本文件维护用户批准的 M49，并为 M47 生命周期、M55 读屏和 M56 显示/输入验收提供记录规范。[Mobile Web](mobile-web.md) 与 [Web App Runtime](web-app-runtime.md) 继续定义产品行为；[逐项清单](mobile-web-followups.md) 定义实施顺序。

**当前状态：矩阵与验收规范已建立，M01–M11 的共享组件与实际Web应用模拟浏览器证据已记录；四个真机环境均待验。** 当前没有 iOS/Android 真机执行结果。后续功能使用下列固定 case ID 追加结果；列出一个用例不代表对应功能已经交付。

## 1. 结果必须分为四层

| 层次 | 可用状态 | 记录内容 |
| --- | --- | --- |
| 产品实现 | implemented / partial / missing / unknown | 实际代码路径、检查版本；是否已经接入用户流程。 |
| 运行时检测 | present / absent / unknown / error | 当前页面、显示模式及具体 API 的原始检测值。 |
| 实际动作 | not-run / succeeded / cancelled / rejected / blocked | 在什么用户手势下，用什么样本，尝试了什么动作及其结果。 |
| 任务验收 | pass / fail / blocked / not-run / not-applicable | 用户是否完成规定流程，所用证据、限制和下一步。 |

不得用一个 `supported: true` 合并以上四层。API 存在、请求返回成功和文件已保存/已送达是不同证据。能力缺失但回退流程可用时，可单独通过“回退”用例；没有实施产品入口时，记录产品缺口，不归因于操作系统。

## 2. 环境矩阵

| 环境 ID | 必须记录的真实环境 | 视口/地址栏 | 键盘/安全区 | 平台能力及生命周期 | 当前结果 |
| --- | --- | --- | --- | --- | --- |
| IOS-TAB | iPhone 型号、iOS build、Safari build、普通标签页 | 地址栏展开/收起、两侧横屏、页面缩放 | 搜索/重命名/密码/筛选、键盘关闭恢复、Home indicator | 文件选择/下载/分享、视频模式、后台/锁屏/重新进入 | **not-run：真机待验** |
| IOS-INSTALLED | 同设备、部署版本、添加方式、实际图标启动与显示模式 | 冷/热启动、旋转、文件深链接、外链/返回 | 独立窗口安全区、键盘、长内容 | 与普通标签页分别执行，不能继承其结果 | **not-run：真机待验** |
| ANDROID-TAB | Android 型号、OS build、Chrome build、导航方式 | 地址栏、两侧横屏、短视口、页面缩放 | 键盘 resize/overlay、手势导航区、输入切换 | 文件/目录选择、分享、视频模式、后台/网络切换 | **not-run：真机待验** |
| ANDROID-INSTALLED | 同设备、部署版本、安装和图标启动步骤、实际显示模式 | 启动目的页、系统返回、深链接、外链 | 独立窗口键盘和系统栏 | 分享接收单独记录；进程回收后恢复 | **not-run：真机待验** |
| CHROMIUM-EMULATED | Chromium 153.0.8010.0，Linux，无物理设备；触控/鼠标分别测试 | 360×780、390×844、430×932、844×390、899×700、900×700、1280×800 | 可测缩短视口、DOM/焦点和 200% rem；不能模拟实际软件键盘或物理安全区 | 使用真实 React/MUI 与有界 API fixture；不覆盖 OS 系统面板 | M01–M03：174 项；既有 Files：54 项；完整 Web 视口：901 项，均通过，见[证据](validation/mobile-files-controls-2026-10-09.json)。 |

每种 OS 先执行一个明确记录版本的手机，普通标签页与安装模式分开。产品最低支持版本尚未明确时，写“最低基线未定义”，不自行宣布版本支持范围。真实手机 CSS 尺寸按设备测量，不强行改成桌面预设。地址栏步骤只有在已观察到无需浏览器栏的显示模式下才可标记 not-applicable。

## 3. 当前实现与检测边界

以下代码观察对应本次变更的源文件；测试代码哈希见证据 JSON。可用性结论必须由未来运行时/动作结果补充。

| 项目 | 当前实现证据 | 仍需记录/验证 |
| --- | --- | --- |
| 应用高度 | [App.tsx](../web/src/App.tsx) 的 `100vh` 回退及 `100dvh` 增强；[WorkspaceContent](../ui/shared/src/mui/WorkspaceContent.tsx) 保持同一 main。 | 原始 layout/visual viewport、实际控件位置与键盘关闭后的恢复。 |
| viewport 声明 | [index.html](../web/index.html) 使用 `width=device-width, initial-scale=1.0`。 | 不为测试擅自加入 `viewport-fit=cover` 或 `interactive-widget`，否则改变了被验收对象。 |
| 安全区/模态 | [WorkspaceCompactNavigation](../ui/shared/src/mui/WorkspaceCompactNavigation.tsx)、[DialogTitle](../ui/shared/src/mui/DialogTitle.tsx)、[WebFileViewerApps](../web/src/WebFileViewerApps.tsx) 已使用安全区样式；Viewer 背景有 inert/aria-hidden。 | 同时记录 height/min-height/max-height 和 padding；Dialog 的 `height:100dvh` 与 `minHeight:100vh` 组合是待实测项，未证明为缺陷。 |
| Files 控件 | 单一工具条、独立 44px 目录展开/进入、共享筛选 Drawer，均跟随 900px 宽度边界；真实输入语义另外处理。 | 真机短横屏、地址栏动画、读屏及软件键盘；切勿用“按钮存在”代替可点中。 |
| 安装模式 | [site.webmanifest](../assets/icon/web/site.webmanifest) 声明 standalone、根 start/id/scope 及图标。 | 当前产品未记录实际 display-mode；声明与实际启动模式分别填写。 |
| 键盘测量 | 当前 Web/shared 没有 VisualViewport 或 VirtualKeyboard 观察层。 | 这是测量缺口，不能据此判定浏览器不支持。 |
| 目录选择 | [WebFileExplorer](../web/src/WebFileExplorer.tsx)、[WebOverviewPage](../web/src/WebOverviewPage.tsx) 设置 directory 属性；使用相对路径。[FileExplorerExternalDrop](../ui/shared/src/mui/FileExplorerExternalDrop.ts) 已支持目录递归/显式空目录。 | picker、drop、File System Access 分开检测；选择器的 FileList 不等于能表达空目录。M39 尚需用户流程完善。 |
| 保存下载 | [downloadSink](../web/src/downloadSink.ts) 检测具体 `showSaveFilePicker`，打开 writable；普通回退由 [api.ts](../web/src/api.ts) 使用原生票据下载。 | 取消、写入关闭、实际落盘文件名/哈希；不把历史 `kind:'blob'` 名称解读为整文件内存下载。 |
| 系统分享 | [ShareDialog](../ui/shared/src/mui/ShareDialog.tsx) 检测 `navigator.share`，目前发送标题与链接，处理取消/复制链接回退。 | 文件字节 `canShare({files})` 与真实接收待 M44；manifest 当前没有 share_target，接收入口待 M48。 |
| 视频能力 | [FilePreviewSurface](../ui/shared/src/mui/FilePreviewSurface.tsx) / [FilePreviewTransformedMedia](../ui/shared/src/mui/FilePreviewTransformedMedia.tsx) 使用原生 controls 与 playsInline。 | 原生控件动作和自定义 PiP/fullscreen API 路径分开记录；没有自定义按钮不等于平台不支持。 |
| Range/版本/公开下载 | [download_ticket.go](../internal/api/download_ticket.go) 与 [shares.go](../internal/api/shares.go) 使用 ServeContent；ZIP 准备和下载流有独立流程。 | 按 endpoint/ticket/fixture 验证响应头与实际分段字节；没有通用浏览器 `rangeSupported` 结论。 |
| 辅助功能 | 已有主题与 DOM/focus/inert 检查；本次包含键盘不穿透背景、响应式焦点恢复。 | VoiceOver/TalkBack 完整任务、200% 系统字体、减少动画和混合输入分别执行。 |

## 4. 视口、键盘与安全区的采样规则

动态视口单位、layout viewport 和 visual viewport 需要分别采样。软件键盘可以覆盖内容而不改变 layout viewport；缩放也能改变 visual viewport，因此不能用一个高度差推断“键盘已打开”。这是[CSS 视口单位](https://www.w3.org/TR/css-values-4/#viewport-relative-lengths)与[VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)文档所描述的不同坐标/显示状态。验收时附测试者明确的 keyboard-shown/hidden 标记。

在键盘关闭、visual scale=1、布局稳定时，应用应填满实际可用动态视口，保留现有 ±1 CSS px 的几何容差，不预留全局顶/底栏；窄/宽/窄转换保留同一 main 与滚动宿主。键盘或缩放活动时，不要求根高度机械等于 `visualViewport.height`，而是验证输入位置、必要动作和关闭入口能通过预期内部滚动触及，键盘关闭后没有残留空白或丢失位置。

安全区值为 0 也是有效观测，不代表设备没有缺口或操作一定安全。`viewport-fit=cover` 会改变页面布局空间；应保持被测声明并结合 computed padding 与实际屏幕观察，不能仅靠“用了 env()”通过验收。参见 [WebKit 的 safe-area 说明](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)。

| 采样组 | 原始字段 | 采样限制 |
| --- | --- | --- |
| 版本/环境 | UTC、实际 testedCommit 或 dirty+bundle SHA-256、部署标识、fixture/hash、设备/OS/browser/键盘版本 | 系统版本由测试者确认；UA 仅可附加，不作为能力判断。 |
| 显示模式 | manifest 声明；各 display-mode 查询结果；可选 navigator.standalone；launchMethod | [Manifest](https://www.w3.org/TR/appmanifest/) 的请求模式与实际应用模式分开，Element Fullscreen 另记。 |
| 视口 | innerWidth/Height、document client/scroll、scrollX/Y、DPR、方向；visualViewport width/height/offsets/page/scale 或 null | 页面缩放、双指缩放、系统字体分别标注；不能互相替代。 |
| CSS | dvh/svh/lvh 的解析支持及实际 reference 高度；四边 safe-area computed px | 无副作用的参考元素必须离开布局、不可交互，用完移除。 |
| 元素/滚动 | main/Viewer/Dialog 及关键按钮矩形，height/min/max/padding/overflow，scrollHost/client/scroll，元素稳定 ID | 先测初始矩形、祖先裁剪和原生 hit test，再进行会自动滚动的定位点击。 |
| 焦点/输入 | 安全的测试 ID/元素类型、inert/aria-hidden、pointer/any-pointer/hover、实际 pointerType | 不收集输入值、密码、文件正文、令牌或完整下载票据。 |
| 生命周期 | resize、orientation、focus、visibility、pageshow/pagehide.persisted、VisualViewport resize/scroll；显式用户标记 | 后台、锁屏、关闭进程分开；内存日志丢失不能证明具体回收原因。 |

可选的被动记录器尚未实现。实现时复用相同采样函数给现有浏览器 runner，采用有界缓冲、几何事件节流、明确的丢弃计数与停止清理；不修改页面 viewport、焦点、滚动或权限，不自动打开系统面板。真机地址栏/键盘/分享等 OS 表面需要带时间标记的屏幕录像，DOM 截图不充分。

## 5. 固定验收用例

| Case ID | 操作顺序 | 通过标准及所需证据 |
| --- | --- | --- |
| M49.V01 | Files、Gallery、设置页依次打开；上下滚动让地址栏展开/收起，各两次。 | 稳定状态填满可用视口、无全局栏占位、滚动/目录身份不变；记录几何与真实地址栏录像。 |
| M49.V02 | 竖屏→左横屏→竖屏→右横屏；分别打开/关闭导航与 Viewer。 | 短横屏可操作，关键按钮不被缺口/手势区挡住，返回保留上下文。 |
| M49.V03 | Files 搜索并设条件，滚动到深处；打开结果/显示所在文件夹并返回，再前进；在 899→900→899 与待恢复 Grid 期间改变宽度。 | 保留查询、条件、各自排序、有效视图、选择与逻辑位置；新输入/滚动可打断恢复，失败可重试。结果变化时提示附近位置，不选中替换项。共享 renderer 与实际 Web Viewer 分别记录，真机仍逐环境执行。 |
| M49.V04 | Files 选择混合文件/目录，全选未加载结果；加载中取消、清除、完成；切至 200% 文字和短视口，再展示真实任务长错误或下载汇总。 | 数量按唯一身份计算，目录/Search 范围明确；完整选择不被操作上限截断；主操作、任务入口、关闭提示及完成均可触达，同一列表宿主保留。分别记录 renderer 回调、实际下载字节与真机触控证据。 |
| M49.V05 | 从 Files 直接移动/复制到文件夹，翻页、进入深层目录、取消/重试；从反馈进入对应任务；重命名失败后改变 899→900→360 宽度，在短屏/200% 文字下修改并保存。 | 目标浏览不改 Files 历史，来源身份/版本不丢失；目标和错误可读，提交/取消至少 44px；冲突/取消/重试跟随同一任务。重命名保留草稿、仅提交一次、返回文件焦点。迟到完成不能关闭新目标或清除后来重新应用的同一搜索。真实软件键盘与 renderer 缩短视口分别记录。 |
| M49.V06 | 无选择时从位置面板管理标签；读取失败后重试，创建/编辑定义，再给完整选择分配或移除标签；保存搜索、修改条件、进入目录并返回；在 700/899px 鼠标与 360×390/200% 文字下重复。 | 管理与分配入口、数量和删除语义明确；失败读取显示未知，空标签正常；规则与当前 Search/历史匹配，不使用加载行数量推测结果。长规则、错误、提交与完成可触达，模态关闭恢复入口焦点；真机键盘和读屏另行记录。 |
| M49.V07 | 同一照片/视频/实况分别从Files、Gallery与实际Web Viewer打开属性；在竖屏/短横屏读取长字段与资源，关闭返回；挂起A的查询或保存，改看B或关闭后再完成A；刷新版本后重新打开。 | 共享媒体字段一致，Files保留路径/来源/大小/版本/ID及普通文件回退；未索引成功、部分元数据与查询失败分别表达。属性不增加Viewer播放器或原件/动态加载，返回焦点正确，旧查询/保存不能覆盖新目标。传输边界、实际App及真机结果分开记录。 |
| M49.V08 | Files完整选择后用44px手柄拖到文件夹/路径，再对快速访问和智能文件夹作之前/之后重排；尝试小幅拖动、取消、第二手指、会话切换、卸载和边缘滚动，并使用无需拖动的目标选择或上移/下移。 | 仅有效目标高亮，保留完整ID/版本和同一滚动宿主；未加载选择不提交子集，当前目标与范围改变取消。松手不激活新出现或替代的控件，下一次有意点按仍生效。边缘滚动后重新命中当前挂载目标；失败恢复/重试复用现有操作。短横屏、200%文字和混合输入记录实际矩形，原生系统触控仍分环境验收。 |
| M49.V09 | Files 先后打开筛选与位置抽屉；Gallery 打开高级筛选并选择设备、格式、日期。普通竖屏、844×390 短横屏、200% 文字下分别检验内部滚动、关闭、清除、保存／应用与焦点恢复；随后用真实 iOS／Android 软件键盘复测 VisualViewport 的 offsetTop/height、菜单、关闭和底部动作。 | 面板高度与底部遮挡依赖实际可见区域（VisualViewport），不得超出短横屏；只有面板内滚动，不占全局顶／底栏。图库应用／清除／保存智能相册仍可触及，Files 嵌套菜单关闭后恢复焦点；API 支持、模拟器检查和真实键盘手势三层分别留证。 |
| M49.V10 | Gallery 手机在 360×780、844×390 和200%文字下选 3 项，检验数量、退出、收藏／标签／下载／删除、进入相册选择器、过滤并选择手动相册、提交一次与成功/权限失败；选择器开启后改变选中范围、旋转、键盘弹出、取消与返回。 | 选中数量由真实选择计算且不因面板截断；主操作保持在图库内容区可滚动区域；只列可写手动相册，须显式确认，失败提示可读、取消不提交、选择范围变化禁止旧操作；页面不新建全局底栏。真机键盘与模拟/React测试证据分开。 |
| M49.V11 | Gallery 分别选择年/月/日，滚动到真实100k索引深处并观察“当前浏览”；用日期输入选中精确日、空白日、最近日期、未知日期、空集合；从跳转处“返回刚才位置”，再变更密度、原比例、排序、时区，打开 Viewer 后返回。依次在360×780、844×390、899/900px、200%字体和 iOS/Android 标签页／安装模式上重复。 | 日跳转只利用 Server 的日索引，不渲染成百上千下拉项，选无照片日期明确标出最近真实日期；年/月/日滚动日期提示与实际首个可见分组一致，未知日期不猜拍摄时间；返回原锚点且逻辑身份不变，排序时保留原照片锚点。100k 依旧有界渲染。短屏菜单、原生日历控件、安全区、真机横屏/读屏和已安装模式分别留证，未经真机验收标记 not-run。 |
| M49.V12 | 从Gallery/Files/Viewer进入共享属性，依次编辑描述、标签、人物；保持请求未完成、成功返回规范化值、继续编辑、制造失败并重试，再切换目标和返回。390px、700px精细指针、844×390/200%文字及900px边界分别检查。 | 三个窄屏保存按钮实际至少44×44px；每字段可见且polite朗读保存/成功/未保存状态，规范化父更新保留确认，新目标不继承旧反馈。未知旋转标未记录，明确0°保留；真实软件键盘、VoiceOver/TalkBack与模拟浏览器分别留证。 |
| M49.K01 | 打开 Files 搜索并输入长查询；开筛选并选择类型/同步文件夹/标签；关闭键盘、嵌套菜单与面板；横屏重复。 | 可读/可点/可退出，焦点正确恢复，不触发背景文件；软件键盘与外接 Enter/空格/Ctrl+F 分列。筛选当前字段为选项按钮，不虚构可编辑字段。 |
| M49.K02 | 搜索、长文件名重命名、真实密码表单；制造验证错误后取消。 | 输入位置、长错误、提交/取消可达，退出恢复视口与位置，密码不进入证据。 |
| M49.K03 | 同步文件夹设置、目标/范围选择、长响应/错误、保存/重开。 | 用真实 M51 产品流程；该项目未就绪时保持待验，不以玩具弹窗替代。 |
| M49.I01 | 图标冷/热启动；登录前后文件深链接；外链；系统/浏览器返回，再次进入。 | 实际目的页与返回栈符合 Runtime 契约；普通标签页不能替代安装模式。关联 M46。 |
| M49.L01 | 分别在上传与视频过程中切 App、锁屏、离线/联网、刷新、重新进入、明确关闭进程再启动。 | 分别记录文件重新选择、传输状态、当前媒体/时间和恢复结果；关联 M38/M47。 |
| M49.A01 | 读屏完成导航→找文件→选择/操作→Viewer→返回；再测 200% 文字、浅/深色、减少动画、外接输入与页面缩放。 | 朗读名称/角色/状态、模态焦点、背景不可交互、返回焦点和完整任务均有证据；关联 M55/M56。 |
| M49.C01 | 真实目录选择/取消/重开；含嵌套、空目录、零字节、Unicode/长名称样本；分别尝试多文件/ZIP 回退。 | 逐文件相对路径与哈希正确，空目录明确；[Entries API](https://wicg.github.io/entries-api/) 的 FileList 与目录 entries 不混同；上传 ZIP 不表示已解包。关联 M39。 |
| M49.C02 | 检测 share/canShare，使用明确用户手势发送指定真实 File；取消一次、重试，并在真实目标接收/保存。 | 保留名称/类型/大小/哈希、取消/异常和接收端字节证据；[Web Share](https://www.w3.org/TR/web-share/) 的检测不代替送达。当前链接分享与待实施 M44 分开。 |
| M49.C03 | 已有下载入口打开保存选择器，取消一次再完成；能力缺失时走原生下载回退。 | 具体 picker 单独检测，实际落盘名称/字节正确，取消不会开始传输。 |
| M49.C04 | 就绪视频→播放→原生控件或明确 API 入口进入/退出 PiP/全屏→旋转→后台/返回→关闭 Viewer。 | API/promise/error/events 与实际模式一致，媒体时间/单播放器正确；[PiP](https://www.w3.org/TR/picture-in-picture/) 与 [Fullscreen](https://fullscreen.spec.whatwg.org/) 路径单列。关联 M35/M47。 |
| M49.C05 | M48 产品入口就绪后，从 OS 分享面板选择安装的应用，选目标，确认上传，再验证取消/选择器回退。 | 接收真实字节与目标正确；当前 manifest 无 share_target，记录产品 missing、动作 not-run。 |
| M49.N01 | 普通、版本、预览和公开文件分别执行完整 GET、首/中/尾 Range、无效范围，随后验证过期与撤销。 | 按 [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests) 比对状态/Content-Range/长度/分段哈希；HEAD 不能证明字节，Server 成功不代替浏览器落盘。 |
| M49.N02 | ZIP 准备后中断下载，重试，检查完整归档条目/哈希。 | 准备结果复用与下载流重试分开，不把文件 Range 或 manifest 复用当成 ZIP 断点下载。关联 M42。 |

先对四个真机环境执行 V01/V02/K01/K02 与适用安装 smoke，再随相关功能补 C/N/L/A。每个触及流程保留长内容、成功、取消、失败/重试；不要求无目的地遍历所有组合。任何未执行步骤必须在结果中出现原因。

## 6. 证据保存与维护

小型 JSON、样本清单和校验值存放在 `docs/validation/` 或 `docs/mobile-web-evidence/<date>/<revision>/<run-id>/`；大录像使用可保留的不可变附件位置，附 SHA-256 与 case/时间关联。仅有会过期的 CI 日志不够。每个 run 必须包含环境版本、部署/数据样本、精确步骤、预期/实际、四层结果、证据、阻塞与下一步。

以下是计划模板，不是已执行结果：

```json
{
  "schemaVersion": 1,
  "runId": "pending-ios-tab",
  "recordKind": "planned",
  "createdAt": "2026-10-09",
  "executedAt": null,
  "source": { "testedCommit": null, "dirty": null, "bundleSha256": null },
  "environment": {
    "id": "IOS-TAB", "kind": "physical-device",
    "deviceModel": null, "osVersion": null, "browserVersion": null,
    "keyboard": null, "launchMethod": null
  },
  "display": { "declared": "standalone", "applied": null },
  "settings": { "systemTextScale": null, "pageZoom": null, "pinchScale": null },
  "results": [{
    "caseId": "M49.K01",
    "implementation": "implemented",
    "runtimeObservation": "unknown",
    "action": "not-run",
    "acceptance": "not-run",
    "reason": "Physical device evidence not collected",
    "steps": [], "expected": null, "actual": null, "evidence": []
  }]
}
```

动作记录增加 `actionPath`（product/native-controls/qa-api-probe/fallback）、fixture ID、API 原始值、错误名称和明确的取消结果。已执行 run 必须有 testedCommit，或 dirty 标记加实际 bundle hash；未提交 HEAD 单独使用无法标识构建。

每次相关布局/功能改动，在同一变更更新本矩阵与关联 case；OS/浏览器升级保留旧记录，再执行受影响几何与能力动作。已通过结果只归属于其版本、模式和样本。真机受阻时保留 not-run/blocked，记录缺少的设备或执行条件，不自动转成通过。

## 7. 本次证据与可复用入口

本次 2026-10-09 M01–M03 的 [JSON 证据](validation/mobile-files-controls-2026-10-09.json) 记录固定基线、最终共享组件哈希、实际失败与转绿结果。174 项共享控件、28 项针对性复现（属于共享控件集合，不重复计数）、54 项既有 Files、901 项完整 Web 视口检查，以及独立复查的 200% 短横屏/键盘检查，均为 **Chromium renderer evidence**。

M04–M05 的[搜索返回证据](validation/mobile-files-search-return-2026-10-09.json)追加 M49.V03：接到 `daf35bce` 主线后，真实共享 Workspace / Search / Navigation / VirtualCollection / FileExplorer 的 104 项检查通过；同时重跑既有控件 174 项与 Files 54 项，均无失败或浏览器错误。底层目录和搜索 range 使用有界 transport fixture。控制器聚焦 17 项属于相关 88 项集合，相关集合又由完整 Desktop 测试覆盖，不能相加成独立验收数量。实际 Web App Viewer 结果在同一证据中单列；上述结果不继承为 iOS/Android 安装模式或真机键盘、地址栏、读屏通过。

M06 的[选择与操作反馈证据](validation/mobile-files-selection-actions-2026-10-09.json)追加 M49.V04：真实共享组件 286 项检查通过，包含 1,024 项完整选择、有效 768 项回调与原始版本保留、明确的 200/1,000 项操作资格，以及 360×390/200% 文字下通过实际滚动找到任务/关闭入口。该组合布局先记录 2 项真实失败，再通过相同 14 项检查；独立 presenter 的 20 项检查与组合场景分别记录，不替代 App 或实际传输验收。

M07的[完整操作证据](validation/mobile-files-operations-2026-10-09.json)追加M49.V05：共享操作315项与实际Web应用72项通过，覆盖来源版本、目标翻页/取消、重命名错误与重试、冲突续作、任务定位和取消状态。实际短屏200%文字发现列表仅露出8.16px行内容，修复后保留100px滚动区；实际App发现普通重开任务页会重放旧焦点，已复现并修复。M06选择286项、共享搜索返回104项、实际Web搜索返回48项与完整视口901项回归通过。设备时区和虚拟行渲染等待分别属于测试条件修正，不计为产品缺陷。四个真机环境仍为not-run。

M08的[组织功能证据](validation/mobile-files-organization-2026-10-09.json)追加M49.V06：共享组织流程184项、实际Web应用33项、实际Web搜索返回48项通过。原始管理89项在旧版有18项失败，最终同名89项全部通过；其中名字与颜色输入的实际点击区域在360/700/899px均为44px，900px保留40px桌面密度。360×390/200%文字下，原生滚动可到达长错误两端及保存/取消，模态完成后焦点返回入口。真实App覆盖读取503后的显式重试、无选择管理、完整规则保存、Trash/目录/Back匹配状态及单文件标签分配/移除。MUI退场等待和旧测试桩接口属于测试修正，不计为产品缺陷。四个真机环境仍为not-run。

交付前接到`31defbde`新主线后，M49.V05/V06的实际App流程分别72/33项、搜索返回48项，以及共享组织184项再次通过；完整Desktop1532项通过、零失败、一项既有可选跳过。实际入口构建为`index-sVHKtTvt.js`，精确哈希见同一证据的`latestAcceptedIntegration`。原174项控件的实际依赖哈希未改变，沿用其已记录结果；上述所有记录继续归属于Chromium模拟环境。

M09的[共享媒体属性证据](validation/mobile-shared-properties-2026-10-09.json)追加M49.V07：Files121、Gallery25、实际路由Viewer170项通过，同一照片/视频/实况的九组实际字段完全一致。Viewer在390×844、844×390及700/899px精细指针环境测得属性关闭按钮44×44；阅读2.6秒后关闭仍恢复到可见、可点中的原入口，媒体元素与播放状态不变。Gallery的四项真实迟到保存失败转绿；同一Node仅字节版本变化的8项独立复查保留既有注释保存语义。Files旧查询取消、未索引/错误回退与重新打开新版本分别验证；Agent JavaScript HTTP取消不冒充完整Electron/Go/Server链路。完整Desktop1557项通过、零失败、一项既有可选跳过；真实App搜索返回48项通过。整合RAW兼容预览后，实际同文件刷新曾显示第8版属性却请求第7版预览；同一25项检查24通过/1失败转为全部通过，最后的原件版本参数为7→8。完整首次失败与最终构建见同一证据的`latestAcceptedIntegration`。四个真机环境、软件键盘、实际安全区及读屏继续not-run。

复用脚本：`desktop/scripts/file-explorer-controls-browser.cjs`、`file-explorer-mobile-browser.cjs`、`file-explorer-selection-browser.cjs`、`file-explorer-organization-browser.cjs`、`file-explorer-media-properties-browser.cjs`、`media-properties-gallery-browser.cjs`、`web-media-properties-browser.cjs`、`mobile-web-app-browser.cjs`；表单/公开分享后续使用现有 `mobile-web-forms-browser.cjs` 与 `mobile-web-public-share-browser.cjs`。本次没有重新执行真实 Server 下载、OS 安装/分享或读屏用例；相应条目保持待验。

上述标准和平台文档访问日期为 2026-10-09。规范草案与文档用于界定检测/动作语义，不能替代某个 OS/browser build 的实际结果，也不构成“当前所有 iOS/Android 版本都支持”的承诺。

M10的[触控拖动与重排证据](validation/mobile-files-touch-drag-2026-10-09.json)记录M49.V08：Files135、Navigation162、实际Web App49项通过，独立原生触控21项和迟到挂载目标9项通过。完整选择与原始版本经过既有操作通路；单次拖动、取消、完整重排、上移/下移及失败恢复分别验收。844×390/200%根文字下的手柄、取消和位置入口可触达，360×390侧栏顺序菜单保留完整长名；触屏上下文中的鼠标操作也通过。迟到目标高亮、拖动状态造成的行位移和兼容点击误触均保留相同首次失败及修复证据。完整Desktop1575项通过、零失败、一项既有可选跳过；四个真机环境继续not-run，软件键盘、地址栏、物理安全区及读屏不从这些结果继承通过。


M10 补充在相关 [PR #1119](https://github.com/lazyxu/xdrive/pull/1119) 完成 CI `37905955558` 并合并为 `f693cb00` 后重新整合，精确实现为 `d9179872`。整合后 Files135、侧栏162、保留并适配的既有手机80、实际Web49、原生指针21均通过；完整Desktop1582通过、零失败、一项既有可选跳过，类型检查、Web lint/build通过。保留页面隐藏取消与无效坐标校验，移除重复的本地拖动状态机；没有覆盖其他未合并分支。首次失败、相同检查和最终源文件哈希见证据的 `latestAcceptedIntegration`。完整补充PR CI、合并与清理仍待完成。

### M12–M14：相册选择、日期触控与属性反馈（2026-10-09）

**本地整合验收完成，新的完整 PR CI 与线性合并待完成。** M10–M11 已由 [PR #1125](https://github.com/lazyxu/xdrive/pull/1125) 的完整 CI `37914259268` 通过并合并为 `3ad7e73a`，远端工作分支已清理。本批固定在该合并点，只叠加 M12/M13/M14 自己的补充，不重复实现已合并基础。最终生产检查点为 `c55d5ad1`，随后仅增加文档与证据。

M12 在现有相册选择器中整理固定关闭、搜索、候选、错误和确认操作的滚动关系。844×200／200% 文字时，原本被压到0px的列表行恢复为可滚动到的56px；相同14项12通过/2失败→14/0，扩展35项使用完全相同的已记录依赖复用。实际 Web 同40项39/1→40/0：取消回到“加入相册”；加入成功并清空选择后，焦点回到仍挂载的“选择”。403失败保留选择和草稿，显式重试发送同一组三个文件ID及相册版本。整合期间曾错误挂接焦点ref，实际同40检查发现后，已恢复经复查的持久按钮和原effect位置。

M13 保留已交付的年/月/日、各尺度密度、日索引、当前日期提示及返回锚点，仅将窄于900px的年月选择框实际命中区由40px补足至44px；900px仍为40px。最终同45项在合并父版本上41/4→45/0，覆盖原生上下边缘点按、Escape返回、空白日期最近匹配、日期提示和原锚点返回。新主线明确的`fold_duplicates:false`只需要测试契约适配；不因该测试比较错误改变产品行为。

M14 的描述、标签和人物各自显示正在保存、已保存和未保存更改。服务端返回的规范化值及随后父组件更新保留已保存提示；新编辑、当前目标变化和错误保留既有作用域规则。三个保存按钮在窄屏分别至少44×44px，900px原密度不变。视频旋转优先使用已记录的有限数值，再读现有video元数据；两处均缺失时显示“未记录”，明确记录的0°仍保留。相同21项11/10→21/0，旋转同5项3/2→5/0；最终扩展28项全部通过，含844×390／200%文字下原生滚动读到保存状态。

最终构建的实际 Web 相册40项、面板37项及共享属性28项均通过，零意外请求/浏览器错误。日期45、共享面板57、相册35明确复用其相同源码与测试记录。完整 Desktop **1613通过／0失败／1项既有可选跳过**；完整结果摘要已显式核对，类型检查、Web lint/build均通过。[整合证据](validation/mobile-gallery-selection-timeline-properties-2026-10-09.json)与[保留的M12/M13首次失败](validation/mobile-gallery-controls-m10-m13-2026-10-09.json)记录真实命令、完整断言、独立复查、源码和构建哈希，数量不相加。

M49.V10–V12 继续区分实际渲染与真机结果。iOS/Android 普通标签页/安装模式、真实软件键盘、地址栏、安全区、VoiceOver/TalkBack均为 **not-run**。这里的逻辑360项日期样本不表示100k渲染或真机Viewer往返已经验收。

### M49.V08/V09：合并依赖后的证据

**Local acceptance complete; updated PR #1125 full CI and merge pending.** The confirmed checklist/matrix conflicts required reconstruction onto merged M12 `bd96b2b1`. The independently updated PR head `95a23fbb` was inspected: all of its M10 production and browser fixture bytes are retained. Upstream Gallery index readiness, selection-picker wiring and concise sidebar copy remain intact. The additional production changes are limited to the Files form scroll region, Gallery action positioning and compact navigation hit targets.

At **844×200 CSS px with 200% root text**, Files previously left only **24px** for a **61px** field. Sharing the bounded scroller with Save/Clear leaves **87.97px** and reveals the whole field; native scrolling reaches the unchanged actions while Close remains visible. Gallery's sticky actions previously exposed only **23px** of a **63px** field; the same field is fully visible after removing sticky positioning, and actions remain reachable through the existing scroller. Compact Gallery navigation now measures at least44px with either pointer type.

On production `53177a7b`, the same final **Files135**, **Navigation162**, **Files panels22**, **Gallery panels57**, **actual Web drag49** and **actual Web panels37** all pass with zero browser/unknown-request errors. The active build is `assets/index-BYQXNagw.js`; both App receipts contain exact runner/build hashes. Full Desktop validation passes **1594**, with zero failures and one existing optional benchmark skip; typecheck, Web lint and build pass. Eight prior actual VisualViewport scale/pan samples are retained as observations with an explicit dependency comparison, not rerun or keyboard tests. The native pointer21 receipt has an unchanged helper source.

The [M11 ledger](validation/mobile-panels-short-viewport-2026-10-09.json) preserves the same17-check Files first-red (16pass/1fail), same57-check Gallery first-red (52pass/5fail), full final assertions, source/build hashes, geometry and fixture-only corrections. The [M10 ledger](validation/mobile-files-touch-drag-2026-10-09.json), `combinedPanelIntegration`, retains its earlier history and records these fresh integration results. Counts overlap and are not summed. All four physical iOS/Android tab/installed environments, real keyboard/address bars/safe areas and screen readers remain **not-run**; M49.V08/V09 record the actual evidence boundary.
