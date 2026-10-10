# Admin service dependencies and secure Baidu AK configuration

## Scope and status

**Status:** Shared Web/Desktop **服务与依赖** page exposes 11 instance-wide dependency health contracts and real administrator controls for encrypted Baidu Server AK, GeoNames radius/reload/history/rollback, and Photo Intelligence automatic scheduling. Other dependencies remain deployment-owned or planned. It is **not** a Docker controller, Compose editor, arbitrary host-path editor, or general-purpose credentials service.

### Contract

- HTTP: `GET /api/v1/admin/services`, guarded by the existing authenticated `requireAdmin()` group.
- Response: `{ checked_at, services: [{ id, group, label, status, detail, version?, model? }] }`.
- States are intentionally distinct: `ready` means a real probe succeeded; `unavailable` means configured/expected but the probe failed; `disabled` means no analyzer/resolver is configured; `unknown` means a store implementation lacks a readiness probe; `planned` means integration or probing is not implemented.
- PostgreSQL checks `PingContext` with bounded deadline. Storage reuses `Store.Ready(ctx)` when implemented. Face, visual/OCR, and semantic analyzers call existing local `Info(ctx)` contracts, without exposing sockets, secrets, or raw errors. GeoNames reports the actually loaded resolver and version.
- Video Media Worker remains `planned`. Baidu Server Static Map v2 is the **only supported map provider**: `disabled` without AK/opt-in; `unknown` (configured but not actively probed) when enabled; maps stay unavailable rather than rendering an alternate map. GeoNames label resolution is independent.
- Probes run on explicit page load/refresh, are bounded by a shared two-second context, and have no side effects. The page does not poll when hidden.
- Backend permission, not sidebar visibility, is the authority. Desktop forwards the existing session via Agent IPC; it does not send user credentials into the Renderer.

### Deployment/source of truth

- **Existing:** `server`, `worker`, `postgres`, `caddy`, optional `photo-face` profile. Analyzer sockets, model images, CPU/memory limits and unrelated secrets remain Compose/host config. The Baidu AK is the **only** credential editable here, saved encrypted in PostgreSQL and immediately applied without restart.
- **GeoNames:** Existing `XD_PHOTO_PLACE_GEONAMES_DIR` points at the *container-visible* folder; the dedicated read-only host mount is tracked separately in PR #1189.
- **Media:** separate optional FFmpeg Media Worker to be implemented and measured; no video hover is enabled by this page.
- **Maps:** Gallery Places uses **Baidu Server Static Map API exclusively**; no offline SVG basemap, self-hosted/alternate tiles, or fallback map. If disabled/unavailable, show a visible unavailability state. GeoNames remains an independent optional offline place-*label* resolver, never a map provider. See `docs/baidu-map-server-api.md`.
- Runtime control and editable settings require distinct permission, persistent configuration, compatibility, and Host Manager safety contracts. Do not mount Docker socket into Server.

### Acceptance gates

1. A standard (no-profile) deployment still serves file operations, uploads, sync and Gallery unchanged.
2. Unauthenticated and nonadmin API calls are rejected; admin sees only safe fixed status fields.
3. A missing/unreachable analyzer is distinguishable from a disabled one; a missing or failed Baidu map shows an explicit unavailable state and never renders an alternate map. The planned worker never displays a false green status.
4. Web hash route, sidebar, desktop navigation and IPC path open the *shared* MUI page; account switch/unmount drops stale results.
5. Old Agent/Server returns an explicit unsupported/error message and does not silently show fictitious health.
6. Go unit tests, Web lint/typecheck, Desktop main/renderer typecheck, and scoped CI pass before merge.

## Configuration and activation contract (phase P1-A)

**Strict scope:** This administrator page lists only instance-wide runtime infrastructure and global service providers. Yike, Synology Photos, DSM FileStation, user credentials, per-user source schedules and all **同步文件夹** belong exclusively to each user's existing Sync Folder settings/API; the admin dependency inventory, editor and navigation must not surface them. The shared masked credential/reveal UI does **not** merge secret stores or permission domains.

This page must **not** treat a service's configuration form, process presence and actual health as the same state. Every entry reports its **configuration scope**, **activation mode**, **runtime probe result**, and exact prerequisite. Missing probes are labeled unknown; future containers are planned, never reported ready.

| Dependency | Configuration owner / controls today | Activation contract |
| --- | --- | --- |
| Baidu Server API | Admin service page; encrypted AK enable/edit/reveal/clear | Immediate, next authenticated map request, no restart |
| GeoNames place labels | Read-only `/geonames` dataset mount with deployment path; administrator-persisted matching distance | Admin can edit distance and atomically hot-apply this instance, or validate/reload dataset without restart; path stays deployment-owned, replica status remains independent |
| Face, animal/object, OCR and semantic image analysis | Optional shared `photo-intelligence` Compose container, Unix socket, pinned models | Controlled deployment for profile/socket/model changes; never represent a UI toggle as a container start |
| Creative analyzer (cutout/erase/movie/collage) | Same optional Photo Intelligence runtime | Controlled deployment; independent model/info probe |
| Media Worker / FFmpeg | Not yet integrated | Planned; **no enable button** or fabricated status |
| PostgreSQL and file storage | Deployment volumes/database connection and backup policy | Restricted maintenance / controlled restart, not changed by web admin Server self-operation |
| Caddy/HTTPS and background Worker | Deployment parameters/Host Manager when explicitly supported | Controlled redeploy/restart; do not mount or expose Docker socket |

**Delivered in this phase:** a typed, read-only capability/application contract for **11 system-level dependency rows** with safe Web/Desktop UI labels. No per-user connector rows or navigation appear here. This is **not** a claim that all services can already be started, restarted or hot-reconfigured from the administrator page.

### P1-C1: Photo Intelligence automatic task policy (merged #1253)

The administrator can save a **single instance-wide automatic-analysis scheduling switch** with optimistic revision checking and a metadata-only audit in the same transaction. The default is enabled for backward compatibility. On successful save, the current Server atomically uses the new setting for future automatic face detection/embedding, smart visual/OCR classification, semantic embeddings and person clustering. New system-event and reconciliation admissions are blocked while paused; automatic tasks queued before the change check policy again before processing. In-flight work is not interrupted. Explicit user/admin reanalysis remains available, as does independent GeoNames place-label reconciliation. This does **not** manage the Photo Intelligence container, installed models, sockets or CPU limits.

`GET/PUT /api/v1/admin/services/photo-intelligence` are administrator-only, no-store and never carry user connector credentials. The GET contract reports desired/effective enabled values, revision and effective revision, source, `applied/pending` **for the current Server only**, and no-restart mode. After startup, other Server replicas refresh the persisted policy at the existing 30-second reconcile interval; the page must not claim fleet-wide apply. Startup read failure fails closed for automatic analysis, preserving manual work; a later successful refresh re-enables the saved policy. Saving is a task-boundary control, not an interruption or cancel command.

**Acceptance evidence to check before merge:** Go policy unit/integration tests (including explicit false, revision 409, admin-only, audit, pending replica), Web/Desktop typechecks and the PR CI gate. This remains a phase-specific runtime policy rather than general worker configuration or safe Host Manager orchestration.

### P1-C2: per-kind automatic-analysis admission controls (merged #1275)

Extend the existing audited, revision-fenced instance-wide scheduling policy with **four task groups**: face detection/embedding, smart visual/animal/object **and OCR together** (the current scheduler has one combined task kind), semantic embeddings, and person clustering. The global master switch continues to override every group. A disabled group blocks newly admitted event/reconcile/scheduled tasks and queued automatic tasks before work begins, but does not interrupt running jobs. Manual user/admin reanalysis and independent GeoNames label resolution are never disabled.

The same administrator `GET/PUT /api/v1/admin/services/photo-intelligence` contract returns `kinds` and `effective_kinds` in addition to the existing global desired/effective values and revision, always **for the current Server only**. A PUT includes the complete four-boolean `kinds` object, validates all keys and rejects null/partial/unknown values before persistence. Legacy clients omitting `kinds` preserve the existing per-kind policy. Missing/legacy persisted kinds mean all four enabled; malformed persisted settings fail closed at startup. The `xd_admin_photo_auto_settings` row gains a migration-safe text column; global and per-kind policies share one CAS revision and one transactional metadata-only audit, then hot-apply atomically on this instance; replicas refresh during the existing 30-second reconciliation.

Web and Desktop reuse the same shared MUI switches and authenticated REST/Agent IPC transport. An old Server without `kinds` must not display fabricated per-kind controls; the existing global editor remains functional. This is a **task admission** control, not independent model start/stop, AI inference model setting, or CPU/RAM deployment editor. No per-user Yike, Synology or Sync Folder data is included. Acceptance: strict input and migration/default tests, persisted+replica pending/applied, runtime checks for all four task triggers, manual-place unaffected, stale 409 and audit rollback, Web/Desktop contracts and authoritative PR CI.

### P1-C3-R1: audited Photo Intelligence policy history and rollback backend (implementation PR)

Backend-only control plane: append immutable global+four-kind policy revisions to `xd_admin_photo_auto_revisions` inside the existing administrator save-and-audit transaction. First post-upgrade policy edit snapshots the previously effective persisted policy; a brand-new default policy creates revision 0. GET `/api/v1/admin/services/photo-intelligence/revisions` returns up to 40 recent revision values, their sources and timestamps; POST `/api/v1/admin/services/photo-intelligence/rollback` requires the current optimistic revision and a recorded older target. The rollback validates the full stored policy, writes a **new revision** and metadata-only audit atomically, and only then hot-applies the selected policy to this Server. Stale edits return 409, missing revisions 404, corrupt history 422 and unavailable storage/audit 503. Other Servers independently reconcile at their existing 30-second interval; no claim of cluster-wide activation.

This restores only automatic **task admission policy**, not analyzer models, container images/sockets, model/CPU/RAM limits, running tasks or user connections. Web/Desktop revision selector, confirmation and transport are the separate P1-C3-R2 followup; this backend phase is not advertised as a completed user-facing rollback control until that UI is delivered and validated. Existing global/per-kind editors continue working unchanged.

### P1-B1: GeoNames actual validate-and-apply (merged #1225)

The administrator-only `GET /api/v1/admin/services/geonames` reports the loaded dataset version, configuration source, search radius, and whether this Server supports reload. `POST /api/v1/admin/services/geonames/reload` accepts **only** the expected active resolver version, not an arbitrary directory path. It serializes reload attempts, re-reads and validates all three files from the existing deployment-mounted directory, writes a metadata-only audit before publication, then atomically publishes an immutable snapshot. Invalid or partial files retain the old snapshot; a stale active version returns HTTP 409. The PlaceRunner pins a resolver snapshot for candidate queries, resolution, and stored label version throughout each batch. Current Web/Desktop share the same MUI button and Server-backed Agent bridge. Existing durable upload, download and sync tasks are unrelated.

**B1 historical scope (merged after CI run #38009959801):** This delivers real reload of the existing deployment-provided data, not an in-app directory editor or remote GeoNames download. The radius editor and persisted desired/effective distinction arrive in P1-B2a. Automatic multi-replica coordination, upload/staging and rollback UI remain outstanding; production-dataset memory/latency evidence has not been recorded as completed.

### P1-B2a: persisted matching radius and per-instance hot apply (merged #1236)

The administrator may update the GeoNames matching radius in `(0, 500]` km with a mandatory optimistic revision and an explicit applied-versus-pending indication. The Server rebuilds the full candidate from the existing trusted read-only mount **before** updating `xd_admin_geonames_settings`. Saving and a metadata-only audit are one transaction; only after commit is the new immutable resolver published in the current Server. Failed validation, stale revision (409), or failed audit leaves the previous effective resolver intact. Startup reads the persisted override before loading the resolver. An administrator may use the existing manual reload action on a replica to pick up a pending saved radius. This is **not** an arbitrary dataset-path editor, automatic cluster broadcast, or global all-replicas success guarantee. User-level Sync Folder credentials remain excluded.

### P1-B2b-R1/R2: revision journal and auditable rollback, shared UI (merged #1252 / #1260)

The administrator can review an immutable history of the last 40 GeoNames matching-distance revisions and roll back to an older value. The first setting edit stores the old deployment default as revision 0. Every rollback creates a new revision, not a history rewrite. Complete dataset verification precedes database changes; settings, immutable history and a metadata-only audit commit atomically before this Server swaps the resolver. Stale revisions return 409, missing targets 404 and invalid datasets 422. Other replicas may remain pending. This is a radius rollback, **not** automatic dataset-file or multi-replica rollback.

**After merged P1-B2b:** historical radius rollback is delivered through the shared administrator UI. Managed dataset upload/staging, application acknowledgments across every Server instance, and restoring an earlier mounted dataset remain unimplemented. A past *radius* revision is not an earlier on-disk dataset.

### P1-B2c: automatic GeoNames radius reconciliation on each Server instance (merged #1267)

A configured Server instance checks the administrator-persisted radius every 30 seconds. An unchanged radius does not trigger another full index build. For a pending radius, it takes the existing reload mutex, loads and validates the complete immutable candidate from its trusted read-only deployment mount, re-reads the desired revision to reject stale candidates, and only then atomically publishes it. Missing/invalid files, database read errors and interrupted validation leave the previous index intact. In-flight PlaceRunner batches keep their previously pinned snapshot. Foreground configuration/reload/rollback commands take priority; a busy instance retries on the next interval.

The existing admin save/rollback transaction is the durable audited source of truth; passive replicas only apply the committed desired state and report their **own** effective radius. Every replica can remain `pending` after validation failure, so this is **best-effort eventual apply**, **not** a cluster-wide success acknowledgment or automatic dataset-file replacement. The UI reports the 30-second retry cadence without claiming a completion deadline. Changes to mounts, secrets, worker processes and user Sync Folder configuration remain out of scope. Acceptance: PostgreSQL integration for pending → applied and invalid mount → last-good retention → repaired retry, Go API and shared Web/Desktop CI.

**Next real control-plane stages:**
1. Follow up merged GeoNames per-replica radius reconciliation with separately proven managed dataset staging/upload, versioned apply acknowledgments across replicas and mounted-dataset rollback. Keep the existing batch snapshot-pinning contract.
2. Complete per-kind Photo Intelligence automatic task admission controls, then separately build safe analyzer lifecycle and resource controls. Container installation/profile/CPU/memory remain deployment-owned.
3. Implement optional FFmpeg Media Worker with signed byte access, cancellation and resource isolation before introducing its configuration endpoint.
4. Reuse the restricted Host Manager for deployment-only changes after implementing permissioned status/backup/diff/rollback and exact runtime-health checks. Never grant Server general Docker socket permissions.

### Final instance-level configuration lifecycle target (not yet implemented)

Every system-wide dependency in this inventory must ultimately support a truthful administrator-only **inspect → edit → validate → save desired revision → apply → verify effective revision/health → rollback on failure** workflow. This is a delivery requirement, not a claim about the current read-only entries. Versioned desired and effective settings, apply status (`pending`, `applying`, `applied`, `failed`, `rolled_back`), audit identifiers, actor, and restart requirements must be visible without exposing secrets. Stale revision writes return 409 and unauthorized writes/reveals are denied at the Server, regardless of UI visibility.

- **Hot apply where safe:** Baidu AK already does so; GeoNames requires validating a whole candidate dataset and swapping an immutable resolver snapshot while an in-flight PlaceRunner retains a consistent version; AI/Media Worker hot policy changes must preserve in-flight work.
- **Restricted apply where required:** database, storage mount, Caddy and container image/profile changes require a least-privilege Host Manager, explicit diff/preflight/impact confirmation, health probes, backup or rollback, and progress states; the application Server never gains a general Docker socket or host shell.
- **No false success:** a persisted form is only `pending` until the effective runtime is proven. Disable apply if the required safe controller is not implemented. User-level **同步文件夹** connections are outside this inventory and do not share its admin configuration APIs.

## Follow-on sequence

1. Finish server-side Media Worker signed preview input and output verification, worker cancellation and short-video cache; **measure production baseline first** per `AGENTS.md`.
2. Add actual FFmpeg worker health and queue/capacity to the status endpoint when the runtime is shipped.
3. Baidu Maps Server API is documented in `docs/baidu-map-server-api.md`. It serves a bounded static PNG from a fixed upstream host. No offline fallback or other provider is allowed; any later interactive functionality requires a separate Baidu API/licensing/coordinate review.
4. Baidu AK can be updated, disabled or cleared using the scoped admin-only endpoint with authenticated encryption, audit and optimistic revision checking. Other deployment-controlled service settings remain read-only until separately designed. Secret values must never be returned in status JSON.

### Baidu Server AK precedence and hot reload

- Initial/fallback deployment settings: `XD_BAIDU_MAP_ENABLED`, `XD_BAIDU_MAP_AK` (no admin override row).
- When saved from the administrator page, encrypted `xd_admin_service_secrets` record **overrides environment settings**; even disabling/clearing the key must not activate an old environment AK.
- Uses the existing versioned `XD_CONNECTOR_SECRET_KEYS` AES-GCM keyring. If absent, the UI explains that an encryption key must first be configured through deployment; no plaintext persistence is permitted.
- GET status reports `editable`, `configured`, `revision`, `source` and `requires_restart=false`, never AK. PUT updates are admin-only and audited without secrets. A stale revision returns HTTP 409.
- The shared `XDriveStoredCredentialField` (also used by Yike Cookies and Synology DSM password) provides an explicit “显示 / 隐藏” control for the configured AK. Its optional description adapts the stored/environment source; no plaintext enters the replace-AK input.
- `POST /api/v1/admin/services/baidu-map/reveal` is admin-only, bound to the current config revision, and requires a successful metadata-only reveal audit before returning the AK. Response is uncached; the UI hides the value after **30 seconds**, on visibility loss, save/clear, account/source switch and unmount. The ordinary status endpoint still contains no secret.
- Live Server reads use the effective persisted configuration on every Baidu map request, so rotating, enabling, disabling or clearing the AK needs **no container restart** and does not interrupt file services.
