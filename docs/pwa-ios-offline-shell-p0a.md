# xDrive · iOS PWA 静态 App Shell P0-A

更新日期：2026-10-20。代码基线以提交和 PR 的准确 HEAD 为准；这份文档是实现与验收契约，不是生产安全或 iOS 真机验收报告。

## 当前状态与目标

原版 Service Worker 只缓存公开 /offline.html，iOS 在无网冷启动时不能可靠运行 React/MUI App Shell。此前已具备主屏安装资源、52px App Frame、SW waiting 更新检测、前台任务和跨窗口安全提示、浏览器上传恢复及 Server durable task 区分；这些能力不重写。

P0-A 目标：首次联网完成安装后，把静态入口和 Vite 静态依赖图放到可恢复的 CacheStorage；没有网络时也可以显示已缓存的 xDrive 登录/导航 UI，但任何未在线授权的 Files/Gallery/Viewer 数据必须明确不可用。P1/P2 私人持久缓存不在本阶段。

## 构建

1. Vite 打开 build.manifest，生产 npm run build 在 Vite 后调用 web/scripts/build-pwa-shell.mjs。
2. 从唯一主入口沿 imports 遍历静态依赖，收集 file/css/assets。绝不遍历 dynamicImports，避免首次安装把全图库 Viewer/性能测试模块全部下载。
3. 只允许带 Vite 哈希的 assets/ JS、CSS、SVG、PNG、WebP、WOFF/WOFF2；整个启动 Shell 文件数上限 120、原始文件合计不超过 24 MiB。超出即构建失败。
4. 对文件实际字节、路径、原版 SW 模板求 SHA-256 内容修订号（前 20 个十六进制字符），生成部署用 /sw.js。资源变动触发浏览器后续更新检查。
5. Vite 专用相对 Base 性能构建跳过预缓存注入，不污染性能测试入口。

## 安全边界

- SW 仍采用延迟注册、waiting 提示和跨窗口更新保护：不调用 skipWaiting，不强制 reload，不主动 Cancel Browser upload、Viewer 或 Server durable tasks。
- 独立公共缓存：xdrive-pwa-public-offline-v1 存公开静态离线页；xdrive-pwa-public-shell-REVISION 只存精确预缓存清单。安装必须校验 HTTP/MIME、禁止重定向、匿名获取、最多 4 并发；任一资源失败则不激活不完整的新 Worker。
- GET 导航仅 /、/index.html 可以读公开 App Shell；其他路由、所有 /api、缩略图、原件、图片/视频、下载票据、分享、Range、写请求、JWT/Cookie 永不进入 SW 公共缓存。
- SW 激活只清除本应用前代公开 shell/offline 缓存，不清除无关站点缓存；浏览器或用户可以清退 App Shell，联网后可重新获取。
- Caddy /assets/ 使用 Vite 哈希不可变资源长缓存，缺失返回真实 404，不把 HTML 返回给 JS/CSS；/、HTML、SW 每次可重新验证。旧构建资源在线保留和 API 双版本兼容仍属 P0-B。

## 验收及性能纪律

| 场景 | P0-A 必须验证 | 状态 |
| --- | --- | --- |
| 合成 Vite 静态资源图 | 只生成白名单；JS 修改改变 Revision | 本地 Node fixture 已执行，待仓库 CI |
| 非法路径、私有 URL、缺失产物 | 构建 fail closed | 本地 Node fixture，待准确 HEAD CI |
| Service Worker 离线根页面 | 缓存 App Shell，不访问网络；hash 深链接不变 | Node Worker harness，真实 Chrome 待 CI |
| 非根导航、API、票据、Range、POST | SW 不接管；CacheStorage 无私人路径 | Node 与 Chrome 专项，待 CI |
| 两窗口版本更新、后台上传/Viewer | waiting，不强制更换控制器 | 既有真实 Chromium fixture 仍需回归 |
| iOS 27 主屏图标/飞行模式/存储清退 | 真实设备 FCP 与可交互时间 | NOT VERIFIED |
| 前后对照：冷/热启动、下载字节、p50/p95 | 同一设备/网络、准确版本 SHA，先基线后复测 | 尚无真实同条件测量，不宣称提速 |
| 100k Files/Gallery、请求取消、布局抖动 | 不重挂载、不闪烁，不以静态缓存代替性能修复 | 保留既有主线，P0-B |

生产环境专属安全验收按用户永久决定跳过（未验收），不请求生产凭证、HAR 或人工签收，也不以不可获取的生产证据阻断源码 CI；真实 iOS 系统行为没有执行不得宣称已通过。

## 后续阶段

P0-B：部署保留旧哈希文件、真实新旧 SW 版本/回滚、iOS 启动和 Files/Gallery 页面静态与业务数据分离，并重复测量导航抖动、请求与 CPU。P1：仅用户主动授权的 IndexedDB、按实例/账号隔离的只读快照与注销清除。P2：有限缩略图容量/失效/隐私管理；默认不缓存原件、视频、Live 或下载票据。


## P0-A CI 第一次完整回归与精确修复（2026-10-20）

- P0-A 初版准确 HEAD 2dc66c278ade34432e8a48d29d5a820797cba35c 的真实 Chromium S2B1 workflow #39442806481 已通过；完整 CI #39442804002 中 Web/Go/Linux/Windows/服务镜像等已执行主要作业通过，desktop-tests 一项工作共 7 个旧版静态断言失败，完整 CI **失败**，不可当作已验收。
- 失败位置：baidu-jsapi4-protected-http-route、pwa-s4b3-real-folder-resume-contract、pwa-s4c3-native-4gib/cancel/download-contract、pwa-s4d2-real-wake-contract、pwa-s4d3-real-durable-contract。前者过时地要求 SW 只拦截 navigate；后六项要求 CacheStorage 只有 /offline.html。
- 修复仅更新上述七项源码契约断言：保留地图 Server 代理/CSP/鉴权等所有既有验证，增加 SW 精确静态资产清单与同源边界断言；真实浏览器的缓存断言改用统一 assertXDrivePublicShellCache，精确验证当前编译 SW 公开资源集合（offline.html + index.html + 版本化 /assets/...），**出现多余私有 URL 或遗漏资源都会失败**。未删除实际下载 SHA、跨用户鉴权、上传续传、任务恢复的任何测试。
- 独立工作分支重新基于最新完整 master 并保留所有 AGENTS.md 和其他 owner 代码，使用一个全新的单提交 HEAD 重新跑全部 CI、Chrome；旧成功或失败作业不作为新提交证据。
