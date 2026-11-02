# Viewer quality settings and variant cache: P1 foundation

This change establishes the shared TypeScript/Go policy only. It deliberately
does NOT claim that per-user persistence, admin settings UI, alternate renderers,
server enforcement or DSM v2 Range negotiation are already deployed.

Policy: account-scoped default high/4096; optional device override; Server admin
maximum is a hard cap. Effective = min(device override or account, admin max).
Unknown input must be rejected. Show requested and effective tiers in diagnostics.

| Tier | Max edge | WebP | JPEG |
|---|---:|---:|---:|
| economy | 1280 | 82 | 84 |
| balanced | 2048 | 88 | 90 |
| high/default | 4096 | 90 | 93 |

The existing high profile MUST keep legacy v1 image key and ETag unchanged,
including DSM strict 256 KiB Range verification. Different profiles use separate
key and ETag identities including actual edge, encoding quality, renderer/encoder
version, source SHA and revision. Switching quality does not clear cache or touch
LIVP, HEIC, MOV, thumbnail wall or original downloads.

Follow-up rollout gates:
1. Implement per-Owner DB preference with authenticated GET/PUT and CAS revision.
2. Implement audited global admin maximum + cache budget, enforce on Server.
3. Wire bounded 1280/2048 generation, task identity and ETag v2; update cache GC
   to protect current versions and evict cold versions without touching originals.
4. Upgrade Web, Desktop and DSM (including exact Range/ETag v2) explicitly.
5. Wire in-Viewer preset selector and decoder-safe/cancellation-safe switching.
6. Validate full applicable CI and device behavior before master merge.

Never accept arbitrary client quality, proxy URLs, or unsafely shared cache tokens.

## Codec proof (account-preference stacked stage)

The real `ViewerQualityPreview` encoder is now available to Server integrations
for the six bounded variants. The existing Viewer route still requests legacy
high and does not consume these alternate formats until the authenticated
admin-cap and cache/GC pipeline is wired. A codec unit test decodes generated
JPEG/WebP pixels, checks long-edge dimensions and rejects arbitrary quality.
