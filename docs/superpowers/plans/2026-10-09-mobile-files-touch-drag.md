# M10: touch dragging and sidebar reordering

Status: integrated local acceptance and independent review complete, supplemental PR CI/merge/cleanup pending. Related PR1119 merged as f693cb00 while delivery was prepared; this one supplemental work commit now uses that exact required baseline. Final integrated implementation d9179872 preserves its existing behavior and replaces duplicate local pointer ownership. Original dependent head was M09 PR #1111 `774c4aa509372d4787869c08e59b30b3d103aafe`. After its successful merge `43426b4e`, the one M10 delta was reconstructed without conflicts onto fixed base `89b5913d44fc7c5dc083dab10094eab2434185bd`; final tested implementation is `8112026762d0c9b09c47f1ebc5fd12bc68ce9c6a`. Scope remains M10 with M49.V08. No global application chrome is introduced.

## Accepted design

Files gets a persistent44px selected-items drag handle; Quick Access and saved searches get sibling44px reorder handles. Handles alone own pointer capture and touch-action:none. Ordinary rows retain natural pan, long-press selection and normal activation. Native mouse HTML drag remains supported. Files already exposes Move/Copy To for destination selection; sidebar rows add Up/Down ordering alternatives, with readable boundaries and manual/name sort state.

A small internal pointer-presentation hook owns one immutable source, active pointer, movement threshold, local capture and one animation frame. It reports client coordinates to the owner; each owner performs real mounted-target hit tests, target acceptance and its existing business callback. Files validates the complete selected projection with selectionActionDisabledReason('move-to') before beginning, keeps existing200-root limits, and does not submit only loaded rows. Navigation copies the complete section ID list, distinguishes before/after insertion and submits its existing full-order callback once. Keep the existing Quick Access and Organization persistence behavior separate.

The same local scroll host scrolls only while an active pointer is within its visible bounds near an edge. Re-hit-test after scrolling/virtual row updates and again on release. Targets are highlighted; invalid release, Escape, pointercancel, lost capture, second pointer, navigation/session/source change and unmount cancel without mutation or residual capture/highlight/animation. A visible in-app cancel action and status support short screens, keyboard and touch. Gesture release must not activate a file or navigation row.

## Sequence and ownership

1. Preserve actual first-reds with exact source/fixture hashes. Navigation baseline has22pass/14fail/0errors: trusted touch cannot reorder and Up/Down are absent, while12 native mouse controls pass. Files owner captures ordinary-pan/long-press and native mouse positive controls plus the missing handle before implementation. This is missing functionality, not a claimed mutation race.
2. Root implements the internal pointer helper and focused real-React gesture tests; no new API, global store or mutation queue. Files and Navigation owners consume the agreed API, own their target/drop semantics and focused actual-browser fixtures, and do not edit each other's files.
3. Files owner verifies complete IDs/revisions to folder/crumb; eligibility and unavailable selection; target highlight; invalid/cancel paths; same scroll owner and later mounted destination; direct destination fallback; native row gestures.
4. Navigation owner verifies first/middle/last insertions and Up/Down equivalence, full IDs, no-op, manual/name mode, no activation, bounded autoscroll and existing failure restoration. Preserve native mouse controls.
5. Root integrates actual Web App acceptance, short landscape/200% text and mixed input, focused controller regression plus normal gates. Review only concrete remaining ownership/interaction risks.
6. Update canonical Files/mobile docs, M10 status and M49.V08 with exact before/after evidence and explicit native not-run entries. Amend the single commit, then PR CI, linear merge and cleanup.

## Limits

No backend move/reorder endpoint, source transfer contract, gesture dependency, global drag context, Gallery wall selection/reordering, or platform support claim is added. Files operation feedback/retry remains M06/M07's existing durable operation path. Album manual ordering remains M19; wall pinch/drag selection remains M21/M22. Physical iOS/Android ordinary/installed modes, OS keyboard, safe areas and screen readers remain separate not-run acceptance until actually exercised.

Files first-red is now complete: archived `fd3397c0`,24checks/22pass/2fail/0errors. Besides the missing handle, native long-press release clicks the newly appeared Move To control under its original contact point after selection chrome shifts. Preserve that exact actual compatibility-click sequence and fix only its owner-level suppression. The unchanged row pan and native900px complete-source move controls pass. Navigation baseline remains36checks/22pass/14fail/0errors with native controls. All first-red source/fixture identities remain preserved in scratch until the final ledger.

The agreed helper is internal `ui/shared/src/mui/usePointerDrag.ts`: generic immutable payload, ownerRef/scrollHostRef, enabled/scopeKey, onMove/onDrop/onCancel, supplied existing autoScrollDelta(pointerY,top,bottom), points `{clientX,clientY}`, and begin(event,payload)/active/cancel. Navigation combines drag with a plain tap/keyboard Up/Down menu under `拖动或调整顺序 ${name}`; pending press must preserve that click, and active drag must suppress its own release. Root owns helper/tests; Mobile owns Files; Platform owns Navigation; Files A reviews.

## Acceptance and remaining delivery gate

- [x] Actual missing-entry and long-press first-reds, helper compatibility-click21, sidebar target-shift36 and stationary late-target9 retained with exact fixtures.
- [x] Files135, Navigation162 and actual built App49 pass; same complete sources/orders, normal input, fallback, cancel, scroll owner and return preserved.
- [x] Independent review closed after unchanged21/9 turned green. Files refreshes the retained target only when its mounted projection commits; no polling or new queue.
- [x] Full Desktop1575pass/0fail/1existing optional skip, Desktop typecheck and Web lint/build pass on final source. Test loader and generated-config environment corrections are separated from product defects.
- [x] Canonical Files/mobile docs, M49.V08 and [durable evidence](../../validation/mobile-files-touch-drag-2026-10-09.json) updated. Physical modes/keyboard/safe areas/readers remain not-run.
- [ ] Exactly-one-work-commit complete PR CI, linear merge and configured remote/local cleanup. Do not poll post-merge master CI or retry the previously rejected GitLab direct-master action.

## Merged dependency integration

PR1119 CI37905955558 succeeded and merged2026-10-09T08:48:26Z. Both earlier FileExplorer base blobs matched; reconstruction resolves the alternative Files drag implementation explicitly. Keep the persistent full-selection handle and shared helper, preserve all80 upstream mobile browser checks, finite coordinates and hidden-document cancellation, and retain original Properties tests. The added15-hook first-red13pass/2fail becomes15pass, plus2 existing Properties checks. Final Files135/Navigation162/native21/App49 pass, along with1582 normal Desktop passes. These receipts are recorded separately under latestAcceptedIntegration; historical81120267 evidence remains intact. No physical-device claim is added.
