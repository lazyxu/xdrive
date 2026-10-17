# L03-G0-A2b2b2c2a — durable prepared-operation correlation, never upload proof

**Prerequisite:** #2000 L03-G0-A2b2b2c1 (native held
`prepare` → `observe`) passed full 76-job exact-head PR CI
#39036223229 (25 successful, 51 conditionally skipped, final gate green)
and Rebase-merged as master
`d2cb40f88871fbd171b23f6a816c2a85bb41308a`.
Its PR-trigger branch cleanup succeeded and the old LocalPush branch is
independently absent. This is a fresh, independent stage.

## Why this is needed

#1972 creates an owning Agent's durable OS-random 32-byte request key and
private O_EXCL claim. #2000 securely associates that key with one live Server
operation UUID and generation only **in memory** after the held native
directory and exact owner/Root/Source checks. A lost response or Agent crash
can therefore lose the known UUID even if the Server retained a matching
30-second reservation. It is not safe to mint an alternative key.

This phase records the *already authenticated and observed* pair for later
strict correlation. It does NOT create a terminal successful backup receipt.

## Agent-local journal

`cmd/xdrive-agent/device_backup_local_operation_prepared_receipt.go` adds
unexported `persistLocalPushPreparedReceipt` and
`loadLocalPushPreparedReceipt`. Before writing or reading, both verify the
existing complete Root/Source/Server/account/session/device/target-bound
request key by the established SecretStore journal. The slot is the same
per Server/account/device/Source, while the saved `scope_digest` covers
the mutable login, Root, Source revision and target.

A nonsecret private `operation-receipts/*.claim` marker is created with
`O_EXCL` and 0600 permissions under a 0700 directory. Only after this
exclusive marker is fsynced is one 6-field private SecretStore envelope
saved: version, full-scope SHA256 digest, domain-separated request-key
digest, exactly canonical operation UUID, positive generation and a
keyed HMAC-SHA256 over scope + UUID + generation. This envelope excludes
Root path/fingerprint, account, Server URL, device credential, source
file names/content, raw request key and any upload ticket. On Windows the
existing credential store uses the Windows user DPAPI; Linux uses Secret
Service if available and otherwise the existing **0600 plaintext fallback**.
Neither fallback nor MAC is claimed to resist an attacker who owns the OS
account and also steals the key.

The journal has one effective receipt per source slot and is **immutable**
until a separately reviewed terminal protocol exists. Repeating the exact
UUID/generation/key/scope is idempotent; a different current generation,
Root/session/revision/target, wrong key, tampered HMAC, lost marker or
orphan marker refuses. A crash during marker/credential persistence leaves
the pending claim in place and fails CLOSED, never silently replacing it.
The returned record has unexported fields and JSON encodes to `{}`.

## Native checkpoint and recovery boundary

The non-operational `inspectLocalBoundBackupPreparedOperation` from #2000
now supplies this writer to the existing native held-window callback. The
Server `prepare` and independent same-UUID/generation `observe` must
return validated `reserved` before the correlation is written. The
write occurs **while the native handle is still pinned, before the THIRD
credentialed Server read and final native recheck**. A late revoke,
cancellation, changed Root/Source, lost storage ACK, corrupted receipt
or expired operation produces **no positive result**; stale local records
are not a source of execution authority.

The current offline `load` function is *not* a Server status inquiry,
device attestation, current native file proof, reconciliation result or
license to retire the key. Recovering it after process restart is only the
first step; any later caller must reacquire the real owning Root and
authenticated Agent session and recheck Server operation status under
the live held native checkpoint before using the correlation.

Tests include true OS-backed (DPAPI on Windows; Linux SecretStore or 0600
fallback) journal persistence and restart simulation, strict account/Root/
device/revision/target scope isolation, duplicate/new operation conflicts,
concurrent different-UUID writers, orphan claim/marker loss, MAC tampering,
JSON redaction, and held-window prepare/observe→receipt→third-read ordering.
Desktop source tests prohibit IPC, Renderer, Web or SourceRun wiring.
A mock native held-reader does NOT prove installed physical 100k or ≥4GiB
backup or a cross-machine native-handle-to-PostgreSQL atomic file commit.

**Hard NO-GO:** no automatically retired credential, terminal operation
receipt, device recovery worker, production CAS/Node/FileVersion/SourceItem
commit, SourceRun, real upload/stop/resume, scheduled task, Mirror deletion
or NAS Push. Keep local_folder paused and its activation/Run blocked;
temporary Stage stays capped at 64MiB. Web/Mobile Web/foreign Desktop
remain read-only. GitLab deploy and native installed-device acceptance are
not claimed.

**Next L03-G0-A2b2b2c2b:** independently review a bounded revalidation
path for persisted UUID/generation under the real owning native handle and
current Server status; design durable terminal states and key-retirement
proof, with restart/revocation/revision and SQL two-pool tests. Do not
delete a request key merely because a 30-second lease expired or an
unconfirmed abort occurred. Require one work commit, accurate-head full
GitHub PR CI (Go Linux/API PostgreSQL Race, Windows, Desktop/Web, Rootless,
images/artifacts, single-commit and final gate), Ready/Rebase merge and
branch cleanup.
