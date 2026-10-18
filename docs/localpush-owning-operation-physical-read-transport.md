# L03-G0-c2c3b8 — Owning-Agent exact Operation SQL/CAS read-only HTTP transport

**Accepted prerequisite:** c2c3b7 #2077 exact HEAD
`210455290100d276e18648e818163efd1750f2fd` passed full
[CI #39125256008](https://github.com/lazyxu/xdrive/actions/runs/39125256008),
including PostgreSQL API Race and Final Gate, and Ready/Rebase merged as
`master@e12e434d442c41515fde5fa6e09de7bd038c337d`. The old branch is subject to repository cleanup.

## Scope

The existing Server-private c2c3b7 proof joins immutable Operation
UUID/Generation/request-key digest, an exact Stage, an atomically committed
Node/SourceItem SQL outcome, and actual currently pinned, double-hashed CAS
bytes in one read-only SQL transaction. c2c3b8 adds a narrowly authenticated
**read-only** HTTP/Go Client bridge so an owning enrolled Agent with the
OS-private ORIGINAL 32-byte request key can retrieve that nonauthoritative
fact after a lost reply. It deliberately does not expose an upload/finalize
or cancel API.

POST `/api/v1/sources/:id/local-staging/:stageID/operation-physical-receipt`
is guarded by authenticated owner JWT, existing `localPushOperationNoStore`
and owning Agent `requireLocalSourceExecutor` device secret/Root/Source
revision middleware. Body is capped at 768 bytes and JSON-only; contains the
private 43-character canonical base64url request key, UUID/generation and
one validated relative leaf. Unknown/trailing fields, request query,
foreign device/Root, stale revision, wrong original key and paths are denied.
No local path/key/Root/secret in URLs, response or cache. The Server rechecks
the exact owner/device/Root/session/revision/target inside the SQL+CAS pin
transaction. Errors contain only generic scope failures.

Response is a narrowly allowlisted current Source/Stage/Operation identity,
PENDING Node/SourceItem IDs and historical SQL+CAS state.
`cas_observed=true` never means native bytes verified, backup complete,
source run started, a cancel has completed, or a durable key may be retired.
All flags `native_verified`, `backup_complete`, `commit_supported`,
`authoritative`, `missing_inference_safe`, `retirement_supported`
are explicitly false. Agent Go Client rejects missing, elevated, oversized,
cacheable or mismatched replies, and its result is JSON-redacted.

A historical temporary Stage need not still exist. Physical CAS missing or
altered, user/device revoked, Source/Root drift, modified PENDING state,
foreign key/UUID/generation and missing schema must fail closed. Tests
exercise a real Gin/PostgreSQL/Local Storage chain and owning Agent Go Client
with unauthorized same-account foreign Desktop, forged credential, CAS
deletion/corruption, excessive/untrusted request bodies, and immutable replay.
The route manifest and Desktop static contract block unexpected exposure.

## HARD NO-GO

The Agent's original native descriptor is NOT held by this Go Client method;
even if later invoked inside an Agent-owned file checkpoint, there is no
distributed OS-fd/SQL physical transaction. A successful observation is
ephemeral. No new Writer/Router mutation, SourceRun, file lifecycle change,
scheduler, Agent IPC, renderer or Web Start/Cancel, backup-completion claim,
key retirement, Mirror deletion or local_folder activation. Temporary Stage
remains <=64MiB; Web, Mobile Web, PWA and foreign Desktop remain read-only.
Existing Pull unchanged; NAS Push stays unsupported.

Next: bind this read into the original owning Agent's held CURRENT descriptor
and OS-protected original request key scope with account/Root/fingerprint and
post-hash checks; separately prove durable physical commit-versus-cancel
exclusion and crash-safe request-key retirement before production Push.
