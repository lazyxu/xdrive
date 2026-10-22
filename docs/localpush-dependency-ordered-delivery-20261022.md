# xDrive Push Runner — Seven-stage dependency-ordered delivery (2026-10-22)

This is the canonical remaining-work execution order. It supersedes historical statements that all local Push execution is disabled: merged #2212 already provides a real explicitly started **owning Windows/Linux Desktop Backup-only, first-level single-file 0–64 MiB** upload. That one-shot path does **not** authorize a trusted terminal record, key retirement, another file, SourceRun, or automatic backup.

## Stage 0 complete — merged exact-head evidence (2026-10-22)

| PR | Final tested feature HEAD | Final exact-head CI / Final Gate | Rebase-merged master commit |
| --- | --- | --- | --- |
| [#2319](https://github.com/lazyxu/xdrive/pull/2319) | `b50b3988a49417005b39859267d164bae3585c21` | [#39713842949](https://github.com/lazyxu/xdrive/actions/runs/39713842949): 77 jobs, 25 success/52 conditional skip, Final Gate success | `c5576bcac9a96463a54b3b27f0deccf1f31719ae` |
| [#2327](https://github.com/lazyxu/xdrive/pull/2327) | `384cd7ad6c7dfd3ea58e7c20830c519c7b0c542f` | [#39715737651](https://github.com/lazyxu/xdrive/actions/runs/39715737651): 77 jobs, 25 success/52 conditional skip, Final Gate success | `f52c3373bc0f8f0f10719ce10073e674fd239da0` |
| [#2332](https://github.com/lazyxu/xdrive/pull/2332) | `afcbae41c79ce52763f39ce5edd76d9babcd9a0e` | [#39731593817](https://github.com/lazyxu/xdrive/actions/runs/39731593817): 77 jobs, 25 success/52 conditional skip, Final Gate success | `8292d1565a3158fd15a14f2bae41663662bdff34` |

As of the third merge, master is `8292d1565a3158fd15a14f2bae41663662bdff34`; the original feature branches were no longer returned by the repository's LocalPush branch search. The three production code scopes respectively harden the original Writer recovery marker, add an **UNROUTED** SQL/CAS-held private precommit hook and hold an Agent-native live Writer lock across the already-active one-file HTTP callback. None adds trustworthy Server physical file-terminal INSERT, physical CANCEL, Stage/key retirement, second-file admission or automatic backup. Stage 1 below is the next coding gate.

## Earlier tested candidate CI (historical, not final merged HEAD)

| PR | Tested HEAD | Verified CI | Actual scope |
| --- | --- | --- | --- |
| [#2319](https://github.com/lazyxu/xdrive/pull/2319) | 8a5a40d6300c5d15eacde5de0ac21505f7887704 | [77 jobs](https://github.com/lazyxu/xdrive/actions/runs/39708308207): 25 success, 52 conditional skipped, Final Gate success | Read-only post-read original Writer marker inode and parent identity hardening |
| [#2327](https://github.com/lazyxu/xdrive/pull/2327) | 67bf759f82e5516a772a8fdc47f1627d3423c3d6 | [77 jobs](https://github.com/lazyxu/xdrive/actions/runs/39708534236): 25 success, 52 conditional skipped, Final Gate success | Original Operation SQL/CAS-held **private** precommit hook with test-only synthetic terminal; no production caller |
| [#2332](https://github.com/lazyxu/xdrive/pull/2332) | d2a2df02691d92f9d822fe5614c899264d23a2b9 | [77 jobs](https://github.com/lazyxu/xdrive/actions/runs/39709650234): 25 success, 52 conditional skipped, Final Gate success | Live original native Writer lock held across existing first-file HTTP CAS/SQL path; not a Server physical terminal |

At audit time the complete master was e5bf867b79dcb78d8a80e6194c971136eba12289, after the PRs' tested parents. Each CI is evidence for that *exact* PR SHA, not a different reconstructed commit. Recheck live master before each merge.

## Stage 0 — Close three existing PRs, serially (completed 2026-10-22)

1. Inspect current master and the precise PR HEADs, compare changed files including Go/SQL/native interfaces, go.mod, migrations, security tests, workflow changes and cumulative AGENTS.
2. Prefer reuse of successfully tested source HEAD and clean rebase merge where truly source-compatible. If necessary, reconstruct exactly one feature commit on a complete fresh master retaining all unrelated work and all existing AGENTS history; never overwrite another owner's files or misattribute old CI to a new SHA.
3. Resolve and merge #2319, then #2327, then #2332 subject to required checks, source compatibility and fresh mergeability. Remove branches only after actual merge/obsolescence is verified; preserve active PR branches. None of these merges unlocks file #2.

## Stage 1 — Real same-file terminal and durable recovery (P0)

- An owning native Agent must transmit trustworthy current OS Writer Claim and original open-fd evidence to Server via authenticated Device, Root, Owner/session, Source revision, immutable Stage, original Operation UUID/generation, private key binding and CAS identity. Never accept a renderer-, Web- or caller-supplied path/digest as authority. No private evidence leaves trusted Agent/Server domains.
- Record physical-commit on the original Operation only while the original SQL UPDATE / Source / Stage locks and the actual pinned physical CAS proof hold, in one SQL transaction. The existing private precommit hook must gain an independently verified production caller, not merely synthetic insert tests.
- Record physical-cancel-quiesced only after actual native writer quiescence and exclusion of competing writes. HTTP cancel, lease expiration, crash, missing ACK and timeout are NOT quiescence. Enforce mutually exclusive COMMIT/CANCEL under the same operation and preserve UNCERTAIN instead of inventing a decision.
- Replay the same original Operation idempotently after lost ACK, Agent/Server crash and SQL/CAS boundary failures without a duplicate Node, FileVersion or commit. Test real PostgreSQL/CAS, race, Owner/Device/Root revoke, wrong key/Stage, CAS missing/GC, A-B-A native inode change, concurrent terminal and canceled contexts. Only then claim trustworthy *one-file* terminal.

**Stage 1 partial hardening (2026-10-22):** Once the bounded first-leaf coordinator attempts original Operation `Prepare`, a lost/rejected ACK, malformed original Operation response, or canceled caller after reservation is conservatively reported as `UNCERTAIN`. The in-memory Source remains quarantined, the original key/Stage stays in place, and no second Commit/generation is launched. Original error identity remains inspectable through `errors.Is`. This is only fail-closed reporting, **not** authenticated Agent→Server native proof, physical-COMMIT/CANCEL or cross-process replay, and does not unlock Stage/key retirement or file #2.

## Stage 2 — Retire and re-admit Stage/Key/Writer (P0)

- Design durable monotonic terminal → retirement eligibility → private key revocation → Stage/Writer claim cleanup → new-generation admission, with idempotent checkpoints and safe retry if any cleanup step crashes.
- Do not retire on ACK alone, empty heartbeat, timeout or synthetic terminal. Never delete local source bytes. Distinguish uncertain, quarantined, retired and admitted states. Prove two different files can complete sequentially and that first-file CAS/FileVersion remains immutable under crash and contention.

## Stage 3 — Complete multi-file incremental Runner (P0/P1)

- Use the two-generation native inventory and durable identities for nested folders, new/changed/renamed/moved files. Keep unreadable or absent Root distinct from a reliable deletion. Bind each file to a durable Operation, SourceItem/Node, FileVersion and immutable target; handle duplicate and replay safely.
- Add resumable chunked streaming for large files, per-file exact checkpoints and bounded global/Source concurrency with backpressure. Do not buffer 4 GiB in memory; support physical CAS dedup with owner isolation and version history.
- Acceptance: real bounded ephemeral Postgres/CAS + authenticated Agent path processes a multi-level tree including add/edit/move and restart. Do not call current one-shot first-file loop a multi-file Runner.

## Stage 4 — SourceRun and local-only control (P1)

- Expose persisted Run lifecycle: start, scanning, running, pausing, paused, resuming, canceling, canceled, failed, uncertain and succeeded with accurate per-file/byte progress, durable history and audit. Pause/continue and cancel must obey the actual writer fence/Go context; partial progress never becomes backup_complete.
- Only the bound owning Desktop/Agent controls Push; other Desktop and Web/Mobile retain B-level read-only device/run views. Reauthorize Owner/Device/Root/Source revision for every mutation. Pull remains a distinct top-level app.

## Stage 5 — Automatic synchronization (P1)

- Use filesystem watcher as a hint plus bounded interval/cron reconcile. Saved schedule preferences are not execution until true Runner+SourceRun pass their gates. Coalesce events; resume safely after offline, device sleep, unplug and reboot.
- Root unavailable/unreadable does not imply deletion. Backup first; Mirror still requires independently proven double-complete missing evidence, time grace and trash-only semantics. Do not add remote/NAS Push.

## Stage 6 — Automated non-production E2E, performance, security and branch cleanup (P1/P2)

- Real ephemeral PostgreSQL + physical CAS, authenticated native Linux/Windows Agent→Server, Desktop and fault injection: 1k/10k/100k mixed trees, nested/moved files, large resumable 1–4 GiB bytes, checksum, lost ACK at every boundary, SIGKILL, reconnect, A-B-A, physical cancel, concurrent contenders, revoke, and restricted IPC/HTTP.
- For any performance modification: capture a reproducible BEFORE under matched data/hardware/concurrency/network, optimize a demonstrated bottleneck, capture AFTER, retain only clear gains. Track scan/scheduler overhead, bytes/sec, wall time, memory, SQL/CAS IO and cancellation resource release.
- Preserve previous independent PRs and merged source. Close/delete only demonstrated merged/obsolete branches; do not delete active work. Follow master snapshot/edge versus v* tag stable release policy without misrepresenting unfinished features.

## Permanent test and reporting rules

**Production-environment security acceptance: 按用户决定跳过（未验收）**. Never request production access, credentials, accounts, AK/JWT/Cookie/HAR, production captures or manual sign-off; this does not block source implementation, CI or PR merges, and is never described as passed. Keep code-level and controllable non-production Owner/Device/Root/native/SQL/CAS security tests mandatory.

Follow AGENTS.md: actual compatibility and risk determine whether full CI must repeat after master moves. A *new SHA* is never claimed to have passed an *old SHA's* CI. In every continuation report current master/PR heads, merged items, remaining gaps, executed test evidence, and honest limits before making changes. Execute the seven stages in dependency order, not 50 independent parallel items.
