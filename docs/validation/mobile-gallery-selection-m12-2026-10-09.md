# M12：图库多选工具与手动相册选择器

日期：2026-10-09。依赖 M11 可视视口修复，工作基线 `63212e43b1eed59eeac7bfd051552119832d5589`。

本批只更新共享 `MediaGallerySelectionToolbar` 的手机呈现，不复制 Gallery 数据控制器或恢复全局底栏。选中数量和退出在第一行固定可见，其余主要操作在当前 Toolbar 内水平滚动。

手机“加入相册”变为应用内的可搜索选择抽屉：仅展示手动相册及成员数量；需要显式确认；失败显示权限/网络错误以便重试；选中数量在打开后改变则阻止旧选择提交。桌面继续复用原有选择控件。抽屉使用 M11 的 VisualViewport 尺寸与安全区规则。

`desktop/tests/media-gallery-mobile-selection.cjs` 是共享真实 React 组件的操作回归（MUI host stub），验证过滤、成功、失败、选择范围变化；仅为模型层测试，不是 iOS/Android 真机证据。

验收：M49.V10，分别在普通标签页与安装模式检查短横屏、键盘、200%文字、VoiceOver/TalkBack、取消／错误与任务反馈。真实设备目前 not-run。合并仍需最终 PR 全套 CI。
