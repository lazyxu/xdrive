# M12：真实 iCloud-only / HEIC / Live Photo / 视频海报图

本 PR 修复本机 MapKit 缩略图状态生命周期：使用网络允许的**限尺寸** PhotoKit 请求加载 HEIC/Live/video poster；当先有 degraded 后有 final iCloud 响应时，不会过早结束加载，也不在最终失败时闪成空图。取消请求、PhotoKit Full Access 撤销和 annotation reuse 会阻止旧回调渲染；最终失败但没有任何图片时显示 iCloud 不可用图标并提示「地图操作 → 重新加载位置封面」。

这**不**允许地图自动请求原始视频/Live mov/全尺寸 iCloud 原件。Viewer 的原件导入仍需用户明确操作。

**未完成的实物验收**：有 iCloud Photos 账户、真实 HEIC-only / Live-only / H.264/HEVC 长视频的设备、飞行模式到网络恢复的实际帧截图、重试成功率、内存和任务取消。当前提交只是代码及 source contract；不能声称所有真实 iCloud 情况已通过。
