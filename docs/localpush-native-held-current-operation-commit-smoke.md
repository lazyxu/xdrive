# L03-G0-c2c3b5 — Native-held original through current-operation physical CAS/SQL test

## Purpose and exact boundary

The prior L03-G0-c2c3b4 internal writer now requires the immutable Stage ID
↔ latest Operation UUID/generation SQL binding both before CAS/Node locks and
immediately before its SQL COMMIT. The remaining missing evidence is whether
an actual native Root/CURRENT/original-file descriptor survives all the way
through physical CAS preparation and the operation-fenced SQL write.

This phase adds **tests only** to `internal/api`. The fixture constructs a
real Linux/Windows strong-identity Root, persists an inventory CURRENT,
performs a real enrolled-device-authenticated Gin HTTP temporary Stage upload,
prepares actual physical CAS bytes and owner quota, stores the latest keyed
operation and immutable Stage/Operation SQL binding, then calls the existing
private `commitBoundLocalPushFirstLeafWithCurrentOperation` INSIDE
`WithHeldCurrentOriginalReadCheckpoint`'s real still-open original OS
descriptor callback. The same native descriptor is hashed again after the
SQL commit callback; SQL/physical CAS and native bytes are checked separately.
Exact replay must retain one Node/SourceItem and one real Stage PUT.

## Independently tested negatives and post-COMMIT ambiguity

A revoked owning Device between durable Stage binding and SQL writer entry
must be denied even though the original file descriptor is still open. The
negative test requires ZERO new canonical Blob, SourceItem and SourceRun.

On Linux an in-place local content change deliberately occurs after the
physical CAS/SQL transaction COMMIT but before the original descriptor
closes. The native post-checkpoint digest MUST fail. The already committed
CAS and PENDING SourceItem must remain accurately queryable: this negative
post-COMMIT native result is **ambiguous** and must never be treated as a
durable cancellation/rollback proof, successful backup, permission to retire
the OS request key, or safe Mirror deletion. Windows does not run this
Linux-specific in-place concurrent mutation variant; its positive real-file
descriptor and revocation paths remain covered.

## Hard NO-GO and next stage

This is an **in-process Go integration fixture**, NOT a remotely attestable
cross-machine native file-descriptor capability. The private writer is still
UNROUTED. The Agent's original descriptor cannot be transmitted to Server
over HTTP, and network messages/SQL reservations do not create an atomic
local-file vs remote-CAS commit lease. A-B-A local mutations, commit-response
loss and cancellations after Server COMMIT remain unresolved production
boundaries.

No product Router/Go Client/Agent IPC/Renderer/Web control, SourceRun,
manual or automatic Push Runner, key or claim retirement, new operation
generation, scheduled watcher, NAS Push manager, or Mirror deletion is
introduced. `local_folder` remains paused and execution hard-denied;
private temporary Stage <=64MiB, other Desktop/Web/Mobile Web/PWA strictly
observer-only, and existing Pull unchanged. This does not claim installed
Windows/Linux hardware acceptance, 1k/10k/100k files, >=4GiB, or GitLab.

Next work: independently authenticated, durable Agent-native witness with
ownership and content provenance for the exact operation/Stage, followed by
independent commit-vs-cancel exclusion and crash-safe native request-key
retirement before any production Writer/Runner admission.
