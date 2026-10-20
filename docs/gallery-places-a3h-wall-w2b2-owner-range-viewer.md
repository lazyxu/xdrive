# A3h-Wall W2b2 · Shared authenticated cell photo wall and Viewer Range

**Stacked Draft on W2b1 #2228 → W2a #2220 → W1 #2214. Do not merge independently.**

After a trusted BD09 8x8 Cell selection, existing GalleryPage waits for the FIRST W1 authenticated sparse Range before atomically publishing the existing VirtualCollection, count, timeline, title and route. It does not blank or eagerly swap from the existing Places map during network pending. The VirtualCollection's subsequent pages use the same Owner cell selection. `kind='baidu-cell'` is explicitly carried in the serializable Viewer context; Web Viewer uses the same signed current-Owner endpoint for neighbor navigation. No new 100k browser scan, media URL, GPS inverse conversion, Share token or separate virtual list.

Map invalidation on pan/zoom/Session now aborts the current cell first-page GET; account/source changes and navigation abort likewise. Errors keep current map and report a generic retry, not private details. Back from cell wall returns to Places index without fetching a wrong 'all' media Range. Temporarily disable ordinary gallery sort while viewing a cell instead of silently changing to unscoped 'all'.

**Known remaining W3:** exact native BD09 camera/zoom restoration after map unmount, region highlight and virtual scroll anchor after separate Viewer route, Desktop isolated Agent IPC parity, changing sort within cell, error/409 visual alignment, fully measured Abort→Go ctx.Done latency and real 100k or iOS27 physical evidence. No claim of complete P0-05. Production safety acceptance is excluded by explicit user rule (#2227); code-level privacy/Owner authorization and tests remain mandatory.

### W2b2 Correctness update · preventing wrong-scope refresh and stale navigation

Native Cell walls never expose generic Gallery filters/sort that could route to unscoped `/media/items`. A different tab aborts an in-flight Cell page immediately. Back/Refresh discard the old Cell collection and redisplay the map; the user must select the current approved cell again, instead of accidentally widening the result set. Source tests capture these contracts; W3 still needs real device camera/Viewer return tests.

### 2026-10-20 · Correct signed-Cell Viewer page size

The signed Owner Cell endpoint only accepts limit 1..100. The original shared Web Viewer used 128-item pages for every Gallery target, which rejected all `baidu-cell` Viewer neighbors, especially indexes crossing 100. This W2b2 source revision explicitly uses 100 only for `baidu-cell` and retains 128 for other Viewer contexts. Added a compiled original-source runtime regression that resolves index 100 through offset 100, forbids unscoped Gallery fallback and validates the 100-item contract. W3a cancellation must be replayed on top of this fix without overwriting the scoped page size.

Production environment security acceptance remains permanently skipped (unverified). This is a source functional regression fix, not a claim of production or physical validation.

### 2026-10-20 · Windows Desktop typecheck fail repaired
Exact-head [CI #39424944508](https://github.com/lazyxu/xdrive/actions/runs/39424944508) found `TS2304: Cannot find name 'collectionTarget'` in the shared presentational `XDriveMediaGallery` component: W2b2 accidentally referred to a controller-local variable that exists only in `XDriveMediaGalleryPage`. Use an explicit boolean presentation prop `isBaiduCellWall` passed by the owning Page, default false for standalone clients; do not guess from string collection keys or widen Owner scope. Add source regression for Page→UI prop. All other W2b2 files retained; this new SHA requires its own complete CI/Final Gate.

## 2026-10-20 · 本轮 CI 真红修复

- W2b2 `9fdd272` 的 Desktop `desktop-tests` 实报 **17** 失败；其中 P96/P97/P98/P100/P103 共 16 个是原源码抽取夹具未提供新 Cell Abort/Back 词法作用域，另 1 个 `web-app-runtime.cjs` 继续要求固定 128 项，与签名 Cell `limit<=100` 冲突。
- 仅修复 5 个历史测试夹具注入 inert / non-Cell 所有者与 1 个准确分页边界断言；不回退实际浏览器 Abort、Owner Cell 范围或普通 Viewer 128。旧 CI 与已过期父提交均不能作为当前成功证据；完整新主线单提交与实际 CI 优先。
