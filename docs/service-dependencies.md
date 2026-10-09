# Admin service dependencies (read-only first delivery)

## Scope and status

**Status:** In progress. Phase 1 delivers a shared Web/Desktop **服务与依赖** page and an admin-only, no-store Server status endpoint. This is an operational read-only view, **not** a Docker controller, Compose editor, secret viewer, full model inventory, or a completed map/FFmpeg integration.

### Contract

- HTTP: `GET /api/v1/admin/services`, guarded by the existing authenticated `requireAdmin()` group.
- Response: `{ checked_at, services: [{ id, group, label, status, detail, version?, model? }] }`.
- States are intentionally distinct: `ready` means a real probe succeeded; `unavailable` means configured/expected but the probe failed; `disabled` means no analyzer/resolver is configured; `unknown` means a store implementation lacks a readiness probe; `planned` means integration or probing is not implemented.
- PostgreSQL checks `PingContext` with bounded deadline. Storage reuses `Store.Ready(ctx)` when implemented. Face, visual/OCR, and semantic analyzers call existing local `Info(ctx)` contracts, without exposing sockets, secrets, or raw errors. GeoNames reports the actually loaded resolver and version.
- Current Video Media Worker and remote tile Provider deliberately remain `planned`. The existing local-first Places map continues to function without tile requests.
- Probes run on explicit page load/refresh, are bounded by a shared two-second context, and have no side effects. The page does not poll when hidden.
- Backend permission, not sidebar visibility, is the authority. Desktop forwards the existing session via Agent IPC; it does not send user credentials into the Renderer.

### Deployment/source of truth

- **Existing:** `server`, `worker`, `postgres`, `caddy`, optional `photo-face` profile. Analyzer socket, model image, secrets, CPU/memory limits are Compose/host config, not mutable from this page.
- **GeoNames:** Existing `XD_PHOTO_PLACE_GEONAMES_DIR` points at the *container-visible* folder; the dedicated read-only host mount is tracked separately in PR #1189.
- **Media:** separate optional FFmpeg Media Worker to be implemented and measured; no video hover is enabled by this page.
- **Maps:** preserve local-first Places, subsequently add an opt-in online/self-host tile adapter and clear privacy information. No fabricated default tile service.
- Runtime control and editable settings require distinct permission, persistent configuration, compatibility, and Host Manager safety contracts. Do not mount Docker socket into Server.

### Acceptance gates

1. A standard (no-profile) deployment still serves file operations, uploads, sync and Gallery unchanged.
2. Unauthenticated and nonadmin API calls are rejected; admin sees only safe fixed status fields.
3. A missing/unreachable analyzer is distinguishable from a disabled one; the local map and planned worker never display false green status.
4. Web hash route, sidebar, desktop navigation and IPC path open the *shared* MUI page; account switch/unmount drops stale results.
5. Old Agent/Server returns an explicit unsupported/error message and does not silently show fictitious health.
6. Go unit tests, Web lint/typecheck, Desktop main/renderer typecheck, and scoped CI pass before merge.

## Follow-on sequence

1. Finish server-side Media Worker signed preview input and output verification, worker cancellation and short-video cache; **measure production baseline first** per `AGENTS.md`.
2. Add actual FFmpeg worker health and queue/capacity to the status endpoint when the runtime is shipped.
3. Add tile Provider selection with explicit opt-in, provider license/attribution and data-privacy behavior; then report the real provider state.
4. Add safe read-write admin configuration only after source-of-truth and permission semantics are defined. Secret values must never be returned in status JSON.
