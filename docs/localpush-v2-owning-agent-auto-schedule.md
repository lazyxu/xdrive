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

## Crash-persistent admission cooldown (follow-up)

The existing verified owning-Agent scheduler also writes one small 0600,
fsynced, atomically published cooldown observation inside the **existing**
private Root/Source Operation journal before admitting a scheduled run. It
does not hold per-file tasks, remote credentials, paths or SourceRun status.
An unchanged Owner-session/Source-revision/checkpoint is cooled down across
Agent restarts for 15, 30, 60 and at most 120 minutes on repeated admission;
this is an advisory guard against repeated failing attempts, not a retry
authority. A genuinely new, authenticated terminal `partial` checkpoint
resets the old cooldown immediately (including short 1m schedules).

Before publishing a new admission, the Agent re-opens the original private
latest-batch-run checkpoint and verifies the exact current RunID, Root,
Owner session, Source revision, terminal state, counts and timestamp. A
well-formed but unpersisted checkpoint cannot reset cooldown. Only a
*different* authenticated terminal run whose updated time is strictly later
than the prior admission can reset the old delay; changed session/revision
identifiers alone do not grant a reset.

Missing records begin a new admission window. A corrupt, symlinked, revoked
or incorrectly scoped private cooldown fails closed. Nothing changes the
`uncertain`, `paused` or `cancelled` no-auto-resume rules or infers
physical cancellation. Offline discovery still runs no faster than the
existing one-minute Agent tick; end-to-end network recovery still depends
on the verified original-Operation reconciliation.

## Multi-source fairness (same owning Agent)

The one-Source-per-minute admission bound stays in effect. Before rechecking
Source/Device/Root proof, the Agent sorts its already owner-scoped candidate
IDs by their most recent **in-process admission attempt** (oldest first),
including prior Source revisions. This prevents a frequently successful 1m
Source from starving later IDs; it does not bypass due-time, cooldown,
credentials, existing Source leases or manual-run priority. After an Agent
restart the rotation starts afresh, while the separate fsynced per-Source
admission cooldown still prevents repeated stale-checkpoint work.


## Native change notifications and periodic catch-up (watcher P1)

The existing owning-Agent timer remains the correctness fallback: roughly once
per minute it rechecks the saved explicit schedule, current Root grant, Owner
session, Source revision and independently persisted original SQL Operation
checkpoint. The actual worker always creates a fresh complete native inventory
journal and uses the existing per-file /uploads path.

Linux uses a bounded recursive native inotify subscription (at most 2,048
watched directories per Source), using 256-entry streaming directory
reads to bound memory on wide 100k-file Roots; Windows uses one recursive OS
change notification handle per Source. At most 16 Owner-private Sources per Agent
are subscribed. Missing permission, inaccessible or oversized trees, native
event loss, cancellation and overflow disable that watch and leave the
ordinary scheduled full scan intact. Events never infer remote deletion,
physical CANCEL, file contents or backup completion.

Notifications are coalesced in a single buffered wake slot and the Agent
allows at most one extra schedule probe every 10 seconds; the prior manual
batch retains priority. A wake does not bypass an explicit interval/cron
due time, paused/cancelled/uncertain checkpoint or OS/Server authorization.
A paused/offline Agent cannot promise instantaneous event coverage. The next
normal due tick re-scans the whole Root even when all native events were lost.

The watcher stores no raw Owner session or device credential, and never
accepts a renderer-supplied directory. It watches only a previously verified,
Agent-owned, strongly identified Root. Login rotation clears old subscriptions,
and Source removal from the owner-scoped device list cancels its subscription.

Required regression evidence: Linux nested file changes, invalid Root
rejection, Owner-session and Source-revision rotation, coalesced wakes,
cross-platform Go builds and true PostgreSQL API Race. Watching alone is
not a current-CAS verification or a whole-Source backup success proof.

## Transient discovery outage throttle

After a failed owning-Agent device-list or Server discovery probe, the
existing periodic scheduler keeps a separate **in-memory advisory** retry
deadline of 1, 2, 4, then at most 8 minutes. Native event storms cannot
bypass this deadline and cause repeated offline discovery requests. A fresh
successful discovery clears the penalty; explicit account/session rotation
also clears the previous Owner's penalty. No login secret or native pathname
is persisted in this throttle.

This throttle does **not** create another task queue, start or retry an
original per-file Operation, change the existing fsynced per-Source admission
cooldown, or delay the owning Desktop's explicit manual backup action.
If the Agent is stopped or an original SQL result is uncertain, reboot and
connectivity recovery still require the current immutable receipt and
authorization checks; the discovery backoff itself provides no resumption
or complete-Source certification.

Code regressions must verify the 1/2/4/8-minute cap, restart/Owner
rotation separation, success reset, no event-storm bypass and unchanged
manual, Source lease, and SQL/CAS fences.
