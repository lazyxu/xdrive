# P0-Places-A3c23: source-compiled Baidu JSAPI4 child transport

Date: 2026-10-19. Provider: **Baidu only**. Release state: **NO-GO** until independent external approval.

## What is actually implemented

The registered authenticated Owner Session and exact Loader path remain unchanged. A new source-compiled child manifest and real Server HTTP transport are wired into the **real Gin Router**. Only individually source-reviewed exact child paths may be registered; NEVER a wildcard. The manifest is currently deliberately empty and the reviewed child revision/count remain empty/zero, so it registers **zero child routes**. No administrator setting, HAR file, Test Candidate or Browser AK can add a runtime route.

Once independently licensed and fully reviewed evidence has been code-pinned together with a trusted Ed25519 operator release, each exact child HTTP request must pass:

1. Strict canonical same-origin path/query and immutable resource contract, with no ambiguous encoding, arbitrarily chosen upstream URL or browser AK parameter.
2. Fresh authenticated short-lived Server-issued map-only HttpOnly Cookie, current Owner SessionVersion, epoch and encrypted Browser AK revision, identical to the Loader.
3. Bounded cross-replica Fleet/Owner quota and in-flight slot before fixed HTTPS Baidu transport; no environment proxy or redirects, with BMAP_PROXY_URL derived solely from trusted AllowedOrigin; no forwarded browser credentials.
4. Source-reviewed MIME and response byte maximum, AK-byte checks, no upstream Cookie, redirect or unchecked response headers. Only fixed no-store/nosniff/no-referrer/same-origin headers leave the Server.
5. Signed release, Owner state, AK/config and revocation checks after the upstream response and again before Gin writes a byte. Browser cancellation propagates to the Go request Context.

The original Web/Mobile Web/PWA and HTTPS-isolated Desktop continue sharing Gallery API, Range/VirtualCollection/Viewer, original WGS84 source-vs-derived BD09LL, the 52px App Frame and static Baidu fallback.

## Why actual JSAPI4 dynamic production is STILL blocked

The production release signer is still empty; the reviewed child inventory revision is empty, the approved count is zero, and the code-owned child candidate slice contains zero entries. No runtime option, admin checkbox or synthetic HAR changes that. We CANNOT honestly fill real child host/path/query/MIME definitions or pin an operator certificate without the provider account's real licensed capture and private, independently reviewed raw-byte evidence.

There is no live pinned operator release provisioning, no real Baidu child traffic, no physical iOS27 Photos 1:1 screenshots, Android, Windows/macOS or actual 100k acceptance. The Server continues returning 503 for unlicensed Loader/Session and 404 for unknown children, without exposing Browser or Server AK.

## Required operator work

1. Independently retain the official account approval for Browser AK JSAPI4, Server AK/static map, self-hosted multiuser proxy, Web, PWA, iOS Safari, Android, Electron, geo BD09 retention, attribution, quota and fees. The prior operator statement is already on issue #1798 and need not be repeated.
2. Prepare trusted isolated HTTPS staging with private credentials and synthetic locations. Obtain 9 pairs of genuine Browser and distinct Server-upstream HAR: Web/Mobile Web/HTTPS Desktop × load, pan, zoom. Run the existing private evidence-matrix tool with a privately injected AK canary.
3. Review exact observed resource hosts, paths, canonical query keys, MIME, limits, JS/tiles/font/WASM children and AK-leak/caching behavior. Pin all approved, versioned rules in source and an independently trusted Ed25519 signing root; add protected Server signed-release startup/renewal only after this review.
4. Verify actual iOS27 Photos page screenshots/gestures and Viewer anchors, Android/PWA/Electron, ClusterLayer and >100 real-count cells, cancellation/logout, accessibility and physical 100k.

Original AKs, unredacted HAR, Cookie/JWT and user GPS must remain out of GitHub, public CI, chat and screenshots. See docs/gallery-places-a3-production-cutover.md, docs/gallery-places-jsapi4-operator-runbook.md, issue #1798 and Baidu official serviceHost proxy documentation:
https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy
