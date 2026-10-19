# P94 · Global Storage diagnostic first-read stability (2026-10-19)

Real source audit found three short-lived `正在加载…` panels when expanding staging cleanup failure details, unreferenced CAS Blobs, or legacy objects. They can displace the final records and the failed staging list can imply unconfirmed “first 0” before the Server replies. Accepted Legacy/GC rows also had an in-flow progress row inserted on pagination.

This scoped change uses silent 160px regions from before-first-GET through held responses, truthful `aria-busy`, same-height terminal error with 44px Retry and no invented empty state. Cursor, 20-item pages, Owner data scope, accepted list rendering and genuine pagination loading remain unchanged; further pages retain accepted records without an extra spinner row. No real bytes, thumbnail, upload, download, sync/maintenance task, backend, Agent or cancel behavior changed.

Regression: `desktop/tests/storage-diagnostics-quiet-first-read-p94.cjs` checks actual original source, three cold/error/retry branches and pagination wiring. Require new exact-HEAD full CI. This is source/testing coverage only: original-component fully mounted integration, real browser widths, physical Safari/Android/PWA, WAN/100k CLS/FPS remain **NOT RUN** and release parity is not established.

The three diagnostic AccordionDetails use **192px outer minimum height and 16px vertical padding** around the unchanged 160px content slot, so the initial/failed/short accepted states share the same minimum box instead of shrinking by the Accordion padding.
