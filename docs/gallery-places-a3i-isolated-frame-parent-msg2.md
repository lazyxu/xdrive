# A3i-Msg2 · Parent-owned isolated HTTPS frame contract

2026-10-21. **Source-only stage; NOT an active isolated Baidu map.**

## Dependency and exact scope

A3i-Msg1 #2263 defines an inert cross-Origin postMessage protocol. This staged child change adds the **trusted-parent iframe mount and event boundary**, plus a source-compiled Node regression. It does **not** enable the third-party SDK or modify the existing same-document JSAPI Loader. Hence P0-03 is still **NOT COMPLETE**.

- Parent Window and HTMLElement ownerDocument must match. Gallery and child must use HTTPS and distinct Origins; reject even the same hostname on different ports. Child address is a configured and reviewed Origin plus the fixed child document path; never a user-supplied URL, credential or query.
- The trusted parent mints a 256-bit WebCrypto nonce, generation, and 128-bit random session-only Cell keys. No AK/JWT/Cookie/Owner/Node/Asset identity, thumbnail URL, EXIF, pixels, or original GPS is sent in messages.
- The frame requests sandbox permissions allow-scripts + allow-same-origin **only for a future independently verified child Origin**. These permissions are unsafe on a same-Origin frame. A different hostname alone does NOT prove Cookie isolation: sharing an eTLD+1 cookie domain, navigating the child to Gallery, or insufficient app CSP would defeat the desired isolation. This code cannot become active before those deployment controls and real browser tests exist.
- Outbound packets target the exact child Origin and contain only up to 64 currently authorized consented BD09 representative points and counts, and opaque random keys. Mapping to the real selected Cell stays parent-only.
- Inbound events require matching event.origin, event.source, nonce, generation, method shape and byte budget. The child activate-cell message is an **intent**, never authorization; only the existing current-Owner signed /cell-items Range, Consent and revision checks can authorize Viewer/media.
- Logout, navigation, revoke and Owner change must dispose the frame and synchronously clear its key map. Reload invalidates old keys. Malformed new receipts revoke the previously published selection.

## Regression evidence

The new desktop/tests/gallery-places-a3i-isolated-frame-host.cjs transpiles the **real original TypeScript sources** for the parent and Msg1 protocol, testing exact HTTPS Origin, WebCrypto challenge, wrong origin/source/replay, no identifiers or credentials, up to 64 keys and revocation. These are **source unit tests**, not two-Origin hostile-provider browser security proof.

## Requirements remaining before P0-03 completion

1. An actually deployed separate HTTPS child site with **different registrable-site trust**, independent cookies/storage, no parent app authentication, approved child resource allowlist, exact Server/Caddy host routing, and strict parent frame-src, parent frame-ancestors protection, child frame-ancestors/default-src/script-src/connect-src. Verify navigation cannot turn the child into a Gallery same-Origin sandbox.
2. Real isolated child map renderer plus safe map-only Server Session and current signed resource controls. The current same-document Loader must not silently remain active. Fail closed to original Baidu Static Map.
3. Two-Origin hostile SDK browser tests proving it cannot read/alter Gallery parent DOM, cookies, storage, sensitive API responses, media URLs, or privileged Electron contexts. Test logout/revoke/reload/Owner change/missing child.
4. Real Owner/Consent revocation, Desktop transport parity, 100k and Go ctx cancellation, and iOS27 visual/function tests separately.

**Permanent user rule in AGENTS #2227:** inaccessible production security acceptance is **按用户决定跳过（未验收）**. Never request production HAR, credentials, AK, JWT, Cookie or manual production acceptance; do not block source CI/PR/merge on them. Origin/CSP/Owner/Consent/revoke/fail-closed and controlled tests remain mandatory.
