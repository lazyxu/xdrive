# Android Files · native bounded PDF Viewer · 2026-10-27

## Implementation and trust boundaries

- Current Owner Files Browse, Recent, Favorites and Search open a PDF with Android `PdfRenderer`, previous/next page buttons, 1–4× zoom/pan, real download progress, explicit failures/retry and Back to the original loaded Files viewport. No duplicate FileExplorer index or PDF transport is introduced.
- The existing pinned-TLS, no-redirect `GET /api/v1/files/{id}/content` is reused. The Core verifies the full current Owner Node (ID, parent, name, size, revision, type) **before and after** its existing full ETag/optional SHA-256 verified download. Partial or changed content is not shown.
- `PdfRenderer` needs seekable bytes; documents are bounded to 64 MiB, written only to an app-private `cacheDir/owner-native-pdf/preview-*.pdf` file, held for the active Viewer, deleted on normal exit, error, cancellation, Owner switch or logout. Crash remnants are swept on the next PDF Viewer creation. The filename, stream credentials and PDF bytes never enter Compose UI state, public Downloads, Gallery/MediaStore or persistent app preferences.
- Only the **current PDF page** is rasterized; `PdfRenderer` allows one page at a time and serialization prevents close/render races. Page bitmaps are limited to 2048 px per edge and 4,000,000 pixels. UI-only zoom/pan does not fetch another Owner byte stream.
- The Controller fences late/noncooperative reads by current Owner generation, exact visible Files Node, revision and Viewer epoch. No production-only verification switch or customer account is required to exercise source tests.
- Large (over 64 MiB), malformed or password-locked files show a clear error; existing Save to device remains the supported path for large files. PDF text search, annotation, form fill and password entry are *not* claimed as part of this bounded Android increment.

## Validation

Source candidate; require exact-head Android JVM/Core, Lint, Debug APK, API35 real Compose fixture (two actual PDF pages and temp cleanup) and applicable CI. True Android OEM hardware, very large files and iOS pixel-matching: **跳过（未验收）**, not falsely green and not a source-development blocker.
