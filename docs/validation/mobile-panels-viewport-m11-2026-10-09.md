# M11 — 手机筛选和导航面板视口约束

日期：2026-10-09。固定实现基线：`f693cb00e02daee03dcde13af992d186b88bf816`（已合并 M10）。

## 本批范围

Files 的筛选底部抽屉、位置侧边抽屉和 Gallery 高级筛选复用 `useMobilePanelViewport`：仅读取 VisualViewport `height`、`offsetTop` 和 layout viewport 高度，监听 resize/scroll；不改变 HTML viewport 声明、不推断软件键盘能力，也不改变应用根节点或滚动宿主。

在宽度不足 900 CSS px 时，Gallery 高级筛选改为底部 Drawer；基础实现的表单有独立滚动区域和底部 sticky 操作；补充验收复现极短屏字段遮挡后，操作已归入同一表单滚动区域，关闭按钮仍保留 44×44px。宽屏原 Popover 保持，尺寸跨越断点时安全关闭并恢复触发器焦点。

Files 保持已交付的结构化筛选和独立触控导航；新增 VisualViewport 遮挡时面板高度／位置约束，菜单高度也遵守可视区域；不会增加全局底栏。

## 自动化与真机边界

- `desktop/tests/mobile-web-panel-viewport.cjs`：纯几何和组件接线约束，不能替代实际触控／软键盘。
- 现有 `desktop/scripts/file-explorer-mobile-browser.cjs`、`desktop/scripts/mobile-web-forms-browser.cjs` 和 Gallery UI 真实浏览器工作流需在完整浏览器环境重复执行短横屏、200% 文字、应用按钮、字段焦点与返回路径。
- iOS Safari 和 Android Chrome 的普通标签页／安装模式必须分别记录型号、OS、浏览器、VisualViewport 事件、地址栏、实际软件键盘和录屏；目前**not-run，真机待验**。
- 只有最终 GitHub PR 的完整 CI 通过才可以合并；源码断言不能宣称端到端真机可用。

平台 case：M49.V09；后续 M12 从图库批量选择工具按固定顺序推进。

## 补充验收

已复用通过CI并合并的PR #1122，随后按真实短屏复现修复Files字段压缩、Gallery sticky操作遮挡和导航目标过小。合并依赖后的最终共享Files22/Gallery57、实际Web37项全部通过；完整Desktop1594通过、零失败、一项既有可选跳过，类型检查和Web lint/build通过。原有纯几何/接线测试不再声称能证明软件键盘或控件可达性。

首次失败、完整最终检查、源文件/构建哈希及8个真实VisualViewport缩放/平移样本的复用边界见[补充证据](mobile-panels-short-viewport-2026-10-09.json)。PR #1125完整CI和线性合并仍待完成；真机状态不变。
