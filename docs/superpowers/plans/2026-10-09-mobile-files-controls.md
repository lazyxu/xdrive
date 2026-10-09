# Mobile Files controls implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement the ordered tasks and `superpowers:requesting-code-review` for the final independent review.

**Goal:** Complete the first three user-approved Mobile Web follow-ups: a single visible browsing context without tabs, usable location targets, and reachable structured filters/clear/save-search.

**Architecture:** Extend the existing shared MUI FileExplorer and its navigation/filter components. Keep the active shared navigation workspace and its committed history; a compact viewport hides tab chrome and disables tab commands without destroying desktop workspaces. Keep Server Search and platform adapters unchanged.

**Tech Stack:** React 18, MUI 7, TypeScript, Node behavioral tests, Playwright Chromium.

**Spec:** User request on 2026-10-09; `docs/mobile-web.md`, `docs/file-explorer.md`, and `docs/web-app-runtime.md` remain normative.

## Global constraints

- Mobile apps occupy the complete available dynamic viewport below 900 CSS px; no global header/footer or reserved spacer.
- Single-context/tab presentation follows the width boundary, including a mouse or keyboard attached to a phone. Touch item activation remains based on the actual input event.
- Touch controls have actual targets of at least 44 × 44 CSS px. Expansion and navigation are independent controls.
- Preserve wide-screen tab/session state, selection/open semantics, column widths, pane widths, and density preferences.
- Search remains Server-backed. No client-only filtering of retained VirtualCollection pages.
- The work branch keeps exactly one work commit on fixed base `6d48604dd9948cd7d14ceb00a4921d282155a247`; changes are amended into it.
- Native iOS/Android, installed-mode, keyboard and assistive-technology results are recorded separately from Chromium emulation.

## Review focus

- A keyboard or middle mouse button must not switch to an inaccessible tab in a narrow viewport.
- A wide-screen menu open during a responsive transition must not retain hidden tab commands.
- Deep tree indentation and long names must not shrink the expansion or navigation targets below 44 px or cause horizontal document overflow.
- A filter menu must restore focus inside the filter panel; panel dismissal must close nested menus and restore the trigger.
- Short landscape, enlarged text and an already-open selection toolbar must leave close, clear and save actions reachable.

## Task 1: Single mobile browsing context

**Files:** `ui/shared/src/mui/FileExplorer.tsx`; `desktop/tests/shared-file-explorer-mobile-view.cjs`; `desktop/scripts/file-explorer-controls-browser.{cjs,tsx}`.

**Interface:** Existing tab callbacks remain unchanged; a width-derived presentation flag controls rendering and dispatch. No navigation-state schema change.

- [x] Observe failing rendered tests for tab chrome and tab commands below 900 px, with wide-screen controls preserved.
- [x] Hide tab chrome and suppress tab creation, switching, restoration, middle-click and tab menu entries in the mobile presentation.
- [x] Verify active directory/caller identity survives narrow → wide → narrow and wide callbacks remain usable.

## Task 2: Location panel touch targets

**Files:** `ui/shared/src/mui/FileExplorerNavigationPane.tsx`; the same browser runner.

**Interface:** Keep existing `onNavigate`, expansion, Quick Access, Favorites, saved-search and tag callbacks. Resize both CSS grid tracks and actual buttons.

- [x] Measure and record baseline target rectangles; tap expansion separately from directory entry.
- [x] Make mobile expander/secondary targets 44 × 44, navigation rows at least 44 px high, and cap touch indentation to preserve room for names and navigation.
- [x] Verify every enabled visible location action, no expansion-triggered navigation, close/focus and short-landscape scrolling.

## Task 3: Mobile structured filters

**Files:** `ui/shared/src/mui/FileExplorer.tsx`, `ui/shared/src/mui/FileExplorerSearchFilters.tsx`; the same browser runner.

**Interface:** Reuse `commandBarEnd`, `filters`, `onChange`, `canSaveSearch`, and `onSaveSearch`. The filter component has exactly one mounted presentation for the active toolbar.

- [x] Observe that the baseline has no reachable filter trigger in compact touch.
- [x] Expose a bounded trigger with active count and a shared mobile panel for current conditions, per-condition clearing, clear-all and save-search.
- [x] Verify type/time/size/sync-folder/tag changes use the supplied Server Search controller callbacks; dismissal and resize close nested surfaces safely.
- [x] Check 360/390/430/844-landscape/899/900 widths, enlarged text, keyboard focus, and desktop filter behavior.

## Completion

- [x] Run relevant behavior tests, complete Desktop `test:main` and typecheck, Web lint/build, shared Files browser acceptance and whole-Web fullscreen regression.
- [x] Record actual measurements and native-device pending items in the canonical docs and approved follow-up inventory.
- [x] Independent branch review; four actual findings reproduced and resolved.
- [ ] Amend the single work commit and deliver through the repository PR gate.

## Continuation

The next ordered slice is search scope/conditions/clear/result location/return, followed by sort/view state, batch operations, operation destination/conflict/retry and organization discovery. The remaining user-approved Gallery, Viewer, transfer, share, platform and accessibility work stays in the ordered inventory; this first slice does not claim those items are complete. During validation, PRs #1085 (Gallery same-item sorting), #1087 (organization mutation races) and #1083 (transport cancellation) merged independently. Their changes retain separate ownership; this branch remains on its selected base unless a real merge conflict requires reconstruction.
