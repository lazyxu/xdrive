# Dynamic-only Places: retire the unisolated JSAPI prototype

After merged PR #2441 removed Baidu Static Map, only the Server-signed separate HTTPS JSAPI 4.0 Child may render Places.

This follow-up removes the obsolete, reachable in-Gallery JSAPI prototype and its Browser AK-returning endpoint:
- Server `GET /api/v1/media/places/baidu-jsapi/prototype`
- Desktop local Agent `GET /v1/media/baidu-jsapi-prototype`
- Go Client, Electron Main/Preload/Renderer, Web adapter and shared Gallery prototype ports
- Same-document direct SDK injection renderer and its old GPS clustering/cover-pin helpers
- Prototype-specific diagnostics and tests

Preserved: Server-signed `/media/places/baidu-jsapi/status`, Child ticket, independent origin/session, strict CSP and no map fallback, current Owner BD09 cells/camera Range, GPS consent, original-photo Gallery Range/Viewer, administrator Browser AK configuration and private Server AK for separately authorized coordinate conversion.

## Regression
- Retired routes are not registered and old components are absent.
- Web, Mobile Web, Agent and Electron no longer expose the prototype transport.
- Only `authorized_signed_release` mounts the isolated Child. A denial reports a bounded anonymous error and never falls back to same-document or static maps.
- Source-level tests and full Go/PostgreSQL, Web/Desktop and Final Gate CI must pass on the exact HEAD.

Production-only security acceptance beyond ChatGPT's reach: **按用户决定跳过（未验收）**. This does not exempt code-level Owner/Consent/CSP/Origin or adversarial tests.
