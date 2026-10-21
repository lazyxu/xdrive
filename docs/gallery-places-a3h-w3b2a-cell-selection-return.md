# A3h-Wall · W3b2a Verified Cell selection & bounded virtual anchor

**Date:** 2026-10-21 · **Scope:** staged source-only PR based on existing W3b1 #2247 (unmerged). This is NOT final W3b2/three-client/physical acceptance.

## Original source gap

The merged W2 Cell photo-wall takes a signed Owner `/cells` snapshot and opens original virtual Media Range / Viewer, but returning to the map loses the selected Cell identity. Existing W3b1 adds a separate BD09LL camera in short-lived Owner memory; it does not persist Cell selection or sparse scroll anchor.

## Scoped implementation

- New `media-gallery-baidu-cell-return-session.ts`: small, allowlisted clone-only UI state keyed by existing Owner scope, 10-minute TTL, maximum eight scopes, never in localStorage/URLs/PWA Service Worker/SDK or public share tokens. Stored: exact signed Cell selection envelope (BD09 bounds/8×8 indices/representative IDs/revision/photo_count), captured|added & asc|desc sort, and optionally one logical visible Node ID / index. It is NEVER a new authorization token.
- In the shared Gallery controller, **only after first Owner `listBaiduNativeCellItems` returns a valid page** is the selected Cell remembered. The Gallery virtual list reports its current visible index + Node to the same Owner-only memory. Invalid values are rejected. Choosing a different map place invalidates the native camera and Cell hint.
- Existing `MediaGalleryPlacesMap` passes the selected Cell to the original native PhotoSurface. The native map shows `aria-pressed` / primary border **only if a CURRENT, freshly accepted signed Owner `/cells` result** has the same bounds, Cell index, Asset, Node, revision and count via the original `xDriveSelectBaiduNativeCell` validator. Stale, revoked, moved-map and missing cells never highlight. The authoritative Cell Range and selected media are still server-only; no image bytes or URLs go to the Baidu SDK.
- Node runtime tests execute original TypeScript via TS transpile, checking owner isolation, TTL, bounded memory, no SDK extras, anchor constraints, invalid data, revision/viewport changes, and static exact-source wiring.

## Explicit remaining W3b2b/W3b3

- Restore the original *virtual* photo list to the verified selected logical anchor, sort and Viewer-selected item, using the original bounded authorized Range/anchor index and guarding superseded Owner requests. Do not trust the remembered anchor as an authorization source.
- Complete Desktop secure Agent parity, iOS27 physical navigation/VoiceOver/375/390/899/900, real 100k and Abort→Go ctx.Done evidence.
- Independent third-party Baidu JS different-Origin iframe/strict postMessage remains open P0-03; this patch does not falsely claim SDK isolation. Production-only security acceptance is permanently SKIPPED (not performed/verified) per merged AGENTS #2227, and is not a code/CI merge gate. Source Owner/Consent/revocation and security checks remain mandatory.

## Integration/merge controls

The work stays a **DRAFT stacked PR** until W3b1 #2247 itself passes its exact-head CI+Final Gate and merges. Reconstruct a single work commit directly on the complete then-current `master`, preserving all original independent source blobs, entire master AGENTS historical suffix and all owner changes, and run its own exact-head full CI/Final Gate/clean before merge. Previous parent CI does not certify this child.
