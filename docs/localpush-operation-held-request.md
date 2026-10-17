# L03-G0-A2b2b1 — private owning Agent held-native request-key window

**Prerequisite:** #1972 L03-G0-A2b2a completed full 76-job exact-HEAD CI,
Rebase-merged, and its work branch was cleaned. This is the next *inert*,
Agent-local safety bridge, not a runnable backup.

## Scope and concrete behavior

The new `withOwnLocalPushFirstDirectoryRequest` holds the existing native
directory window created by
`localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint`.
A trusted in-process callback can inspect or prepare with the exact
already-persisted operation key ONLY after:

1. Authenticated owning-Agent Server/Source/binding read and current
   account/Server/session verification; paused local_folder/push Source,
   revision, authoritative target, device credential and exact Root proof.
2. Strong current RootGrant verification, the sealed PREVIOUS/CURRENT
   generations, exact native current directory and live held OS directory
   handle identity; no weak/root-replaced/symlink/root-unmounted positives.
3. A **second authenticated Server read inside the held native checkpoint**,
   matching the first Source, target, Root, device token and session.
4. Exact new-key mint (one exclusive durable claim) OR exact-key recover.
   Never automatically replace an old key when recovering an uncertain request.

The callback is capped at 8s; a **third authenticated Server/Root/session
read** is required *inside* the still-open native directory callback after
the action. Cancellation, exceeded deadline, changed account, Source, target,
Root, device token or native evidence means an opaque denial, not a success.
The enclosing native reader independently repeats native identity and
sealed-generation checks before releasing its directory handle. If an
operation callback encounters an uncertain failure, the key remains durable
for exact future recovery, never overwritten.

The callback is an in-package **trusted test/future private Agent function**.
There is currently no production caller, no Server operation API transport
and no source of external callback or client-provided keys. Its result grants
no native-handle lifetime after return and cannot authorize an actual cloud
CAS/SQL commit. Its own positive return is NOT an upload, SourceRun or backup
receipt. A concurrent revoked device may still be checked only by future
Server write-transaction fencing.

## Verification and remaining release gates

Go tests use a real native RootGrant persisted to a temporary private local
registry, a true secretstore-backed key, fake authenticated Server reads and
an injected test-only held-reader to verify first/second/third read ordering,
exact lost-reply recovery, rejection of duplicate new requests, late device
revocation, changed login/Root/revision/target/native identity and Context
cancellation. Fake held-reader tests are NOT a physical end-to-end Server
roundtrip or a certificate of live OS-handle/SQL atomicity.

Desktop contract tests prohibit exposing either held request function to
Router, Go Client, Agent HTTP/IPC, Main/Preload/Renderer or Web. Preserve
Pull, Web/Mobile Web and foreign Desktop read-only, Source/Root/CAS identity,
paused local_folder activation/Run denial, <=64MiB Stage, NAS placeholder,
Mirror trash-only/two complete scans/24h and all existing branch boundaries.

**Next G0-A2b2b2:** independently reviewed, authenticated *Server prepare /
abort / observe* transport, with nonce/idempotent Owner/Device/Root/Source
scope, exact revocation fencing, payload/privacy limits and PostgreSQL
two-pool concurrency tests. Link one physically held Agent request to one
Server generation and implement durable terminal reconciliation/retirement
BEFORE enabling any canonical first-file writer, SourceRun or UI operation.
Go Windows/Linux physical 100k and >=4GiB installed backup E2E remain
unverified. Require exactly one scoped work commit and full new exact-head
Go Linux/API PostgreSQL Race, Windows/Web/Desktop, Rootless, artifact,
single-commit and final-gate GitHub CI prior to merge. No GitLab delivery
is claimed.
