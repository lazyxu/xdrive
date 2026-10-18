# L03-G0-c2c3b3 — Immutable first-file Stage / operation SQL correlation

**Scope:** a private Server-only SQL admission and persistence prerequisite. This
is a staged step after #2051's real native-file descriptor and historical CAS
read-only correlation, NOT production Push.

The new `xd_local_push_operation_stage_bindings` table is append-only in
application behavior. Stage UUID is the primary key, Operation UUID unique,
and `(SourceID, Generation)` unique, forbidding a second Stage under the same
first-file reservation. Every field is private / JSON-redacted. A row carries
the owning session and enrolled device, Root, Source revision/target, exact
operation UUID/generation and original *request-key SHA256 digest* (never
secret), plus quarantined Stage snapshot/path/content SHA256, size, expiry
and PostgreSQL-clock binding timestamp. Migration creates NO rows.

Only `bindBoundLocalPushOperationStage`, an UNROUTED Server-private function,
may create/observe an exact immutable row. The caller supplies the original
OS-private 32-byte key, not an owner-JWT alone. In the same retained GORM
transaction, verify the latest operation and authentic owning device,
unrevoked Root, Source revision/target and SQL-clock reservation lease;
lock and verify the exact currently STAGED 0–64MiB row and its preexisting
immutable CASPrepareIntent quarantine record; require all scopes, SHA256,
size/expiry to agree; insert with unique constraints or return an unchanged
identical record for exact replay. Before transaction exit, rerun the
current-operation fence under the same retained locks. SQL failures,
stale/foreign key, revoked source/device, Stage mutation, terminal operation,
expiry, canceled context, absent migration or reused Stage fail closed.

**Critical non-authority:** A SQL binding does not itself mean the native OS
file was held continuously, CAS bytes were committed, SourceItem synced,
SourceRun started, a transfer canceled or the owner key may be retired.
No production writer reads this table as authorization yet. This stage does
not register a new REST route, Agent IPC, Electron/Web control, Runner,
schedule, automatic retry, Mirror delete or NAS manager. local_folder remains
paused and its run hard-denied; the existing local Stage cap stays 64MiB.

Tests use real PostgreSQL migration and the existing authenticated
transactional first-leaf fixture to assert immutable exact replay, zero
Node/SourceItem/Run side effects, strict key/session/root/source/Stage
validation, stale/aborted/terminal operation denial, table-absence denial
and rejection of a second generation reusing the first Stage. The Desktop
static contract prohibits importing this new binding into any UI or Router.
Physical installed Windows/Linux 1k/10k/100k and >=4GiB tests, crash-safe
commit/cancel exclusion, real Agent uploader and GitLab delivery remain
outstanding.

**Next:** independently bind native held-file provenance into the actual
CAS/SQL physical writer and prove a durable post-COMMIT or abort receipt,
before allowing external callers or retiring local operation keys.
