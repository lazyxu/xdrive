# xDrive · 统一 FileExplorer Core（Owner / Share）架构与验收合同

> **当前主合同 · 2026-10-22。** 这是跨 Web、Mobile Web 与 Desktop 的 FileExplorer Core 和 Share 授权/性能边界，不是既有 PR 的历史执行日志。历史证据继续放在 [SH-P020](unified-file-explorer-capabilities-p020.md)、[SH-P021](unified-file-explorer-single-core-shp021.md)、[SH-P022](unified-file-explorer-server-grants-shp022.md) 和 [性能登记簿](performance-test-registry.md)，不要删除失败样本、覆盖源码 SHA 或改写其历史状态。

## 已确认的架构决策

**一个交互与渲染核心、两个彼此隔离的读取/操作适配器：**

```text
XDriveFileExplorer Core（共享）
  ├─ Virtualized Grid / Details / viewport / selection
  ├─ Viewer / thumbnail / properties / context actions
  ├─ capability-based action presentation
  └─ request-scoped visible-data cancellation
       ├─ Owner adapter → account JWT + per-item ACL / Owner APIs
       │     ├─ sparse virtual Range（任意有界窗口）
       │     └─ authorized cursor pagination（适用页面）
       └─ Share adapter → Share Token + password / Share-only APIs
             └─ bounded keyset/cursor page (≤100 authorized entries)
                 ├─ Share-only preview / thumbnail tickets / original download
                 └─ durable folder ZIP preparation + explicit task control
```

**核心是展示/交互的复用，不是复用访问令牌。** 普通 Share Token 不得注入 Owner JWT/ACL API、Desktop Agent IPC、FileOperation 或 Owner 对象选择器。Share 使用独立的 Go 接口，在分享根目录授权后服务端检查每次目录列表、图片票据、原件、Range、ZIP 和能力；Owner 继续独立校验用户身份/权限。UI 隐藏操作只是能力投影，**不能**代替后端鉴权。

### 1. 不再单独开发分享浏览器

- 已合入 [SH-P021 #2307](https://github.com/lazyxu/xdrive/pull/2307)：已授权的**分享文件夹**实际挂载和 Owner 同一个 `XDriveFileExplorer` Grid/Details Core，调用专属 Share 数据适配器，使用相同的虚拟滚动、缩略图调度、选择、预览和属性/菜单基件。原 Share facade 暂时管理分享密码、过期、次数、单文件显示及 ZIP 生命周期；它**不是**第三套可持续演进的文件夹浏览器。
- Owner 大目录的稀疏 Range 保留按可视窗口取元数据的策略；Share `publicShareChildren` 使用 Go 端有界 keyset/cursor（当前页 **最多 100 项**），前端只保留当前窗口和必要的短游标历史，绝不能将 100k 子项加载为一个 JS 数组，也不得全量客户端排序/搜索。Share 的“筛选当前页”只筛当前已授权的最多 100 项，**不等于**全子树搜索。
- 已授权的 Share 文件夹 Grid/Details 已复用 Core。后续 SH-P023 将单文件分享也直接交给同一 Core，仅保留不含独立行/网格/浏览逻辑的 facade。**Share 全子树搜索/排序、全格式媒体 Viewer 的完全一致性、可配置安全 preview-only 仍未完成**，不能因为单文件 UI 共用而谎称完成。

### 2. 服务端七项能力是上限，不是 bearer 授权

Go `GET /api/v1/public/share` 已按 [SH-P022 #2312](https://github.com/lazyxu/xdrive/pull/2312) 返回：

| 能力 | 当前公开文件 | 当前公开文件夹 | 授权边界 |
| --- | --- | --- | --- |
| `list` | true | true | 当前 Share 令牌/密码、有效期、Owner、Share 根目录 |
| `preview` | true | true | 每个预览/缩略图与签名票据独立检查 |
| `download` | true | true | 原件/签名票据/Range 的 Go 独立授权 |
| `downloadZip` | false | true | 服务端选择根目录、prepare/status/ticket/stream、次数 |
| `search` | false | false | Share 全子树安全搜索 API **未实现** |
| `write` | false | false | Share 无匿名写入/移动/重命名 |
| `delete` | false | false | Share 无匿名删除 |

默认只读**允许原件下载**；目录 ZIP 在独立 Server durable task 中准备。浏览器 UI 根据 grant 控制入口，Go 必须对每一个 API 独立检查 Share Root/Owner/密码/过期/撤销/下载次数和目标子节点归属，并拒绝 Share Token 调用 Owner API。不可将前端 `readOnly` 或 `downloadPending` 当作权限；下载忙碌不得撤销仍然合法的浏览/预览权。

未来“仅预览、不允许下载”应该由**同一** Go Share 授权策略持久化、签发并在所有原件 ticket、Range、ZIP prepare/status、ZIP 流和普通下载路径执行，验证直接构造 URL 的拒绝。**当前仅有 UI 能力上限，不具备安全的可配置 preview-only 分享链接。** 禁止原件下载也不等于绝对阻止浏览器保存它已经收到的预览字节。

全子树搜索、排序将来必须是**Go/SQL Share-root-scoped 语义**（含 cursor/稳定排序键及 100k 覆盖），不得用逐页浏览器合并或 Owner Search 接口伪装。Owner 原有授权 Range/搜索与排序独立保持。

### 3. 请求级取消与持久任务取消是不同所有权

| 生命周期触发 | 立即取消的对象 | 不允许无故取消的对象 |
| --- | --- | --- |
| 虚拟滚动离屏/切目录/下一游标 | 已失去消费者的 Share/Owner 列表、缩略图、预览短请求 `AbortController` | 用户主动启动的上传、原件下载、ZIP、同步、删除 |
| 切 Files/Gallery App、Viewer 退出或组件卸载 | 已过时的元数据 Range、图片/Poster/Viewer 请求及对应 Go `Request.Context().Done` | 已入队的服务器持久任务与其他视图仍需要的任务 |
| 浏览器隐藏或 `pagehide` | 与当前可视生命周期相关的临时 HTTP、缩略图消费者、待完成的列表请求 | Server durable ZIP prepare、同步、删除和已启动的持久传输；除非用户显式 Cancel |

前端须同步 `abort()`，不等待 React 下一次渲染；Share/Owner Adapter 把 `AbortSignal` 传给 Fetch/XHR/IPC 接收端，Go Handler 尊重 `Request.Context().Done` 释放 CAS/SQL 等下游资源。**取消浏览器对 durable Task 的轮询，只意味着停止观察；不是向 Task Center 发出取消命令。** 显式用户 Cancel 才可通过后端受权限保护的任务控制接口终止已启动任务。浏览器本身无 durable 能力的原始下载必须单列，不得谎称跨窗口持久恢复。

## 真实性能证据与未知边界（不把不同 CI Runner 拼成 A/B）

| 专项 / 已合入 PR | 实测 CURRENT 或匹配 A/B | 是否证明生产优化 |
| --- | --- | --- |
| [SH-P018 #2275](https://github.com/lazyxu/xdrive/pull/2275) 同 Runner n9 | 1440px Go 取消 P50 `127.940→55.371ms`（-56.7%）；390px `113.940→49.701ms`（-56.4%） | **仅此配对**具有匹配收益 |
| [SH-P021 #2307](https://github.com/lazyxu/xdrive/pull/2307) | 100k SHA 不同 JPEG Share 实体目录和同一 Core、100 条页、Go 6/6 取消 | 架构复用验收，AFTER=N/A |
| [P070 #2320](https://github.com/lazyxu/xdrive/pull/2320) | 受控真实 HTTP 隐藏 P50 `645.826→1.430ms`，废弃 98,304→0 字节 | 仅此受控 HTTP 配对；**不代表**整套 100k Go 提速 |
| [P072 #2326](https://github.com/lazyxu/xdrive/pull/2326) | 100k SHA 不同 JPEG 物理 CAS、六个真正隐藏而未卸载的 Chromium、Go Context.Done **6/6，最慢 28.080ms**，0 残留字节 | CURRENT/BEFORE；没有产品代码优化 |
| [P073 #2331](https://github.com/lazyxu/xdrive/pull/2331) | 前一准确测量 HEAD `9fe9abbe` 的真实 Share **第二游标列表 POST**：Go Context.Done **6/6，最慢 30.476ms**；零废弃 body，原页仍在 DOM | **Draft / 归档最新 HEAD 未通过独立 Final Gate 之前不得称合入** |
| [P068 #2309](https://github.com/lazyxu/xdrive/pull/2309)、[P071 #2321](https://github.com/lazyxu/xdrive/pull/2321) | Web/Desktop 4 GiB 真实高熵上传下载、100k Sync、100k 逻辑/115k 物理混合 Gallery/H264 Poster | 达到既定预算，产品未做优化；AFTER=N/A |

P072/P073 真实 Chromium 测量是 **Linux Xvfb 环境的 Web1440 / CDP390 模拟 Mobile Web**，不代表物理 iOS Safari/Android、真实 WAN、Windows/macOS Agent、所有视频/Live Motion 播放，也不代表 100k 缩略图同时解码。测量源 SHA、n、P50/P95/max、CPU/RSS、物理 bytes/SHA/Go active/wasted bytes 必须跟随原始证据保存。

## 按 `AGENTS.md` 的研发与 PR 顺序

1. 优先关闭/合并现有相关 PR，按依赖处理。已合并的 SH-P018/P020/P021/P022/P070/P072 与 P068/P071 **不得重做**；没有真实未合入分支不要制造重复分支。
2. P073 **只处理当前真实 100k Share 列表隐藏取消证据与 CI**，前一 source-exact GREEN 不自动授权归档 HEAD。CI/Final Gate+clean 后即可收尾，不把无根据的优化嫁接进来。
3. SH-P023 单文件分享改走原 FileExplorer Core，只删独立展示行，不触碰 Owner/Go/ZIP 访问控制，附单文件密码/撤销/下载及权限/真实文件夹 100k 回归。Share-root 全子树搜索/排序与 Preview-only Go 策略须分别做最小独立 PR；不得因为统一 UI 而宣布这两项已经完成。
4. 性能专项先测 **CURRENT/BEFORE**；达预算则保留现状。如果客观不达预算或有明显尾延迟，先定位瓶颈，之后在**同源码/同 Runner/同负载**独立 n≥3 做匹配 BEFORE/AFTER；收益显著且 CPU/RSS/I/O、网络字节、数据完整性和 Owner/Share 权限不退化才保留。Race 专项不改。
5. 完整 Web/Desktop、Go Linux/Windows、真实 PostgreSQL API、源码安全负例和 Final Gate 不得跳过。无法接触的生产环境专属安全验收统一为 **“按用户决定跳过（未验收）”**，不索取 AK/JWT/Cookie/HAR/生产账号，也不将其作为源码/CI/合并门槛。

## 仍需的验收矩阵

- 10k/100k Owner sparse Range，Share 100k keyset 100项/页及异常深目录；Web 1440、Mobile Web 390、Desktop Agent 分开标注实测。
- Grid/Details、虚拟离屏、缩略图 JPEG/H264/Live 静态图、视频 poster、Viewer 图片/PDF/视频首帧、搜索/排序/属性、单个文件和子文件夹下载/ZIP。
- 大文件 Web/Desktop 1/4 GiB 真 SHA 上传/下载/断点/取消；100k Copy/Move/Delete/Undo/Sync 持久任务和入队尾延迟；后端 Root/Owner/Token/撤销/密码/配额负例。
- 滚动/切目录/路由/窗口隐藏时，分别测已经实际建立的请求、Go Context.Done、Handler active=0、废弃响应字节和取消后 CPU/RSS 释放；同时实测 durable Task **不被这些展示生命周期错误取消**。Race 单列。
- 本条 SH-P023 的验证必须在自身准确 HEAD 重跑 `desktop-tests` 与 Web 构建，并通过此分支启用的 SH-P021 原生 Chromium / PostgreSQL / CAS 物理 100k 和 P073 Share List → Go `Context.Done` 取消专项；失败时不得复用父分支绿色记录。
