# PWA P1-D · Viewer 关闭时真正的签名 H264 Range 请求取消

## 2026-10-25 · 主线同步与验证边界

旧独立真实 Gin/PG17/CAS/390px Chromium n3 专项 `#40126030454` 在旧准确 HEAD `b04e9623` **SUCCESS**，真实 206 signed Range 返回后点击 Viewer Back，Go `Context.Done` 为 89.843 / 83.947 / 93.633ms、零过期字节、0px 返回漂移。重基于新 master 的工作提交仅在本 PR 的准确新 HEAD CI/Final Gate 完成之后才允许合并；旧成功不得直接冒充新 SHA 的通过结果。实体 iOS 27 Safari/Home Screen 仍 `NOT RUN`；生产专属不可接触验收按用户决定跳过（未验收），源码 Owner/ACL/Abort 必测。


#2582（100k JPEG）、#2589（H264 帧）和 #2593（Live 按住）已合并。本 PR
在完整 master 上保留一个工作提交，提供真实 Gin/PG17/CAS/Chromium 夹具、
Workflow、回归测试，以及共享 Web/Mobile/Desktop 的媒体流同步清退修复。
生产修改仅复用一个 HTMLMediaElement 的 pause → remove src → load helper；
不修改 Go 生产 handler、Service Worker，不增加 API、队列或私人缓存。

复用 390px 原有登录 Owner Gallery、实际 Gin/PG17/Local CAS、
已有 100k PhotoAssets/115k metadata。仅把*有界可见 video Node*
原始 CAS 换成仍含真实原始 moov+mdat 的 H264 样本，末尾增加合法
2MiB ISO BMFF free box，使正在加载的视频实际产生可保持在途的
HTTP Range 响应。请求继续走正式 POST /preview-ticket 后的 signed
/api/v1/file-preview/<node> GET，原有 Owner/session/revision 校验不被替换。

测试仅在完成旧版 JPEG Viewer→Back、H264 双帧动态播放、Live Photo
真实按住/松开、6 个 JPEG Go Context.Done 后才启用 Range 探针。
新的浏览器用真实点击进入同一 Viewer，确定当前签名视频的 HTTP 206 Range
正在活动，并且前 4KiB 原件已经发送。探针对后续合法 free box 数据做
**测试专属 5 秒延迟**；点击真实 Viewer Back 后的 160ms 内必须观测
该原件的 Go Request.Context.Done、Handler active=0、0 个残留响应字节，
并确认原图库 route/document/virtual grid/scroller/scrollTop 完整恢复。

不使用直接 AbortController.abort()、伪造 fetch 或 window.location.hash。
与旧 P058 不同，本测试的触发点是 **生产 Viewer 的 Back 控件**，不是
浏览器外部的人工取消。数据安全记录仅含匿名计数/耗时；不得记录 ticket。

这不是全部 115k CAS 字节、用户切换、真实 iOS Safari、移动端屏幕锁定
或 WAN 行为的证明。后续 Owner 切换、网速、HEVC、持久任务另行验证。
无法访问的真实生产安全验收按用户决定跳过（未验收）；
Owner/ACL/Abort 等代码级验证不得跳过。
Diagnostic phase: the test-only Go wrapper now counts the existing signed
original video GET with and without HTTP Range separately. Only an actual
Range GET with HTTP 206 may satisfy the cancellation gate. If Chromium does
not issue one, CI fails with numerical/browser-state diagnostics, **never**
a ticket value or private source URL. Plain GET is not delayed or counted as
a Range success.

The native signed original video URI is checked immediately when the Viewer
mounts; the test then observes the real active HTTP 206 Range BEFORE waiting
for video decoding or playback readiness. Earlier CI confirmed 1 actual
Range 206 / 2,100,110 bytes, but the old ordering waited until that Range
naturally completed; it was a false test timing condition, not a missing
native Range. Parent P1-B independently verifies advancing decoded frames.

Observed product bug: genuine Viewer Back unmounted successfully while the
signed H264 HTTP 206 Range stayed active in Go after 160ms (0 obsolete bytes,
but no Request.Context.Done). Production shared Web/Mobile/Desktop previews
now synchronously pause, remove src and load() the outgoing native video/audio;
edited video reuses the same small teardown helper. No new cache/queue/API.
Actual Go/Chromium P1-D cancellation proof and full CI are required before
calling the lifecycle fixed.
