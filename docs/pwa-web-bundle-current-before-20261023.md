# PWA P1-01/P1-02 · Normal Web Public App Shell CURRENT/BEFORE (2026-10-23)

This independent scoped PR measures real production Vite bundle static/dynamic graphs and gzip bytes, plus cold/warm native Chromium public login App Shell at 390, 430, 899, 900 and 1280 CSS pixels (three independent browser profiles each). It is NOT the 100k logical/115k physical Go/PG17/CAS benchmark, which already has a separate source-exact baseline from PR #2368.

The runner MUST show real login DOM, reject private API reads, and archive only anonymous timing/byte metrics and exact HEAD. No Web/Mobile controller, Service Worker, Go API, IndexedDB, old-hash archive or layout changes are made. This establishes CURRENT/BEFORE only. P1-01 AFTER remains null until an actual product candidate is measured on the SAME Runner, data and network n>=3. Do not infer Web/Mobile speedup from gzip or from separate runner samples. For P1-02, trial Admin/Files/Gallery/Viewer lazy imports only when shared range, viewer return, source ACL, app frame and offline behavior remain equivalent.

The inaccessible production-only safety acceptance is skipped (unverified) per owner decision, never a code/CI gate. Real physical iOS/Android installation is NOT RUN. Keep Draft until this exact HEAD native specialty + complete CI and fresh clean mergeability pass.
