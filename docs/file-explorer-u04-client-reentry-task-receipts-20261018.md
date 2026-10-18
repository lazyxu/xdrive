# U04 · durable FileOperation status and Task Center receipt on Client re-entry

## Progress and baseline · 2026-10-18

F02/F03/F04 fixes and U02 [#2032](https://github.com/lazyxu/xdrive/pull/2032), U03 [#2038](https://github.com/lazyxu/xdrive/pull/2038), U05 [#2044](https://github.com/lazyxu/xdrive/pull/2044), U06/U09 [#2036](https://github.com/lazyxu/xdrive/pull/2036) all have merged source, accurate-head CI and Final Gate. U05's UTF-8/Owner/Revision real Gin tests are untouched. Frozen parent: `master@731e3469b173eeef4e9db659cc42d00fdcc18869`. This branch makes exactly one scoped work commit touching the existing Go integration test plus this document, with **no production code changed**.

## Gap and real test

Existing FileExplorer lifecycle Go integration confirms authenticated 202 Accepted does not imply successful copy/move/delete, supports queued cancellation, in-flight running cancellation and Worker terminal status. It verified initial submission Client's responses; it did not explicitly reopen a new Client and compare its GET to the durable Task Center list.

This addition calls a **fresh Client instance** against the existing true Gin/PostgreSQL/Local CAS server, before and after the following genuine operations: queued copy (zero progress), cancelled queued copy (terminal without committed bytes), completed Worker copy, completed Worker move, completed Worker delete. Every new GET must match its list row's ID/status/type/item count/processed bytes/percent/finished flag, and foreign owner's List must not show the task. A queued record is never described as finished; only actual Worker completion can be 100%.

The source test runs in the usual PostgreSQL-backed API Race CI; existing Desktop tests already verify presentation words and retry/undo state through the common Task Center and FileExplorerActionFeedback components. No second state machine, additional network poll, fake server response or modified operation worker is introduced.

## Limitations / release gate

A newly created authenticated Go Client is **not** physical Electron Agent reconnect, native platform process restart or a second physical device. Its authoritative receipt verification is genuine SQL but does not prove OS recovery, UI keyboard input, or external persistence after a machine power-cycle.

Require fresh accurate-head complete 76-job CI (Go/PostgreSQL API Race, Web/Desktop, Windows, Rootless, artifacts, one-work-commit, Final Gate) and GitHub current `mergeable_state=clean` before Ready/Rebase. If red, diagnose and reconstruct a single corrected work commit on the SAME frozen base. Never count conditional skips as passes. Physical PWA S5 remains NOT RUN / NO-GO.
