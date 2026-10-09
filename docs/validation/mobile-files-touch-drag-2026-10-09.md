# M10 — Mobile Files touch drag and destination feedback

Date: 2026-10-09. Repository: lazyxu/xdrive.
Pinned master baseline: fa722fbd09f32b29be268c63dab63957de007863.
Only Files touch-moving into a directory or breadcrumb is in scope; manual album ordering remains M19.

The existing Desktop HTML5 DnD and the explicit "移动到 / 复制到" picker remain unchanged. Native scrolling on an ordinary file row and the existing 450 ms touch long-press selection must continue to work. A dedicated 44 CSS px handle is touch-action:none so a drag cannot hijack a normal vertical scroll. Target IDs are resolved from current logical list indices rather than stale raw DOM identities, using the existing copy/move operation controller for commit and conflict handling. Source snapshots must keep complete selected items; self-drop is rejected; disabled/missing targets do not dispatch.

Acceptance contracts:
- desktop/tests/file-explorer-touch-drag.cjs — pure threshold/target identity tests and source wiring.
- desktop/scripts/file-explorer-mobile-browser.cjs — trusted CDP touch gesture, selection, target highlight and cancelling (manual actual-browser runner where Playwright is installed).
- Existing desktop/tests/desktop-file-explorer.cjs, file-explorer-selection-actions.cjs and file-explorer-mobile-browser.cjs must not regress.
- Full Desktop typecheck/main test, Web lint/build and GitHub PR CI govern merge. User-environment iOS/Android, installed/tab, VoiceOver/TalkBack are NOT RUN unless separately recorded.

Tracking: docs/mobile-web-followups.md item M10 and docs/mobile-web-platform-matrix.md M49.V08. Do not count source assertions or CI alone as native gesture certification.

## Supplemental integration after merge

PR #1119 passed full CI37905955558 and merged as f693cb00. The supplemental shared-helper implementation keeps this contract, consolidates the local row-handle mechanism into a persistent complete-selection handle, adds sidebar ordering, and retains the upstream real-browser scenarios. Exact integrated first-reds, source hashes and1582 normal test passes are in [the durable JSON ledger](mobile-files-touch-drag-2026-10-09.json), latestAcceptedIntegration. Physical-device acceptance remains pending.

## M11/M12 dependency integration

The final combined source53177a7b retains the independently updated PR1125 remote95a23 M10 bytes and the merged M11/M12 foundations. Files135/Navigation162/actualApp49 were repeated successfully; fullDesktop1594pass/0fail/1existing skip, typecheck/lint/build pass. Its three M11 presentation supplements also passFiles22/Gallery57/actualApp37. The JSON ledger's `combinedPanelIntegration` records the exact build and preserves all historical evidence. Full updated PRCI and merge remain pending.
