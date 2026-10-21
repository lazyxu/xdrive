# A3h-Wall · W3b2b authenticated Cell Viewer return & sparse anchor

**2026-10-21. Scope:** an independent source-only, stacked Draft on W3b2a #2259 → W3b1 #2247. It does NOT claim that the whole photo-map P0, iOS27, Desktop Agent, 100k, Go cancellation latency or third-party JS Origin isolation is complete.

## Previously delivered and actual gap

W1 #2214, W2a #2220, W2b1 #2228 and W2b2 #2232 are merged: current signed Owner BD09 /cells → signed /cell-items → shared Gallery VirtualCollection/Viewer. W3b1 restores native BD09 camera; W3b2a adds a bounded Owner-only visual Cell selection and a logical visible Node/index, but does not actively reauthorise that logical location on true Viewer→Gallery remount. The Web overlay path normally retains its mounted Gallery scroll host; this change handles actual remounts without inventing a 100k client index.

## Change

- Add an ephemeral one-shot viewer return marker to the existing W3b2a Cell return session. Keep the selected consent-scoped Cell, sort, anchor Node/index, TTL=10 minutes (same bounded in-memory session), max 8 owner scopes. No localStorage, sessionStorage, URL, SW, media pixels, raw photo GPS, Provider auth or reusable access token.
- Mark the intent only when a current signed Cell wall opens the Viewer, with its currently visible logical Node/index. Ordinary Library/Album/Place navigation continues through its existing logic.
- On a fresh Gallery mount routed to **Places** only, atomically consume the one-shot marker. The map/previous trusted UI remains visible while making an **authenticated, abortable Owner `listBaiduNativeCellItems`** request with the *same* BD09 Cell identity and sort plus `anchorNodeID`.
- The Go handler already recognises `anchor_node_id` and maps the Cell constraint to the ordinary Owner Media Range query. Require a valid first response (exact offset/limit, bounded items/count) **and**, for a requested anchor, a Server-calculated `anchor_index` within the current total. Only then commit current Cell membership into existing VirtualCollection, apply sparse absolute `sortAnchorRestoration`, and render the wall. Do not trust a remembered or provider-supplied anchor index.
- If Consent/Owner/Session/Node revision or signed Cell is no longer valid, a missing anchor or HTTP 409/auth error **cannot** show stale media; keep the map and show the existing generic retry feedback. Switching section, selecting a different Cell, changing location or pressing Back cancels unconsumed return intent; Go cancellation for transport remains in original request Abort path.
- The already-mounted Web Gallery/Viewer background preserves its native scroll host via `web/src/App.tsx`; do not add another scroll restoration timer or competing sticky state. This path is the fallback for a *real unmount*, and the original Range/Viewer remains the sole data authority.

## Source tests / acceptance

`desktop/tests/gallery-places-w3b2b-owner-anchor-reentry.cjs` compiles the original W3b2a TypeScript runtime, tests one-shot expiry, Owner separation, explicit cancellation, invalid node/index, and verifies the original shared Gallery's authorised range-before-commit wiring and real Go parser's `anchor_node_id` constraint. It does **not** invent physical browser or PostgreSQL benchmark data.

Must pass exact HEAD full Linux/Windows Go and genuine PostgreSQL API Race, Web/Desktop, mounted Node regressions, release image/rootless/installer checks where required, single-work Final Gate, then fresh GitHub clean before parent merge → restack → independent merge. Prior parent green CI is not enough.

## Explicitly remaining

Third-party executable Baidu JS is still in the trusted Gallery document. P0-03 requires an independently hosted HTTPS Origin iframe with strict `postMessage` and CSP. W3b3 requires Desktop Agent parity and controlled 100k/weak-WAN/Go `ctx.Done()` metrics; C1 still needs iOS 27 and multi-client real physical evidence. Later B1-B/C/D → B2 → B3 stays unchanged.

**Permanent user decision:** production-only security acceptance **skipped (not performed/verified)** per merged `AGENTS.md` #2227. Do not request production AK/JWT/Cookie/HAR/access or gate source PRs on inaccessible production tests. Code-level Owner, Consent, revocation, CSP, third-party JS origin isolation and fail-closed are still mandatory.
