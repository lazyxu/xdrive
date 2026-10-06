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
   bounded batch before yielding. If a P2 reconcile batch is still queued when a real file event arrives, the
   existing task is promoted to P1; if it is already running, P1 is retained for the next generation.
   Full batches continue immediately only when indexing made progress; a full batch with zero progress stops
   instead of hot-looping and waits for the next 30-second P2 fallback reconciliation.
4. Photo Intelligence: `Media ready -> face/place`, then `Face ready -> person-cluster(owner)` with owner-level
   coalescing.
5. FileOperation: PostgreSQL `NOTIFY` wakeup plus a fallback poll; retain `FileOperation` as the durable queue.
6. Source worker: retain `SyncRun`; integrate only resource budget, priority, and unified health/status.
7. Janitor/storage sampler: remain timer-driven; add PostgreSQL advisory-lock leader election for multi-server
   deployments when needed.

## Fairness and priority policy

`OwnerID` is scheduler attribution and the basis for per-owner fair scheduling; it is not a reason to create
per-user worker pools. Resource capacity remains system-wide. Before high-fanout user-owned consumers are
migrated, equal-priority work should gain owner fairness so one user's backlog cannot monopolize a resource
class.

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
