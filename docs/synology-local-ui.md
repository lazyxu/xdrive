## DSM MVP follow-up: read-only original receipt recovery review (PR validation pending)

The original owning Linux/ARMv7 Backup-only Agent already has a bounded
`GET /v1/device-backups/local-common-batch/recovery-review` endpoint. The
shared `XDriveDeviceBackupLocalCommonBatchDialog` already has an optional
advanced diagnostics view for this response. This change only connects the
same implementation to the authenticated DSM Host. It does not create a
second Scanner, Runner, Source, writer, backup Operation, or page.

DSM `backup.cgi?op=recovery-review` is **GET-only**, rechecks the authorized
DSM session and protected owning Agent discovery, and accepts only a
canonical local Source ID, bounded file ordinal (up to 1,000,000) and the
Agent's opaque 64-digit lower-hex generation epoch for a continuation. The
same-user Agent revalidates Server Owner, native Root grant, Source revision,
checkpoint, private inventory and original SQL receipts on every page.
Results contain **only numeric counts** for a maximum of 16 files per read,
the source revision, run state and continuation; no native path, device/Root
identity, SQL Operation ID, content digest or credential is exposed.
The browser validates all fields and aborts its own fetch when the
shared dialog closes; that does **not cancel an Agent/Server operation**.

The view deliberately labels historical commits and current cloud metadata
comparisons as **non-authoritative**. It does not verify present-day CAS
bytes, prove Source-wide backup completion, authorize retry of uncertain
original SQL tasks, or replace the Agent's durable restart recovery.
Old Agents lacking the exact capability fail closed. Physical DS218j
install, first CAS upload/receipt, unchanged second incremental and
restart/recovery acceptance remain **跳过（未验收）**, not PASS.

This is an unmerged DSM-only PR until its precise HEAD passes Go tests,
DSM authenticated UI, built shared MUI/ARMv7 SPK checks, full PR CI and
Final Gate. No published snapshot containing this change is assumed.

# Synology DSM 7 authenticated local UI

## 2026-10-30 DSM MVP integration PR #3313 (unmerged; source-level)

This narrow DSM-only change adds initial and **same-Server/same-username re-login**
inside the original shared `XDriveSettingsDialog`. It delegates to the owning
Backup-only Agent's already implemented `POST /v1/auth/login`, rather than
adding a separate account database, credential store, shell command, browser
Agent RPC or NAS source authorization.

The DSM browser submits `server`, `username` and `password` only to
same-origin HTTPS `backup.cgi?op=server-login` using the authorized DSM
session and bound CSRF key. The CGI rejects extra fields, duplicate JSON keys,
unexpected query arguments and non-POST methods; credentials never appear in
query strings or response content. The same-user local client enforces HTTPS,
validates the Agent's authenticated status and rejects switches to a different
Server or Owner. The CGI checks current Owner quota **after** login; the UI
reloads after both successful and uncertain login outcomes so cached prior
Owner content cannot be shown as newly authorized.

The consolidated DSM integration PR also composes the original shared Device Backup
page's verified NAS share inventory/preflight and verified Owner cursor-based
cloud directory browser into an explicit **create local backup Source** form.
The DSM browser sends only `selection_id`, a verified HMAC `owner_scope`,
a Server Owner directory `target_id`, a Source display name, and
`confirmed: true`. The CGI checks the DSM session, CSRF/Origin, exact
bounded JSON, current Agent Server/Owner scope and fresh native NAS share
identity. It reuses `localbackupipc.Client.PreflightLocalRoot`,
`CreateLocalBackupSource` (paused), and `AuthorizeLocalRoot` (same
restricted Agent) from `xd backup init`. No browser-selected absolute
path, private Root/device token or general Agent API is exposed.

The GUI acknowledges `authorized` **only** on a verified Agent
`awaiting_executor` Root grant; no initial file, backup run or CAS receipt
is implied. If Source creation or Root binding has an uncertain outcome,
the GUI **does not retry** and instructs native draft/binding inspection
before further action. Source creation is explicitly local and does not
grant access to another Server Owner.

**Still required before full DSM MVP:** coordinated cross-Server/Owner
migration while existing Source/Runner work exists; actual first/incremental
CAS upload receipts, restart/recovery; file upload/mutation Host ports;
verified published and installed MUI SPK on physical DSM. An old Agent
without the known typed native capability fails closed. No password is
stored by the browser. A root CA must already be trusted by the native
Agent; the DSM web form does not accept TLS bypass or browser-provided CA.

This is proposed on a master-targeting integration PR containing the complete delta of previously untested DSM branches #3305 and #3286; **it is not released or
physically validated**. The prior standalone development HEADs are retained as provenance until current-HEAD validation; no child PR is itself a master merge. The current branch includes Go negative tests
for forged selection/path/Owner scope, CSRF, missing consent, old Agent,
unknown Source creation and uncertain Root binding; DSM Node wiring and
shared-MUI build still require applicable exact-head CI. Run exact-head Go,
Synology UI, PR CI/Final Gate and release checks before eventual master merge.
DSM device-only install, ACL, browser and upload acceptance remains
**跳过（未验收）** and is not PASS.


## Historical 2026-10-30 pre-integration source audit: minimal usable DSM scope

Canonical master source audited at `0ff2fa1a3dd478e73fd48e84ff50ce2ef9c2cb99`. This is a **source-level capability inventory**, not a device acceptance or a claim of exact-HEAD CI PASS. The old 2026-10-27 seven-route matrix below is historical; the current Desktop/DSM app has one shared `XDriveApp` and **16 registered routes**. A rendered common page alone does not prove a DSM data/action adapter exists.

| Route | DSM authenticated capability currently wired | Remaining for full DSM graphic MVP |
| --- | --- | --- |
| Overview | Local Agent backup source/status fallback | Desktop Server metrics, tasks and complete actions |
| Files | Authenticated current Owner root/cursor browse, thumbnail, bounded viewer/download | Search, upload/folder creation, move/copy/delete/rename, arbitrary-size download |
| Gallery | Real Owner-scoped albums/wall and bounded viewer media | Interaction/metadata parity, unsupported formats, device playback verification |
| Remote Pull | Shared page exists | No authenticated DSM SourceManager port |
| Device Backup | Local Agent backup read/run/schedule and remote Owner read-only scope | Full local source setup/target/rules and safety validation |
| Conflicts | Shared page exists | No authenticated DSM conflict data/control port |
| Diagnostics | DSM session and local Agent source checks | Server/disk/update/transfer diagnostics |
| Transfers | Local Agent backup tasks/history only | Complete cloud transfer queue and real controls |
| Global Tasks | Shared page exists | No verified Server admin role or global task port |
| Cloud Storage | Server Owner quota through Agent | Full inventory/distribution/admin storage operations |
| Local Storage | Browser-origin quota only | NAS volume and Agent cache metrics |
| Admin Maintenance | Shared page exists | Verified Server admin and maintenance port |
| Admin Users | Shared page exists | Verified Server admin and users port |
| Admin Audit | Shared page exists | Verified Server admin and audit port |
| Admin Storage | Shared page exists | Verified Server admin and storage port |
| Admin Services | Shared page exists | Verified Server admin and dependency port |

**Therefore: 8 routes have a genuine but incomplete DSM data source and 8 lack a DSM route-specific authenticated adapter.** The shared settings dialog is an additional overlay, not a seventeenth route. No DSM remote Root grants or arbitrary Agent browser RPC are authorized.

### GUI deployment and P0 delivery gates

1. DSM 7 SPK remains package-user-only. Target architecture is `armada38x`/ARMv7 (DS218j); other NAS architectures are not supported by this package.
2. The CLI already supports restricted-user `xd login --server ... --password-stdin`, local Source setup and Agent scheduling. GUI Server-address/login mutation is not implemented; it must not impersonate DSM authentication as xDrive Server authentication.
3. Authenticated same-origin HTTPS CGI, CSRF and Owner read projection exist. GUI Files write, Server admin role and broader Source/Task operations remain deliberately unavailable until explicitly verified Host ports are built.
4. Optional MUI SPK build has a separate reproducible package path. No source-only/Artifact result proves published, installed or accepted.
5. The current PR adds a read-only Server Owner quota verification inside the **existing shared Settings dialog**, with cancellation and an explicit non-HTTPS fail-closed explanation. It does not add a new auth/write route or grant remote control. CI and merged status must be checked on its exact PR HEAD.
6. Source-exact build, signing/manifest/SHA, install/upgrade persistence, actual Source first/incremental backup, crash recovery, ACL, CGI effective UID and browser playback/download still need evidence. Device-only acceptance is **跳过（未验收）** by the owner's decision, not PASS.

## Current shared UI status (2026-10-27)

The merged baseline includes [#2712](https://github.com/lazyxu/xdrive/pull/2712) (authenticated local UI and Owner file preview), [#2785](https://github.com/lazyxu/xdrive/pull/2785) (native video/audio Range), [#2802](https://github.com/lazyxu/xdrive/pull/2802) (Owner thumbnails) and [#2820](https://github.com/lazyxu/xdrive/pull/2820) (thumbnail-first Quick Look). Single-file download [#2823](https://github.com/lazyxu/xdrive/pull/2823) is also merged; it was still open at the start of this audit and its merged state was rechecked before this continuation. This matrix records implemented components and adapter wiring; CI results, built artifacts, publication, installation and physical acceptance require their own evidence.

| Surface | Shared implementation and actual DSM scope | Remaining capability or delivery boundary |
| --- | --- | --- |
| Shell, navigation and theme | `XDriveWorkspaceShell`, `XDriveWorkspaceSidebar`, `XDriveWorkspaceContent` and the common appearance provider; seven working page routes | Full-app parity requires authenticated adapters for the remaining pages |
| Home | `XDriveHomePage` entry with a DSM local-data branch; authenticated local Sources and Agent Server Owner quota | Full Desktop overview metrics and actions |
| Cloud Files | Canonical `XDriveFileExplorer`; Owner root/folders, Server sorting, 200-item cursor pages and virtualization | Search/grouping, upload, move, delete and other file mutations |
| File Quick Look / Viewer | Same `XDriveFileQuickLookDialog` and Preview engine; <=1 MiB text, <=32 MiB SHA-verified JPEG/PNG/WebP/GIF/PDF, native authenticated video/audio Range | Live Photo, unsupported original formats/codecs and physical DSM playback acceptance |
| Thumbnails / posters | Same visible-item thumbnail loader and cache; Owner/revision-verified Server derivatives; Quick Look loads the thumbnail/poster alongside the original | NAS-volume thumbnails and unsupported/uncached derivatives |
| Single-file download | Existing #2823 uses shared FileExplorer download actions and original Owner Range transport; nonempty files <=32 MiB, full SHA-256, real progress/cancel and a temporary user-clicked save link | **Merged bounded download**; larger streaming downloads, empty files, multi-file/folder ZIP and durable background transfers remain unfinished |
| Device Backup | `XDriveDeviceBackupPage`; local DSM branch shares cards, history, batch/schedule dialogs; account-device read-only scope uses the same Server page and bounded device/folder/history reads | Full local creation, target/rules, advanced preview and recovery |
| Tasks / transfers | `XDriveTaskCenterPage` with the authenticated local Agent backup-batch section | Full Server task history/control and transfer queues |
| Cloud Storage | Same `XDriveCloudStoragePage`, with real Agent Server Owner quota | File distribution, CAS inventory and admin operations |
| Local Storage | Same `XDriveLocalStoragePage`, with browser-origin storage estimates | Physical NAS disk and Agent cache metrics; browser estimates are not those measurements |
| Diagnostics | Same `XDriveDiagnosticsPage`; real DSM session and local Source-read checks | Server, disk, update, transfer and durability diagnostics |
| Settings | Same `XDriveSettingsDialog`; session-only appearance | Persisted account/server/package/update settings |
| Gallery, cloud Pull, conflicts and administrator pages | No authenticated DSM data adapter or route yet | Reuse their existing shared pages when genuine capabilities are connected; no placeholder state or actions |

The seven routes are Home, Cloud Files, Device Backup, Tasks, Cloud Storage, Local Storage and Diagnostics; Settings is a dialog. Home, local Device Backup and Tasks retain limited DSM data branches inside the shared page entries, so shared exports alone do not establish full Desktop feature or internal-layout parity. The requirement remains **all pages, navigation, dialogs and theme shared through `@xdrive/ui/mui`**, with genuine authenticated host adapters.

Code references: [DSM host and routes](../web/src/synology.tsx), [canonical FileExplorer/Quick Look composition](../ui/shared/src/mui/SynologyOwnerFilesPage.tsx), [DSM typed client](../ui/shared/src/synology-backup-adapter.ts), [fixed CGI operations](../internal/synologyui/cgi.go), and [shared Gallery port](../ui/shared/src/mui/MediaGalleryAdapter.ts). The existing Go and Node fixtures and [DSM UI workflow](../.github/workflows/synology-ui.yml) provide code-level coverage. Some shared-UI wiring checks are source assertions, not mounted-browser or physical-device acceptance.

### Current file boundary and next development

Cloud Files isolates verified rows to the current breadcrumb/sort scope, cancels obsolete requests and loads bounded follow-up pages near the canonical virtual scroll host's end. Owner refresh retires previous preview and thumbnail state. Text, binary preview, native media Range and thumbnails are already implemented; they are not a new backlog item. The bounded nonempty single-file download in #2823 is merged; arbitrary-size and batch download parity remains unfinished.

This continuation reuses merged #2823 and unifies double-click, Space and preview-menu activation on the same shared Quick Look. It adds previous/next navigation within supported files already loaded in the current directory, preserves selected-file sessions, labels counts as loaded/selected, and suspends background list thumbnails while the Viewer is open. The list, Viewer action and download handler now use one disabled-reason check before any side effects. A legal download closes the preview to reveal real progress, Cancel and the existing save link; a rejected request preserves a previously verified link. Owner refresh, client replacement and unmount retire old actions, and verified rows are bound to the client/root generation. **Implemented with 10 local controller regressions passing; new-head TypeScript/build/SPK CI and delivery are still pending.** The tests execute production controller functions with deterministic hook and Agent fixtures; they are not a mounted-browser or physical DSM acceptance run. The same suite first reproduced invalid-download URL loss, an old callback starting work after Owner refresh, and seven old rows appearing during a replacement-client first render, then passed after the fixes. No new media transport, player, queue or credential route is introduced. Subsequent Gallery work needs real Owner media/album reads through the existing Agent/DSM adapter and the existing `XDriveMediaGalleryPage`; cloud Pull and complete task/transfer/admin adapters remain separate work. Preserve revision/ACL checks, cancellation and credential confinement throughout.

### Release and physical acceptance policy

The initial DSM 7 armada38x **CLI-only backup SPK release is independent** of optional GUI adoption, full-page parity and physical DSM acceptance. Merged packaging or UI source does not by itself prove a published asset or installation.

Under the owner's standing decision, real shared-folder ACL, first upload, unchanged second incremental, package stop/restart, upgrade persistence of credentials/tasks/checkpoints and effective CGI UID are **按用户决定跳过（未验收）**. Disclose these skipped checks once, then continue subsequent development without repeated confirmation or a device-acceptance blocker. Actual DSM playback/save behavior also remains unverified until observed. Skipping does not establish PASS, and does not waive executable authorization/CSRF/Owner/Root tests, applicable CI, SPK integrity or publication gates.

### Reading the historical records

Dated sections below preserve implementation-stage evidence. Their words such as "current", "next", "development PR" or "pending CI" refer to that historical stage and are superseded by the current matrix and the actual relevant PR state. Do not infer today's capabilities, test results or release status from those older checkpoints.

## Historical — 2026-10-27 · Bounded, fully verified single-file download (standalone PR #2823)

This code follows successful merges **#2785 native video/audio Range** and **#2802 current Owner JPEG/PNG thumbnails**, and merged thumbnail-first Quick Look **#2820**. PR #2823 now targets `master` directly and requires its own source-exact CI. It adds a **single-file <=32 MiB** browser download action through the **original shared `XDriveFileExplorer`**. This is an intentionally bounded first download slice, **not yet full-size/ZIP/batch parity with Desktop**.

- **No new privileged route:** The DSM frontend invokes the same `ownerFileMediaRange(nodeID, revision, offset, length, signal)` on the existing, DSM-authenticated, same-user owning Agent. Each request reads up to 256 KiB, and the Server validates the current Owner, revision-bound ETag, byte range and CAS SHA-256. No signed preview/download URL, Agent token, file path or bearer reaches the browser.
- **Complete-file integrity gate:** The bounded loader requires the Server's total exactly matches the item size, all sequential ranges are complete and retain the same revision and lower-case SHA-256. The browser uses WebCrypto to hash the **entire** assembled Blob and compares it with the Server digest. Only **after success** is an `application/octet-stream` Blob URL created and exposed as a **real user-activated** `a[download]` save link. The second user click is intentional because Safari/DSM may reject a synthetic click after many asynchronous range reads. Corrupted, shortened, cross-Owner, changed-revision and canceled transfers never offer partial downloads.
- **The actual shared Explorer's selection menu** has an enabled download action only for exactly one selected non-empty file <=32 MiB; folder, multi-select, oversize and concurrent requests show disabled reasons. Progress is actual `loadedBytes / totalBytes`, with a Cancel action. Folder/sort/Owner-root refresh or component teardown cancels pending Agent reads. The verified save link is valid for at most **60 seconds**; browser navigation, Owner switch or Cancel revokes it immediately. The downloader never attempts a post-await synthetic click that Safari could silently reject. Actual DSM save behavior remains unverified.
- **Bounded memory:** 32 MiB maximum file input, 256 KiB individual reads, no Server/Agent filesystem access and no fabricated success for larger files. Fully streaming >32 MiB saves and batch/ZIP downloads require a separate safe browser sink, end-to-end digest with rollback, large-file cancellation, and device/browser acceptance.
- **Regression:** `web/scripts/test-synology-owner-download.mjs` tests arbitrary binary identity, every range offset/length, whole-file SHA, byte progress, filename sanitization, abort and forged size/hash/revision/offset/short body failures; confirms the existing common `XDriveFileExplorer` action and no new token/ticket route. The original Synology UI CI runs the script.
- **Physical DSM acceptance** (actual browser save, shared-folder ACL, actual first and second incremental upload, package stop/start/upgrade, effective CGI UID) remains **按用户决定跳过（未验收）**, not counted as passed or a blockade to independent code.

## Historical — 2026-10-27 · Thumbnail-first image / poster in the same Quick Look

Following merged **#2785 native media Range playback** and **#2802 Owner-scoped derivatives**, Synology's existing `XDriveFileQuickLookDialog` now passes the **same** `loadOwnerThumbnail` derivative reader to `loadImagePreview` that `XDriveFileExplorer` uses for grid/list tiles. It does not introduce a NAS-specific Viewer. The shared `XDriveDecodedImagePreview` independently initiates the small Owner-verified thumbnail and full original; the thumbnail can render first without being replaced by a blank spinner, while full-resolution image decode continues. For a video, the shared `FilePreviewSurface` uses the derivative as a pre-play poster without blocking native Range playback.

The thumbnail is Server Owner/revision validated for every read and remains an owned `blob:` URL with the shared Preview's abort/revoke lifecycle. Failed or uncached thumbnails degrade to existing file icon/loading behavior and never relax original authentication. The cached thumbnail may be loaded again through the independent viewer adapter; future sharing of live cached leases can optimize that path without expanding authority. **Live Photo, full-size unsupported RAW/HEIC, actual DSM browser playback, full-file download and all Gallery flows remain separately tracked.**

Source-exact regression in `web/scripts/test-synology-owner-thumbnail.mjs` asserts that Quick Look binds both `loadImagePreview` and original `loadPreviewURL` to the original shared two-layer Viewer. The physical DSM and native iOS comparison policy remains **按用户决定跳过（未验收）**; it does not count as successful testing.


## Historical — 2026-10-27 · Server Owner thumbnails in the canonical virtualized FileExplorer (development)

This independent step follows merged **#2712** and merged video/audio Range PR #2785. The NAS app uses exactly the existing shared `XDriveFileExplorerThumbnail` (six request slots, visible-item prefetch admission, scroll cancellation, 96-entry Blob URL LRU, cache release on hidden/switch). **No new NAS thumbnail implementation, background scanner or second React list**.

- **Real derived bytes, never whole originals:** `GET /api/v1/media/items/:id/thumbnail?v=4&revision=:currentRevision` on the *original Agent's currently logged-in Server* returns a JPEG/PNG thumbnail or cached video poster. The Server verifies Owner and revision on every call; the new `MediaOwnerThumbnail` deliberately bypasses the Agent's ordinary revision-keyed warm cache to prevent a stale image after login/revision changes. Both file identity and revision are required and constrained to JavaScript-safe positive integers. No arbitrary Server URL, NAS path, bearer, cookie, preview ticket or mutation authority crosses to DSM.
- **Bounded transport:** Source image data must be <=2 MiB, first pass JPEG/PNG header/dimension validation (at most 2048×2048), then **fully decode** to reject truncated or malformed compressed data before projection. Exact `opaque/masked/unavailable` alpha-state is validated. Masked thumbnails require a well-formed <=4 KiB base64 PNG mask with matching image dimensions. The private owning Agent opts into `cloud-thumbnail-read` and GET-only `/v1/cloud/thumbnail?node_id=..&revision=..`, returning only JSON base64 + image MIME/alpha metadata; its IPC JSON cap is 4 MiB. DSM CGI grants only fixed `op=cloud-thumbnail`, rechecks HTTPS DSM session/authorized DSM user/same-user original Agent **for every request**, and refuses duplicated, noncanonical and extra fields. Old Agents fail closed.
- **Browser + UI:** Same-origin DSM `fetch` decodes a strict bounded payload, confirms JPEG/PNG magic and optional alpha PNG magic, then the shared thumbnail loader creates a Blob URL for the original FileExplorer. The shared progress control uses the exact alpha mask only when proven; when mask is unavailable, the pie stays hidden rather than overlaying transparent pixels. A new Owner-root refresh increments the `interactionLifecycleKey`, discarding all old thumbnail caches even if a different Server account reuses numeric Node ID/revision. No fake byte-progress: JSON download is indeterminate until the derivative has been received.
- **Behavior boundaries:** Unsupported formats, uncached video posters, a Server revision conflict and missing Agent capability show the original FileExplorer type icon (with normal error status). The 1 MiB text Quick Look, 32 MiB image/PDF verified Blob preview and owner media-range route remain separate. This is not NAS volume thumbnails, remote upload/download or full Gallery.
- **CI contract:** New Go tests cover real PNG decoding, Server revision request, unsafe/mismatched alpha, invalid/missing Agent capability, 2 MiB/JS-safe bounds, DSM per-request session and old-Agent behavior. `web/scripts/test-synology-owner-thumbnail.mjs` checks browser allowlist, image/alpha serialization, cancellation, root refresh, source-specific LRU and exact common thumbnail control. Existing `synology-ui.yml` builds and packages the same ARMv7 DSM MUI candidate; **not physical DSM accepted**.
- **Real DSM device-only checks:** Read-only shared-folder ACL, initial real upload, unchanged second incremental, package stop/restart, upgrade credential/task persistence, actual Gallery performance and effective CGI UID remain **按用户决定跳过（未验收）** and nonblocking for independent safe code. The status does not waive required source-exact security/CI.

## Historical — 2026-10-27 · Native browser video/audio Range, shared Viewer (development PR)

This incremental work follows **merged #2712**, retaining the same `XDriveFileExplorer`, `XDriveFileQuickLookDialog` and `XDriveFilePreviewSurface`. No alternative Synology UI or media player is created. This is a **source-level candidate awaiting its own exact-head CI and release gate**, not proof of a real DSM installation.

- **New supported stream types:** ordinary MP4/M4V, WebM, MP3, M4A, Ogg, WAV and FLAC if the browser can decode the actual codec; Live Photo and unsupported codecs remain unavailable. JPEG/PNG/WebP/GIF/PDF still use the previously merged <=32 MiB SHA-verified Blob path. The native player receives a URL only after a fixed, Owner-authenticated <=256 KiB file-header read proves the selected Node, revision, total byte count, SHA256 and MIME file magic.
- **No browser bearer or download ticket:** only `backup.cgi?op=cloud-media-stream&node_id=...&revision=...&total=...&sha256=...&mime=...` on the **same DSM origin**. The URL itself is not a credential; a copied URL without a valid DSM session and matching same-user Agent fails. CGI responses set `Cross-Origin-Resource-Policy: same-origin`; cross-site `Sec-Fetch-Site` and foreign `Origin` requests are rejected even with cookies. The native HTML `<video>` / `<audio>` controls, buffered seconds and teardown remain the shared Viewer implementation. Source/Owner rebinding aborts pending preflight and discards old player state.
- **Actual packaged CGI compatibility:** The installed `packaging/synology/ui/backup.cgi` shell entrypoint now permits `HEAD` as well as `GET/POST`; previously it exited before the Go gateway, silently breaking native media HEAD probes even when Gateway-only tests passed. The Go gateway admits HEAD **only** for `/v1/cloud-media-stream` and still denies HEAD for cloud root/list/text/ranges or Backup mutations. The SPK archive regression explicitly asserts the packaged script's `GET|HEAD|POST` allowlist and HTTPS/cookie fences.
- **HTTP Range semantics:** DSM's fixed CGI authenticates HTTPS route, current DSM account and configured authority for **every GET/HEAD**, then discovers the existing same-user owning Agent. It supports one `bytes=start-end`, `bytes=start-` or suffix `bytes=-N` window at a time; rejects multi-range, leading-zero, malformed, stale If-Range, wrong digest or media type. Each HTTP response is at most **1 MiB**, assembled from up to 256 KiB separately authenticated Server Owner/Agent slices. Server 206, exact Content-Range, strong revision ETag and SHA256 checks are already enforced in #2712. Only after *all* chunks pass does DSM send the 206 body/Content-Range/ETag/Accept-Ranges/Content-Type. Each browser request rechecks 16 bytes of file magic, so a 0–1 sniff or deep seek works without accepting arbitrary MIME or fake HTML. HEAD reauthenticates the same Owner and reports full Content-Length without streaming media bytes.
- **Deliberate limits:** this is a small bounded native Range adapter, not a general file/URL proxy, direct Server preview ticket, NAS path reader or full download capability. Each 1 MiB browser window requires up to four Agent range reads and has the existing 20s per-request CGI timeout. Complex/multi-range requests and some codecs may fail closed. Physical DSM seeking, fast startup, canceled large streams and browser compatibility are *not yet acceptance-verified*.
- **Regression:** `internal/synologyui/media_stream_test.go` covers session/Owner, small sniff bytes=0-1, open-ended/explicit/suffix/seek ranges, HEAD, 1 MiB cap, content SHA revision mismatch, stale If-Range, selector forgery, wrong MIME, Agent integrity failure and old-Agent 501; `web/scripts/test-synology-media-stream.mjs` covers same-origin endpoint construction, unsupported extensions, authenticated metadata and shared Viewer control integration. CI uses original `synology-ui.yml` with the new tests; no separate build/release workflow.
- **Manual DSM-only acceptance policy unchanged:** real share read-only ACL, first real upload, second identical incremental, SPK stop/start/upgrade, credential/checkpoint persistence and CGI UID remain **按用户决定跳过（未验收）**; this does not waive source-exact Go/browser/packaging validation.


## Historical — 2026-10-27 · Immutable Owner media preview via canonical FileExplorer/Viewer

The existing [#2712](https://github.com/lazyxu/xdrive/pull/2712) developer branch now adds **bounded image/PDF content preview** on top of the real DSM-authenticated Owner file list and text Quick Look. This is **source code pending new-head CI**, not a claim that the SPK was installed on physical DSM or fully matches Desktop.

- **One shared UI:** The DSM page imports the same `XDriveFileExplorer`, `XDriveFileQuickLookDialog` and `XDriveFilePreviewSurface` used by Desktop/Web. Supported types are JPEG/PNG/WebP/GIF/PDF with a **32 MiB per-file cap**. Video, audio, Live, thumbnails, Web downloads, mutation, admin and platform-native NAS disk metrics remain unsupported; never add fake actions or second React/Runner implementations.
- **Strict per-range identity:** The existing Server `GET /api/v1/files/:id/content` uses Owner authorization, `If-Range` and Server revision `ETag`, `http.ServeContent` with `206 Content-Range`, `Content-Length` and `X-Content-SHA256`. The new `internal/client.DownloadVerifiedRange` **rejects HTTP 200 fallback**, missing/stale revision, invalid/missing digest, incorrect offsets/bounds, malformed Content-Range, short/mismatched bodies or unexpected extra data. This does not modify the pre-existing generic `DownloadRangeInto` behavior for unrelated callers.
- **Credential confinement and bounds:** Browser `backup.cgi?op=cloud-media-range&node_id=N&revision=R&offset=S&length=L` is same-origin HTTPS DSM-user authenticated for **every chunk**, resolves the original same-user owning Agent, and allows only four canonical numeric selectors. Agent Backup-only explicitly permits **only** `GET /v1/cloud/media-range` under independent `cloud-media-range-read` capability. The Agent uses its original Server Owner account; no Server URL, bearer, cookie, CAS key, native path, arbitrary HTTP header or preview ticket crosses into the DSM browser. Every native IPC/CGI reply contains only offset/total/revision/SHA256 and at most **256 KiB bytes** encoded as JSON base64. Old Agents fail closed.
- **Verified Viewer handoff:** DSM browser validates schema/base64, requested offset, total file size, revision and stable SHA256 on every chunk; only safe extensions/file-magic are accepted, then the **complete 32 MiB-or-smaller file** is recomputed with WebCrypto SHA-256 before minting a `blob:` URL for the existing Quick Look. Cancelled/scoped-out requests do not produce a Blob; shared Viewer owns revoking created URLs. `loadPreviewURL` is supplied to both the canonical FileExplorer and Quick Look. This is bounded **Blob** viewing, **not** streamable large video/audio; HTML video/PDF open-ended Range support must be designed separately before enabling those types.
- **Regression and CI:** `internal/client/owner_media_range_test.go`, `internal/localbackupipc/owner_media_range_test.go`, `internal/synologyui/owner_media_range_test.go`, `cmd/xdrive-agent/desktop_ipc_owner_media_range_test.go`, `web/scripts/test-synology-media-preview.mjs` and updated Owner-browser/parity tests cover 206-only, stale Owner, malformed selectors, SHA-256/magic mismatch, oversized files and cancel. New-head actual CI/build/SPK verification must pass; no prior SHA green can substitute.
- **Independent real DSM acceptance:** actual shared-folder read-only ACL, first genuine upload, unchanged second incremental, package stop/restart, upgraded credential/checkpoint/Agent job persistence and CGI effective UID remain **按用户决定跳过（未验收）**, once disclosed. Continue independent safe code; this cannot waive code-level security, package-integrity checks or real CI.


## Historical — Desktop ↔ DSM common UI status (2026-10-26; superseded)

The initial common-UI checkpoint under #2712 covered the shared application frame, local backup, limited task/storage/diagnostic pages and bounded Owner file reads. The full-page requirement was already established by merged #2732; the initial headless SPK and release workflow were separate merged work (#2642/#2650). The current matrix above replaces this checkpoint's old table and next-step list: binary previews, native video/audio Range and thumbnails have since landed, while download #2823 remains unmerged. These implementation milestones do not establish publication, installation or physical acceptance.


## Historical — Status (2026-10-26)

- The original armada38x SPK containing `xd` and `xdrive-agent --backup-only` is merged (#2642). SPK release asset publication is a separate PR (#2650). The initial SPK does **not** require a native DSM MUI page.
- This follow-up includes a **strictly opt-in** DSM `dsmuidir` desktop launcher, on-demand CGI adapter, isolated MUI page and SPK packaging/allowlist checks. The default SPK remains CLI-only; the UI SPK is built separately only when an explicitly verified MUI build directory is supplied. Source/CI verification does **not** prove the application was installed or executed on a physical DSM machine.
- Production NAS installation / real share ACL / first upload / unchanged second incremental / package stop-restart / upgrade persistence: **按用户决定跳过（未验收）**. State the checks and proceed with the next safe feature. No production credentials are needed to develop the adapter.

## Historical — Shared application shell — first all-page parity milestone (2026-10-26)

- The DSM entry point now mounts **the exact same** `XDriveWorkspaceShell`, `XDriveWorkspaceSidebar` and `XDriveWorkspaceContent` React/MUI components that Desktop and Web already use. Both use the existing common navigation model; there is no separate NAS Sidebar implementation or duplicate CSS. The same existing AppearanceThemeProvider controls theme tokens.
- **Capability-accurate routing:** the shared Sidebar and compact navigation accept optional `coreKeys`, leaving Desktop/Web defaults completely unchanged. DSM currently supplies only `['device-backup']` because the DSM-authenticated adapter genuinely supports only that page; mobile DSM shows it in the compact navigation instead of a dead "More" menu. Clicking the current destination refreshes the owner-verified Agent view. Do not display nonfunctional Files/Gallery/Viewer/Storage/Admin links as if they were available.
- The canonical `ui/shared` pages must be added unchanged behind actual authenticated DSM and/or Server adapters one capability at a time, including account/session, Files, Gallery, Viewer, Pull/Push, transfer center, storage, conflicts, diagnostics and admin/settings. The final requirement is one app/page UI for Desktop, Web and NAS with different host adapters, not three separate websites. The first all-page step is **app shell / navigation**, not a claim those later pages are implemented.
- The first CLI-only SPK's release remains independent from this opt-in GUI bundle. Physical DSM read-only ACL/first upload/second incremental/package stop/restart/upgrade persistency and effective CGI identity are **按用户决定跳过（未验收）** until exercised on real DSM. Source-exact TypeScript/native/security gates are still required.

## Historical — Desktop ↔ DSM UI parity target (2026-10-26)

**Final requirement:** Desktop and Synology must render the SAME shared MUI components for equivalent supported functions, not two independently styled lookalikes. Platform differences belong only in authenticated capability adapters (Electron/Agent IPC versus DSM-authenticated on-demand CGI). Same header, typography, component spacing, folder expand/collapse, progress/history presentation, dialogs and terminology. Do not duplicate Runner, upload protocol or a NAS-only React library.

- **Current common presentation:** Desktop `XDriveDeviceBackupPage` and DSM `XDriveSynologyBackupLocalPanel` now both use `XDriveWorkspaceSurface`, `XDriveDeviceBackupFolderSummary`, the same folder Accordion appearance and `XDriveDeviceBackupLocalCommonBatchDialog`. DSM shows owner-verified local Agent history inline in the same card structure rather than the original single-line list. A source-level CI contract fails if either client stops importing the same page shell, folder header or dialog. This is **partial parity**, not the complete Desktop app.
- **Now shared schedule configuration:** DSM's same-origin CGI supports owner-scoped schedule read and revision-checked update via the original Agent. The same `XDriveDeviceBackupLocalScheduleDialog` is used by Desktop and NAS, including manual / interval / Cron choices. JSON payload is bounded and exact-field; unknown or duplicate keys, stale revisions, forged DSM identities, foreign Source IDs and wrong Origin/CSRF are rejected. The NAS never creates a parallel scheduler.
- **Still different:** Desktop can browse real device overview and other-device read-only history, create/rename/remove local backups, change cloud target/mode/rules/schedule, preview/snapshot/delta/recovery and show the corresponding shared dialogs. DSM's currently scoped authenticated CGI supports owner-filtered local list, status, history, run, pause/cancel and read/write schedule. Do not render inert actions or synthesize `verifiedLocalDeviceID`, a fake cloud target or a private Root path.
- **Next convergence:** continue adding narrowly scoped authenticated DSM adapters for local-owner functions one at a time (next: owner-verified backup settings/preview; schedule already uses the original shared dialog and Agent). Preserve Source identity/revision, DSM principal/CSRF, original Agent IPC and Owner/Root boundaries. For full Desktop-style device list, retrieve real owner-redacted device IDs from the original Agent, never fabricate an ID. Reuse complete `XDriveDeviceBackupPage` when the real data source is available.
- **Full-app goal:** share application shell, navigation and pages where functionality exists on NAS. Desktop-only Electron system facilities remain platform-specific or unavailable rather than being represented by nonfunctional buttons. DSM window chrome/display size may differ; comparable UI components must remain identical.
- **Release boundary:** first headless SPK does not wait for full UI parity. Real DSM CGI UID, share ACL, first upload, unchanged second incremental, service lifecycle and upgrade persistence remain **按用户决定跳过（未验收）** unless a real NAS is available; never claim they passed. Code-level auth, TypeScript, CI and release gates remain mandatory.

## One Agent and one shared UI

- `cmd/xd/backup_synology_ui.go` uses the **original** CLI, not a new daemon. `internal/synologyui` authenticates the DSM session for **every** request, then connects with `localbackupipc.Connect` to the already-running same-user owning Agent. No browser-facing Agent bearer, second Runner, CAS writer, upload queue, or TCP listener.
- `web/synology.html`, `web/src/synology.tsx`, `web/vite.synology.config.ts` and `npm run build:synology` produce an **isolated, relative-path static React/MUI bundle** verified by `web/scripts/verify-synology-ui.mjs`. `packaging/synology/ui/config` registers the DSM `com.xdrive.NASBackup` application and its relative `3rdparty/xdrivenas/synology.html` URL. The only CGI executable is the unprivileged `ui/backup.cgi` shell wrapper, which validates the real package `target`, sets the Agent's matching home/config environment and delegates to the original `xd`.
- `ui/shared/src/mui/SynologyBackupLocalPanel.tsx` composes the existing `XDriveDeviceBackupLocalCommonBatchDialog`. `ui/shared/src/synology-backup-adapter.ts` maps authenticated same-origin API calls to its existing run / inspect / history / pause / cancel actions. There is no second progress/history implementation.
- The browser receives scoped, redacted Source/device/Owner-file/quota projections and bounded verified preview bytes. It never receives native paths, credentials, device proofs, private per-file operations or Agent discovery metadata. No remote Web/cross-device Root writes.
- Create/bind local Root still requires the **local** same-user `xd backup` CLI. Authenticated schedule read/update uses the existing shared dialog and Agent; a DSM web request cannot select a native directory or grant a Root.

## Authentication and owner boundary

Synology documents its per-request custom CGI session check using `/usr/syno/synoman/webman/modules/authenticate.cgi` with the actual CGI `HTTP_COOKIE`, `REMOTE_ADDR`, and other gateway environment values. See [Synology DSM 7 Application Authentication](https://help.synology.com/developer-guide/integrate_dsm/web_authentication.html).

1. The restricted `xdrivenas` package account executes `xd backup synology-ui authorize --dsm-user ACCOUNT` **locally** after `xd login` and Agent setup. This stores a 0600 user allowlist plus randomly generated CSRF key under its protected xDrive config dir. No remote request can authorize or rotate a principal.
2. The DSM custom CGI entry invokes `xd backup synology-ui cgi`. It only runs under a genuine HTTPS CGI environment; each request verifies the DSM login via the absolute native `authenticate.cgi` executable, checks the explicit approved DSM principal, then validates the same-user Agent and owning Source grant.
3. Mutating POST requests additionally require exact same-HTTPS-origin and the short-window CSRF token bound to the browser's DSM Cookie, authorized principal and Host. No path-based Source selectors, token in browser storage, header trust bypass, unsafe fallback or unsafe same-user bootstrap.
4. Fail closed without configured authority, if CGI is not the same OS user as the Agent, if DSM authorization fails, if the Source belongs to another device, or if the session changes. The API sends no credential-derived error details.

The on-demand CGI URL is **one fixed DSM script**, `/webman/3rdparty/xdrivenas/backup.cgi`, using an allowlisted `op` query parameter rather than relying on CGI `PATH_INFO`. The adapter internally maps these operations onto the existing private `/v1/...` handler and rejects noncanonical paths, duplicate `op`, unknown fields and malformed escaping. The following are initial local-backup examples; the complete current allowlist, including Owner reads and previews, is in `internal/synologyui/cgi.go`.

- GET `backup.cgi?op=bootstrap`, `?op=sources`, `?op=status&source_id=...`, `?op=history&source_id=...`
- POST `backup.cgi?op=run&source_id=...`, `?op=control&source_id=...&action=pause|cancel`

The `xd` dispatcher checks the effective UID against the installed non-root `xdrivenas` account for BOTH CGI execution and CLI authorization. A DSM CGI running as an unrelated web-service user is rejected; neither root/setuid nor group-readable Agent credentials are fallback options.

`pause` and `cancel` affect scheduling at the **next file boundary**, not physical cancellation of an in-flight remote commit. Do not assert `backup_complete`, `retirement_safe` or `current_cas_verified`.

## Optional UI package build and verification commands

```sh
# No second Runner, backend or web server: same original ARMv7 binaries.
npm ci --prefix web
npm run build:synology --prefix web

# Baseline SPK: unchanged original CLI-only format.
bash scripts/build-synology-spk.sh 0.1.0-1 release/synology-cli
python3 scripts/ci/test-synology-spk.py \
  release/synology-cli/xdrivenas-armada38x-0.1.0-1.spk \
  release/synology-cli/core 0.1.0-1

# Opt-in UI SPK: supply the *source-exact* prebuilt MUI directory as arg 4.
bash scripts/build-synology-spk.sh 0.1.0-1 \
  release/synology-ui release/synology-cli/core web/dist-synology
python3 scripts/ci/test-synology-spk-ui.py \
  release/synology-ui/xdrivenas-armada38x-0.1.0-1.spk \
  release/synology-cli/core 0.1.0-1 web/dist-synology
```

Only `ui/config`, `ui/backup.cgi`, `ui/synology.html`, versioned CSS/JS, bounded signature-checked PNG assets and seven source-derived DSM icon sizes are admitted. The package's `bin/xd` and `bin/xdrive-agent` remain **byte-for-byte identical** to the exact core used in the CLI-only candidate. No Electron, server, Node runtime on DSM or new network port is included. In the GUI SPK, `dsmuidir="ui"` and `dsmappname="com.xdrive.NASBackup"` register the entry.

The icon is visible to DSM desktop users; API access is still limited to the **explicitly approved DSM principal**. While logged in as the restricted package account (not root), run `xd backup synology-ui authorize --dsm-user ACCOUNT` after local `xd login` and original Agent initialization. The CGI's effective UID must equal the configured `xdrivenas` account; otherwise the UI fails closed, and no privileged workaround is permitted. A missing/expired DSM session or another DSM user never authorizes local file operations.

## Remaining device-only acceptance (report and skip, then continue)

- Install optional UI SPK in DSM Package Center and open desktop launcher under the authorized DSM principal.
- Prove DSM CGI actually executes as `xdrivenas`, with exact session/CSRF/Owner checks and no token exposure.
- Grant read-only DSM share ACL, upload first file, rerun unchanged incremental, stop/restart and upgrade while retaining credentials and original Agent journal.

These require physical DSM and remain **按用户决定跳过（未验收）** under the standing owner decision. After one disclosure, do not request confirmation again or block subsequent development. CI must still pass source-level auth, dangerous user/Root rejection, SPK byte identity, bundle allowlists, shell syntax and consistent release packaging; skipped physical checks are never PASS.

## Historical next-work list — initial adapter slice

This list records the initial follow-up plan. Use the current matrix and relevant executable tests before choosing work; it is not a new gate on development or a claim that all listed fixtures are still missing.

- A DSM package-runtime fixture (or later physical NAS) must confirm that the registered `backup.cgi` executes as the owning `xdrivenas` account. The `xd` UID/authorization checks refuse cross-user execution. Do not use setuid/root, broad group-readable bearer files or exposed Agent loopback as a fallback.
- Follow up by promoting a source-exact, verified optional GUI SPK to a user-facing release asset *after code-level CI passes*. The first CLI-only release is separate and must not wait for GUI adoption or physical DSM acceptance.
- Add source-exact CGI negative tests for auth failure, other DSM users, origin/CSRF, foreign Source, config symlink/permissions, restart, and stale owner session. Go adapter tests exercise the core security model with injected fixed authenticated principals; they do not pretend to execute a real DSM webserver.


## Historical — DSM 与 Desktop 共用“诊断”页（2026-10-26）

- NAS 和 Desktop 直接渲染同一 `XDriveDiagnosticsPage` React/MUI 源文件，包含状态卡片、分组、说明和响应式布局；Desktop 仅保留兼容重导出。
- NAS 限定为两个**真实、只读**检查：经 DSM 会话授权的 CGI `bootstrap` 和所属 xdrive-agent 的 `sources`。两次均成功才标记这两项 PASS；失败清空旧结果并报告失败。未检查 Server、存储、更新、传输及重启持久性，不假称整体通过；无真实实现的操作按钮不展示。
- 当前 NAS 仅开放 **设备备份** 与 **有限诊断**；Files、图库/Viewer、完整 Push/Pull、任务/传输、存储、冲突、管理、设置均须后续接入真实经身份认证的适配器后才能开放相同共享页面。
- 真正 DSM 的 ACL、首传、第二次增量、停启以及升级后任务/凭证保持：**按用户决定跳过（未验收）**；不阻塞独立开发，也不记为通过。


## Historical — 2026-10-26 · 同源设备卡、历史与设置对话框

- 设备卡片已提取为唯一 `XDriveDeviceBackupDeviceCard`：Desktop 使用 Server/Agent 实际设备名、平台、在线状态及活动时间；NAS 使用“当前 NAS”描述，只显示经过 DSM 身份验证的本机 Agent 来源，不制造设备 ID。
- 备份历史统一使用 `XDriveDeviceBackupHistoryList`，由严格类型区分 Server SyncRun 与 Agent 本地阶段性回执。共用布局与日期、状态、数量/字节格式；本机回执不声称云端 CAS 完整性或备份完成。
- 群晖侧边栏增加“设置”入口，打开 **Desktop/Web 已在使用的同一 `XDriveSettingsDialog`**。当前真实支持外观（亮/暗/跟随系统），仅当前窗口生效，不储存用户密码、会话或私有 Token，不虚构未实现的 NAS 账号/套件设置。
- 仅“设备备份”“有限诊断”是已授权的普通页面；设置是共享 Dialog。Cloud Files、Gallery/Viewer、Push/Pull 完整管理、Task/Transfer、Storage、Conflicts、Admin 仍未接入本地经 DSM 认证的真数据适配器。全部页面共用 UI 的目标尚未完成。
- 真实 DSM 的只读 ACL、首次实际上传、第二次增量、套件停启和升级持久性：**按用户决定跳过（未验收）**，不阻塞独立开发；不能声称已通过。


## Historical — 2026-10-26 · 本机备份文件夹与动作栏继续收敛

- Desktop 与 DSM 直接渲染同一个 `XDriveDeviceBackupFolderAccordion`：文件夹标题、展开箭头、边框、间距、操作区、可访问折叠交互与响应式布局由 `ui/shared` 唯一实现。历史内容已在上一阶段抽取为共用 `XDriveDeviceBackupHistoryList`。
- 两端也使用一个 `XDriveDeviceBackupLocalPrimaryActions` 实现“手动增量备份（试用）”“配置本机同步计划”的按钮、顺序、间距和样式。Desktop 只有验证真实本机设备 ID、拥有 Source 且未撤销时才传入可执行动作；NAS 仅针对通过逐请求 DSM 会话、严格 Owner/Source 验证的 Source 提供动作。不允许占位按钮/伪造结果。
- 本项不添加 NAS 第二套 Runner、Server 来源身份、SQL/CAS 写入或 Shell IPC；只统一真实业务页面的 JSX 展现。其他未接通授权适配器的页面继续隐藏，物理 DSM 验收保持“按用户决定跳过（未验收）”。


## Historical — 2026-10-26 · NAS 真正接入共享“本地存储”页（有限范围）

- DSM 已复用现有 `XDriveLocalStoragePage`（Desktop/Web 共用）作为第三个真实页面。其 `createXDriveSynologyBrowserStorageSource` 只在安全上下文读取标准 `navigator.storage.estimate()` 的站点使用量/配额及可用的 Cache Storage 容器数量；数值经过有限、非负校验。
- **数据范围绝不混淆**：这是 DSM HTTPS Origin 的浏览器站点估算，可能含同源其他 DSM 应用；并非 NAS 磁盘、Agent 缓存、云端 CAS、当前账号配额或可清理空间。共享页面通过新 `usage_scope_label` 展示准确来源。
- 未加入清理、删除、释放、修改本地策略接口；共享页面在没有 `clearBrowserCache` 时不显示禁用的伪清理按钮，其他 Web/Desktop 客户端不受影响。无凭证/Cookie/localStorage/IPC 操作。
- 单独 Node 运行时测试校验正常、无权限、不安全上下文、无 API、异常字节数据及无可执行写方法。真实 NAS 磁盘容量/Agent 缓存管理仍 **尚未接入**，须等待受 DSM 鉴权保护的真实本地适配器后开放。
- 实机 DSM 的 ACL、真上传、第二次增量、套件停启及升级后任务/凭证持久性继续标记“按用户决定跳过（未验收）”，不影响独立代码开发。


## Historical — 2026-10-26 · NAS 接入同一个任务页（有限本机备份批次）

- NAS 直接挂载共用 `XDriveTaskCenterPage` 的 `localBackupClient` 适配，原 Desktop/Web 任务列表不变。仅呈现 DSM 会话及 Source 权限验证过的本机 Agent 批次，不伪称 Server 全局任务、传输记录或可删除源文件。
- 列表调用已有 `client.list()`；用户选中单个 Source 才通过原有 `client.inspect(sourceID)` 查询状态，无 512 个 Source 的预排请求。切换来源、刷新或失败时清除陈旧快照。
- 复用任务中心区块/卡片/状态徽标，新增 `xDriveValidateSynologyLocalBatch` 拒绝伪造 Source ID、备份完成/CAS 安全标志、冲突计数和 stop_requested，并用无凭证 Node fixture 做正反例测试。
- NAS “任务”现在是第四个真实页面，范围仅为本机 Agent；云端任务/传输等其余数据待真实认证适配器接入。实机 ACL、首传、第二次增量、套件启停及升级持久性仍标记“按用户决定跳过（未验收）”。


## Historical — 2026-10-26 · NAS / Desktop 直接使用同一个设备备份页面入口

- DSM 现在和 Desktop/Web 一样挂载 `XDriveDeviceBackupPage`，不再从 Host 直接挂载 `XDriveSynologyBackupLocalPanel`。真实 DSM Session + Agent adapter 由 `localBackupClient` 注入；Server/Native 子树通过独立组件生命周期保持原有安全检查和异步数据处理。
- 统一的是页面入口和大部分设备备份 UI 组件，**尚非所有功能或内部 DOM 完全相同**：NAS 不能伪造 Server device ID、云端目标、Root 或完整历史。剩余 FileExplorer、Gallery/Viewer、完整 Push/Pull、Server 任务及管理员适配器仍待真实实施。
- 实机 ACL、真实上传、第二次增量、套件启停和升级后任务/凭证持久性：**按用户决定跳过（未验收）**，不阻塞独立开发，但代码级权限与 CI 不能跳过。


## Historical — 2026-10-26 · DSM 主页直接复用 Desktop/Web 页面入口

- DSM 使用同一个导出的 `XDriveHomePage`；仅在 `localBackupClient` 存在时渲染受限的 `XDriveSynologyHomeOverview`，Desktop/Web 原有 Home 与文件、图库、收藏、最近访问功能不变，未把 NAS 的 DSM 登录伪装成 xDrive Server 登录。
- 首页数据只来自已有的经 DSM 会话、Owner-Source 验证的 `client.list()`：本机授权文件夹数及最多 8 项来源预览；失败或切换会话立即清空数据。已认证读取仅证明接口可读，并不证明上传、CAS 或同步任务已完成。
- 云端配额、NAS 物理磁盘一律显示“未检测”，不假造免费容量、空闲任务、设备数量。只向真实 NAS 备份页、有限任务页、诊断页提供快捷入口，文件、图库和管理能力仍未对 NAS 显示。
- `XDriveWorkspaceSidebar` 的可选 `compactPrimaryKeys` 使 DSM 窄屏以 主页 / 设备备份 / 任务 / 本地存储 为原生主导航；默认 Desktop/Web 选项、顺序与行为完全保持。新增 Node 导航测试和共享页面静态契约检查。
- 本轮仍然不声称已在真实 DSM 环境完成 ACL、上传、二次增量、套件停启、升级后的任务与凭证持久性；这些保持“按用户决定跳过（未验收）”，不阻塞其他安全的独立开发。


## Historical — 2026-10-26 · NAS 只读 CGI 请求取消与运行中单任务刷新

- DSM `list`、`inspect`、`history`、`diagnostics` 支持可选 `AbortSignal`，通过同源认证 Adapter 原样交给 `fetch`；不改变 POST、CSRF 或原始 Runner。
- Home、设备备份、任务、诊断视图在页面退出、Source 更换和刷新时主动中止旧 HTTP 请求，并保留 React active guard 以拒绝竞态回写。取消 HTTP 允许 CGI context 取消下游 Agent 的在途读取，减少资源浪费。
- 任务仅在用户选定的**一个** Source 真实处于 running 时，每 10 秒在页面可见状态下获取新快照；切走页面取消定时器及请求，隐藏标签不轮询，绝不并发预排 512 项。
- 新 Node fixture 校验实际 Adapter 的 GET signal 转发、AbortError、原始同源 URL、无额外请求和不泄漏 Agent Bearer；在 DSM UI 专项 CI 打包前运行。真实 DSM ACL、首次上传、第二次增量、停启、升级凭证/任务持久性仍 **按用户决定跳过（未验收）**。


## Historical — 2026-10-26 · Current-HEAD CI root causes and test migration

- Checked **actual failing GitHub job logs**: previous DSM CI failed because the source-level parity script still matched old pre-AbortSignal snippets; Web/Desktop builds failed TypeScript because the new optional `primaryKeys` destructuring shadowed a local `const primaryKeys = new Set(...)`. Renamed local Set to `promotedDestinationKeys` without changing Desktop/Web navigation behavior.
- Desktop tests that inspect implementation now read the **canonical shared** diagnostics, history, card and task components instead of deleted inline JSX. Mounted DeviceBackup first-read test mounts the actual shared device-card component, not a no-op string mock. Tests still cover authenticated owner/redacted data, stable pending UI, local owning-Agent schedule, global admin task capability, and canonical shared layout.
- DSM parity script now expects `AbortSignal`-aware `list` and `inspect` reads, retaining all session, Source, CSRF and no-bearer checks.
- Physical Synology ACL/upload/second-incremental/stop-upgrade credentials remain **按用户决定跳过（未验收）**, but source-exact CI and automated security tests remain mandatory.


## Historical — 2026-10-26 · DSM 账号设备 B-scope 只读访问（沿用现有 Agent Server 会话）

- `xdrive-agent --backup-only` **本来已经**允许 `device-backup-read` 及 Owner 设备概览/运行历史 IPC 端点。本轮在同一 `localbackupipc.Client` 中加上有 capability 检查的严格 GET 读取，CGI 增加固定 `device-backups` 和 `device-backup-runs` 两种只读操作。所有请求先验证真实 DSM session、私有 authority 文件、同一个私有 Agent IPC discovery；Server 仍独立根据 **Agent 已认证的 xDrive Server Owner** 检查数据权限。
- 这不等同于把 DSM 用户名映射为 Server Owner：已经通过 `xd backup synology-ui authorize` 授权的 DSM 用户，只能读取**被授权软件包 Agent 当前 Server 账号**的脱敏 B-scope 概览和历史。没有额外 Server Login、Cookie 转发、Root 路径、凭证、设备 token、其它用户数据或跨设备控制。
- CGI 限制固定 HTTPS 路由、Get-only、准确 Query key/SourceID/limit≤20/offset≤100000、Agent IPC 实际 capability、Owner-redacted DTO 和结构/SourceID 校验，返回的错误不带 Agent/Server 私密数据。非本机设备不可经由本地 `ReadSchedule` 授权任何更改。
- NAS 现在在 **相同导出的 `XDriveDeviceBackupPage`** 内可选择“本机备份”和“账号设备（只读）”；后者使用和 Desktop/Web 完全相同的 `XDriveDeviceBackupServerPage` 组件及原有红acted page/run runtime validators。账号设备只支持已实现的第一页与每个 Source 的有界运行历史；更多设备分页、完整 Files、Gallery/Viewer、全局任务和管理员页面仍不可用，不伪造完整性。
- 真实 DSM ACL/首次上传/第二次增量/套件启停/升级凭证与检查点持久性仍 **按用户决定跳过（未验收）**，不能把代码或 UI 专项测试当作实机通过。


## Historical — 2026-10-26 · B-scope Server Owner read security fixtures

- Added `TestRemoteOwnerBackupReadStillNeedsDSMAndServerAuthority` plus negative CGI/Agent tests: authenticated DSM session, canonical Source selector, no foreign account read, bounded query, duplicate/unknown field rejection, private upstream error redaction, no native write side effects, and old Agents fail closed.
- Added `TestRemoteBackupCapabilityAndBoundedReadOnlyIPC`: no loopback network call unless actual Agent advertises `device-backup-read`, no mutating IPC method, invalid history pagination rejected locally, only bounded GETs with protected Agent bearer.
- Added Node fixture exercising the **actual** DSM read-only client: fixed same-origin HTTPS `op`, no browser-visible private Authorization, no mutation ports, B-scope view uses real `list`/`runs` functions, unsafe Source IDs and ranges fail before fetch. Workflows run Go and JS tests before DSM package publication.


## Historical — 2026-10-26 · Owner 设备 Keyset 与单设备文件夹分页（无新组件）

- DSM 只读“账号设备”复用 Desktop/Web 的 `XDriveDeviceBackupPage` 现成“加载更多设备”和“加载并核对设备文件夹”交互；`listPage(100, cursor)` 及 `foldersPage(device, 100, afterSourceID)` 通过受 DSM 会话保护的**固定 CGI GET 端点**转到拥有真实 Server 会话的 Agent IPC。
- 后端使用 Agent 本来存在的 Owner 脱敏 `GET /v1/device-backups?limit&after_device_id` 与 `GET /v1/device-backups/folders?device_id&limit&after_source_id`；仅可访问 Server 当前认证账号的记录。不增加新的代理、数据库或跨设备写功能。
- UUID 必须规范小写，数字游标在 JavaScript 安全整数范围内，limit≤100，Query 不允许重复、未知字段；后端与前端均核验增量游标单调、分页大小、响应 Source ID。旧 Agent 缺能力时该项失败，不退化成猜测完整列表。
- 共享页面本来就采用旧数据保留、请求代数、重放/竞态检测和单设备按需读取，不对所有设备预加载文件夹；测试已增加恶意 cursor 与重复/错误 query 的负例。
- NAS 实机 ACL、首次上传、第二次增量、套件停启及升级凭证持久性仍按决定 **跳过（未验收）**；代码级授权/回归/CI 必须通过才合入。


## Historical — 2026-10-26 · 同一个云端存储页读取真实 Server 账号配额

- `xdrive-agent --backup-only` 现在显式宣告仅允许 `cloud-quota-read`，新增白名单 **GET /v1/cloud/quota**。保留严格拒绝 cloud root、全局 storage、缓存清理、上传、管理员 API 和 POST 写入；它调用原来 Agent 已认证的 Server `/api/v1/me/quota`，不把 DSM 用户自动提升为 xDrive Server 账号。
- 扩充现有 Go Client Quota DTO 的 `reserved_bytes` 和 `disk_total_bytes` 字段，与 Server 原始真实数据对齐；本机 IPC / DSM CGI 重检非负、IEEE754 可安全表示的容量数值，出现失效认证、缺少 Agent capability 或损坏数据就拒绝，**不会伪造 0 GiB、可用空间或 Unlimited**。
- DSM 固定 CGI 只增 `op=cloud-quota`，每次验证原 DSM Session 与私有 Agent 身份；浏览器同源 GET 严格验证白名单配额字段，绝不拿到 Server JWT、Agent Bearer 或 DSM Cookie 值。Go 与 Node 负例测试覆盖未授权、未知参数、负数/越界、错误数据和写操作拒绝。
- DSM 直接挂载现有 `XDriveCloudStoragePage`，`createXDriveSynologyCloudStorageDataSource` 使用同一个 `OwnerQuota`。文件分布、CAS 统计和实际 NAS 物理磁盘仍标记尚未提供；不允许清理或管理管理员全局存储。共享页面的 DSM-only `clearOnRefresh` 避免会话撤销后把旧 Owner 配额继续展示；异步请求在组件卸载与刷新时取消。
- Mobile Web/Desktop 原有云端存储数据源与交互默认完全不变。所有实机 DSM ACL、实际上传、第二次增量及持久化测试仍为 **按用户决定跳过（未验收）**，CI/鉴权测试不跳过。


## Historical — 2026-10-26 · 主页配额不再是固定占位数字

- NAS 共享主页继续采用原有 `XDriveHomePage` 入口，分别用带 `AbortSignal` 的 `client.list`（本机 Source）和 `client.ownerQuota`（Agent 当前 Server Owner）并行只读，两个授权范围不混淆；退出页面、切换来源或刷新都会丢弃并取消旧请求。
- 只有 Agent + Server 的真实配额读取成功，才展示账号已用容量与额度；Unlimited 必须由认证后的 `quota_bytes=0` 得出，而不是读取失败时编造。旧版 Agent 无 `cloud-quota-read`、Server 会话失效或者配额读取失败，显示“未检测”；本机已授权来源列表不因此隐藏。
- 快捷操作“云端存储”直接进入同一共享 `XDriveCloudStoragePage`；全局 NAS 磁盘、CAS 分布、服务器上传下载仍未获得数据授权。Desktop/Web 原有主页功能及布局默认不变。


## Historical — 2026-10-26 · NAS 云端文件只读浏览复用统一 FileExplorer

- Backup-only Agent 只额外允许 `cloud-files-read` 对应的 `GET /v1/cloud/root` 与 `GET /v1/cloud/children`，其余 Preview/Download/Upload/Delete、Server Admin 以及 Agent 全能力仍禁止；DSM CGI 只有固定 `op=cloud-root/cloud-children`，不存在泛用 URL Proxy。
- Server Owner 身份仍来自同一个已认证 Agent 会话，非 DSM 登录映射。Node 严格投影 ID、ParentID、文件名、类型、大小、版本、时间；所有 ID/大小可安全传递 JavaScript，目录 SourceID、排序和 NextCursor 保持授权一致，拒绝重复、错误 Owner 或越界分页。
- NAS `XDriveSynologyOwnerFilesPage` 是位于 `ui/shared/mui` 的**数据适配层**，界面实际直接渲染与 Desktop/Web 一样的 `XDriveFileExplorer`。只支持真实目录导航、面包屑、Server name/updated/type/size 排序、200 条/页逐页加载、原组件虚拟化；尚无真实文件字节读取时预览/下载/上传/删除操作都不可用。
- 切换目录或排序、刷新、离开页面时取消在途 CGI，清空过期 Owner 数据，过期请求不回写；失败不会伪装成空目录。权限与完整 DSM 实机测试保持项目既定规则。
