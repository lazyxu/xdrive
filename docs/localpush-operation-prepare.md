# L03-G0-A2b2b2a — authenticated owning-device Server operation prepare

**Delivery stage:** Server and Go Client transport contract for an inert
Local Push operation reservation. Prerequisite #1977 (held native window)
passed its exact full 76-job PR CI and was linearly merged. No native
Agent production invocation is connected here.

## Only new operation

`POST /api/v1/sources/:id/local-operation/prepare` accepts one strict,
canonical unpadded Base64URL encoding of exactly **32 nonzero bytes** in the
JSON body `{"request_key":"..."}`. The only permitted caller is a
session-authenticated, unrevoked **owning device credential** with exact
Server-stored Root binding/fingerprint, paused local_folder/push Source and
`If-Match` Source revision. This is a credential-and-Root fence; a
stolen device credential is **not** physical machine attestation, and no
Native OS-handle attestation is proven by the HTTP request itself. A future
trusted Agent must invoke this client transport only within #1977's
physically held and repeatedly verified native directory callback.

The existing Server-private `reserveBoundLocalPushOperationIntentWithKey`
performs Owner-session -> Device -> Source -> Root row locking and
PostgreSQL-clock lease/idempotency validation in the SAME transaction.
A repeated matching **live** key gives the same operation UUID and
generation without prolonging its 30-second lease; new keys cannot preempt
live operations, and expired/aborted/stale keys cannot be resurrected.
Only the domain-separated SHA-256 key digest is persisted; the raw
request key is never placed in a URL, log, metadata table, or response.

The bounded request body (256 bytes), exact Content-Type, no URL query,
strict unknown-field/trailing-body rejection, original request context,
no-store and If-Match form the HTTP transport contract. Both new and
replayed successful preparations return **HTTP 200** with Source ID,
revision, operation UUID/generation and `reserved` state. Mandatory
`commit_supported=false`, `backup_complete=false`,
`authoritative=false` and `missing_inference_safe=false`
prevent these ephemeral receipts from being mistaken for uploaded files.

The Go Client adapter rejects missing source/revision/device/Root/key,
unfenced ETag, cacheable replies, unexpected status/fields/trailing
content, noncanonical UUID, zero generation, and any missing/true authority
flag. The in-process result has all fields `json:"-"` and may not
enter Agent loopback IPC, Electron Preload, shared Web/Mobile UI, or PWA.

## Validation and next phases

- Real HTTP/Gin with **two isolated PostgreSQL pools**: owner/foreign-JWT
  and same-account device/Root credential denial, missing/stale revision,
  malformed/oversize/key/query rejection, replay stability, live competing
  key denial, revocation, DB-clock expiry and newly generated key advancing
  the generation.
- Prove **no** new Node, SourceItem, SyncRun, FileVersion, upload or CAS
  modification. Client tests reject forged status/metadata, cacheability,
  missing false fields and leaked private JSON; Desktop contracts prevent
  renderer and generic Source fallback.
- Full accurate-head GitHub PR 76-job CI (Go API PostgreSQL Race,
  Windows/Linux, Desktop/Web, Rootless, artifact and final gate) and one
  fixed-parent work commit are mandatory before rebase merge and cleanup.
  Native installed 100k and >=4GiB whole-backup tests remain unverified.

**Still NO-GO:** This new HTTP prepare is **not** upload authority.
There is no native Agent production caller, Server HTTP abort/observe,
durable committed terminal receipt, true native-to-PostgreSQL atomic
lifetime, completed SourceRun, automatic scheduler, watcher, Mirror
deletion or NAS Push. The current local_folder activation/BeginRun
hard denial, private <=64MiB Stage and Web/Mobile Web/foreign Desktop
read-only ownership boundary remain unchanged. Existing Pull Sources,
CfAPI/FUSE, SourceItem history and CAS IDs are not rewritten.

**Next G0-A2b2b2b:** authenticated Server and Go Client abort/observe,
with exact generation UUID, same owning Root and PostgreSQL locks, and
explicit uncertain/revoked/restarted recovery before introducing real
file commit or any UI start/cancel actions.
