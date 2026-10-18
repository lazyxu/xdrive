# F03 Mobile Files More disabled reasons · 2026-10-18

**Current scope:** Fix an independent disabled-menu presentation gap on Mobile Web and installed PWA. This is source/CI work, NOT genuine device or screen-reader acceptance.

Previously merged F03 work explained disabled per-file long-press and batch-more items. The iOS-style **main More menu** still called `overflowAction` with a bare disabled boolean: Paste, Undo, Redo and Browser History Back/Forward appeared disabled without a reason, and this Menu did not enable keyboard navigation over disabled entries. This is a separate menu from the current Wide Web/Desktop F03 follow-up PR.

Extend only the original shared Mobile More helper with an optional caller-supplied neutral `disabledReason`. Reuse existing `xDriveFileExplorerMenuDisabledReason` and `xDriveFileExplorerMenuReasonLabel` to display a visible caption and expose a title and aria-label. Enable `disabledItemsFocusable` only on the existing Mobile More Menu. Preserve the original five disabled predicates, actions, menu size/safe-area constraints, all permission/Server business logic and iOS 27 gestures. No inferred ACL state, new API, storage, fetch, extra PWA polling or restart. Existing Browser History semantics stay distinct from folder-up and Viewer.

A new source-executed Desktop Node contract covers the five original predicates/reasons, original callback and menu keyboard state, and ensures the already-merged P57 100k sparse-row quiet placeholder remains unchanged. The source test is not a genuine TalkBack/VoiceOver announcement, hardware keyboard, 200% font, installed PWA or iOS/Android OS behavior. Those stay NOT RUN under `docs/pwa-s5-acceptance.md`.

Delivery: exactly one scoped commit frozen to latest merged P57 master; new exact-head full 76-job GitHub CI (Web, Desktop, Windows, real Go PostgreSQL API Race, Rootless, one-commit/Final Gate) and clean mergeability before Ready/Rebase. Do not modify the independent Web/Desktop command overflow F03 candidate, Gallery, Server, Agent or performance branches.


## First accurate-head CI failure and minimum correction (2026-10-18)

Initial one-work HEAD `86d7f3aa30c6ef80b4fd3450e24ab3fd6bc463c8` ran [full 76-job CI #39087443466](https://github.com/lazyxu/xdrive/actions/runs/39087443466). `desktop-tests` failed 26 preexisting, genuinely mounted MobileFiles assertions (including Browse Home/Search, Recent/Favorites, Select All, Undo/Redo, and Go-to-Path). The two NEW F03 helper/source tests passed. Root cause is the initial patch wrapping **all** `overflowAction` labels, including enabled commands, in a new Box. That unnecessarily altered direct enabled MenuItem text-child identity observed by the original mounted presenter contracts. It is an unintended code compatibility regression; do **not** weaken or rewrite 26 existing test oracles.

Correct ONLY the helper's contents: **enabled** actions once again render the exact original raw `label` child; **disabled** actions alone render the original label with its newly visible reason, title, aria-label and keyboard focus. Preserve all source, callback, permission, P57 100k, history and safe-area contracts and the two new passing tests. Recreate exactly ONE work commit against the SAME frozen `master@7ad007077773a9d1da690d2e8bf5746f7ac7967a`, update only this work branch under a HEAD lease, and demand an entirely NEW complete exact-head 76-job CI/Final Gate and clean mergeability before Ready/Rebase. The original RED result cannot authorize merge.


## Second accurate-head CI: enabled semantic name duplication (2026-10-18)

Corrected one-work HEAD `c3693c74bf1760d76aee8c55e2a0219992ca52b9` triggered [full CI #39087736058](https://github.com/lazyxu/xdrive/actions/runs/39087736058). Its `desktop-tests` improved from 26 original failures to **2** actual mounted regressions: Browse-home and Recent/Favorites global Search found **two** `aria-label="搜索全部文件"` matches instead of the original one. The new helper assigned an explicit identical aria-label even to **enabled** More commands; that duplicates the existing search control's accessible locator in the original rendered tree. No existing test was altered or ignored.

Minimum correction: preserve the original **enabled** menu's implicit accessible name from its direct string label (no new `aria-label`), and set explicit `aria-label="动作：原因"` only while the command is **disabled**. The disabled visual caption/title/keyboard focus and all original actions stay unchanged; the two Search regressions remain authoritative. Extend the NEW scoped helper test to require enabled `aria-label=undefined`. Again rebuild exactly ONE work commit on the SAME immutable parent and run a completely NEW full 76-job accurate-head CI with clean mergeability; prior partial/RED runs cannot authorize merge.
