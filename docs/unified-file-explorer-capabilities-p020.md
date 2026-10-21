# SH-P020 · Unified FileExplorer capability contract and 100k regression

## Product decision

An account read-only folder and a public shared folder should eventually use **one FileExplorer browsing core** (virtualization, Grid/Details, thumbnails, Viewer, filtering, sorting, properties, downloads) with **two separately authorized data adapters**:

- Account: the existing Owner/JWT/ACL APIs, access limited to the account's individually authorized files and parents.
- Public Share: the existing Share capability/password/revision/expiry/revoke/root APIs, access confined to the share root. A bearer capability token must **never** be used with Owner FileExplorer/Agent APIs.

Read-only **allows original download and authorized folder ZIP by default**. A future preview-only mode can independently disable downloading; it **must first have matching server-side authorization**. Client affordance flags by themselves are not a security boundary.

The canonical capability set is `list / preview / download / downloadZip / search / write / delete`. Download ZIP depends on download; delete depends on write; Share UI always declines write/delete even if forged flags are passed. Additional mutations such as upload, rename, move or create are represented by `write` for this initial upper bound and remain enforced by separate Owner server APIs. A future fine-grained write model can split those operations without creating another Explorer.

## Delivered by this bounded slice

1. New neutral `ui/shared/src/file-explorer-capabilities.ts` contains the shared runtime capability resolver, typed data adapter contract and default public read-only grant. It imports no Auth, JWT, API or Agent code.
2. The existing Owner and public Share FileExplorer surfaces both consume this resolver for relevant action gating. The existing 100-row Share keyset API, click/preview/native download, thumbnail cancellation and durable ZIP behavior remain unchanged. The current page filter remains explicitly `筛选当前页`, not an unimplemented server-wide search grant.
3. Optional public `canBrowse / canPreview / canDownloadZip` UI upper bounds allow a future preview-only grant without coupling every behavior to `canDownload`. Existing callers remain backward-compatible. Share recipient eligibility remains a stable capability grant while native file handoff sets an independent `downloadPending` busy flag: duplicate downloads are disabled, **but bounded directory navigation, preview, already-visible thumbnails and user-owned download continue**.
4. Dedicated unit contracts verify absent grants fail closed; true read-only with default download; preview-only with no download; public source never gains mutations; no cross-owner import; existing React public-share form loader resolves the new pure file. A real React state/effect regression verifies next-page Share HTTP navigation during a deliberately pending original download without a duplicate signed handoff.
5. The same frozen 100k workload tests check the actual new source on a real PostgreSQL17/Gin/LocalCAS dataset. Owner Desktop, Wide Web and Mobile Web each use the existing P038/P050/P049 original 100k logical PhotoAssets + 115k SHA-distinct physical JPEG/H264/Live still/motion assets, Grid/Details × 5 actual scroll positions, 3 independent populations. Public Share runs the original six Chromium 1440px/CDP390 100k physical JPEG sessions with real native original downloads and SHA verification.

## Existing performance BEFORE (not an optimization A/B)

Historical accepted P067 exact final evidence-head, across **different historical runner/source**:

| Platform | Grid P50 | Details P50 |
| --- | ---: | ---: |
| Native Desktop | 740.436 ms | 598.782 ms |
| Wide Web 1440px | 608.684 ms | 426.829 ms |
| Mobile Web CDP390 | 363.616 ms | 361.058 ms |

Original Web 4 GiB incompressible LocalCAS upload/download P50 **48.509 / 18.417 s**, Desktop Go Agent **55.087 / 21.969 s**. The P020 capability slice does **not** modify upload/download/CAS/Go or durable file tasks; previously accepted 4 GiB native baselines remain independent and cannot be credited as new P020 after measurements.

New P020 actual Web/Desktop/Public Share 100k results = **not measured until source-exact CI finishes**. If all original frozen budgets pass, keep the existing production hot paths and report `BEFORE=CURRENT, AFTER=N/A, speedup=N/A`. If any genuine performance regression occurs, diagnose first and only retain a minimal fix after same-source/runner matched n≥3 data demonstrate material improvement without CPU/RSS/bytes/auth regression. Invalid harness and race failures are not performance samples.

## Later slices (not claimed completed here)

- Actually make the Account and Public Share data adapters power a single virtual collection/Explorer shell rather than just the same capability contract and common item surfaces; preserve strict independent backend authorization.
- Share-scoped bounded **server** search and sorting for all authorized descendants (not local 100-item filtering); separate Go authorization tests and real physical 100k first.
- Preview-only Share links need genuine backend ability and ticket revocation policy, not merely a hidden download button.
- More JPEG/H264/Live Photo original and decoded-visible workloads; true live-motion playback and installed iOS/Android/PWA/WAN remain separately unmeasured.
- Request-scoped `AbortSignal → Go Request.Context.Done` cancels only obsolete viewport media/navigation requests. User-owned durable ZIP/transfer/sync/delete requires its own explicit user Cancel and must continue across view changes.

This slice does not edit Race code or production-only security acceptance. Inaccessible production-specific acceptance is **按用户决定跳过（未验收）**; code-level permission, revocation and CI negative checks remain mandatory.

Related issue: [#2205](https://github.com/lazyxu/xdrive/issues/2205). Related merged shared item surfaces: [#2281](https://github.com/lazyxu/xdrive/pull/2281). Related current Share cancellation performance: [#2275](https://github.com/lazyxu/xdrive/pull/2275).

## Follow-up source integration (stacked until SH-P018 is merged)

SH-P020 is based on the exact validated SH-P018 cancellation commit and preserves its synchronous thumbnail abort when changing Share parent or cursor. Native download activity remains an independent busy state and never aborts a user-owned file/ZIP transfer. The historical static public-share download assertion now checks the new `canStartDownload` guard, not its obsolete raw `canDownload` boolean, while retaining real React handoff/navigation tests. The merged branch must be rebased/retargeted to full current master and pass fresh 100k physical Owner/Share specialty CI and the full Final Gate before release. This stack does not claim completed shared DataAdapter wiring or backend preview-only authorization.

## Next incremental wiring — genuine Share data adapter

SH-P020 additionally implements and **actually calls** a source-specific `XDriveFileExplorerDataAdapter<PublicShareChild, number>` for the initial and subsequent public folder pages. It retains the existing Share-only HTTP endpoint, token/password closure, root 0, numeric cursor validation, direct AbortSignal propagation, 100-row server/page bound, viewer purpose-separated preview, and live native original/ZIP UX; no fake Owner API, JWT or Owner Agent delegation. Immediate P018 thumbnail cancellation occurs **before** the adapter's next-page network wait. The adapter shares the neutral contract with future Owner wiring, but the full common virtual browsing shell and Share full-tree search/sort remain separate unimplemented stages. The only runtime change is the list invocation wrapper; no production SQL/Go/CAS/codec modification or matched speedup claim. Source-exact real 100k Chromium and full CI on final merged master are still mandatory.


## Incremental Owner adapter integration — real Web Columns

Web Account **Columns** now actually uses an `XDriveFileExplorerDataAdapter<Node, number>` whose implementation forwards the exact cursor, bounded 200-item page and `AbortSignal` to the pre-existing **JWT/ACL-backed** `XDriveApi.listPageAbortable`. The existing Share adapter independently calls only `publicShareChildren` under its capability/password/root, also with `AbortSignal`. Both expose the neutral `list` result without crossing authentication contexts or creating a third Explorer. No virtual list algorithm, Go SQL/CAS, or transfer hot path changed. The Owner read adapter advertises **only** the list capability it can establish here; it is not a fabricated full-account mutation grant and does not replace server checks.

This is **not yet full shell convergence**: Owner Grid/Details still consume their existing sparse virtual Range, while Share remains bounded keyset pages; Desktop Columns' older IPC cancellation path has not been represented as an abortable data adapter and needs its own genuine 100k baseline. Full shared Viewer/search/sort and Go-enforced preview-only Share permissions remain later slices. These are functional adapter changes: no same-runner performance A/B speedup is claimed until genuine source-exact 100k workloads pass after the parent merges.

## Bounded source-exact 100k specialties while dependent PR is Draft

The four pre-existing 100k/115k real physical Owner Desktop/Web/Mobile and public Share JPEG workflows now accept pull requests to either their SH-P018 dependency or master, but continue to require the exact SH-P020 head branch before invoking real workloads. No data sizes, decode requirements, CRC/SHA, time or resource limits change. This permits the actual Account/Share adapter source to be measured on the stacked PR. Full standard CI/Final Gate and retargeting to master still follow the parent merge; never reuse checks from a different HEAD.
