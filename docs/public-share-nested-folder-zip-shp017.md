## SH-P017 · first genuine selected-nested 100k physical ZIP n3 SUCCESS (measured source 41d998cd · 2026-10-21)

- **Dedicated source-accurate [SH-P017 #39538925407](https://github.com/lazyxu/xdrive/actions/runs/39538925407) completed SUCCESS**, with original PostgreSQL17 authorization/selected-root/foreign-owner/active-task test and three independently seeded genuine 100000 SHA-distinct independently decodable JPEG originals plus one outside sentinel per corpus. Selected subfolder under a separately shared root; 100001 ZIP entries, 100000/100000 true CRC reads, 4 exact original SHA sample checks per fixture and preserved CAS physical inventory. Original machine rows and source SHA stored permanently at [SH-P017 JSON](performance-evidence/public-share-nested-folder-zip-shp017/ci-run-39538925407.json).
- **Original sample-1/2/3**: prepare **2300.361 / 2364.557 / 2246.150ms** (P50 **2300.361ms**); actual signed HTTP ZIP stream **3825.642 / 3813.559 / 3749.755ms** (P50 **3813.559ms**); cancelled genuine Go Request.Context.Done/Handler exit **0.163 / 0.193 / 0.198ms** (max **0.198ms**, all true); Go RSS post-seed growth **426901504 / 412692480 / 424022016B** (max **426901504B**, 407.12MiB); original physical blocks **409604096B each**; Go CPU ticks **1049/1047/1025**. Seed time **68383.748 / 64304.349 / 64523.592ms** excluded from ZIP business timing; all samples meet unchanged <=120s prepare P50, <=300s per prepare/stream, <=1s cancellation, <=512MiB RSS, full CRC/SHA/scope budgets.
- **Decision: retain original bounded durable ZIP infrastructure unchanged; this is a newly enabled nested selection, not performance hot-path optimization.** Nested BEFORE = unsupported, no numerical 0ms baseline. Successful new-feature CURRENT physical n3 means **no same-runner BEFORE/AFTER and speedup N/A**. Historical root-share ZIP from a different source/runner prepared P50 2127.069ms / streamed 3641.683ms and does NOT prove improvement or regression.
- This **measurement SHA is prior to archiving**; the evidence-amended one-work branch HEAD changes. **DRAFT / NOT MERGED** pending NEW exact archive-HEAD 3×100k physical ZIP and complete 77+ Go Linux/Windows/API/Postgres, Web/Desktop/artifacts/final-gate plus clean GitHub mergeability. Independent native phone/PWA, WAN and 4GiB public ZIP remain NOT MEASURED. First gofmt RED 07ff9c4 remains recorded separately below; do not erase or reinterpret it. Production-only inaccessible safety acceptance **按用户决定跳过（未验收）**, source-level scope/revocation mandatory.

## 2026-10-21 · first exact-head CI failure (format-only, retained)

Original one-work `07ff9c4f3c31606f8e3b3ee444f4ec06051e6e2e` [full CI #39538040175](https://github.com/lazyxu/xdrive/actions/runs/39538040175) `go-linux` and [SH-P017 dedicated #39538042146](https://github.com/lazyxu/xdrive/actions/runs/39538042146) `nested-share-postgres` **RED at source gofmt before PostgreSQL integration executed**. The exact two unapplied format diffs were alignment of `sample` in the 100k result map and alignment of the `outside.ID` inline comment in `public_share_archive_integration_test.go`; no production Go/authorization/ZIP behavior or thresholds were changed. The physical specialty and remaining full CI jobs on that old SHA cannot certify any amended SHA even if they finish. Keep this original RED, rerun exact rebuilt one-work HEAD PostgreSQL, physical n3 and full 77+ CI before Ready/Merge; **valid nested 100k n=0 until a real completed genuine sample**.

# SH-P017 — Shared subfolder ZIP in the read-only FileExplorer

**Status:** Draft implementation / accurate-source Go/PostgreSQL and genuine 100k physical CI pending. **No production merge, AFTER valid n=0.** Existing root Share ZIP #2158, public FileExplorer #2148, file/folder context share #2117 and cached thumbnails #2258 are merged; never repeat these implementations. Related issue: [#2205](https://github.com/lazyxu/xdrive/issues/2205).

## User-facing contract

The recipient opens an independently authorized /share/:token page, browses a folder inside the shared root, then right-clicks a directory and chooses **下载该文件夹 ZIP**. This action downloads the selected folder *including its descendants and empty directories*, not the entire shared root. The existing top-level **下载整个文件夹 ZIP** still downloads the entire originally shared root. Both use the same established durable queued/prepare/status/explicit cancel and native streaming, one DownloadCount per signed ZIP ticket; a tab close aborts only HTTP status polling and **never cancels** durable user-owned ZIP work. The context menu remains read-only: no Move/Delete/Rename/Paste/Upload/DragDrop.

## Security and implementation boundaries

- New optional `folder_id` is accepted **only by** the existing anonymous `POST /api/v1/public/share/archive/prepare` Share capability route. The default omitted/0 means original shared root for existing public links.
- `publicShareArchiveSelectedFolder` uses the existing owner-scoped PostgreSQL bounded 128-ancestor walk to verify the selected ID is a *live directory* under the exact share root. Private account Owner ZIP APIs and JWT are never called. Cross-owner IDs, outside siblings, files, deleted and moved-out folders must fail without name/content disclosures.
- Durable run `requested_ids_json=[selected_directory_id]` is fixed at preparation while `public_root_revision` continues to bind the original share root. Reuse is per selected subtree; another different live preparation for the same Share is rate-limited and cannot launch a fleet of anonymous ZIP workers. The existing 3-start/10min admission, 200000-entry cap, 100GiB uncompressed bound and 5-minute signed ZIP ticket remain.
- On public `status`/`cancel`/`ticket` and second-Server signed `stream`, re-validate the *same* share ID, share-root revision, live selected descendant folder, current Owner, expiry/revocation and run scope. Ticket and stream separately compare the complete selected-directory manifest paths, Node revisions, parents, storage keys, sizes and current subtree membership. A moved-out selected folder after ticket issue must yield HTTP 409, not leak its bytes.
- No new account permissions, public write actions, Owner FileExplorer mount, offline zip cache or source/media generation. ZIP archive requested only explicitly; page navigation/scrolling cannot start ZIP automatically.
- Production-only inaccessible security verification: **按用户决定跳过（未验收）**. Go-level authorization, revocation, PostgreSQL negative tests and CI are mandatory.

## Performance baseline / acceptance

**BEFORE**: independently downloadable *nested* folder ZIP from a parent folder Share **not implemented**; thus there is no successful old nested latency and **no valid BEFORE/A-B speedup**. Already merged **root ZIP** is a different selection, and its authentic 3×100k independent SHA-distinct physical JPEG/Pg17/LocalCAS test [#39255424998](https://github.com/lazyxu/xdrive/actions/runs/39255424998) measured root ZIP prepare P50 **2127.069ms**, stream P50 **3641.683ms**, peak Go RSS growth **463306752B**, three abandoned signed GETs each reached true Go `Request.Context().Done`, worst handler exit **0.208ms**. Not a matched A/B nested comparison.

**AFTER/current SH-P017**: **Not measured; genuine 100k n=0** until the exact-head [SH-P017 dedicated workflow](../.github/workflows/sh-p017-public-nested-zip-physical-100k.yml) produces three full independent samples. Reuse the unchanged original 100k SHA-distinct, separately decodable physical JPEG generator, real Pg17/Gin/CAS and 100001 actual ZIP paths under a subfolder of a distinct shared root, verify 100000 CRCs, four SHA checks, 100k original physical CAS unchanged, signed real HTTP streaming, cancelled Go handler, CPU/RSS and bytes. Baselines and budgets must be locked **before** first measured run:

| Metric | Immutable validation budget |
| --- | --- |
| Physical source per trial | 100000 different SHA, +1 unshared original sentinel |
| n | 3 independent PG/CAS corpora (sample-1..3) |
| Full ZIP prepare P50 | <= 120000ms; each <= 300000ms |
| Signed HTTP ZIP stream | each <= 300000ms |
| Signed stream explicit Request.Context cancel | <= 1000ms, genuine Handler exit, no durable prepare cancellation |
| Go RSS postseed growth | <= 512MiB |
| ZIP exact integrity | 100001 entries / 100000 CRC reads / 4 original SHA comparisons each |
| Scope | Never a sibling/foreign Owner path; ZIP filename = selected folder name |

Web Share UI mounted React integration and true Pg17 positive/negative tests are separate from 100k physical throughput evidence. 1440px/390px Browser Share file/UI metadata evidence from SH-P016 remains valid for its *different* workload; no numeric inference for this new nested-ZIP action. Real installed iOS/Android PWA, physical desktop OS, WAN, 4GiB compressed download, Live Motion not measured.

**Decision policy (AGENTS.md):** if the new original selected-ZIP workload passes these existing ZIP correctness/resource budgets, keep the implementation; do not speculate about a hot-path optimization. For any measured regression, first capture original exact-head samples, freeze the threshold, perform a genuine SAME-runner/source/physical-data n≥3 BEFORE/AFTER candidate, retain it only on material repeatable improvement without I/O/RSS/cancel/security regression. Do not treat missing capability as 0ms old time. Archive all invalid RED and genuine measured raw JSON with source SHA in the central registry + this document; source-exact CI must be rerun after evidence is amended.

## CI gates before Ready/Merge

1. New `TestPublicShareFolderZIPLifecycleAndSecurity` verifies root unchanged, nested ZIP includes only selected 2 paths, foreign/root/sibling/file denial, one download count, cross-share run separation, duplicate selected idempotence, one active preparation and moved-out signed ticket denial.
2. Mounted `web-public-share-form.cjs` proves a directory's read-only context menu passes its ID to the Share ZIP API, while the root toolbar still requests folderID=0 and no private mutation appears.
3. New `sh-p017-public-nested-zip-physical-100k.yml` performs source gofmt, real PostgreSQL test and 3 full SHA-distinct physical 100k nested ZIP workloads, with raw log artifact and predeclared checks.
4. Complete same-head 77+ CI Go Linux/Windows, PG API, Web/Desktop, artifact, single-commit and Final Gate plus fresh GitHub clean state. PR remains Draft until source-exact outputs are archived and all gates pass. No Race work.
