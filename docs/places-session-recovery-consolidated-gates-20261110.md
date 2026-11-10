# Places Desktop map session recovery: consolidated exact-HEAD gate

This is an executable acceptance map, **not** a claim that a public Baidu
deployment, personal Windows installation, or physical 100k photo library was
tested. Keep the existing trusted Owner/Cell/Viewer and SDK isolation design.

## Consolidated scope

| Requested scope | Executable acceptance and existing coverage |
| --- | --- |
| P0 #4278 Child handshake, reload, background and forged messages | Already merged at #4278; exact-HEAD full CI, Final Gate and Chromium passed. Do not rewrite this green PR. |
| P0 merge + master | #4278 merged to master; review the post-merge master commit CI independently. |
| P0 no remembered password, Agent survives multiple Desktop boots | `places-desktop-production-web-runner.cjs` now uses **three consecutive production Main/Preload/Renderer + WebView boots** with one real Agent/Gin/PostgreSQL fixture; first two complete with original Owner and no saved password, third logs out and switches Owner while the Guest is mounted. Same real F12 and signed photo/Viewer route checks occur on every boot. |
| P1 Owner/logout/Agent/Browser Cookie/revoke/late messages | Existing production Electron WebView tests cover native logout, Cookie regrant, legacy Server fail-closed, in-flight bearer cancellation, Owner switch and route retirement; new unit and dual-host error matrix prevents old authorized pins or Viewer returns on 401/403/429/503/network. |
| P1 mode switch, browser history, one-use PhotoScope | Existing dual-host Chromium real Gin handoffs cover Family/Favorite/date/kind/sort, bad/revoked/expired issuance, full-document reload, history ABA, changed routes and fresh Owner reads. Combined source-executed Back/Forward and explicit abandon checks add exact URL scrub + Owner visual/camera/Cell retirement. |
| P1 map → photo drawer → Viewer → camera, filter and scroll | Existing dual-host real React/Gin, real decoded CAS Viewer, and deep 100k logical-wall tests assert verified Owner Cell and exact pixel/logical anchor, rehydrated signed page and restored camera. Those suites are triggered by the changed dual-host script; no second Viewer is created. |
| P1 401/403/429/network/SDK | The actual shared Parent is mounted under both inline and independent HTTPS Child on real Chromium and gets a once-failed Owner Favorites Cells read. For each of five failure classes it must hide stale pins, display retry (not a fake empty map), reread current Owner Range and open exactly the signed 3-photo drawer; no SDK remount. The #4278 synthetic isolated SDK stage diagnostics remain independently gated. |
| P1 controlled PG 10k/100k, cancellation/latency/RSS | The original **real PostgreSQL 17** C1 measurement now triggers on this PR's session-recovery test/script paths. It seeds 10k and 100k indexed Owner assets with a foreign Owner, measures actual generated SQL/EXPLAIN for 7 operations × 7 samples, P50/P95/Max, bounded 64-cell Count and Go-process MaxRSS, plus pre-cancelled map query. The browser dual Host's 100k sparse virtual wall additionally checks bounded DOM, sparse seek, Viewer Back and rotation; it is **synthetic logical 100k**, not a physical 100k media dataset. |

## Exact-HEAD gates and truthful evidence

1. `CI` + `final-gate`: current PR SHA, Desktop Windows/Linux, shared Web build and full CJS suite.
2. `places-desktop-production-web-restart.yml`: real production Electron two retained-Owner restarts **plus** third live logout/Owner switch, with the same Agent and real Gin/PostgreSQL.
3. `places-p0-17-real-chromium.yml`: both real mounted SDK Hosts, exact Owner handoff, revoke, photo/Viewer return, 100k sparse wall and all five bounded HTTP/network retry classes.
4. `places-c1-postgres-baseline.yml`: current PR SHA 10k/100k SQL query evidence and process RSS; no invented P95 target or A/B speedup. Compare measured values only under matching environments.
5. #4278 Child handshake tests remain in inherited master. Separately redeployed Child website, real Baidu Browser AK/CDN, installed Windows and production/physical device checks are **跳过（未验收）**; never treat skipped as passed.

No map JWT, raw Owner/Node/GPS, photo bytes, AK, Cookie, provider exception or
full HAR enters this report or the public test output. Do not disable TLS, CSP,
Origin/nonce or Owner authorization to make a test pass.
