# P0-Places-A3i-Msg2 · Parent-owned isolated HTTPS iframe transport

Date: 2026-10-21. **Source-only staged implementation; NOT a deployed map iframe, browser security sign-off, or production integration.**

## Dependency and scope

Stacked on [A3i-Msg1 #2263](https://github.com/lazyxu/xdrive/pull/2263), which provides the strict but inert postMessage protocol. This step adds a REAL DOM iframe mounting controller for a future separate-origin child and original-TypeScript compiled Node adversarial tests, but deliberately does not activate it in Gallery. It must not be mistaken for a completed third-party SDK isolation.

The file ui/shared/src/media-gallery-baidu-isolated-frame-host.ts is parent-only and network-free except that the browser would navigate an explicit iframe to a fixed child path. It **never loads Baidu SDK** and never moves auth/Owner authority into the child.

## Security invariants implemented in code

- Validate actual ownerDocument/defaultView and trusted parent Origin. Reject same Origin, same host/different port, **sibling subdomains under the same two-label DNS suffix**, IP literals and localhost before creating any iframe. A different hostname is NOT sufficient: a Domain-scoped cookie can span hosts. The deliberately conservative two-label check may reject valid sites on multi-label/private public suffixes (fail closed); it is NOT a PSL verifier or evidence of cookie isolation.
- Require crypto.getRandomValues and a fresh 256-bit nonce for each controller generation. No non-crypto fallback. Fixed child path without AK/JWT/Owner/node ID, query, or location arguments.
- An independently hosted child may use allow-scripts + allow-same-origin only when an **independent registrable site** is confirmed by external deployment configuration AND the parent CSP frame-src prevents any navigation back to the privileged Gallery Origin. The new conservative precondition is necessary, NOT sufficient. Dedicated child CSP/frame-ancestors, Gallery frame-ancestors, separate Cookie/Storage and an adversarial real-browser regression remain required. The controller adds no popups, top-navigation, forms, camera or geolocation permissions, and sets no-referrer.
- Parent authenticates the child with exact MessageEvent.origin AND source === iframe.contentWindow and strict nonce/generation/protocol fields from Msg1; postMessage targetOrigin always equals approved child Origin, never wildcard.
- Initial challenge transmits **zero cells**. Caller can provide at most 64 already Server-authorized, explicit-opt-in BD09LL cells; the controller generates fresh random 128-bit opaque keys and sends only key/latitude/longitude/count. Owner selection object, JWT, node/asset ID, media URL, EXIF, pixels and original GPS stay only in the trusted parent.
- Activate-cell message is an **intent**, NOT authorization. The trusted caller must use the original authenticated /cell-items Range and fresh Owner/Consent/revision check before showing media. Invalid replacement clears old keys; iframe reload clears ready/cells; disposal invalidates generation, handlers and DOM.
- Unit tests compile and execute original Msg1/Msg2 TypeScript. Cover false origins, same hostname with different port, absent cryptographic randomness, sandbox flags, no data until handshake, wrong source/nonce, WGS84-as-BD09, unauthorized opaque keys, credential injection, malformed count, max64, revoke and disposal.

## Critical unimplemented work — do NOT activate

This PR **does not** create or deploy the independent HTTPS hostname/Caddy route, child bundle, child CSP/frame-ancestors, separate Cookie/storage and map-only bootstrap, malicious provider JavaScript browser E2E, Browser AK child-resource policy, PWA/Electron child-host parity or true JSAPI4 Session renewal. The present Gallery still has its old same-document JSAPI Loader when separately Server-authorized. Do not call P0-03 complete, do not set a map-isolated runtime flag, and do not issue a production release from this implementation.

Next staged work must establish independent child hosting and CSP, **prove in a real controlled browser that third-party JS cannot read parent DOM/storage/private API**, and then replace the old Gallery-native Loader with a fail-closed parent bridge. Preserve signed Owner, Consent, revoke, original Gallery virtual Range/Viewer, camera BD09/WGS84 tagging, Static Map fallback, 52px App Frame and one Baidu Provider.

**Permanent owner decision:** ChatGPT-inaccessible production environment security acceptance is **按用户决定跳过（未验收）**. Do not request production AK, HAR, JWT, Cookie, credentials, accounts, access or manual sign-off; never block source CI/PR merging on this unavailable step. Code-level Origin/CSP/Owner/Consent/revocation/fail-closed and controllable automated security testing remain mandatory.
