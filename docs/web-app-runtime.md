# xDrive Web App Runtime

Mobile Web Files 的展示层独立于 Desktop FileExplorer；在同一个 `files` App ID 和 Web REST/controller 契约上运行。首次进入浏览首页，之后恢复账号自己的文件夹与滚动位置；显式 `dir` 深链接优先，不新增 Mobile 文件 API 或新的 App 注册项。见 [Mobile Files iOS 合同](mobile-files-ios.md)。

## 目标

Web 端不再把“打开文件”理解成到处创建新的 Dialog state，而是把可独立启动、可深链接、可由其他工作区调用的能力注册为 Web 程序。Web 程序使用统一的 App Registry、类型化 launch contract、Hash Route 和 session browse context。设置、属性、分享、历史版本、标签、重命名和冲突确认仍是程序内部 Dialog / Inspector，不升级成独立程序。

当前固定为 **16 个 Web 程序**：

| App ID | 名称 | Presentation | 主要启动参数 |
| --- | --- | --- | --- |
| `overview` | 主页 | workspace | 无 |
| `files` | 文件管理器 | workspace | `dir?` |
| `gallery` | 图库 | workspace | `section?` |
| `sync-folders` | 同步文件夹 | workspace | `source?` |
| `tasks` | 任务 / 全局任务 | workspace | `scope?`, `task?` |
| `local-storage` | 本地存储 | workspace | 无 |
| `cloud-storage` | 云端存储 | workspace | 无 |
| `preview` | 预览 / Quick Look | immersive | `node`, `context?` |
| `media-viewer` | 图片 / 视频 / 实况查看器 | immersive | `node`, `context?` |
| `text-viewer` | 文本 / 代码查看器 | viewer | `node`, `line?`, `column?` |
| `pdf-viewer` | PDF 查看器 | viewer | `node`, `page?` |
| `audio-player` | 音频播放器 | viewer | `node` |
| `admin-users` | 用户管理 | workspace | `user?` |
| `admin-audit` | 审计日志 | workspace | 无 |
| `admin-storage` | 全局存储 | workspace | `section?`, `task?` |
| `admin-services` | 服务与依赖 | workspace | 无（管理员专用） |

## Route 与启动契约

私有 Web 程序使用：

```text
#/app/<app-id>?...
```

公开分享继续使用 `#/s/<token>`，不进入 App Runtime。

Canonical 文件身份使用 node ID。路径可以由上层调用者解析后再启动程序，但 URL 不以 path 作为唯一身份，也不把 access token、签名 preview URL、完整选择列表或大型查询结果塞入 URL。

典型路由：

```text
#/app/files?dir=123
#/app/gallery?section=albums
#/app/media-viewer?node=456&context=<session-id>
#/app/text-viewer?node=789&line=120&column=8
#/app/pdf-viewer?node=901&page=3
#/app/tasks?scope=mine
#/app/tasks?scope=global&task=system-maintenance:storage_verify
```

Sidebar 的“任务”与管理员专用“全局任务”是独立入口，分别启动 `tasks?scope=mine` 和 `tasks?scope=global`。它们共用一个 Web 程序与共享任务页面，`task` 参数仍可定位具体后台任务。内部 workspace key 保留 `transfers` 作为“任务”的兼容键，并增加 `global-tasks`；旧的无 scope `tasks` 链接继续进入个人任务。

上传和下载从任务页面移到共享传输浮层。宽屏 Web/Desktop 在顶栏头像旁打开；Mobile Web 在 App 自有标题栏右侧直接打开上传/下载状态入口，不保留独立全局顶栏或悬浮导航；账号入口在应用导航 Drawer 中。该浮层不是 Web 程序，也不写浏览器历史；打开、关闭或查看传输历史都保留当前目录与页面。Viewer 打开或账号切换时关闭浮层。速度口径与任务范围见 [传输与任务](transfers-and-tasks.md)。

多选列表、目录排序/分组、Search filter、Gallery collection target 等浏览上下文通过 `sessionStorage` 保存；只有 Quick Look / Preview 与 Media Viewer 把短的 `context` session ID 放进 URL。Text、PDF、Audio 是单文件程序，不携带集合 context，也不提供上一项/下一项。直接 deep-link 没有 context 时仍能打开 Preview / Media Viewer 的目标文件，只是不提供集合前后切换。

## 历史模型

**浏览器历史只负责程序级跳转。** Files → Viewer、Gallery → Viewer、workspace → workspace 会产生浏览器级历史项；Viewer 中切换上一项/下一项只 replace 当前 Viewer route，不逐项污染浏览器历史。**手机 App Frame 左上角返回**只退出当前 Web App：若当前 route 的内部 history state 记录了上一个 App，则浏览器 Back 回到该 App；直接 deep-link 无内部调用方则 replace 至 Overview。它不执行 FileExplorer 的目录后退/上一级，避免跨层混淆。

**FileExplorer 自己维护目录与内部标签历史。** FileExplorer 的 Back/Forward、内部 Tabs、Search、目录导航仍由现有 workspace controller 管理。当前目录变化仅 replace `#/app/files?dir=<id>`，不额外 push 浏览器 history。

Viewer 以覆盖层挂在当前 workspace 上方，因此 Files/Gallery DOM、选择、内部 tab/session、滚动位置和 collection state 在 Viewer 打开期间保持挂载。浏览器 Back 或 Viewer 关闭后，调用方恢复到原状态。

直接打开 Viewer deep-link、没有调用方历史时，关闭后进入该文件父目录；父目录不可解析时回到 Files 根目录。

## Web 与 Desktop 的“打开”

Desktop：
- 文件双击、Enter、右键“打开” → 系统默认程序。
- 文件夹双击、Enter、右键“打开” → xDrive FileExplorer。
- “打开方式…”继续使用 OS chooser。
- Space → xDrive Quick Look。
- 不再保留重复的“使用系统打开”菜单项。

Web：
- 文件夹 → Files。
- 图片 / 视频 / Live Photo → `media-viewer`。
- 文本 / 代码 / 配置 → `text-viewer`。
- PDF → `pdf-viewer`。
- 音频 → `audio-player`。
- 未关联格式不自动下载；显示“没有可用 Web 打开程序”的 fallback，并直接提供下载、分享、属性三个显式动作。
- Space → 路由级 `preview` 程序。
- 文件右键提供“在新浏览器标签页打开”。文件的 Ctrl/Cmd+Click 保持多选语义；Sidebar 的 Ctrl/Cmd+Click 可以打开新的浏览器标签页。
- 文件夹自己的“在新文件标签页中打开”继续表示 FileExplorer 内部 Tab，与浏览器 Tab 明确区分。

## Viewer context

Preview 可以接收三种 Files context：
- selection：冻结的多选 node ID 顺序；
- directory：目录 ID + sort + grouping + active index；
- search：query + filters + sort + grouping + active index。

Media Viewer 还可以接收 Gallery context：collection target + active index + total count。Viewer 不把整个集合物化到内存，而是继续使用 Server range API / Gallery range loader 按需找前后项目。

Media Viewer 从 Files 打开时只在集合中遍历图片、视频与 Live Photo；从 Gallery 打开时保留 Favorite、Info/EXIF、Albums、Tags 等图库语义。

## Text / Code Viewer

第一版保持轻量：只读 `textarea`，等宽字体，保留空格/换行，支持自动换行开关、浏览器原生选择/复制，并接受 `line/column` 定位参数。暂不引入 CodeMirror/Monaco、语法高亮、编辑保存或复杂 IDE 搜索栏。

共享文本 allowlist 同时供 Preview Engine 与 Web Open Resolver 使用，覆盖常见源码和配置文件，例如 JS/TS、C/C++ headers、Go、Rust、Java、Python、Ruby、C#、Kotlin、Swift、Dart、PHP、Lua、Scala、Elixir/Erlang、F#/VB、Haskell/Clojure、Vue/Svelte/Astro、Terraform/Nix、Shell/PowerShell、SQL/Proto/GraphQL、HTML/SVG/XML/YAML/TOML/JSON，以及 Dockerfile/Makefile/CMakeLists/Jenkinsfile/.env/.npmrc 等。PEM/KEY 等密钥文件不进入 allowlist。

Server 文本预览上限为 **1 MiB**。超过上限返回 `truncated=true`，Viewer 明确提示只显示前 1 MiB，并提供下载完整文件。第一版只保证 UTF-8 / UTF-8 BOM；NUL 或无效 UTF-8 按不支持处理。

## Presentation 与 UI 边界

- workspace：宽屏使用 App Shell + Sidebar；Mobile Web（小于 900 CSS px）每个 App Frame 铺满整个动态视口，其自身标题栏和内容区在 Frame 内按正常文档流分配空间；全局 header/footer/Sidebar 不占布局空间。
- viewer：覆盖 workspace 的全视口查看器，保留轻量 header。
- immersive：Preview / Media Viewer，内容区可隐藏 chrome。
- MUI Modal（分享、标签等）必须位于 Viewer 之上；Viewer 自己不抢占 modal z-index。
- Gallery Inspector 在 Viewer 模式下使用专用 overlay z-index，但仍低于 MUI Modal。

### Mobile Web 全屏硬约束

适用于上述 **16 个 Web 程序及今后新增程序**。手机 **App Frame 根**占满整个可用动态视口，`x=0, y=0, width=viewportWidth, height=viewportHeight`。Frame **自身**拥有 52px（加顶部安全区）的标题栏：左上角退出当前 App（回到上一个 App；无调用方时回主页），右上角打开应用导航及实时传输入口（小于 350 CSS px 时传输入口自动收入应用 Drawer）。内层 `main` 应从标题栏以下开始并填满剩余高度，保留已有 Files/Gallery 滚动容器；不得把旧的 `main y=0` 验收要求机械套用在新 Frame 下。禁止全局悬浮导航、常驻底部导航、独立全局 AppBar 和遮挡状态栏的覆盖层；Desktop/宽 Web 不变。

标题栏右侧“打开应用导航”打开同一权限过滤后的应用 Drawer，账号/设置在 Drawer 内，上传/下载状态在标题栏内；打开/关闭 Drawer 不改变 route/history，不重新挂载当前 main。Files/Gallery 的条目短按打开、静止长按显示 Context Menu、拖动仅作用于有效目标；不在每个条目叠加 More、Info、Favorite 操作按钮。程序自己的文件工具条、PDF 页码、文本操作等保留在程序内；Viewer 使用同一全屏覆盖层和独立返回控件。详细规则以 [Mobile Web](mobile-web.md) 为准。

手机文件管理器在 900 CSS px 以下只呈现当前一个浏览上下文，**不显示 tab 栏**；内部新建/切换/关闭/恢复标签及目录菜单、中键的标签入口一起收起。当前目录、返回链和宽屏桌面的已提交标签状态继续由同一个共享控制器保存，不能为了隐藏 tab 栏而重建 workspace。后续工作只按[已批准清单](mobile-web-followups.md)依次推进。

## 新增 Web 程序的规则

新增程序必须同时：
1. 在 shared launch contract 与 Web Registry 注册稳定 App ID；
2. 明确 presentation、必需/可选参数及默认行为；
3. 参数只包含可序列化 canonical state；
4. 大集合通过 session/context 或 range contract，不塞入 URL；
5. 定义直接 deep-link、Back/Forward、无参数和无调用方时的行为；
6. 文件关联通过统一 resolver 添加，不在 FileExplorer 写新的格式特判；
7. Web/Desktop 同一业务概念优先复用 shared model/MUI surface，平台传输和 OS integration 保留在 adapter。


## 移动 Viewer

移动 Web 的 Viewer 继续使用同一个 Web App Runtime 和浏览上下文，不建立独立 mobile viewer。全屏根框架从加载到成功或失败持续存在。窄屏且主指针为 coarse 时，immersive Viewer 使用全动态视口高度；标题栏与底部 44px 操作栏覆盖在媒体上，安全区保护返回和操作控件，隐藏 chrome 不留下占位条。Text/PDF/Audio 也占满完整应用视口，但保留各自阅读所需的程序内工具栏。

图片预览在 1× 时支持横向 swipe 切换前后项目；放大后单指移动图片，双指 pinch 缩放，双击在 1× / 2× 间切换。单击内容延迟切换 chrome，从而与双击缩放区分。视频继续由原生 media controls 拥有手势；Live Photo 继续保持按住播放、松开停止，不用 Gallery swipe 覆盖其 hold 语义。

手机布局只是呈现投影：只有 Preview / Media Viewer 保留 Viewer context 与前后项 range 查找；Text/PDF/Audio 继续保持单文件程序。Favorite/Info/Share/Download 等适用命令以及浏览器 Back/Forward 规则保持原契约。
