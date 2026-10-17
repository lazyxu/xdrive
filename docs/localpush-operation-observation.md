# L03-G0-A2a — Server-private observation of a Local Push operation

**Status:** inert Server-package-only read; prerequisite G0-A1 (#1955)
already merged. No production route or native Agent/Web/Desktop consumer.

The observeBoundLocalPushOperationIntent function reads the exact newest
operation UUID and Source generation through the current Owner session,
unrevoked Device credential, approved native Root and Source revision/target.
It uses one PostgreSQL-clock read transaction with a 2-second derived request
context. Source and Device guards are reused rather than accepting user
headers, account identity or an operation UUID as authority.

Only three internal states can be returned: reserved (latest still live),
aborted (matching durable abort), and expired (latest reserved but past the
database-clock expiry). All struct fields are unexported and JSON serialization
produces an empty object. Stale generations, invalid clock bounds, malformed
UUIDs, changed targets, revoked credentials and cancellations deny with the
same opaque error. There are no database writes or media reads.

A lost initial reserve response with an unknown UUID CANNOT be recovered
by this exact-ID lookup; a future separately reviewed initial-operation
idempotency key and native-held session protocol are necessary. A state
observation never proves a native handle, uploaded bytes, CAS content,
SourceRun status, a production authorization or task cancellation.

Regression coverage: isolated PostgreSQL two-pool reserved/aborted/expired
status, generation/ABA fencing, invalid Owner/session/device/Root/Source,
revocation, canceled request, JSON redaction and unchanged cloud Node,
SourceItem and SyncRun counts. Desktop source contract bars public routing
or IPC. Require exact-head single-commit full GitHub CI, PostgreSQL API Race,
Go Linux/Windows, Web/Desktop, artifacts and final-gate before merge.

**Remaining NO-GO:** local_folder activation and SourceRun stay hard denied.
No Agent-held physical process lifetime binding, production first-file commit,
scheduler/watchers, local Run/Cancel UI, Mirror deletion, NAS Push or native
installed 1k/10k/100k and >=4GiB end-to-end acceptance. The separate next
G0-A2b protocol must safely bind an authenticated owning Agent and held
OS handle to a recoverable Server prepare/abort/commit receipt before any
actual production upload is enabled.
