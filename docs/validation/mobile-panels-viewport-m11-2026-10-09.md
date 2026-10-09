# M11 — 手机筛选和导航面板视口约束

日期：2026-10-09。固定实现基线：`f693cb00e02daee03dcde13af992d186b88bf816`（已合并 M10）。

## 本批范围

Files 的筛选底部抽屉、位置侧边抽屉和 Gallery 高级筛选复用 `useMobilePanelViewport`：仅读取 VisualViewport `height`、`offsetTop` 和 layout viewport 高度，监听 resize/scroll；不改变 HTML viewport 声明、不推断软件键盘能力，也不改变应用根节点或滚动宿主。

在宽度不足 900 CSS px 时，Gallery 高级筛选改为底部 Drawer；表单拥有独立滚动区域，原有应用／清除／保存智能相册操作保持底部 sticky，关闭按钮保留 44×44px。宽屏原 Popover 保持，尺寸跨越断点时安全关闭并恢复触发器焦点。

Files 保持已交付的结构化筛选和独立触控导航；新增 VisualViewport 遮挡时面板高度／位置约束，菜单高度也遵守可视区域；不会增加全局底栏。

## 自动化与真机边界

- `desktop/tests/mobile-web-panel-viewport.cjs`：纯几何和组件接线约束，不能替代实际触控／软键盘。
- 现有 `desktop/scripts/file-explorer-mobile-browser.cjs`、`desktop/scripts/mobile-web-forms-browser.cjs` 和 Gallery UI 真实浏览器工作流需在完整浏览器环境重复执行短横屏、200% 文字、应用按钮、字段焦点与返回路径。
- iOS Safari 和 Android Chrome 的普通标签页／安装模式必须分别记录型号、OS、浏览器、VisualViewport 事件、地址栏、实际软件键盘和录屏；目前**not-run，真机待验**。
- 只有最终 GitHub PR 的完整 CI 通过才可以合并；源码断言不能宣称端到端真机可用。

平台 case：M49.V09；后续 M12 从图库批量选择工具按固定顺序推进。
