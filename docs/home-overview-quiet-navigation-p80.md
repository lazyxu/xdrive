# P80 · Home overview verified-first lists without timer-driven loading frames

Date: 2026-10-18. Frozen baseline: `f27ac68170a3010f8caf0b6f599d28c7e01481da`.

## Source-exact defect and correction

The original shared Home page rendered a 300ms-deferred `正在读取列表…` loading panel inside unverified Recent/Favorites list cards. A fast GET was silent but a slow GET acquired a visually different intermediary; the user had explicitly rejected this pattern for ordinary app or directory navigation. The Web owner had already implemented current-account, authenticated ready/error list receipts. This UI must never invent progress for the first list read.

P80 deletes the visual-only timer hooks and loading panel from **only** `ui/shared/src/mui/HomePage.tsx`. The two unverified list surfaces are immediately and permanently silent, reserve the same 96px inner area, and expose truthful `aria-busy` before a request and while awaiting verification. Real terminal error remains visible, accepted zero gets an equal-height quiet result area, and previously accepted items remain mounted during refresh. Both cards retain the 160px outer minimum, headings and actions, and existing network thumbnail provider.

## Validation and scope

The existing original Home source contract now rejects navigation-only spinner/timer text; a **new test mounts the original React HomePage.tsx** with its existing props under idle, fast/held >350ms, failed, verified zero and accepted-row refresh. It asserts two 96px slots, no StatePanel, truthful semantic busy and preserved actual thumbnail child. The same original Web/Desktop API, 52px App Frame, account-specific list acceptance, real media fetching and operations are unmodified.

This PR intentionally does not touch the active P79 Mobile Trash files/AGENTS notes, Gallery A3 map/Live Photo, API/Agent, 100k performance, security or Go race branches. Require a new exact-HEAD full CI/Final Gate before merge. Physical native iOS/Android, installed PWA, WAN/100k CLS or FPS tests remain **NOT RUN**; original mounted tests and CI do not establish physical zero-jitter acceptance.
