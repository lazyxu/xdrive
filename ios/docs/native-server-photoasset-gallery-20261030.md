# Native iOS Server PhotoAsset Gallery — scoped read-only increment

This master-targeted PR extends the native Photos/navigation code integrated by merged PR #3279. Its Gallery implementation must pass a fresh exact-HEAD macOS IPA, full CI and Final Gate after conflict resolution. Previous green checks do not cover the new merge commit.

The existing owner-authorized endpoints from Web/PWA supply native data: `GET /api/v1/media/items?range=true&offset=&limit=48`, `GET /api/v1/media/albums`, and `GET /api/v1/media/albums/{id}/items?range=true`. No new Server API or upload/CAS writer is introduced.

The native Gallery now distinguishes **云端图库** (canonical PhotoAsset wall and albums) from **备份原件** (earlier iPhone `-xios-` root-only backup proof). Those have different semantics and must never be presented as the same inventory. Local PhotoKit album/photos remain separate.

The iPhone UI renders just one bounded 48-item server page at a time; visible thumbnail requests are Owner/revision scoped, ephemeral and max 2 MiB, downsampled to 280px via ImageIO. Authenticated page and albums requests are revalidated by native Owner/root. The currently supported still/video items use a same-origin signed preview ticket, with no bearer in the URL. Logical Live Photo is reported as **static-only** until real motion pairing is implemented.

Unsupported native files/map/admin routes remain honestly unavailable. Full page/timeline virtualization, cross-process history, real 100k performance, iCloud/SideStore and cloud Live motion are not verified. Device acceptance: **跳过（未验收）**.

Before merging this PR into master: run the actual native source contracts and Xcode iPhoneOS unsigned IPA on this PR's exact HEAD, complete required CI and Final Gate, and confirm the current mergeable state. Keep device/iCloud/SideStore acceptance labeled **跳过（未验收）** until exercised.

## Native landscape and search follow-up

- iPhone landscape uses adaptive 95–150pt PhotoKit/cloud-original grids; viewer return retains the current PhotoKit page offset instead of jumping back to the first page.
- Server PhotoAsset browsing supports explicit Owner-scoped `q` search, using the existing Go `mediaSearchMaxRunes=200` limit. The same query works within a cloud album, and the page cache identity includes **Server Owner + album ID + search query**. Changing any identity discards stale rows. In-range navigation retains only the same verified query page until the next response succeeds.
- A failed next-page request does not erase an already-verified page; retry submits the exact failed offset. Source requests remain cancellable and stale generations cannot overwrite a newer query.
- The new search is **cloud PhotoAsset search**, not local PhotoKit on-device search, nor new OCR/semantic indexing.

## Native Viewer and Photos-first root (child development increment)

- L3 still images from local PhotoKit, cloud original evidence and canonical PhotoAsset now share the same **native zoomable image surface**: pinch 1×–5×, double-tap to toggle magnification, two-axis panning and named VoiceOver zoom actions. This does not change original image bytes or enable editing.
- Verified HTTPS Owner login/restore automatically opens the native **图库** tab; the user's **我的 → 服务器与账号** route can still return to the verified account screen. Existing global original-run gate, logout and Keychain owner safety remain unchanged.
- Exact uploaded child HEAD must still compile via macOS iPhoneOS Xcode and pass the applicable PR CI/Final Gate. The V8 source-contract precheck is not a substitute for those checks.

## MVP transient-failure cache policy

- A prior verified cloud Gallery page is retained **only** for a transient network failure, HTTP 408/429, or HTTP 5xx. Clear cached names/thumb readers immediately on HTTP 401/403/404/410, invalid page/scope, TLS trust errors, or failed Owner/root re-verification; do not present a disconnected/error state as successful access.
- The `NativeMediaPageRetryPolicyChecks.swift` Foundation-only regression tests classify these failures. They are run before the iPhoneOS build in `ios-unsigned-ipa.yml` and are a necessary source-level gate, **not** real iPhone UI evidence.
- Do not add local backup task-log encryption, duplicate upload writers, PDF editing or other non-MVP work to this branch.

## Conflict-resolution note

The master iOS PhotoKit and cloud-original viewers already use `XDriveIOSNativeZoomablePhotoView` and preserve a bounded originating page on Viewer return. Retain those tested behaviors, adapt the local/cloud/album grids, and reuse the existing zoom view for the newly added canonical Server PhotoAsset Viewer. No second zoom component or media upload writer is introduced. Physical iPhone validation remains 未验收.
