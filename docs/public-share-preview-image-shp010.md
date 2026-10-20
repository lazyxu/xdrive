## SH-P010 · restore read-only context-menu Download after preview activation (2026-10-20)

Exact source fabcc71ef2e15c1b51802038df78d6d09a3832ec [complete CI #39404375162](https://github.com/lazyxu/xdrive/actions/runs/39404375162) flagged original mounted public-folder read-only context-menu regression: clicking Download on a JPEG incorrectly invoked the new Preview branch, leaving actual signed original downloads empty. The same source [native physical 100k JPEG #39404377010](https://github.com/lazyxu/xdrive/actions/runs/39404377010) passed genuine six Chromium sessions; it measured normal first/next page and signed downloads but cannot override the failing explicit context action.

Correction: preserve double-click/Enter image Preview, preserve explicit Preview item, and have right-click Download invoke onDownloadItem directly; folder context Open remains onOpenFolder. Original legacy test is unchanged. The corrected SHA must execute its own full CI and 100k physical browser before merge. This is functional correctness, not a claimed speedup.

---
## SH-P010 · source-exact native 100k job RED before measurement (2026-10-20)

Prior valid source e63f9475 failed dedicated SH-P005 native physical 100k #39404187376 during the Web TypeScript build, before 100k physical seed or browser session. Exact TS2322: optional public loadImagePreview callback could yield undefined rather than the shared XDriveFilePreviewSurface loader's required Promise return. Fix this single callback to always return Promise (explicit Promise.resolve(null) safe fallback); do not relax the public capability gates or performance budgets. Previous run remains a genuine pre-measurement RED, with no AFTER data or speedup claim. New one-work SHA needs fresh exact-head whole CI + true n3 100k native browser test.

---
## SH-P010 · reconcile P115 no-reflow and restore exact visual behavior (2026-10-20)

Current master includes successfully merged #2218 public Share navigation and notification stability on exact CI. This final scoped candidate composes the new public image Preview onto the authoritative P115 useLayoutEffect accepted-page identity model, never resets the same-page filter or selection on new array refs, keeps fixed-position feedback and durable ZIP, and appends only original preview React coverage. The entire merged P115 + #2219 Properties tests stay intact. Reconstructed on full master, preserving all unrelated files. No Race modifications.

Previous historical n3 physically SHA-distinct JPEG public page baseline Wide first/next P50 123.823/190.434ms and Mobile390 112.027/178.558ms. New Quick Look click AFTER N/A; physical mixed JPEG/H264/Live 100k remains Not measured. Current rebuilt candidate requires its own exact-head real 100k Chromium and 77+ full CI before Ready/Merge.

---

## SH-P010 · preserve merged Share Properties tests (2026-10-20)

Source review of previous Quick Look candidate showed its older staged test accidentally deleted the already-merged #2219 Dialog mocks and read-only file/folder Properties assertions. The new exact-source candidate restores the complete authoritative master tests and appends only the explicit image preview mock and test. This is a regression repair, not a claimed performance gain. Keep old failed-source CI in history; verify new SHA's 100k physical browser and full CI before merge.

---

## SH-P010 full source-exact image preview public UI candidate (2026-10-20)

Previous accurate-source CI #39400959661 identified Go Linux format-only errors in three added Go files. This branch applies the exact gofmt diff recorded by that CI. Prior failed or cancelled CI remains evidence, not an acceptance statement.

Public capability image preview now mounts the permission-neutral shared XDriveFilePreviewSurface ONLY when a recipient explicitly opens a permitted JPEG/PNG/WebP/GIF file from the read-only Explorer. Native download remains separate, folder ZIP remains durable. The preview image transport requests its short-lived public-only ticket and then performs an AbortSignal-owned signed GET with no-referrer, credentials omitted, 32 MiB limit and strict MIME matching, returning a revocable blob URL to the shared viewer. Closing the viewer triggers AbortSignal from FilePreviewImage to immediate Go Request.Context cancellation. No eager preview or 100k thumbnail decoding is introduced. Narrow viewport previews use compact action icons. Preview usage does not increment download-count; purpose-limited JWT, descendant and revision checks are retained.

Existing genuine 100k JPEG public share ORIGINAL n3 on prior source: Wide Web first/next P50 123.823/190.434 ms and Mobile Web 112.027/178.558 ms, 12 SHA-correct signed original downloads. AFTER for new preview click and full 100k JPEG/H264/Live mix = Not measured; no performance speedup claimed. This feature must stay Draft until its exact source-HEAD full 77+ CI and native 100k physical JPEG browser dedicated CI, PG17/LocalCAS integration, Final Gate, and clean mergeability are verified. Original-vs-current different-host numbers are not a paired A/B result. True user-visible 1:1 Gallery/Owner FileExplorer thumbnail/poster/Live media parity requires a separate #2205 mixed-media physical n3 gate. Distributed multi-replica preview quota and installed iOS/Android/WAN remain unimplemented.

---

## SH-P010 · bounded JSON fixture correction on current test HEAD (2026-10-20)

Source audit of the first auth-map-corrected work HEAD `8f770da6eed94f38066c11b721dd48d27081191f` found an invalid fixture construction in the new positive PG integration test: the JSON request body string accidentally contained literal placeholder delimiters rather than escaped JSON field names. This would prevent the genuine authorized JPEG ticket branch from being tested. Restore only the exact compact JSON object with password and node_id keys; no change to production handlers, quotas, MIME/Owner checks or any original assertions. This replacement SHA must run its OWN complete CI and true PostgreSQL17/CAS test; do not misrepresent the older in-flight run's results as applying to this corrected code.

---

## SH-P010 · source-exact first RED in Go Windows Bearer route contract (2026-10-20)

The first one-work HEAD `fd68635bdb8c45a093b28e22811dfb5bb2f692b5` [whole CI #39400274970](https://github.com/lazyxu/xdrive/actions/runs/39400274970) recorded **go-windows RED**: the existing global `TestEveryProtectedAPIEndpointRequiresBearerToken` enumerates every route; although the new public-only POST/GET/HEAD were added to the complete API coverage manifest, they were missed in its separate **public capability, not Bearer-required** exemption map. The test sent an empty request and got legitimate share_not_found HTTP404 rather than expected authenticated HTTP401. This is a route classification/test-contract error, **not** permission to give a public Share token the Owner JWT. Add only those three exact public capability paths to the public allow-map; the real purpose/auth/scope tests remain unchanged. The old RED run is retained and does not authorize the corrected SHA. Re-run full accurate-HEAD CI including real PG integration and Final Gate; do not claim preview performance/GUI or throughput speedup.

---

# SH-P010 · Public-only image preview capability (first authorization slice)

**Status: Draft / not yet measured on final HEAD.** Follow-up to [#2205](https://github.com/lazyxu/xdrive/issues/2205). This is a first backend capability step, not the completed user-visible 1:1 FileExplorer.

Existing rights are unchanged: files/folders have a common owner Share menu; recipient already has read-only Details/Grid, bounded 100-entry navigation, original signed downloads and durable whole-folder ZIP. Authenticated account FileExplorer is never mounted with a raw Share token. AGENTS.md already contains measurement-first, same-runner A/B and viewport-to-Go cancellation requirements, so the policy itself is not edited.

## Design and scope

- A public capability can request a **purpose-distinct 90-second preview ticket** using the existing X-XDrive-Share-Token header and password. A file-share root or a currently authorized nontrashed folder descendant is the only target. No Owner session, download JWT or ZIP ticket is accepted; the raw Share token never appears in the new GET URL.
- GET/HEAD **revalidate** current expiry/revoke/exhaustion, owner enabled, current share root, descendant ancestor walk, file revision, and file content. Moving a file outside the shared folder or revising the file invalidates the old ticket.
- Inline still preview is limited to **magic-sniffed JPEG/PNG/WebP/GIF matching the extension**, at most **32 MiB per original**. Active HTML/SVG or images mislabeled as JPEG are denied; RAW/HEIC/LIVP/H264/MOV video are not yet served by this endpoint.
- Share-only image preview **does not increment file download_count** but respects already-exhausted Share restrictions. Preview traffic has a **per-instance, bounded** 48 POST ticket / 96 GET streams per Share per minute limiter; 4096 active counters maximum. This is not a distributed multi-replica limiter and remains an explicit production gap.
- GET uses Server Store.Open(request Context), safe Content-Type + nosniff, Content-Disposition inline, no-store, CSP sandbox and CORP same-origin. Browser view teardown/request abort will reach Go request context via HTTP. Durable ZIP and user-started transfers are untouched.

## Performance and delivery gate

**BEFORE:** this new public inline image preview did not exist; original public 100k JPEG native share browsing had n3 Wide 1440 first/next P50 **123.823/190.434ms**, CDP Mobile 390 **112.027/178.558ms** with 12 signed original SHA-correct downloads. Those were different source/runner than this branch, not an A/B optimization. **AFTER preview throughput / preview click latency = Not measured; speedup N/A**. The implementation is a restricted capability feature, not a claimed performance speedup.

New true PostgreSQL17/LocalCAS integration must reject wrong password, Owner sibling/foreign/scope, fake SVG, old NodeRevision, move outside and revoked/exhausted Share; verify true bytes, MIME, Range, no share token disclosure, no download-count charge and JWT purpose isolation. Unit tests verify bounded admission. Full source-exact Go Linux/Windows + PostgreSQL API Race (unchanged mandatory gate), Web/Desktop, Rootless, artifacts, single-commit and Final Gate required before Ready/Rebase. **Do not enable auto 100k thumbnail prefetch or claim physical iOS/Android/PWA, Web/Desktop actual preview, 100k mixed JPEG/H264/Live decode, WAN or 4GiB acceptance.** Actual public UI preview and true 100k mixed physical benchmark are separate follow-ups to issue #2205.
