## SH-P012 · 已完成 CI 失败归因与源准确修复（2026-10-20）

- 当前测试提交 `3c3fca909acc47eef0852c14d7ca4f8d6734452c` 的 [77-job 全量 CI #39424822307](https://github.com/lazyxu/xdrive/actions/runs/39424822307) **RED**：`desktop-tests` 真实 3415 tests / 3413 passed / 1 failed / 1 skipped，随后 `final-gate` 失败。唯一 RED 用例 U07 Unicode 的原静态检查误把 `title={name}` 中的两次属性传值，算入两次实际 JSX 文字节点，故断言期望 2、实际 4。Owner/Public 正式展示叶子各含 Grid/Details 两次**文字**节点是正确行为。
- 原测试修正为精准匹配 `> {name} </Typography>` 的两处 JSX 内容（允许空白），单独保留 `title={name}` 两处与 Unicode 安全断言。生产 UI、Server/Go、ZIP、数据权限、性能预算与原 React 挂载断言均不变。单工作提交原分支修复，**绝不删除或淡化 RED**。
- 修复前相同准确源码的 [SH-P001 真正 100k PG17 元数据 #39424821034](https://github.com/lazyxu/xdrive/actions/runs/39424821034) PASS：三个 1000 页真实遍历 P50 **10.946s**，最大页 P95 **12.072ms**，最慢 **20.338ms**；[SH-P005 真正 100k 不同 SHA JPEG Chromium #39424818989](https://github.com/lazyxu/xdrive/actions/runs/39424818989) PASS：Web1440 首/次页 P50 **284.417/195.242ms**、390px CDP Mobile **244.532/198.417ms**，12/12 原件 SHA 正确。这是修复前测试代码的证据，**新提交仍需自己的专项 n3 和全量 CI**，不能沿用旧 HEAD 的 PASS 合并。
- 产品性能优化 `AFTER=N/A`；保留原有有界读取和无授权泄漏设计。展示 1:1 尚缺 Share 安全缩略图、视频 Poster、Live still/motion、整体排序搜索、子文件夹 ZIP、真机与 WAN；进入后续有独立安全边界的专项。

# SH-P012 · 公共分享只读 Explorer 的文件展示复用（第一切片，2026-10-20）

## 工作状态和优先级

**状态：首轮真实100k两套专项均PASS，完整CI RED且保留证据；修复原静态/模拟事件断言后等待新准确 HEAD 复测。** 已合入 #2117 文件/文件夹右键 Share、#2148 独立只读 Explorer、#2158 根目录整体持久 ZIP、#2190 全宽工作区、#2219 类型/图标/属性、#2224 安全图片 Quick Look、#2233 文件夹链接直接进入。该工作只处理用户指定的**显示一致性与浏览性能**，不碰 Race、Owner 会话、后台 durable Cancel、P064 Copy。

## 测试前冻结的真实 CURRENT

- 已合入 #2233 的原始物理 100k SHA 各异 JPEG Share：准确源码 `909f57189d1b02697be0c44505590ced50da937f`，真实 [SH-P005 #39417535234](https://github.com/lazyxu/xdrive/actions/runs/39417535234) SUCCESS；Wide1440 三次首/下一页 P50 **365.958/284.821ms**，390px CDP Mobile 三次首/下一页 **303.350/261.265ms**；12/12 原件签名下载 SHA 正确、页面每次最多100项、无旧行/溢出。原始预算固定：每页≤2000ms、原件下载≤5000ms。完整源码准确 [CI #39417535259](https://github.com/lazyxu/xdrive/actions/runs/39417535259) 77 job / 25 success / 52 skipped / Final Gate green。上述仅基线 **BEFORE 来源**，不是当前优化结果。
- 独立 SH-P001 100k 元数据、1000页、3组真实 PG17 原版遍历 P50 **16,699ms**，冻结 walk≤60s、page P95≤500ms、worst≤2000ms；其为元数据测试、**不是100k实体JPEG或Grid解码**。当前新 DTO 加入版本/更新时间可能增加请求字节数，必须记录实际 HTTP body bytes。
- 本 PR 没有可比的同 runner 产品加速 BEFORE/AFTER；这是请求的渲染结构与字段功能对齐。新 HEAD 数字采集前 **AFTER=N/A、speedup=N/A**。若原版已经在预算内，保持 Server/SQL 热点原逻辑；如实际红色再冻结同数据/环境 n≥3 对比，重复且明显改善才保留性能改动。

## 本切片实际改动

1. 从 Owner `FileExplorer.tsx` 提取**没有权限/数据副作用**的 `XDriveFileExplorerItemName` 与 `XDriveFileExplorerDetailsNameCell` 到现有纯展示叶子 `FileExplorerItemPresentation.tsx`。账户 Explorer 与公共 Share **实际调用同一组件**：Details 24px 文件可视盒、12/52px 中文自动换行/两行 Grid 名称，保留 Owner 重命名、状态徽章和本地缩略图生命周期；Share 永远不导入 Owner Shell、剪贴板、DragDrop、Move/Delete/Upload。
2. Share Grid 按 Owner `medium` 几何对齐 112px 最小列、180px 卡片最大宽、72px 缩略图槽、52px 文件类型图标，保持已验收的原生分页/下载。由于缺独立 Share 安全缩略图源，**此阶段仍是文件类型图标，不宣称已有真正图像/视频/Live 缩略图**。
3. Root/Descendant 只增加 Share 范围内的 `revision/updated_at`：**无密码 Root** 在有效令牌下返回这些字段；**密码保护 Root** 的原公开 metadata GET 不验证密码，故新增两字段 `omitempty` 不暴露，待独立获授权接口再显示。文件夹子项必须由 `publicFolderShareContainsNode` 校验祖先并先完成密码检查，依然最多100项。前端 Details/属性仅显示实际返回的时间，未授权不伪造或调用 Owner URL。无 CAS key、全量子树、Owner JWT/路径和新媒体字节请求。
4. 390px 紧凑触屏文件项点按进入已授权文件夹或已支持的安全预览/下载；宽屏双击与键盘 Enter 不变。只读上下文菜单保持打开/预览/下载/属性；不开放移动、重命名、拖动、粘贴或删除。
5. Share 仍是独立 `#/s/<token>`；根目录整 ZIP 仍为服务端持久 prepare/status/explicit cancel/短时签名流式 GET，至多200k项/100GiB；窗口关闭仅取消本页 HTTP 读取/轮询，不取消后台 ZIP。子文件夹单独 ZIP 仍需另行限定子树授权，不能直接重用 Owner 下载。

## 冻结验收条件 / 剩余缺口

- SH-P001: 真正 PostgreSQL17 / 100k 元数据 / 1000 bounded pages ×3，原始 walk≤60s，P95≤500ms，worst≤2000ms，登记 HTTP bytes/CPU/RSS、授权和 Go Context.Done；新增只读字段真实且不泄漏隔离目录。
- SH-P005: 真正 PostgreSQL17/Gin/LocalCAS SHA各异 100k 实体 JPEG；Web1440 ×3、Mobile390 CDP ×3，页面先后100项/12次原件完整 SHA；页面≤2000ms、原件≤5000ms、无旧行/溢出。不得把CDP390称作iOS真机。新纯组件渲染不应导致布局高度抖动。
- 完整准确源码77-job CI + Web/Desktop TypeScript/React 真实挂载测试、Go PG17 API授权、Linux/Windows、Rootless与Final Gate通过；所有真实运行行和内存/请求数永久归档 registry/canonical/platform/raw。若失败留原始 RED，不缩减测试指标。
- **尚未完成**：全像素相同的 Owner 动态列宽/排序/整体搜索、允许的 Share 只读缩略图（不能把32MiB全图Quick Look在100k自动加载）、视频 Poster/Live still、真实 Live 动态预览、移动端长按选择/拖动的细节、文件夹子树单独 ZIP、真实手机/安装态 PWA/WAN/4GiB 分享下载。继续 #2205，不声称本切片即 1:1 完成。


## SH-P012 · 第一轮真实100k基线及完整 CI RED（2026-10-20）

- **准确测试源** `1c4f91a5bbd7b9cd03b05d1f1794bc61388c7add`。独立 [100k PG17 元数据分页 SH-P001 #39421704471](https://github.com/lazyxu/xdrive/actions/runs/39421704471) **SUCCESS**，三组真实 100000 个 Node / 1000 pages；完整遍历 P50 **16.894s**，最大 page P95 **19.283ms**，最慢分页 **30.670ms**，每组 HTTP JSON bytes `11327793/11316793/11325793`。原始 [机器样本](performance-evidence/public-share-visual-parity-shp012/ci-run-39421704471.json)。冻结 60s walk、P95≤500ms、worst≤2000ms 均通过。
- 独立 [真实100k SHA各异 JPEG 浏览器 SH-P005 #39421704436](https://github.com/lazyxu/xdrive/actions/runs/39421704436) **SUCCESS**。Web1440 ×3 首/后100 P50 **365.112/221.251ms**；CDP Mobile390 ×3 首/后100 P50 **306.547/239.054ms**。12/12原件文件名、字节、SHA正确、100授权项/页、无陈旧行/横向溢出，页面≤2000ms、下载≤5000ms，全 PASS。[原始机器JSON](performance-evidence/public-share-visual-parity-shp012/ci-run-39421704436.json)，源播种不计时。真实iOS/Android/安装PWA/WAN/视频/Live仍 Not measured。
- 同 HEAD [77-job CI #39421702968](https://github.com/lazyxu/xdrive/actions/runs/39421702968) **RED**：23 succeeded / 52 conditional skipped / desktop-tests RED（原 U07 静态 Unicode 文件名函数仍假定所有 JSX 在 `FileExplorer.tsx`、两项原始 React mount 测试省略了合规事件的 `target`），Final Gate 因此失败。**必须保留 RED，不能只凭两组真 100k 通过而合并。** 现修订原测试去验证已提取的纯展示组件真实文字/tooltip/Unicode、按真实点击事件发给原分享行，并检查内嵌按钮不会冒出二次下载。此前的用户可见功能/权限及冻结预算均不降低。
- **判定：保留原有生产 Server/SQL/ZIP 热点实现**；新增的是 Share-only 元数据和 Owner/Public 同用视觉代码。历史 `#2233` Web/Mobile 100k 首/后不同 Runner，不构成 same-runner A/B；生产性能收益 `N/A`。修订并归档之后提交的新 SHA 必须重新跑 SH-P001、SH-P005、77-job CI/Final Gate；未通过不合入。

---
