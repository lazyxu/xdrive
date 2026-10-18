# A3c21 · Harden isolated Electron Baidu map data: resources (2026-10-19)

## Scoped issue

The A3c17 trusted HTTPS-only Electron map navigation/egress policy correctly blocked external HTTP, untrusted HTTPS CDN, other origins and file: navigation. It nevertheless allowed **every** data: URL, including `data:text/html`, executable JavaScript and SVG. This was broader than necessary for raster tile/icon rendering and cannot be retained as part of a future real JSAPI4 review.

## Change

In `desktop/src/main/baidu_map_secure_view.cts`, the original pure outbound resource predicate now permits only canonical base64 PNG, JPEG, WebP and GIF data: resources with at most 1 MiB decoded image data; executable MIME, SVG, invalid or noncanonical encoding, query/fragment, whitespace and oversized payloads fail closed. Same-origin blob: is unchanged because the SDK may construct internal WebGL/worker objects; the genuine JSAPI4 private child policy and CSP/Electron review must still assess those objects before release.

The existing isolated Electron window remains HTTPS-only, sandboxed, no privileged preload, no direct Baidu AK URL, no arbitrary external CDN. This patch does **not** activate JSAPI4, install a provider signature, collect authentic HAR, or change shared Web/Mobile Web Gallery/Range/Viewer. No new map Provider or UI geometry is introduced.

## Validation and release

The original Desktop mounted source contract remains; an added executable Node TypeScript-transpiled policy test checks allowed 4 raster types and denied script/HTML/SVG/WASM, invalid base64, noncanonical and oversized input. Full CI and exact-head Final Gate are mandatory before merge, in addition to latest GitHub clean mergeability. Real authorised Safari/Android/Desktop/100k and map child graph are separate blockers in #1798.

Production `JSAPI4ChildInventoryComplete()` remains false, signer remains unprovisioned, and no Server session/Loader or child route can be authorized by this policy change.
