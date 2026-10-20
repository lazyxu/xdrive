# P123 · 系统依赖页面导航稳定性：刷新错误不改变页面高度

**确认的共享 MUI 页面缺陷：** `ServiceDependenciesPage.tsx` 在读到已确认快照并显示导航、指标和各项 Service 卡片后，若 Server 状态刷新失败，`{visibleError && <XDriveStatusAlert .../>}` 在页面的 `<Stack spacing={2.5}>` 中临时插入一行，导致后面整块导航与已经展开的内容向下跳动。刷新或切换请求成功时又收回，形成明显抖动。

**修复：** 源代码保留原有 `source.load()`、相同已验证 Snapshot、`refreshing` 状态、错误原文和管理员编辑权限。使用始终挂载、固定定位、安全区域约束的 `data-xdrive-system-dependencies-feedback-owner` 承载晚到的真错误，与包含导航的主 `Stack` 平级；真实首次读取失败则在原有 180px 无动画冷加载占位内显示错误，不把读取失败当作“正常/空”。不会隐藏媒体缩略图、实际网络/传输进度。

**验证：** 原 JSX AST 回归断言错误 Owner 和主 Stack 不是祖先/后代关系，并检查首次读取固定区域、真实错误、源回调与已加载 Snapshot 不被抹去。源文件被并行的 Caddy 详情 #2226 使用，必须仅保留各自非重叠改动；仅在新 exact-head Web/Desktop/Go/PostgreSQL Race/Host/images/Final Gate 全绿和 GitHub clean 后合入。真机 iOS、Android、PWA、WAN、100k CLS/FPS 未测，不做真实设备通过宣称。生产安全验收按 AGENTS 用户规则跳过（未执行/未验证）。
