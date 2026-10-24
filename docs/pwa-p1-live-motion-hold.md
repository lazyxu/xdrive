# PWA P1-C · 真实 Owner 100k Live Photo 按住动态帧

独立 Draft / 堆叠于 #2589（其父 #2582）。不修改生产 Go/Web/Viewer
或 Service Worker，只复用现有共享 LivePhotoSurface / Owner 签名 Motion API。

在真实 Gin/PG17/Local CAS 100k 逻辑 PhotoAsset / 115k metadata 基线上，
只为已进入可视区的少量 Live still 配对的现有 motion Node 写入可解码
H264 MP4 内容。保留原媒体组、PhotoResource、Node ID、用户身份与审计边界，
实际内容 MIME 标记为 video/mp4；不冒称全 115k 物理 CAS。

三轮独立 390px Chromium，先跑 P0C2 Go Context.Done 取消、JPEG 原图
Viewer/Back 与真正 H264 播放门禁，再点击可视区原生 Live Tile、确认 still
已经解码；在共享 Live Surface 上用浏览器**真实鼠标长按**
（mouseDown 保持至完成），不能主动调用 video.play() 或伪造播放事件。
记录至少两个不同的 requestVideoFrameCallback 呈现帧，要求 mediaTime 与
presentedFrames 递增。mouseUp 后必须原生暂停视频、静帧重新可见，
通过真实返回按钮回到同一 Gallery route/document/scroller/grid，偏差不超过 2px。

此阶段只验 **真实 Chromium 鼠标长按**，不冒充 iOS 27 Safari 主屏
触控长按（NOT RUN）、所有素材兼容性、Live 多指交互和 Viewer 断开的
在途 Range Go Context.Done。上述内容与 100k 配对 BEFORE/AFTER 仍在 #2260。

无法访问的生产环境安全验收：按用户决定跳过（未验收）。
源码层面 Owner/ACL/Abort/隐私仍必须验。

The P1-C native Chromium callback also checks the active Live video source
is the same-origin Owner-signed `/api/v1/media-live-photo-motion/<id>?ticket=...`
resource (ticket presence only, never persisting secrets), rejecting substituted
poster/Blob/external videos. The dedicated workflow now targets merged master.
