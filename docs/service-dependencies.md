# Admin service dependencies and secure Baidu AK configuration

## Scope and status

**Status:** Shared Web/Desktop **服务与依赖** page has read-only dependency health plus a narrowly scoped, encrypted **Baidu Server AK** editor. It is **not** a Docker controller, Compose editor, secret viewer, or general-purpose credentials service.

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

## Follow-on sequence

1. Finish server-side Media Worker signed preview input and output verification, worker cancellation and short-video cache; **measure production baseline first** per `AGENTS.md`.
2. Add actual FFmpeg worker health and queue/capacity to the status endpoint when the runtime is shipped.
3. Baidu Maps Server API is documented in `docs/baidu-map-server-api.md`. It serves a bounded static PNG from a fixed upstream host. No offline fallback or other provider is allowed; any later interactive functionality requires a separate Baidu API/licensing/coordinate review.
4. Baidu AK can be updated, disabled or cleared using the scoped admin-only endpoint with authenticated encryption, audit and optimistic revision checking. All other service settings remain read-only until separately designed. Secret values must never be returned in status JSON.

### Baidu Server AK precedence and hot reload

- Initial/fallback deployment settings: `XD_BAIDU_MAP_ENABLED`, `XD_BAIDU_MAP_AK` (no admin override row).
- When saved from the administrator page, encrypted `xd_admin_service_secrets` record **overrides environment settings**; even disabling/clearing the key must not activate an old environment AK.
- Uses the existing versioned `XD_CONNECTOR_SECRET_KEYS` AES-GCM keyring. If absent, the UI explains that an encryption key must first be configured through deployment; no plaintext persistence is permitted.
- GET status reports `editable`, `configured`, `revision`, `source` and `requires_restart=false`, never AK. PUT updates are admin-only and audited without secrets. A stale revision returns HTTP 409.
- The shared `XDriveStoredCredentialField` (also used by Yike Cookies and Synology DSM password) provides an explicit “显示 / 隐藏” control for the configured AK. Its optional description adapts the stored/environment source; no plaintext enters the replace-AK input.
- `POST /api/v1/admin/services/baidu-map/reveal` is admin-only, bound to the current config revision, and requires a successful metadata-only reveal audit before returning the AK. Response is uncached; the UI hides the value after **30 seconds**, on visibility loss, save/clear, account/source switch and unmount. The ordinary status endpoint still contains no secret.
- Live Server reads use the effective persisted configuration on every Baidu map request, so rotating, enabling, disabling or clearing the AK needs **no container restart** and does not interrupt file services.
