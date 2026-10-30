# Native iOS Server PhotoAsset Gallery — scoped read-only increment

This developer child branch is built on integrated native Photos/navigation PR #3279 **without changing its already-running HEAD**. Full deployment/CI is not claimed.

The existing owner-authorized endpoints from Web/PWA supply native data: `GET /api/v1/media/items?range=true&offset=&limit=48`, `GET /api/v1/media/albums`, and `GET /api/v1/media/albums/{id}/items?range=true`. No new Server API or upload/CAS writer is introduced.

The native Gallery now distinguishes **云端图库** (canonical PhotoAsset wall and albums) from **备份原件** (earlier iPhone `-xios-` root-only backup proof). Those have different semantics and must never be presented as the same inventory. Local PhotoKit album/photos remain separate.

The iPhone UI renders just one bounded 48-item server page at a time; visible thumbnail requests are Owner/revision scoped, ephemeral and max 2 MiB, downsampled to 280px via ImageIO. Authenticated page and albums requests are revalidated by native Owner/root. The currently supported still/video items use a same-origin signed preview ticket, with no bearer in the URL. Logical Live Photo is reported as **static-only** until real motion pairing is implemented.

Unsupported native files/map/admin routes remain honestly unavailable. Full page/timeline virtualization, cross-process history, real 100k performance, iCloud/SideStore and cloud Live motion are not verified. Device acceptance: **跳过（未验收）**.

Before any merge to master: integrate parent PR #3279, then check Xcode compile, source/API contract, exact-HEAD iOS unsigned IPA and required CI/Final Gate. Never treat a child built only on a developer branch as already validated.
