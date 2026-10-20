# A3h-Wall W2b1：聚合点点击的可信 BD09 视窗绑定

**仅为 Draft 源码阶段；依赖未合入的 W2a #2220 和 W1 #2214。**

旧封面和区域列表仅使用 focusCell 放大地图。W2a 虽已完成受信 Cell 身份及 Web 认证请求，但旧 Bridge 回调仅给 /cells 的结果，没有返回该次查询使用的 BD09 bounds。如果点击时读取新的 map.getBounds，会在快速平移/缩放时将同一 8×8 bin 误选为其它区域。

本阶段让 Native Bridge 两个有效聚合路径把同一次请求的 (cells, bounds) 配对回调；Surface 复制原始响应和 bounds 并在取消、平移、缩放、Session 撤销及组件卸载时使选择无效。封面、区域列表统一使用 xDriveSelectBaiduNativeCell 的严格身份验证；有 onOpenBaiduNativeCell 回调才转交可信选择，否则保留原 focusCell 行为。没有新增 GPS 反算、Browser AK、Share Token 或缩略图提供给 SDK。

**尚未实现：** GalleryPage 真实回调、虚拟照片墙、Viewer 对同一 Cell 的续页范围、Desktop Agent IPC、地图 camera 和滚动锚点返回、真机和 100k 延迟检测。相关工作另推进 W2b2/W3。现阶段不能宣称 P0-04 完成。

遵守用户最新规则：生产安全验收由用户明确决定跳过（未验证），不再要求用户提供生产 AK/HAR 或以其阻塞源码合并。源码安全隔离和 CI 仍强制，不绕过 Session/Owner/Consent/撤销。
