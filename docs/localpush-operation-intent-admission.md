# L03-G0-A1 — private Local Push operation admission and abort

**Status:** Unrouted Server-private SQL reservation prerequisite, **not** a
working backup executor. Accepted prerequisite #1948 (held native directory
Server scope recheck). No REST, Go Client, Agent IPC, Electron, Web or Mobile Web
operation route; no production worker calls the new private functions.

## Purpose and isolation

The previous native held-directory proof and per-Source one-use directory
challenge are strictly advisory. Their success cannot bridge the lifetime of
a native OS directory handle on device A and a PostgreSQL transaction on a
different machine. This phase separately introduces a **Server-only durable
admission ledger** for later cross-process operation protocols.

`LocalPushOperationIntent` is append-only and records only exact owner/session,
device ID, approved Root ID/fingerprint, Source ID/revision, target Node ID,
monotonically increasing per-Source generation, a random UUID operation ID,
state and PostgreSQL-clock issue/expiry/abort timestamps. Every field is
excluded from JSON. An operation ID is an internal correlation reference,
**not** a bearer capability, native proof, upload authorization or receipt.
No raw local paths, file names, device tokens, MAC, CAS hashes or content bytes
are stored in this ledger. The table is empty after initial/repeated migration.

`reserveBoundLocalPushOperationIntent` first locks live owner session, owning
credentialed device, paused `local_folder/push` Source and its approved Root
using the existing Stage guard, then revalidates the target and binding. Under
the same transaction it reads PostgreSQL time and the highest previous
Source generation. No more than one unexpired `reserved` generation can be
created. A prior `aborted` or expired reservation may be superseded, always by
incrementing the persisted generation. The lease is fixed at **30 seconds**;
no request can extend it. Past records remain to fence stale references.

`abortBoundLocalPushOperationIntent` repeats the entire current owner/device,
Root/revision/target and live-session check, and locks the highest generation.
It refuses stale/expired/foreign operations and writes a durable terminal
`aborted` state for exactly the matching operation. An identical live abort
can be repeated idempotently. Abort only changes this private reservation:
it is **not** the `SourceRun` cancellation endpoint and proves nothing about
an outstanding upload or a physical native handle.

## Regression and release gates

Real isolated PostgreSQL17 TWO-connection-pool tests demand exclusive
admission under 16 concurrent contenders, durable monotonic generations,
same-generation abort/idempotence, stale/expired/mismatched rejection,
revoked/foreign-device/Root/token/owner/Source/target denial, cancellation,
JSON redaction, and unchanged cloud Node/SourceItem/SyncRun. The server
migration test asserts repeatable empty table creation; Desktop source
contract checks that the functions are not routed to any client runtime.
Require the exact one-work-commit HEAD's full authoritative GitHub CI
including Go API/PostgreSQL Race, Linux/Windows, Web/Desktop, image/artifact,
single-commit and final-gate before linear merge and related branch cleanup.
Local Go1.25 native, installed Windows/Linux, 100k and >=4GiB whole-backup
physical validation are not represented by these tests.

## Remaining hard NO-GO

No function in this phase consumes #1931's native advisory challenge, calls
#1937's private directory writer, publishes CAS, updates SourceItem, creates
FileVersion, changes `SyncRun` or enables local `Source` execution. The
existing `local_folder` run/activation hard denial remains. Mirror deletion,
NAS Push, scheduled watcher/retry and all remote Desktop/Web write authority
remain off; temporary Stage stays <=64MiB.

**Next G0-A2:** independently review an authenticated Agent-to-Server operation
intent protocol that binds actual held native content and one immutable server
transaction to a uniquely fenced, recoverable prepare/abort/receipt lifecycle.
Add crash/lost-response/revocation tests before wiring actual first-file commit.
Never infer production authorization merely from a green private admission test.
