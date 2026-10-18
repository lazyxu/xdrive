# L03-G0-c2c3b6 · Durable private first-file SQL commit correlation

**Dependency:** #2066 (native original descriptor through one in-process
current-operation CAS/SQL physical commit) and #2060/#2057 (immutable
Stage/Operation SQL binding and precommit writer fence) merged.

## Motivation

The preexisting reservation terminal is only proof of an aborted or expired
30-second admission. The existing historical Stage/CAS/SQL read receipt is
not explicitly indexed by the ORIGINAL keyed operation UUID/generation.
Neither provides a durable exact-operation SQL COMMIT outcome after a lost
reply; an expired reservation is NOT proof of physical transfer cancellation.

## Change

Only the UNROUTED first-leaf operation-aware physical CAS/SQL writer now
persists an immutable `LocalPushFirstLeafOperationCommit` row **inside the
exact same PostgreSQL transaction** as first-file ContentBlob/Node/File/
PENDING SourceItem and quota-hold Stage commit. It occurs under the same
owner/device/Root/Source/latest-operation and Stage locks while physical
CAS/Stage pins are held and BEFORE the final SQL-clock operation fence
and SQL COMMIT. It never creates a result for an unkeyed legacy fixture.

The schema binds exactly one Operation UUID to one Stage UUID and unique
(SourceID,Generation), retaining original request key DIGEST (not secret),
source/device/owner-session/Root identity, snapshot/path/content hashes,
size, canonical Node ID/SourceItem ID, and PostgreSQL commit-correlation
timestamp. It uses private JSON-redacted fields. The row is visible from
another SQL transaction only after the original COMMIT succeeds. Exact
replay checks the same immutable row, never rewrites or duplicates the
original timestamp. Missing table, conflicting or forged receipt,
wrong key or canceled/expired/revoked operation rolls back the current
transaction, including all new canonical SQL metadata.

The old non-operation CI-only writer and existing terminal reservation
protocol remain intact. There is NO new REST route, HTTP client write
API, Agent IPC, renderer, Web, SourceRun or native OS key/claim deletion.
This is a stored SQL outcome, NOT a completed backup or current physical
CAS/native original attestation. A later CAS GC failure, native file
mutation, process crash or network response loss requires independently
authenticated recovery and physical verification. A reservation may
expire after SQL COMMIT without implying cancellation of the committed
file. This SQL-only record is NOT itself authorization to retire any key.

## Verification and remaining gates

PostgreSQL integration asserts fresh commit, exact idempotent replay,
immutable original timestamp, no successful SourceRun, corruption
fail-closed, table-absence all-or-nothing rollback, and abort-before-write
zero receipt. Native Linux/Windows real original-file fixtures create
the schema but retain their un-routed/test-only boundary. Migration runs
twice and creates zero fabricated rows. Desktop static contract ensures
no Router/Agent IPC/Renderer Web use.

**HARD NO-GO:** No physical distributed native file handle/commit lease,
no durable physical cancellation or safe crash recovery, no automatic/manual
Push Runner, SourceRun, key retirement, Mirror deletion or local_folder
Run activation. Stage remains <=64MiB. Web/Mobile/PWA and other Desktops
are read-only; NAS Push remains unsupported; Pull is unchanged. Physical
installed Windows/Linux 1k/10k/100k >=4GiB and GitLab delivery unverified.

Next stage must add a strictly scoped post-commit observation binding this
operation SQL row to real CAS bytes and live owning Root (read only),
then commit-versus-cancel linearization, before any production Agent control.
