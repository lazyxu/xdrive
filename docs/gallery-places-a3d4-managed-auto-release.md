# P0-Places-A3d4 · Automatic xDrive map release identity

Date: 2026-10-19. Baidu remains the only map provider; no new AK or manual public-key configuration is required.

## The incorrect dual-key UX

xDrive already runs `EnsureBaiduJSAPI4InternalKeys` on trusted Server startup, generating one Ed25519 identity and one 32-byte map-only Cookie key. Both are encrypted in PostgreSQL, shared across replicas and anchored to an independent public-key fingerprint. The previous `jsapi4PinnedProductionPublicKey=""` belonged to a separate xDrive-created publication procedure, **not a Baidu certificate**. It was permanently unprovisioned and blocked all releases even if the operator had configured Browser AK/HTTPS.

## A3d4 correction

- Server loads the existing protected signing/Cookie material from one repeatable database snapshot, validates private/public correspondence, persistent fingerprint, secret-row revisions, encryption root and nonzero key. Missing/corrupt rows fail closed; the Server never silently generates replacement identities after partial loss. No private bytes cross an HTTP, Electron, Agent, JSON, log or browser boundary.
- A four-minute Ed25519 release proof now binds the **real** current build SHA, compiled reviewed map policy digest, trusted HTTPS origin, encrypted Browser AK config revision and durable identity epoch. A Dev build or incomplete policy cannot produce a release.
- The Server auto-issues/renews release proofs on startup and admin config changes, then every minute while running. Renewals with unchanged policy, origin, revision and Cookie identity reuse the same authority pointer to avoid needless map flicker. Disabling, key loss, expiry, stale revision or epoch still revoke; authenticated Map Session and Loader continue enforcing Owner/cookie/quotas/AK/private fixed upstream independently.
- The shared System Dependencies page now reports `instance_signing_identity_unavailable` only when the **actual durable key** cannot be loaded, replacing the misleading "not source-pinned production key" label.

## Not an "approve-all" proxy

This fixes the **unnecessary second public-key setup**, NOT the independent security risks of arbitrary executable SDK children. Official Baidu documentation shows `serviceHost` + `BMAP_PROXY_URL` and a generic wildcard example, but xDrive's JSAPI4 is injected into an authenticated personal-photo origin. Blindly forwarding arbitrary routes and response JavaScript could leak Browser AK or user credentials, bypass quotas and create untrusted executable content. The existing zero-child manifest remains hard-denied; only reviewed fixed provider requests may be admitted, with strict credentials, origin, Canonical path/query, MIME/size, cookie/epoch, cross-replica quota, cancellation and kill-switch. Keep Static Map available until true native map resources and Web/Mobile/Desktop source-exact/physical acceptance pass.

## Status / tests

Current source policy is still empty; dynamic `runtime_enabled=false` is the correct production result. The existing A3 native lifecycle and three-client components are untouched. Verify real signed identity cryptographic tampering, expiry, missing DB/encryption root, cross-replica stable identity and rejection of unreviewed resources. This is a source-only PR; does not claim live deployment or provider-network/9-pair HAR, mobile Safari/iOS27 or Desktop physical acceptance. See [A3 release issue #1798](https://github.com/lazyxu/xdrive/issues/1798).
