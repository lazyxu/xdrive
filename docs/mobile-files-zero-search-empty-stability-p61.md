# P61 — Mobile Files Search/verified-empty stable zero-state geometry

**Date:** 2026-10-18; independent frozen parent `c0c0596ec450ebff982d71ad4818db72b2065835`. P58/P59 merged, P60 #2022 separate pending full CI. This P61 scope touches only existing Mobile Files view, its *original mounted React* runtime test, and this document; no overlap with P60 product/UI files.

## Confirmed residual jitter

Mobile Files Search with an unanswered first global Search COUNT had `showZeroState=false` until the 300ms visual-feedback timer fired. Slow requests then mounted `XDriveStatePanel` into ordinary flow from zero initial height, followed by actual results: a gratuitous additional page-height transition. The P59 cold-Directory slot fixed Directory, **not Search**.

Also, for any zero-state with a real accepted empty result, `data-mobile-files-zero-state` lost its 180px pending minimum-height once `coldUnconfirmedBrowse` became false. In the cold directory/Trash/Search cases this caused a pending→verified-empty collapse unrelated to actual thumbnail bytes. The scroll host stayed mounted, but content height changed unnecessarily.

## Scoped resolution

1. Reserve the existing single **180px** zero-state box from the first unverified Search frame; expose `aria-busy` immediately, without rendering any spinner or “正在查询” caption until 300ms **if still pending**.
2. Render genuine >300ms Search progress *inside* the same slot. Keep the slot's 180px minimum height after verified empty, read error, and Trash statuses. No false zero, no swallowed error, no terminal feedback delay.
3. Preserve Search API/Server owner, 100k sparse virtual rows and cancellation, authenticated directory commit/scroll, iOS touch targets, real thumbnail/poster transfer progress and one scroll host.
4. Extend the **mounted original** `desktop/tests/mobile-files-ios-runtime.cjs` with first frame, 35ms, 330ms, accepted COUNT0, real fast Search item, stale timer, Directory accepted0 and Trash failure/retry/accepted0 checks.

**Release gate:** one isolated commit, complete new accurate-head 76-job CI and current clean PR mergeability before Ready/Rebase; no claim of physical iOS Safari, Android, installed PWA or live 100k WAN CLS/FPS. P60 remains independent and may merge first. This audit is scoped, not a verified product-wide physical acceptance.
