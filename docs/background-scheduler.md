# Background Scheduler

xDrive background work shares one execution contract without sharing one generic persisted job table.
Domain state remains authoritative in the existing models such as `FileOperation`, `SyncRun`,
`PhotoAnalysisState`, and `PhotoPersonClusterState`.

## Execution contract

`internal/background` provides process-local scheduling primitives:

- coalescing wakeups with a fallback timer for reconcile loops;
- P0-P4 priority ordering and queued-task priority promotion;
- bounded worker pools and bounded admission queues by resource class;
- optional domain-owned lease acquisition, heartbeat, and release callbacks;
- retry with bounded exponential backoff, deterministic per-task jitter, and a retry classifier;
- cooperative cancellation through task contexts;
- same-owner task deduplication with a shared completion handle;
- explicit task attribution (`Scope`, `OwnerID`, `Trigger`, `Initiator`, optional `ParentKey`);
- scheduler snapshots for queued/running and lifecycle counters.

The scheduler does not persist task payloads, mutate domain business tables, or replace domain-specific
claim/state transitions. A DB-backed adapter owns those transitions and may use the optional lease callbacks.

## Ownership and trigger attribution

Ownership and triggering are independent. Attribution is mandatory: an empty scope, trigger, or initiator is invalid rather than silently becoming a system task.

- `ScopeUser + OwnerID`: work operates on one user's data and is charged/fair-scheduled as that owner;
- `ScopeSystem`: global maintenance/telemetry work with no user owner;
- `TriggerUserAction`: an authenticated user explicitly requested the work;
- `TriggerSystemEvent`: a domain event such as file commit or media-ready state created the work;
- `TriggerSchedule`: periodic/scheduled work;
- `TriggerReconcile`: fallback repair/reconciliation discovered missing work;
- `TriggerAdminAction`: an administrator explicitly requested work, possibly for another user's data.

`Initiator` records who caused the submission (`system`, `user`, `admin`, or `service`) separately from
the data owner. For user/admin initiators, `InitiatorID` is the authenticated actor id. Authorization remains
the API/domain adapter's responsibility; the scheduler does not grant permissions.

This allows both system-triggered/user-owned jobs and user-triggered/user-owned jobs. For example, automatic
face analysis after media indexing is user-owned with a system-event trigger, while a user-requested
re-analysis is user-owned with a user-action trigger. Janitor and global storage sampling are system-owned
scheduled work.

Deduplication uses the typed identity `Identity{Scope, OwnerID, Key}`. Two users never singleflight each other's tasks merely
because a local node/revision key happens to match. A higher-priority duplicate for the same owner may promote
the queued task and its effective trigger/initiator attribution.

A request context cancelling only stops that caller waiting on a shared `Handle`; it does not implicitly
cancel the underlying deduplicated task. `Scheduler.Cancel(Identity)` is an explicit task-level cancellation
used only after the owning domain has authorized the cancellation. This distinction is important for shared
derived-cache work such as thumbnails.

## Cancellation rollout and request-scoped work

Cancellation is adopted incrementally with the subsystem being changed; it is not a mandate to perform an unrelated repository-wide retrofit. Existing scheduler/Task Center controls remain authoritative where they already exist, but a feature PR should not expand into transfers, derivatives, maintenance, or another async domain solely to normalize cancellation.

Short request-scoped work that has no durable lifecycle should not be forced into the scheduler or Task Center. In particular, FileExplorer Folder Properties recursive statistics are owned by the Properties dialog/request lifetime:

- opening Properties starts one Server-side recursive statistics request for the selected snapshot;
- closing the dialog, replacing its target selection, or unmounting the owning FileExplorer automatically aborts that request;
- Web uses `AbortController`; Desktop propagates an equivalent cancellation token through Electron/Agent to the Server request context;
- the recursive database query uses that context, so an aborted client request stops Server work rather than only discarding the renderer result;
- intentional abort is not reported as a user-visible failure, and stale completions never overwrite a newer request;
- no durable Task Center row is created for this operation.

Other asynchronous subsystems are evaluated for cancellation when they are materially touched. Shared/singleflight derivative work keeps its existing waiter/task distinction: cancelling a waiter is not automatically equivalent to cancelling the shared underlying task.

## Priority classes

| Priority | Intended work |
| --- | --- |
| P0 | user actions, visible thumbnails, manual sync, upload/download/file operations |
| P1 | media indexing and analysis previews |
| P2 | scheduled sync and face analysis |
| P3 | place analysis, person clustering, thumbnail prewarm |
| P4 | GC, integrity reconciliation, storage sampling |

Priority is meaningful within a resource class. Resource limits prevent CPU/ML work from starving
interactive I/O merely because it has pending high-priority work.

## Resource classes

- `interactive_io`: user-facing upload/download/file operations and similar latency-sensitive I/O;
- `network`: connector/network synchronization work;
- `media_cpu`: metadata extraction, thumbnails, analysis-preview generation;
- `ml_cpu`: face detection/embedding and similar compute-heavy inference;
- `background_cpu`: place resolution, clustering, and other deferrable CPU work;
- `maintenance_io`: GC, integrity reconciliation, and storage maintenance I/O.

Capacities are configuration, not persistence. The initial scheduler defaults are deliberately conservative
and consumers may provide explicit capacities when they are migrated.

## Wakeup and reconciliation

A wakeup is an edge-triggered hint, not a durable queue. Multiple signals may coalesce. DB-backed workers
must therefore wake, query their authoritative domain tables, and drain currently runnable work. PostgreSQL
`LISTEN/NOTIFY` adapters may feed the same wakeup contract, while a fallback timer remains enabled so a lost
notification never loses work.

## Lease semantics

The scheduler's lease is optional and domain-owned. The adapter decides how a lease is stored or claimed.
While a task runs, the scheduler can heartbeat the lease; heartbeat loss cancels the task with
`ErrLeaseLost`. Release is attempted with a bounded independent context so cleanup can still run after the
task context is cancelled.

This keeps distributed ownership in the existing domain model instead of introducing a second job database.

## Metrics

`Scheduler.Snapshot()` exposes bounded-cardinality counters and gauges for submitted, started, completed,
failed, cancelled, retried, deduplicated, promoted, queued, and running work, including queued/running counts
by resource class. Metrics may aggregate by bounded-cardinality scope/trigger/resource values, but must not
use raw OwnerID or InitiatorID as metric labels. Server `/metrics` integration is added when the first Server
consumer is migrated so the scheduler remains reusable outside the API process.

## Migration order

1. Shared scheduler primitives (this document and `internal/background`).
2. Thumbnail and analysis-preview generation: **current**. Cache misses use owner-scoped scheduler
   singleflight, bounded `media_cpu` workers, visible thumbnails at P0, analysis preview at P1, and
   deterministic revision-aware cache keys. HTTP request cancellation stops only that waiter; the shared
   derivative task continues for other waiters.
3. MediaIndexer: **current**. Committed `xd_files` content writes emit a PostgreSQL owner wakeup, which
   submits an owner-scoped P1 media-index batch. Bursts coalesce per owner and every generation handles one
   bounded batch before yielding. Each owner batch acquires a PostgreSQL session advisory lease keyed by
   `media.index + owner`, so multiple Server processes cannot index the same owner concurrently. Lease
   unavailability defers through the scheduler without occupying a worker; heartbeat loss cancels the current
   batch rather than continuing after distributed ownership is lost. If a P2 reconcile batch is still queued when a real file event arrives, the
   existing task is promoted to P1; if it is already running, P1 is retained for the next generation.
   Full batches continue immediately only when indexing made progress; a full batch with zero progress stops
   instead of hot-looping and waits for the next 30-second P2 fallback reconciliation.
4. Photo Intelligence: **current**. Media-index progress emits owner-scoped face/place work; face completion
   emits person-cluster(owner). Face uses P2 `ml_cpu`; place/person clustering use P3 `background_cpu`.
   Bursts coalesce by owner+kind and candidate-owner scans remain a 30-second fallback reconciliation path.
   Each `photo.<kind> + owner` generation acquires an independent PostgreSQL session advisory lease before
   entering its runner, preventing duplicate owner/kind processing across Server processes.
   User/admin reanalysis is explicit `user_action/admin_action` work and never becomes P0.
5. FileOperation: **current**. Entering durable `queued` state emits a transactional PostgreSQL
   wakeup; the worker drains with the existing `FOR UPDATE SKIP LOCKED` claim path and falls back to a
   5-second reconciliation poll if notifications are lost or the listener reconnects.
6. Source worker: **current**. `SyncRun` remains authoritative. The independent Source worker submits runnable
   Sources through the shared `network` resource budget: manual requests are P0, while retry/overdue scheduled
   work remains P2 and keeps the existing manual -> retry -> most-overdue ordering before submission.
   `SourceConcurrencyKeyer` is preserved as a non-secret account lease key; same-account work is deferred through
   the scheduler lease path and the existing PostgreSQL advisory lock, so it does not occupy a network worker while
   unrelated accounts are runnable. Connector-local rate limits, persisted Source retry/backoff, and two-stage
   `SyncRun` cancellation remain unchanged. Because the Source worker is a separate process, Server Task Center
   health/status continues to come from durable `SyncRun` rows and derives the same P0/P2 + `network` metadata;
   no cross-process generic task table or scheduler-snapshot relay is introduced.
7. Janitor/storage sampler: **current**. Both remain timer-driven. Each pass takes a short-lived, non-blocking
   PostgreSQL session advisory lease before running: one lease key for the upload/storage Janitor and one for the
   storage sampler. A non-leader Server skips only that pass and competes again on the next timer tick; the lease
   is released as soon as the pass finishes and is never held across timer intervals. Existing cleanup/GC/sample
   implementations and manual admin staging cleanup remain unchanged. The elected leader also records a durable
   maintenance-domain run with phase/progress/outcome in `xd_system_maintenance_runs`. Admin global Task Center
   projects only the latest Janitor and Storage sampler runs from this shared table; ordinary users never query or
   receive system-maintenance rows. This is cluster-aware status, not a second generic task table.

## Fairness and priority policy

`OwnerID` is scheduler attribution and the basis for per-owner fair scheduling; it is not a reason to create
per-user worker pools. Resource capacity remains system-wide.

Fair scheduling is now enforced inside each resource queue in this order:

```text
ready / eligible
  -> priority
  -> owner round-robin
  -> FIFO within that owner
```

At a given priority, queued work is grouped by `Scope + OwnerID`. Active owner buckets are visited with a
work-conserving round-robin; a user with a large backlog therefore cannot monopolize equal-priority capacity
ahead of another ready owner. System-scoped work forms one system bucket and preserves FIFO inside that bucket.
Priority remains strict: owner fairness never lets P2 work jump ahead of ready P1 work. Delayed retry/lease work
does not consume a turn while it is not ready; once its delay expires it immediately re-enters normal
priority/fairness selection instead of remaining behind later-arriving ready tasks.

A user trigger does not automatically mean P0. Visible/interactive work may use P0, while expensive manual
bulk rebuilds remain bounded background work. Priority, resource class, and owner fairness are separate policy
dimensions.

`ParentKey` is optional causal metadata for chains such as `file commit -> media -> face/place -> cluster`;
it is for tracing/health and does not replace persisted domain lineage.


## Admission, expiry, and supersession

Every resource class has both a worker capacity and a bounded queue capacity. A new non-deduplicated task
that cannot be admitted returns `ErrQueueFull`; durable adapters leave the authoritative business row queued
and rely on wakeup/reconcile to submit it later. A duplicate may still join an already accepted task even when
the queue is full.

`NotAfter` allows latency-sensitive queued work to expire before execution. `RunTimeout` is a per-task
execution limit and is not a global timeout. `SupersedeKey` removes older queued work for the same
`Scope + OwnerID` when a newer revision makes it obsolete; already-running work is not force-killed and the
consumer must still fence stale results by revision/fingerprint before commit.

## Retry and lease deferral

Retry backoff applies deterministic per-task jitter so many failures do not wake at exactly the same instant.
Explicit cancellation suppresses retry. Lease unavailability is a defer signal rather than an ordinary
failure: the scheduler requeues it after the configured lease retry delay without consuming the execution
attempt. Lease loss is a distinct terminal signal and is counted separately.

## Causal metadata

`ParentKey` and `TraceID` are optional observability metadata for chains such as
`file commit -> media -> face/place -> cluster`. They do not form a generic persisted DAG and do not replace
domain lineage.

`SupersedeKey` is separate from the deduplication key: deduplication means "the same concrete result is
already in flight", while supersession means "a newer revision makes an older queued result unnecessary".


## Media derivative consumer

The first Server consumer is thumbnail / analysis-preview generation. Cache hits remain direct reads and do
not enter the scheduler. Cache misses submit user-owned tasks keyed by derivative kind, node, revision,
content SHA, edge, and derivative version. Thumbnail requests are P0 user actions; analysis-preview requests
are P1. Analyzer ticket requests are system-event/service initiated but retain the photo owner as `OwnerID`.

The worker writes only deterministic derived-cache objects. Waiters do not receive large JPEG payloads through
the scheduler handle; after successful completion they reopen the shared cache object. This preserves
singleflight while keeping task results small and allows one HTTP request to disconnect without cancelling
work still needed by another waiter.

A saturated `media_cpu` queue returns service-unavailable with retry guidance. It never falls back to
synchronous image decode/resize/encode on the request goroutine.


## Event-driven MediaIndexer

Normal media indexing is commit-driven. A PostgreSQL trigger on `xd_files` emits the owning user id after a
file-content INSERT or content-changing UPDATE commits. This covers multipart upload, chunk finalize,
overwrite, version restore, copy, and sync-folder writes without adding enqueue calls to every API path.

The listener converts that hint into an owner-scoped scheduler request:

- `ScopeUser + OwnerID`;
- P1 / `system_event` for committed file-content wakeups;
- P2 / `reconcile` for the 30-second fallback scan;
- `media_cpu` resource class;
- one bounded batch per owner generation.

Repeated notifications while one owner is already running set a pending bit instead of creating one task per
file. If a batch fills its limit, another generation is submitted after the current generation yields. This
keeps large imports moving while allowing visible P0 derivative work and other owners to enter the shared CPU
pool.

PostgreSQL `NOTIFY` is deliberately only a wakeup hint, not durable job storage. Lost notifications, listener
reconnects, server restarts, rename-only node revisions, and old analyzer/index versions are recovered by the
same stale-state query every 30 seconds. Existing media/domain tables remain the source of truth.


## Background task status/control read model

The server exposes background work as a read model without introducing a generic persisted task table.

- Scheduler-owned work contributes only its current in-process queued/running snapshot.
- Durable `FileOperation` and `SyncRun` rows remain their own sources of truth and contribute recent
  instance-level progress/history.
- High-frequency scheduler work is grouped by `owner + kind` so thumbnail, preview, media-index and future
  face/place micro-jobs do not create thousands of Task Center rows.
- `GET /api/v1/background-tasks` returns only the authenticated user's work.
- `GET /api/v1/admin/background-tasks` returns the global user/system view and requires the admin role.
- Every item includes server-derived `control_actions`. Clients must not infer permissions from role or task
  kind. Cross-user admin controls are deliberately empty until the corresponding domain explicitly defines
  and authorizes them.

Scheduler runtime tasks expose `kind`, state, owner attribution, trigger/initiator, priority/resource,
timestamps, and optional progress reported with `background.ReportProgress(ctx, progress)`. A queued task
that is deferred because another Server owns its distributed domain lease exposes phase
`waiting_for_cluster_lease`; the Web/Desktop shared Task Center renders this as “等待其他服务器”. Runtime entries
are removed after completion; history belongs to the durable domain models, not to the scheduler.


## Photo Intelligence consumer

Photo Intelligence no longer runs independent busy/idle polling loops. Each owner/kind is scheduled through
the shared Background Scheduler:

- `photo.face`: P2 / `ml_cpu`;
- `photo.place`: P3 / `background_cpu`;
- `photo.person_cluster`: P3 / `background_cpu`.

A media-index owner batch that produces new/updated PhotoAssets requests face/place work. A face batch that
processes candidates requests a person-cluster rebuild for the same owner. Repeated events coalesce while a
generation is queued/running. Candidate-owner scans every 30 seconds remain the correctness fallback for
lost events, process restarts, analyzer-version changes, and retry eligibility.

Users may explicitly request reanalysis with `POST /api/v1/photo-intelligence/reanalyze`. Administrators may
request the same derived-state rebuild for a specific active user with
`POST /api/v1/admin/users/:id/photo-intelligence/reanalyze`. Manual reanalysis is a durable owner+kind intent
in `xd_photo_intelligence_reanalyze_intents`: the API atomically advances `requested_epoch` before returning
202, then scheduling is best-effort. Startup and the 30-second reconcile scan recover any
`requested_epoch > applied_epoch` row after queue pressure or Server restart. Only a generation that has
acquired the distributed owner/kind lease consumes the intent: it invalidates the corresponding derived state
and then advances `applied_epoch`. A newer request arriving during invalidation therefore remains pending for
the next generation instead of being lost or overwritten by an older task.

Photo Intelligence and MediaIndexer expose owner cancellation through the same background-task control
contract. Cancellation is durable in `xd_background_runtime_cancel_intents`: an owner+kind cancel epoch is
advanced before the API returns 202, each submitted generation captures the current epoch, and a generation
whose captured epoch is older than the durable request terminates before work or through the distributed
lease heartbeat. If no Server currently owns the advisory lease, the cancel request is finalized immediately;
otherwise the lease-holder finalizes it after the runner stops. Photo Intelligence cancellation restores
persisted `running` analysis/person-cluster state to `stale` before acknowledging the cancel epoch, and it
only acknowledges reanalysis intent that existed when cancellation was requested, so a newer reanalysis
request is never swallowed. Queued/running cancellation therefore remains correct across Server processes,
restart, and missed in-process state. Web/Desktop render the same server-derived `cancel` control and
`cancel_requested / cancelled` lifecycle through the shared Task Center.

Thumbnail and analysis-preview work are deliberately excluded from owner-group cancellation here. They use
shared/singleflight derivative tasks, so cancellation must be consumer-aware: one viewer may detach without
terminating an underlying derivative still required by another consumer. That contract is handled together
with cross-Server derivative singleflight rather than by cancelling an entire owner group.
