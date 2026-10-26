# Gallery cold thumbnail / HEIC decode regression (2026-10-26)

## Symptom
The Gallery Range/metadata can load 8,009 items while most tiles remain skeletons and a selected `.HEIC` preview reports "decoding". This does **not** establish whether any specific production Server thumbnail request is 200, 503, 504 or 500; inspect its response and logs before attribution.

## Repro A: abandoned network work pins all six tile slots
Run `node --test desktop/tests/media-gallery-thumbnail-scheduler.cjs` with Desktop dev dependencies. Start six cold thumbnail loaders and keep their promises unresolved even after receiving AbortSignal; move the Gallery viewport to six new nodes. Prior code removed cancelled tasks from `inFlight` yet kept a separate `active` counter until the old promises eventually settled. The next six visible tiles never launched. The regression test must pass without resolving abandoned promises first. Canceled URLs arriving late must be revoked, not cached; current retained concurrency remains six.

## Repro B: HEIC source routed to browser native decoder
Run `node --test desktop/tests/media-raw-hd-preview.cjs`. The Web Gallery and common File Viewer previously selected the original preview ticket for `.heic/.heif`. Chrome/Electron image decoding cannot be relied on for these formats even when metadata and Server thumbnails exist. A common filename-scoped helper now selects the existing authenticated, revision-fenced 1280px JPEG `/api/v1/media/items/:id/analysis-preview` via the Web API or Desktop Agent. RAW-only semantics stay intact, `.jpg/.png` remain native, and `.livp` keeps the Live Photo still path.

## Production diagnosis still required
1. Confirm the deployed Server version includes merged PR #2720 media-cache directory repair. Check the Server runtime UID can traverse/write `.xdrive-media/thumbnails` and the relevant 2-character shard (without deleting or recursively changing cached files).
2. In browser DevTools Network, filter `/api/v1/media/items/*/thumbnail`. Record exact HTTP status, TTFB, queue/transfer duration, Content-Type and Content-Length from several still-image requests; do not conflate the 8,009 item Range response with thumbnail bytes. A 503/Retry-After indicates resource queue pressure, 504 timeout, 415 unsupported decode, 404 source unavailable, and 500 needs server log correlation.
3. Check whether cold HEIC thumbnail generation under deterministic server-side WASM decode is CPU-bound; compare warm (200 cached) versus cold. Validate the actual deployed `XD_SERVER_CPU_LIMIT` value: changing the compose default does **not** override an older explicit `.env` limit.
4. Validate a warm revisit, a viewport switch with active requests, HEIC Inspector, and Web/Desktop/PWA; compare first-visible image time under the same conditions. The unit regression is not a claim of successful Gen10 live acceptance.

No CAS/original/media metadata deletion, blanket cache purge, global authorization bypass, or unbounded retry is required.
