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
