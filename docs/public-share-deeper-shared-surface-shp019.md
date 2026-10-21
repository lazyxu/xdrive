## SH-P019 · 原版真实 100k 物理 SHA 不同 JPEG 六会话通过，原 CI 两处旧样式断言 RED（2026-10-21）

- **严格原测量源码** `deef8a01d0ca0b9d2fc1ff898a03d0c69268e694`，[PG17/Gin/LocalCAS + Chromium 专项 #39560252661](https://github.com/lazyxu/xdrive/actions/runs/39560252661) SUCCESS。100,000 个真实 SHA 不同物理 JPEG 原片，实际 CAS 分配 409604096B；1440px Web n3 与 CDP390 模拟 Mobile Web n3 均仅渲染受限 100 行、翻页 100 行。Wide 首/次页 P50 **371.160 / 226.060ms**，CDP390 **289.874 / 249.598ms**；每页都低于冻结 2000ms。12/12 真正签名下载 SHA、文件名与完整字节校验成功；0 stale rows / 0 horizontal overflow，最慢原件下载 **165.687ms** < 5000ms。**没有 100k 缩略图同时解码，也没有真 iOS/PWA/WAN**。
- 永久归档 [结构化原始日志 JSON](performance-evidence/sh-p019-shared-item-surface/ci-run-39560252661.json)，原始 [专项 job log](https://github.com/lazyxu/xdrive/actions/runs/39560252661/job/119089516414) 与 [workflow artifact](https://github.com/lazyxu/xdrive/actions/runs/39560252661/artifacts/12328010140) 保留。旧 SH-P015 100k 不同 CI Runner 的数据不能组成有效配对 A/B，所以 **AFTER/speedup=N/A**，代码改变是无权限的纯 JSX 复用，未动 Go/SQL/CAS/短时取消。
- 同一原 HEAD [完整 CI #39560252823](https://github.com/lazyxu/xdrive/actions/runs/39560252823) 的 `desktop-tests` 实际 **RED 2项**：旧 `file-explorer-performance.cjs` 仍在 Owner 组件内查找已下沉纯组件的 `contentVisibility`；旧 SH-P013 Grid 视觉测试仍断言原 Public Box 上独立的 border/radius 字符串。真实 Web/Desktop build 与 100k 专项没有因此否决；本切片严格修正这两项**源码位置测试断言**，改为同时核对 Owner/Public 真调用共享 Surface、虚拟 Grid 仍使用 render containment、Grid 不恢复原边框。保留历史红色，禁止删除测试或削弱布局约束。
- 最新完整 master 重建 / 新证据 HEAD 形成后，前面绿的**旧源码不能授权新 SHA**；必须新 SHA 独立真实 100k×6 专项、全部 77+ CI 包括 desktop-tests/Go PostgreSQL API/Windows/Linux/Web/Desktop/Final Gate、GitHub clean 然后才 Ready/Rebase Merge。生产安全验收按用户决定跳过（未验收），源码负权限仍必验。

---
# SH-P019 · Owner/Share FileExplorer 共用 Details 与 Grid 外层文件项

## 2026-10-21 源码实施与状态

Status: **Draft、准确 HEAD 真实性能待测**。SH-P019 是纯视觉/DOM 容器复用，不修改 Go/SQL/Blob/CAS、账户 FileExplorer 数据控制器和 PublicShare 独立权限/数据接口。

此前已经合入：文件与文件夹右键分享 #2117、独立只读 Share Explorer #2148、根目录完整 ZIP #2158、四列 Details/当前页安全动作 #2251、目的限定已缓存缩略图 #2258、分享范围内子文件夹 ZIP #2267。不可重做。

新的共用 JSX XDriveFileExplorerItemSurface 位于 ui/shared/src/mui/FileExplorerItemPresentation.tsx。账户 Details + Grid 和公开分享 Details + Grid **实际挂载同一个组件**；统一外层轨道/行高、Grid Tile 尺寸和占位、内容可视/containIntrinsicSize、圆角、选中/悬停/聚焦状态。缩略图和单元格仍采用此前共用组件。

边界：ownerInteraction 只在 Owner 调用、组件内部选用原 ButtonBase（原 DOM 事件原样传入）；Share 默认原 Box，不导入 Owner JWT、Account FileExplorer Controller、Agent、移动/复制/重命名/删除/上传/剪贴板/拖放。事件属于各自调用方而非共享展示组件。分享最多单页 100 项；继续独立权限校验、密码、撤销、修订、限次及可取消短时预览/缩略图，持久 ZIP 须显式取消。

## 原版性能 FIRST（不同源码/Runner，不是匹配 A/B）

- Owner P067 #2244：真实 100k 逻辑 + 115k 物理 JPEG/H264/Live，Grid/Details P50 Desktop 740.436/598.782ms，Wide Web 608.684/426.829ms，Mobile CDP390 363.616/361.058ms，均在冻结预算内。
- Public SH-P015 #2251：真实 PostgreSQL17 100k metadata/1000 页三组 P50 15.815s；100k 独立 SHA 物理 JPEG Chromium Wide1440 三组首/后页 P50 356.446/193.260ms，Mobile390 模拟三组 292.201/204.973ms，12/12 签名下载实际 SHA 完整。独立不同 CI runner，不能计算任何产品加速。
- Public SH-P018 另测原版短时缓存 JPEG 视口取消：6/6 浏览器→Go Context.Done，最慢84.061ms、0遗留响应字节；本切片不修改原有 AbortSignal/Go Handler。
- 新 SH-P019 专项 CURRENT valid n=0、AFTER=N/A、speedup=N/A，等待准确 HEAD 的物理测试。纯表现层重构，不编造加速。新 HEAD 如果达到固定预算不做 Go/SQL/网络调优；若出现真实 RED 则另行用相同硬件/数据/Runner n≥3 交替匹配 BEFORE/AFTER，只有显著收益且 CPU/RSS/IO/字节/授权无回退才保留。

## 固定验收

专用 .github/workflows/sh-p019-owner-share-outer-surface-100k.yml 针对本分支执行真实 PostgreSQL17/Gin/LocalCAS + 100,000 独立 SHA JPEG、Wide Web1440×3 与 Mobile CDP390×3、每次先/下一页各100项、12/12 真实完整 SHA 签名文件下载。每页≤2000ms、每次下载≤5000ms、无陈旧/越权、无横向溢出。新 TSX 源码通过 Web/Desktop build 以及含 Go API/Windows/Linux/Final Gate 的完整 CI，单工作提交、准确 HEAD GitHub clean，才可 Ready/rebase merge。旧专项或只有 Node 静态检查不构成新 HEAD 验收。

## 仍未实现

本切片不表示完整1:1：更上层的可调列/排序/搜索/虚拟化、全部媒体格式 Viewer、真机 iOS/Android/PWA/WAN 需要分别有限域实施验证。不能把普通 Share token 传入完整 Owner FileExplorer。生产-only安全验收按用户决定跳过（未验收），源码权限/撤销与 CI 不跳过；Race 不在本任务范围。
