# xDrive · P0-B2b1：两套真实独立 Web 发布构建的懒加载升级/回滚验证

日期：2026-10-21。上游 P0-A #2246、P0-B1 #2252、P0-B2a #2256 已合入。继续使用现有 52px iOS App Frame、统一 Files/Gallery/Viewer、Vite 实际 SW 和 Caddy 公开哈希归档规则，不修改产品源代码。

## 本阶段相较 B2a 的新增真实证据

- 在 CI 中分别 checkout **历史真实提交** `e6018a4c260d1d7fff5e1718421cfb2a21f9dbd4`（P0-A 合并点，称 A）和本 PR **准确 HEAD**（称 B），各自单独 `npm ci` 与 `npm run build`。这不是单次构建写入 synthetic ESM / message probe。
- 两份真实 Vite `.vite/manifest.json` 提供真实哈希入口和未预缓存的 `isDynamicEntry` 按需 JS；各自生产 SW 的 revision 与入口 SHA256 必须不同。记录两个真实模块的 SHA256 是否不同；如相同如实记录，不虚构哈希差异。
- 真实执行 `deploy/pwa-archive-assets.sh`。通过本地匿名 HTTP 测试服务精确模拟当前 Caddy 的 `/assets/*` immutable、真实缺失 JS 404 和 HTML/SW no-cache；该服务只代表**静态 HTTP 语义**，不冒充真正 Caddy 进程或 Server。
- 在真实 Chromium 中分别测试 A 窗口保持打开、B 发布与注册新真实 SW、A 的真正懒加载 ESM **第一次升级后经归档请求**，再关闭旧窗口激活新 SW；独立上下文反方向 B→A 模拟回滚，首次读取旧 B 懒加载模块。测试 HTTP 200、JS MIME、SHA256、字节数、真实 `import()` 执行、活跃旧控制器与新 Worker `waiting`、无强制刷新。
- 公共 CacheStorage 只保留正式 App Shell 和 offline；不允许 `/api`、私有媒体、Range、上传/下载票据以及本次按需模块。匿名 `/api` 返回 401，未知 JS 路径返回 404 非 HTML。没有用户账号、生产访问或密钥。
- Chrome Desktop 和 390px Mobile **模拟**分别执行，单纯 Chrome 模拟绝非物理 iOS Safari。输出含 SHA/真假开关的匿名 `summary.json`；不会上传 Cookie、JWT、HAR、用户文件、目录。

## 边界与剩余 P0

**本阶段是真实独立构建的 Web 双版本验证，但不是 Go Server 双版本 API 验收。** 测试服务不运行 Caddy 可执行文件或 Go A/B Server，不能证明 Web A↔Server B / Web B↔Server A 的鉴权、节点、图库及长传输行为。后续 P0-B2b2 单独验证真实 Go API 版本偏斜与继续上传；之后 P0-B2c 只读资源容量/生命周期，P0-C iOS 冷热启动、离线、Files/Gallery 100k 同条件 BEFORE/AFTER 数据。不得提前实行 P1 IndexedDB 私人内容和 P2 大图库缩略图批量缓存。

性能报告禁止从 6 个公共文件的体积推测 FCP 提速；Chrome 390px 不能被标记为真实 iOS 27。发布过程中不得 `skipWaiting`、强制刷新页面或调用 Go `ctx.cancel` 取消用户持久任务。

单工作提交在完整 master 上实施，全部 AGENTS 历史保留。只有准确 HEAD 的独立 Chromium 专项、完整跨平台 GitHub CI（含真实 PostgreSQL API Race、Final Gate）和 GitHub clean mergeability 全部通过才允许合并。无法接触的生产环境安全验收按用户决定 **跳过（未验收）**，保留源码级鉴权/隐私及 CI 验收。

## 首轮准确 HEAD 浏览器阻塞与修正（2026-10-21）

- 原始 `fa1d41ffa665edc26ccfc8c06e72062240225619` 两个真正独立 Web 构建及 Node 源码测试完成；专项 Chromium [#39532281519](https://github.com/lazyxu/xdrive/actions/runs/39532281519) **RED**：初次 A 页面 `goto(waitUntil:'domcontentloaded')` 30s 超时，尚未开始升级/回滚语义验证。绝不标为 A/B 成功。
- 收敛为 Playwright 正式的 `waitUntil:'commit'`：只让导航等待**真实 HTTP 文档响应被浏览器接受**，随后照旧校验 200、生产登录入口实际可见、真正 SW ready/controller、A/B 历史归档、已执行 ESM、等待/回滚、隐私和 SHA256；未调长时间阈值、弱化 UI 或跳过测试。若真实 UI 没有绘制，locator 本身仍超时并使 CI 失败。
- 新准确 HEAD 的真实 Chromium 和完整 CI 必须重新执行；以前错误的 SHA 不得授权合并。

## B2b1 第二个失败 HEAD 的真实浏览器传输诊断（2026-10-21）

- `0f19034a42ef07960fdd883f053c0c7f1e292205` [专项 #39532933182](https://github.com/lazyxu/xdrive/actions/runs/39532933182) **RED**：两份生产 Web 再次独立构建成功，源码静态约束通过；`goto(waitUntil:'commit')` 仍在 Chrome 初始页面时超时，证明不是单纯等待 `load` 或 `DOMContentLoaded` 的问题。升级/回滚证据仍为零。
- 只添加测试夹具内**匿名本地** HTTP GET `/index.html`（200/MIME）的预检查、固定公开路径的有限 Chrome 请求/响应生命周期观察，以及文档/静态/SW 计数。失败时只输出资源路径和响应码，不输出 query、Cookie、JWT、授权头或 HAR。保留原 30s 真实 Chrome 导航/真实可见登录 UI 和 SW、A/B ESM、回滚全部断言。先分辨 HTTP 服务是否通、Chrome 是否实际请求，不凭猜测改应用逻辑。
- 新 HEAD 的 source-exact 专项 Chrome 和完整 CI 必须重跑；既往两个 RED 均永久保留作事实依据。

## B2b1 测试脚本语法与提前失败门禁（2026-10-21）

- 第三轮诊断脚本加入本地 HTTP 预检查时，字符串模板写入的正则转义层数可能造成 JS 无法解析。修正为 `observed.preflight.mime.startsWith('text/html')` 且保留真实 200 门槛；新增正式 GitHub workflow `node --check` 先检查两个 Node 测试脚本。避免耗时完成两次完整生产构建后才发现可静态检查的问题。
- 保留前两次 Chrome 首次导航 RED、真实 A/B Vite 构建、固定路径网络事件诊断和全部旧版保留/隐私/真实 ES module 等待断言。当前 HEAD 需要全新的完整 CI 与 Chrome。

## B2b1 最新真实双构建浏览器结果与归档路径修复（2026-10-21）

- 第三轮 HEAD `e80e3d8e2d69fe263e1d0287a9687483bbba24e9`，真实双独立 Vite 构建完成（A 为 **6 文件/2,494,416 原始字节**，B 为 **6 文件/2,500,686 原始字节**）；7/7 Node source-contract passed。专项 [#39533955611](https://github.com/lazyxu/xdrive/actions/runs/39533955611) **FAILED**，不得据此放行。
- 先前 30s Chrome 首屏超时在本轮不再重现：匿名 HTTP 预检 200、生产主入口和 SW 被真实请求（文档 7 次、SW 4 次、静态请求 30 次）；之后实际执行 A→B、B→A。测试最终在完整性检查抛出 `ENOENT`：归档脚本传入的源根是 `dist/assets`，归档相对路径为 `<archive>/PwaInstallDialog-<hash>.js`，但末尾检验错误读取 `<archive>/assets/PwaInstallDialog-<hash>.js`。
- 本次只修正**测试夹具**末尾完整性读取路径，严格复用与匿名 HTTP `/assets/*` 一致的 `assets/` 前缀剥离规则，增加防回归源码测试；不碰真实生产静态归档脚本、PWA worker、Server/Go、Caddy、账号/媒体及任务安全。仍需准确新 HEAD 的双版本 Chrome 与完整 CI/Final Gate 全部成功才可合并。真实 iOS、Go 双版本 API、真实 Caddy 和性能收益仍未验收。
