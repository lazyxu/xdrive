# SH-P014 · Public Share 与 Owner FileExplorer 共用 Details 行单元格和表头几何

## 当前进度与问题（2026-10-21 JST）

**状态：独立纯展示切片 / 尚未源码实测 / 不等于分享 1:1 完成。** 根目录分享和独立只读浏览器、整目录 ZIP、文件/文件夹右键分享、自动打开第一页、纯名称、图标及 Grid Tile 已由 #2117/#2148/#2158/#2233/#2240/#2243 合入。文件和文件夹分享 URL 当前正确采用 Share-scoped API，不允许借用账户 JWT、Upload、Move、Delete、Rename 或 DragDrop。

尚未 1:1 原因：Owner `FileExplorer.tsx` 和 `PublicShareReadOnlyExplorer.tsx` 的 Details 表头静态几何（sticky/高度/边框）以及每个 Details 名称/时间/类型/大小单元格相互复制；小改 Owner 可能导致 Share 视觉偏差。Share 列表额外具有“操作”第五列和嵌入按钮，真实整子树搜索/排序及受限 JPEG/H264/Live 缩略图尚缺，不能简单称为与 Owner 视觉完全相同。

本工作只提取并**双方实际挂载**纯 `XDriveFileExplorerDetailsRowCell`（统一角色、溢出裁剪、名称相对定位和数值右对齐）与 `xDriveFileExplorerDetailsHeaderGeometry`（统一粘性/背景/行高/边框/间距）。Owner 仍拥有列排序/拖拽宽度/调整/完整写操作，Share 仍仅有 Share DTO、图片显式预览、合法右键及单件/整根目录 ZIP；不变更第五操作列、分享页体样式，也不传入 Owner 的任何数据适配器。Mobile Web 的单点按、稳定的 52px Header、无抖动反馈以及分页最100项继续保持；不在空页面显示瞬时“加载目录”。

## AGENTS 性能先测后改合同

仓库 `AGENTS.md` 已明确要求先测试 CURRENT 原版与预冻结预算，超标才做最小生产优化，同一 runner/数据/方法 n≥3 真实前后对照，只有收益显著/重复且 CPU/RSS/字节/正确性无回退才保留，不满足即撤销并留原始 RED。因此不添加重复规则。本切片为布局纯函数与组件共用，无媒体字节、Agent IPC、Go SQL、Upload/Download、Copy、Sync/Delete 或真正 thumbnail 生产热路径更改；没有合理理由改动源吞吐算法。

已合入旧 SH-P013 物理原版源（非本 PR）真实100k JPEG Share 浏览器 n3 原性能：Wide Web1440 首/下一页 P50 **394.417/244.673ms**，CDP390 **328.015/251.205ms**，12/12 原件实际签名下载完整SHA，100行当前页、无旧行/水平溢出；100k PG17 元数据、1000页完整遍历 P50 **19.522s**。来源真实 [SH-P013 JPEG #39434555890](https://github.com/lazyxu/xdrive/actions/runs/39434555890) / [PG #39434555567](https://github.com/lazyxu/xdrive/actions/runs/39434555567)，已合入 #2243。不同Runner禁止与本新 HEAD 构造加速百分比。**BEFORE=CURRENT accepted historical, AFTER/speedup=N/A**；没有新真实数据前必须标注 Not measured。

## 真实性、性能与安全验收

1. 新准确 HEAD 上原 P001 PostgreSQL17 真100k元数据分页×3（1000页×100项目，完整扫描≤60s、单页P95≤500ms、worst≤2000ms）与 P005 Native Chromium真100k不同SHA可解码 JPEG 分享浏览器 Wide1440 n3 + CDP390 n3（首/次100项≤2000ms、12实际原件下载SHA与文件名/完整字节、单下载≤5000ms、无旧行/越权/溢出）均必须 SUCCESS，原预算不放宽。配置为本分支 opt-in，不在默认 PR 里增加昂贵工作。
2. 原 Owner 与 Share 需要真 React mount 检查 Details/Grid 切换、单点按/双击/Enter、已接受页面/选择不闪、上下页/返回、预览/下载/右键无额外反射操作及 100项DOM上限，Share 没有 Owner API/剪切/上传/移动/删除。原 `desktop/tests/web-public-share-form.cjs` 和新来源断言不能移除旧测试。
3. 全 77+ CI including 真实 PG API 原 Race 工具作常规门槛（**本工作不修改 Race**）、Web/Desktop/Go Linux+Windows/Rootless/制品、single-commit、Final Gate 和 GitHub clean 都需验证。冻结源码变更的任何 CI 老成功不能签发新证据 HEAD，历史 RED 原样保留。
4. 生产-only 安全验收按用户长期决定跳过（未验收），但代码层必须保持范围/撤销/当前 revision 与 Owner 隔离，以及用 `AbortSignal → Go Request.Context.Done` 取消视口临时读取；**不可**把离开分享页面误作取消已经被用户明确发起的持久 ZIP 或传输工作。

## 后续明确差距

本 P014 只是消除 Details 的纯 JSX/CSS 重复；**真正文件夹列表最终 1:1** 仍须移除第五“操作”列并改用选择工具栏/右键与 iOS 长按菜单、共享完整 DetailsHeader/Row+Grid 外壳/缩略图，同时增加 Share-only media derivative 票据（不是预取32MiB原图）支持 JPEG 缩略图/视频 Poster/Live still、可撤销 Live Motion，后台 Share-subtree 范围排序/搜索以及嵌套子文件夹独立 ZIP 绑定。完整独立合同 [#2205](https://github.com/lazyxu/xdrive/issues/2205)。真 iOS/Android/安装态 PWA/WAN/4GiB 共享下载仍 Not measured。
