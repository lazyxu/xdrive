# L03-G0-A2b2b2b — owning-device private operation abort and observe transport

**Scope:** Strict Agent-only Go Client and Server HTTP contract for the
existing private Local Push reservation state machine. This follows merged
#1986 (authenticated idempotent prepare). It is a protocol prerequisite, not
a production backup Runner or SourceRun control feature.

## Transport

Two new endpoints share the exact current owning-Device, approved Root,
session, paused local_folder/push Source and If-Match revision authorization:

- `POST /api/v1/sources/:id/local-operation/observe`
- `POST /api/v1/sources/:id/local-operation/abort`

A route-scoped `localPushOperationNoStore` middleware runs **before** the
owning-device authorization middleware on prepare/abort/observe so even
an otherwise cacheable 403/404 issued before the operation Handler is marked
`Cache-Control: private, no-store`. The common JWT middleware remains an
independent earlier authentication boundary.

The body is a bounded (256-byte) strict JSON object with exactly a canonical
UUID `operation_id` and nonzero `generation`. Neither field is a bearer
capability; they are selectors checked against the latest matching Source
generation, current Owner, unrevoked device secret, exact Root fingerprint
and target INSIDE the existing PostgreSQL transaction. Queries, unknown
fields, trailing JSON, malformed UUIDs, wrong Content-Type and stale/missing
If-Match are rejected. Only `POST` is used so the operation ID never
enters a URL, browser history or access log.

`observe` returns only the latest exactly identified generation as
`reserved`, `aborted`, or `expired`. It uses PostgreSQL time and
a bounded READ-ONLY transaction, never changes a reservation, Source,
original File, Blob, Node, SourceItem or SourceRun. A previously aborted
generation remains observable after lease expiry only while it is still the
latest generation and all owning authorization remains valid.

`abort` uses the existing Owner -> Device -> Source -> Root write locks,
can mark only the exact latest **unexpired** reservation aborted and permits
an exact live retry. An expired operation cannot be aborted or resurrected;
the client may `observe` it as expired. Old generations and device
revocations always fail closed. An abort is NOT cancellation of durable
physical bytes, uploading, the native filesystem or any SourceRun.

Success is HTTP 200 with `ETag` matching If-Match, `private, no-store`,
source ID, revision, same operation UUID/generation and only the state plus
four mandatory `false` authority fields: `commit_supported`,
`backup_complete`, `authoritative`,
`missing_inference_safe`. The private Client result is `json:"-"`
on every field and explicitly rejects changed identifiers, inconsistent
states, missing/positive flags, cacheable responses, unexpected fields,
oversized responses and missing revision fences. Transport errors never
promote a guessed successful cancellation.

## Validation and outstanding work

Real authenticated Gin HTTP on two independent isolated PostgreSQL17
connection pools exercises live observe, aborted readback, replay,
cross-pool generation progression, stale/foreign UUID, foreign owner,
forged device/Root, revoked device, missing/stale revision, strict
JSON, expired SQL clock and absence of any new cloud Node, SourceItem or
SyncRun. Go Client HTTP tests reject malformed and forged Server replies
and verify the actual owning-Agent proof headers; Desktop source guards
prove no Web/Renderer/Main/Preload/Agent HTTP/IPC or production scheduler
consumes this operation status protocol.

One exact-head work commit above the frozen GitHub master and full PR CI
(Go Linux/API PostgreSQL Race, Windows, Web/Desktop, rootless, images and
artifacts, single-commit and final-gate) are required before rebase merge.
Neither an in-process test nor Green CI proves installed/native hardware
100k or >=4GiB physical backup acceptance. No GitLab delivery claimed.

**Hard NO-GO:** Although the client now has prepare/abort/observe transport,
the native Agent does NOT invoke these in a real operation. There is no
physical OS handle-to-PostgreSQL atomicity, durable file commit receipt,
safe persisted key retirement, SourceRun, uploader, automatic schedule,
watcher, Mirror deletion, NAS Push or UI start/cancel. Local folder stays
paused with active Run and canonical first-file production commit denied;
Stage remains <=64MiB and Web/Mobile Web/foreign Desktop read-only.
Old Pull connectors and historical Source/CAS/Node IDs are untouched.

**Next L03-G0-A2b2b2c:** join the owning Agent held-native window and
durable key to this authenticated prepare/abort/observe transport, prove
restart/lost-response/current Root and Source identity retention, and
design a terminal durable receipt and safe key retirement before any
production file writer is enabled.
