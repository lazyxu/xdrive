# P122 · 全局存储历史切换不应推动指标和趋势表

## 已定位的共享页面缺陷

原始 `ui/shared/src/mui/GlobalStorageStatsPage.tsx` 在已经有历史数据时，通过普通流内 `{historyLoading ? <LinearProgress ... /> : null}` 将网络进度条临时插入 `<Stack spacing={1.5}>` 的孩子节点。切换 30/90/180 天会让下方所有“需要处理”、决策、统计卡片和移动端趋势列表上下跳动；真实网络请求和已接受历史数据并未改变。这不是缩略图/下载字节加载进度，不需要改变整页排版。

## 修复方案

- 始终渲染同一个 `data-xdrive-storage-history-control-owner` 位置容器；原有筛选、文字和按钮保持不变。
- 在这个容器内提供一个永久 `data-xdrive-storage-history-progress-slot`，用绝对定位显示**真实** `historyLoading` 的 `LinearProgress`，状态保留 `aria-busy`。4px 进度线只绘制到筛选行下方既有 12px 间距之内，不再生成 MUI Stack 普通流兄弟节点。不存在人为 300ms 延迟，也不取消请求。
- 保留原 `api.adminStorageHistory(historyDays)`、30/90/180 天选项、历史异常/诊断、原统计数据和滚动位置；共享 Web/Mobile Web/Desktop 同一个原始 MUI 组件。

## 回归和边界

新 `desktop/tests/global-storage-history-progress-no-reflow-p122.cjs` 使用真实 TypeScript JSX AST 检查 DOM 层级、永久定位容器、保留 4px 进度反馈、全部原有历史功能。原 P117/静默冷读取测试继续执行。需要 P122 **完整 exact-head 77+ CI、真实 PostgreSQL API Go Race、Web/Desktop/Host/镜像和 Final Gate 成功**及最新 clean mergeability 才合入；真实 Safari iOS/Android/PWA/WAN/100k CLS/FPS 未执行，不作验收宣称。生产安全验收按现有 AGENTS 指令跳过（未执行/未验证）。
