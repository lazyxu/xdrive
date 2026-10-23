# xDrive Push Runner v2 — Agent-only automatic incremental scan

## One pipeline, no second queue

The owning Windows/Linux Agent schedules the **same** manual v2 worker:
verified native Root scan → immutable per-file original Operation journal →
ordinary `UploadSession/chunks/finalize` → authenticated SQL/CAS receipt →
subsequent incremental scan. This does not activate the generic Server Source
worker, create a new CAS writer, delete originals, or grant foreign devices
write access.

## Opt-in and arming

Automatic runs require **all** of the following:

1. An authenticated locally enrolled device and current, strongly verified
   Root grant bound to the same Owner/Device/Source.
2. A saved explicit `interval` or five-field `cron` schedule read through
   the private owning-Agent proof endpoint. Unset or `manual` never runs.
3. One earlier **manual** v2 batch for the same Source revision and current
   Owner session with a durable private checkpoint in state `partial` and
   zero uncertain files. This checkpoint is per-file history evidence,
   **not** `backup_complete` or a current physical CAS verification.
4. A due time computed from that private checkpoint's last update and the
   normalized schedule, including the configured IANA timezone for cron.

Saving or modifying a schedule increments Source revision. Run the current
Source revision manually once to arm the new policy. Rotating Owner sessions,
invalidating the Root, missing/corrupt checkpoints, status `running`,
`uncertain`, `paused` or `cancelled` all disable automatic admission until
a safe explicit manual run. The same applies after crash until the original
Operation can be reconciled.

## Bounded local execution

The Agent checks approximately once per minute while it is running. It reads
only its own device's owner-redacted, keyset-paginated Source identifiers,
rejects incomplete/malformed pages, rechecks all private Source/Device/Root
credentials and current Source revision, and starts **at most one** Source
per tick. A previously running manual batch wins. A 15-minute in-process
attempt cooldown prevents repeated failing admission attempts.

No guarantee is made for an offline, suspended or disabled Agent. A delayed
tick may trigger the next eligible scan after restart; it does not assert that
an exact wall-clock time was serviced. The current schedule must never be
confused with Server active-run semantics.

## Required checks

- Linux/Windows Go and UI source-contract tests.
- Owner/device pagination, malformed cursor, disabled/manual schedule, invalid
  interval, cron timezone, stale Source revision and non-successful checkpoint
  negative cases.
- Real SQL/CAS original-Operation, crash and ACK-loss tests remain owned by the
  base Push Runner; do not mock their physical success or weaken the boundary.
- No Mirror delete, NAS Push, remote Desktop writing, whole-Source completion,
  or current physical CAS certification.

Production-only inaccessible validation: **按用户决定跳过（未验收）**; this
does not replace code-level security and exact-head CI checks.
