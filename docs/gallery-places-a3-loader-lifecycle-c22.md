# P0-Places-A3c22 — Bounded real JSAPI4 Loader lifetime and fast cancellation

**Date:** 2026-10-19 · **Single Baidu Provider** · **A3 dynamic runtime release NO-GO**

## Original production risk

The genuine shared `ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts` holds one SDK Promise per document. If the Server-authenticated provider script neither fires `onload` nor `onerror`, the Promise remains pending indefinitely. The Gallery unmount's AbortSignal cancels only its local waiter, while the shared script remains in the document; a subsequent Web/Mobile Web/PWA/isolated HTTPS Desktop attempt reuses the orphaned Promise and cannot recover.

## Scoped repair

1. The same already authenticated Owner map-only grant is still required **before** any script is created. Fixed same-origin `/_BMapService/api?v=4.0` and no Browser AK or arbitrary URL remain unchanged.
2. Model the in-progress SDK script with a per-Document consumer count. When one viewer leaves, only its waiter is cancelled. When the **last** leaves, remove the pending script, clear its timeout, reset the local pending cache and restore a previously valid security configuration.
3. End an uncooperative provider script after 8 seconds even without load/error callbacks. After cleanup, a new authenticated Owner grant can retry with a fresh script. Late callbacks cannot initialize a map.
4. Retain success caching solely for the same document's validated BMap namespace. Map lifecycle and abortable Server-side Owner `/viewport` and `/cells` remain shared and unchanged.

## Evidence

Extend the ORIGINAL Node TypeScript-transpiled module tests, not only static source or simulated 100k math: two concurrent consumers, one cancellation preserving the other, last cancellation removing the actual created script, stale onload ignored, a genuine registered script deadline controlled by test clock, and a fresh authenticated retry after both cancellation and timeout. Preserve existing session-first, HTTPS-only, no-AK and WGS84→BD09 safety cases.

This is a local safety/lifecycle improvement, **NOT** an authorized Baidu JSAPI 4.0 upstream child proxy, completed licence audit, operator-signed production release or physical iOS27/Android/100k test. Source-pinned signer remains blank, reviewed child inventory remains zero, unknown URLs and unapproved users stay denied. Follow #1798 for real private 9-pair Browser/upstream HAR and physical three-client release gates.

## Branch policy

Exactly ONE scoped work commit on latest frozen `master`, four paths only: existing shared loader, existing real browser-loader test, this new documentation, and FULL additive `AGENTS.md`. Require fresh exact-head full CI incl PostgreSQL API Race, Web/Desktop Linux/Windows, Rootless, one-commit and Final Gate, plus GitHub `mergeable_state=clean` before Ready/Rebase. Independent FileExplorer/Host/LocalPush/perf/race branches are not modified.
