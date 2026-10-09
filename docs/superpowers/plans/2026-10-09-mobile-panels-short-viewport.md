# M11: compact filter and navigation panels

Status: completing the viable related PR #1122, head63212e43, one work commit on fixed basef693cb00. M10 supplemental PR #1125 is independently in full CI. Preserve the user-approved order and M49.V09; do not introduce global application chrome.

## Evidence and accepted design

Related PR #1122 already supplies a passive shared VisualViewport observer, Files filter/navigation bounds and a compact Gallery Drawer. Reuse that implementation. The earlier source baseline is preserved separately: Gallery31/53, Files9/10, Search7/7. These counts describe actual Chromium renderer checks, not software-keyboard certification.

The exact Files10 reproducer still reports9pass/1fail on63212e43: at844x200 and200% root text, a112px fixed header and fixed footer leave only24px of field area for a61px control. Keep the visible Close header and one bounded scroll region containing both fields and actions, so actions yield space on short screens. Preserve filter state, nested menus, Save/Clear callbacks and modal focus return. The unchanged Search7 already passes; no search-shortcut rewrite is justified.

Validate the related Gallery Drawer with the same53 checks before altering it. Repair only remaining target, semantics or clipping failures: compact controls below900 CSS px are at least44px independent of pointer type; existing horizontal navigation remains horizontal and app-owned. Keep one controlled filter draft, lazy facets, applied query/history, locks, IANA date boundaries and existing handlers. Any fixed footer that recreates the measured short-height clipping should yield into the same bounded form scroll region.

Retain the related local VisualViewport policy and verify real page-scale/offset behavior. Do not change Shell, global meta viewport or native zoom. The existing eight-sample zoom/pan observation did not reproduce an OS keyboard trap; synthetic geometry and layout-resize cases must remain explicitly distinct from physical iOS/Android keyboard acceptance.

## Implementation and validation ownership

1. Files owner preserves the exact10 and7 baseline fixtures, changes only shared FileExplorerSearchFilters presentation, and verifies nested-menu selection, scrolling to actions, Close/focus and retained input.
2. Gallery owner preserves the53 baseline, changes only shared MediaGalleryFilters/MediaGalleryNavigation presentation for reproduced gaps, and verifies real field/scroll/Apply/Close/focus and current navigation.
3. Root records the shared plan and durable evidence, validates the actual built Web App, runs normal Desktop typecheck/test:main and Web lint/build, and maintains canonical Gallery/mobile documentation and M49.V09.
4. Independent review targets remaining panel geometry, modal/focus ownership and listener cleanup risks. No speculative generation fence, new data layer or extra drag feature.
5. Keep exactly one work commit. Re-read PR #1122 state/head before its leased update; if the related implementation has merged, deliver only the necessary supplemental delta on that merged dependency. Require full PR CI, linear merge and configured cleanup; never wait for post-merge master CI.

## Acceptance limits

Physical iOS/Android, ordinary/installed modes, real software keyboards, dynamic address bars, safe areas, VoiceOver/TalkBack and actual mixed-input devices remain not-run until exercised. Chromium trusted touch, focus, page zoom and controlled resize are recorded by their actual mechanism. This work does not certify every platform capability or begin unrelated M12+ behavior changes.

## Related merge and combined supplemental delivery

PR1122 passed its full CI and merged as e9c2e6 on2026-10-09T09:05:59Z during the mounted review. It creates confirmed Files/checklist/matrix merge conflicts with the still-open M10 supplementalPR1125. Reconstruct that required M10 delta on the merged M11 dependency, preserve its visual-viewport implementation, and include the small confirmed M11 panel supplements in the same one-commit PR1125. This continues the existing related PR and avoids two conflicting implementations. Rerun the combined affected browser checks and normal gates before updating the PR; its old CI is not the final gate.

## Local acceptance complete

The final required reconstruction is on merged M12 bd96b2b1 after actual checklist/matrix conflicts. All M10 bytes from the inspected remote95a23 are retained; only the three confirmed M11 presentation changes are added. Files22, Gallery57 and built-App37 pass, with integrated Files135, Navigation162 and built-App49. NormalDesktop1594 pass/0fail/1optional skip; typecheck/lint/build pass. Final source, first-reds, full assertions and physical-device boundaries are preserved in `docs/validation/mobile-panels-short-viewport-2026-10-09.json`. Updated PR1125 full CI, merge and cleanup remain the delivery gate; no further optional retesting is required without a concrete integration change.
