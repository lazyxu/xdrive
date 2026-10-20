# SH-P011 · 只读文件夹分享链接自动进入 FileExplorer 目录

**状态：Candidate / 已通过真实100k六会话与77-job完整CI；最终证据归档HEAD等待复验。** 2026-10-20，冻结完整 `master@86d58ad7687fb57207c11dc60dd3a1bd2e7537f7`，仅在新专用分支修改分享页面、原有实际挂载测试、真实 100k 浏览器性能脚本、分支专项 CI 和性能登记簿。生产性能优化：**无**；Race：不涉及；旧 AGENTS.md 先测、同条件复测、提升不明显则保留原实现等永久约束完整保留，不重复修改。

## 现有、已通过的真实性能 BEFORE

- 原正常“先点浏览文件夹”的分享分页路径：真实 PG17/Gin/LocalCAS **100000 个各自不同 SHA 的 JPEG 原片**+1 隔离哨兵，宽 Web1440 首/下一页 P50 **123.823 / 190.434ms**；Mobile390 CDP 首/下一页 P50 **112.027 / 178.558ms**；各 n3，12 次真实原件下载 SHA/文件名/字节全对、最慢 123.915ms、每次最多100条。来源 [#39396239737](https://github.com/lazyxu/xdrive/actions/runs/39396239737)，<=2000ms 分页、<=5000ms 单件下载全部通过，因此**不改变生产 Server 查询、分页、ZIP、下载热点**，**优化后/提速=N/A**。
- 原整文件夹真正 100k 持久 ZIP：[#39255424998](https://github.com/lazyxu/xdrive/actions/runs/39255424998)；准备 P50 **2127.069ms**，流式下载 P50 **3641.683ms**，3/3 abandoned GET 到真实 Go Request.Context.Done，最坏 **0.208ms**；保持原有 ZIP 独立生命周期与授权，浏览器页面关闭不能删除任务。
- 新**链接打开→首100条**场景本来需要用户额外点击，**没有同口径历史 BEFORE 时间样本**。不得拿旧点击→首屏 P50 伪造速度增长百分比。这轮是 UI 交互行为修复而非性能优化。

## 最小更改

1. 匿名访问文件夹 Share 元数据成功且不需要密码、没有耗尽下载额度时，**直接调用一次**既有 Share 专属 `publicShareChildren(token, '', root=0, cursor=0, AbortSignal)`，进入已经存在的只读 `XDrivePublicShareReadOnlyExplorer`。绝不挂载完整 Owner FileExplorer 或以 Share token 请求私有 API；绝不预加载 100k 原图。
2. 用原已有的安静固定区承载真实待完成目录，无短暂“正在加载文件夹”或二次点击；原列表/网格、文件图标、面包屑、属性、右键只读操作、当前页筛选、分页、选择与关闭预览保持。
3. 有密码与已耗尽的链接不能发出列表读取；真实终态读取失败保留明确报错和“浏览文件夹”重试。页面退出、切换 Share token/隐藏 Tab 取消不再消费的首目录请求，直到 Go `Request.Context.Done`；不触碰用户主动提交的持久 ZIP 准备、上传、下载、同步、删除、取消。
4. 文件分享与文件夹子文件共享同一组只读展示/图片预览，保留 #2224 90s 短期限权图片 Quick Look、原文件单独下载以及 #2158 整文件夹服务器流式 ZIP。全局搜索/排序、视频 Poster、Live Motion、Pixel 1:1 属于 [#2205](https://github.com/lazyxu/xdrive/issues/2205) 后续，不能假称已完成。

## 相同源真实 100k 复测及合入门槛

- 复用 `desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs` 与原 GitHub opt-in 专项工作流：真正 PG17/本地 CAS **100k 不同 SHA 实体 JPEG**，Web1440 3次 + Chromium CDP Mobile390 3次，真实 HTTP Share 元数据/子目录首100行、Next100行、12笔带签名真实下载/完整 SHA 以及超范围拒绝。**新计时包含导航加载到首100行，不能与原来的点击后计时当成 matched A/B**。
- 冻结新链接→首页 <=2000ms，下一页 <=2000ms，单件下载 <=5000ms；<=100 已授权 DOM 行，无上一页污染/横向溢出，前后源文件分配/bytes 不变。首次新 CI 报告之前新 workload `CURRENT n=0`、`AFTER=N/A`、`speedup=N/A`，失败必须保留 RED 和分析，不放宽预算美化数据。
- 文件/文件夹密码、过期、额度、撤销、次级目录权限必须维持现有 Server 守卫；测试自动打开只读请求、分页、React mount 取消、固定页面高度、错误重试、原 ZIP 和下载。
- 所有受影响的默认 Linux/Windows、Web/Desktop、真实 PG17 Go API Race、Rootless、CI artifacts、single work commit 以及 Final Gate 和专用 6-session 真实 100k CI，且 HEAD clean 后才能 Rebase Merge；历史不成功数据不能删除。
- 本地 iOS/Android 已安装 PWA、真实 Desktop Agent 与 Windows 文件系统、实际 WAN、H264/HEIC/LIVP 原图动态播放、1GiB/4GiB 传输不受当前证据覆盖，明确 **Not measured**。

## 2026-10-20 · 首轮 CI 失败与精确纠正

- 首个测试源 `3afe19b8eaa50dc1bf07456c3b7450a7242e4cc3` 的真实物理 100k 六浏览器专项 [#39411509701](https://github.com/lazyxu/xdrive/actions/runs/39411509701) **SUCCESS**，但完整 [CI #39411509132](https://github.com/lazyxu/xdrive/actions/runs/39411509132) 的 Desktop Tests **RED**，不能将通过的专项当作完整验收。
- 实际失败仅定位两个测试契约：SH-P011 首目录失败重试把测试版 `Box` 组件及其宿主 `div` 重复计为两行（实际仅一条共享文件记录），现限定计数真实宿主元素；SH-P002 旧源码静态断言只接受单行 `return () => { active = false; controller.abort() }`，现分别验证元数据和首目录均释放 AbortController，并保证绝不将页面请求 teardown 升级成持久 ZIP 任务取消。
- 生产功能与同一预算不变，无 Server/Owner API/Race/持久任务修改；当前修正 HEAD 的新六浏览器真实 100k 专项以及完整 CI/Final Gate **须独立通过**才允许取消 Draft/合入。上一失败保留历史证据；不同源码 SHA 不可复用结果。

## SH-P011 · 100k真实JPEG分享链接直接进入首100项 · 2026-10-20

准确测试源码 72f5fc4b911f3b2992d16a78c98e6ca63ab39657：Chromium Wide1440 n3 与模拟 Mobile390 n3，PG17/Gin/LocalCAS 100000 SHA各异JPEG原件。独立 [专项CI](https://github.com/lazyxu/xdrive/actions/runs/39413566021) **SUCCESS**，[77-job全量CI](https://github.com/lazyxu/xdrive/actions/runs/39413565919) **SUCCESS**（25成功/52条件跳过，Final Gate成功）。

| Client | first100 P50 | next100 P50 |
|---|---:|---:|
| Wide Web 1440px | 360.090ms | 313.064ms |
| Mobile Web CDP390 | 304.828ms | 280.389ms |

全部100行限定、6会话12/12真实签名下载SHA/大小/文件名准确，没有旧行和横向溢出。最慢首/下一页 379.999/322.632ms，原件下载 110.410ms，冻结≤2000/5000ms预算内。原件字节 70893376B，物理CAS 409604096B；播种耗时 76728.987ms排除。完整六样本和CPU/RSS/HTTP次数: [机器JSON](performance-evidence/public-share-folder-auto-open-shp011/ci-run-39413566021.json)。

判定：原版生产查询/ZIP/权限不变（没有性能热路径优化），BEFORE/AFTER速度增益 N/A；旧版点击 Browse→首100行与新链接→首100行不是同起点、同运行器的匹配 A/B。归档后的新 SHA 必须重新通过自身六会话100k和完整CI后才能合入。真正iOS/Android/PWA/WAN/Desktop Agent/视频Live/4GiB未测；首轮失败CI保留。

---
