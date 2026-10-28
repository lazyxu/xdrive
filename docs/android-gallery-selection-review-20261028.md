# Android Gallery selected-items review · 2026-10-28

## iOS PWA parity

The shared iOS PWA `MediaGallerySelectionReviewDialog.tsx` lists **only actually selected** Owner media, supporting search, remove, clear, pagination (100/page), and return. Android's native Compose Selection mode caps selections to 200 currently loaded Owner photo/video rows. This increment adds **查看已选项** and a real native dialog without creating a new Owner index, selecting unloaded Gallery Range pages, or issuing any Server write.

## Behavior

- Review observes the existing private `DriveState.gallerySelectedItems`, never a query-wide selection. Search filters only selected filenames, case-insensitively; a new search starts at page 1. Real Node IDs key rows; pagination is 100 per page, and removing an item safely clamps an out-of-range page.
- **移除** and **清空选择** only adjust the in-memory verified selected list. They cannot call `/media/batch`, mutate CAS, change the Gallery Owner Range, or trigger another uploader. The existing metadata API continues to require a frozen 1–200 Owner selection before Favorite/Tags submission.
- The review distinguishes empty selection from unmatched search. Closing, Owner switch, logout, or leaving selection discards review UI. No Bearer token, private URLs, or downloaded media are stored.
- Existing floating bottom actions continue to perform real **收藏 / 取消收藏** and **添加标签**. The review is local-only; uncertain metadata ACK blocks it until read-only reconciliation.

## Tests and status

JVM tests cover actual selected-name search, remove and clear (with zero favorite/tags API calls), and logout isolation. API35 Compose covers real Gallery → select → review → remove → clear → return; the original Gallery floating dock reappears on selection exit. Four-sort Owner Gallery, thumbnail handling, SAF, and Viewer behavior are preserved.

Stacked **candidate** on #2871: merge that base after exact-head CI, then retarget and validate this PR against latest master. Physical OEM/iOS pixel comparison/production account acceptance = **跳过（未验收）**, not passed.


## Gallery 已选照片加入已有手动相册（本 PR 后续增量）

- Android 当前 Gallery 选择模式只覆盖当前 Owner 已真实加载且选中的 1–200 张照片或视频。点「添加到相册」才读取现有 GET /api/v1/media/albums，只呈现真实的 kind=manual 有效版本相册；不展示只读智能/来源/文件夹类型为可写目标，不创建假数据。读取失败允许只重试 GET。
- 目标选定后复用唯一 Owner-authenticated 客户端，带真实 If-Match 相册 revision，POST /api/v1/media/albums/{albumID}/items 和精确 node_ids。opaque ID 必须编码成单一 path segment。Go 验证 Owner、PhotoAsset、相册类型及版本；只写成员关系，不复制媒体字节。
- 返回必须核对完整相册 ID、类型、名称、版本和成员数，损坏/缺失 ACK 或 409 均冻结这批选中项，禁止自动重试 POST。只有只读图库 GET 可以解除冻结。成功会清空选择并使原相册列表过期，下次访问精选集重新读成员数。
- 新增 Core MockWebServer、Controller JVM 及 API35 Compose 回归；准确 HEAD CI 未通过之前仅为 Draft 候选。真机和 iOS 像素验收按既定规则为「跳过（未验收）」，不宣称已通过。
