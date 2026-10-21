# P0-Places-A3i-Msg1 · Cross-Origin Baidu JSAPI message boundary (source-only)

**2026-10-21 · Isolated protocol groundwork. Does NOT implement or activate iframe execution.**

## Verified existing gap

The current `ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts` `secureDocument()` selects the trusted Gallery document and appends Baidu's executable SDK there. Even signed Server releases, HttpOnly Cookies and omitting photo URLs **do not isolate a third-party script from Gallery DOM**. P0-03 is NOT complete.

This step introduces a pure, network-free, inert TypeScript protocol and original-source compiled Node tests. Do not route existing SDK traffic through it or claim sandboxing from these helpers alone.

## Parent-to-child trust boundary

- A real, separately hosted HTTPS Origin is required. The selected frame Origin must differ from the Gallery Origin; `https://gallery.example.com` in a different path, same-Origin iframe, `data:`, `blob:`, `null` and HTTP are not accepted.
- A future dedicated map iframe must use independent storage, no app cookie domain overlap, no bearer/Gallery identity forwarding, no privileged Electron preload, and explicit parent `frame-src` / child `frame-ancestors` and per-resource CSP. A sandbox containing `allow-scripts allow-same-origin` is only defensible on a verified, truly different Origin. Never add that combination for a same-Origin frame.
- One signed Owner /cells and /cell-items authority remains in the **trusted parent**. Only explicitly opted-in, current Owner BD09LL map cells with no more than 64 representative coordinates and arbitrary 128-bit random map-local keys may be sent to the child. Key-to-original-cell mapping remains parent-only.
- `postMessage` targetOrigin must be the exact separately approved child Origin, never `*`. Inbound events must simultaneously match `event.origin`, `event.source === iframe.contentWindow`, protocol version, fresh generation, unpredictably generated nonce, strict byte budget and method-specific shape.
- Allowed child events: `ready`, `cancel`, `camera` (BD09LL only) and `activate-cell` (opaque 32-character hexadecimal session-local ID only). Child cannot request arbitrary GET/fetch, send Owner tokens or select files itself. The parent must match any requested cell key against its still-authorized current Cell receipt, then rerun the Owner permission checks. A correct message envelope is not media authorization.
- Owner logout, changing location/Origin, map epoch revocation, navigation or iframe disposal must invalidate nonce+generation, abort bounded Server requests and clear in-memory mapping immediately. Subframe errors keep the existing **Baidu Static Map** fallback; no second map Provider.

## Source test scope and stop conditions

`desktop/tests/gallery-places-a3i-isolated-origin-protocol.cjs` directly transpiles and exercises the real original TypeScript module, including same-Origin/http/replay/stale generation, wrong `source`, oversized packets, credential/pixel/url/asset ID injection, invalid WGS84-as-BD09 camera, duplicate/over-64 cells and malformed opaque keys. No mock implementation is substituted for the real parser.

**Still required to complete P0-03 in a later scoped PR:** real HTTPS independent-Origin iframe host and Server routing; no child app credentials or parent DOM access; strict parent/child CSP and cookie/storage isolation; an isolated render IPC integrating currently authorized /cells/Viewer; native browser malicious SDK test proving parent DOM/Storage/Fetch private media are inaccessible; revoke/logout/multi-owner/video/PWA/Electron regressions; safe fallback for missing resources and independent session lifecycle. Real iOS27 and 100k are separate task evidence, not inferred from this protocol test.

**Permanent owner policy:** production environment security acceptance is **按用户决定跳过（未验收）**. No user production access, AK, HAR, JWT, Cookie, credentials or manual production security approval requested; never block source CI/merge for this inaccessible production step. This is distinct from retaining mandatory code-level JS Origin isolation, Owner/Consent/revocation, CSP, resource restrictions and fail-closed tests.
