# L03-G0-A2b2b2c1 — Native held-directory prepare/observe integration

**Scope:** Owning-Agent **package-private, unrouted** bridge from merged
#1972 durable OS-CSPRNG idempotency keys, #1977 held physical directory
witness, #1986 authenticated Server prepare and #1989 authenticated
abort/observe transports. The prerequisite #1989 exact-head
`73e50020c2aaa88b43309e5ae0ebf70ca3f71202` passed full 76-job
GitHub CI (25 success/51 conditionally skipped, final-gate green),
was Ready/Rebase-merged to `64cfe1f49bf18657d2e6e4b2c0485899d2c6ae5f`
and its old branch was verified deleted.

## Inert owning-Agent flow

New `withBoundLocalPushPreparedOperation` composes the existing
`withBoundLocalPushHeldRequest` without widening its action capability:

1. The locally logged-in Server/account/session, registered owner Device,
   strong native RootGrant, paused Push Source, target and Source revision
   are independently checked against the authenticated Server.
2. The existing native directory recheck securely opens the CURRENT direct
   child directory and holds that OS directory handle across its callback,
   checking two sealed inventory generations and exact native identity.
3. A second **credentialed** Server/Source/Root read occurs INSIDE the held
   callback before a 32-byte OS-generated request key is minted or the
   **same** previously saved key is recovered after an ambiguous reply.
4. Using that live native checkpoint, Go Client sends exactly one
   `PrepareLocalPushOperation` with the owner JWT, enrolled device token,
   approved Root fingerprint and If-Match revision. Server independently
   performs Owner/Device/Source/Root transactional fencing and stores only
   a domain-separated SHA256 request digest.
5. An independent `ObserveLocalPushOperation` queries **that exact**
   operation UUID/generation, accepting only current `reserved`, all
   four safety flags hard-false and a matching Source/revision. Both HTTP
   calls share the existing bounded (8-second) action context while the
   native directory remains held.
6. A THIRD credentialed Server/Source/Root/account read runs while the
   directory handle remains open; the native reader checks the same handle
   and sealed generation again before returning. Only after every check
   can the private `client.LocalPushPreparedOperation` be returned.

New `inspectLocalBoundBackupPreparedOperation` supplies the real
`c.localBoundBackupConfig`, current userconfig session, trusted native
held checkpoint, and authenticated Go Client transport. It owns the
`localFolderGrantMu.TryLock` critical section. There is deliberately
**no production caller**: no Agent IPC, Electron Renderer/Preload/Main,
Web/Mobile Web, background schedule, SourceRun, file read/write or
`local_folder` activation.

Lost responses and unsafe state are handled conservatively. If prepare
or observation returns an error, the durable local request key remains
untouched. A future explicit retry uses `newRequest=false` to send
identical bytes; an unrelated new operation cannot replace the pending
key. A revoked device, stale login, altered Root, changed target/revision,
missing credential or expired/aborted Server operation cannot be promoted
to a successful native backup. The operation ID is an **ephemeral
non-authoritative correlation value** and is not persisted in the local
request journal; losing the ID does not permit guessing or bypassing
the idempotency key.

## Tests and remaining boundaries

Owning-Agent Go tests use a locally persisted strong RootGrant, an actual
secretstore-backed durable key and an *injected test-only* held directory
reader to prove order (two Server reads before transport, one afterward),
exact-key restart/replay, response loss, missing recovery key, source/
revision/device/Root/session drift, post-observation revocation,
cancellation, wrong UUID/generation and expired/aborted observation.
Separate `httptest.Server` coverage calls the **real Go Client HTTP
request/response codecs** inside the held callback and checks authorization
headers, strict JSON and exact replay. A Desktop static contract prevents
any IPC/Renderer/Web runtime call and any CAS/SourceRun mutation. These
tests do **not** prove a physical cross-machine native-handle/SQL atomic
lease: the real native reader is composed in production-private code but
the transport test's held reader is injected. No 100k or >=4GiB installed
Desktop end-to-end backup has been run.

Keep SourceStatusPaused and the hard-denied local_folder Run/activation
path, current 64 MiB staging restriction, NAS Push placeholder and
Web/Mobile Web/foreign Desktop read-only scope. Pull and all existing
Source, Node, CAS and FileVersion histories are unchanged. A successful
`reserved` operation is NOT a SourceRun, a committed file, a durable
terminal receipt or upload authorization; never retire the local request
key automatically on a mere abort/expiry or unverified connection state.

**Next L03-G0-A2b2b2c2:** durable prepared-operation UUID/generation receipt
and explicit terminal reconciliation, same-device/native-scope recovery and
safe local key retirement. Following that, independently review actual
file commit authorization and resumable Runner, then unlock owning Desktop
start/cancel, scheduled backups and hardware 100k/≥4GiB acceptance.
Require ONE work commit on frozen master, own complete accurate-head
GitHub Go Linux/API PostgreSQL Race, Windows, Desktop/Web, Rootless,
artifacts, single-commit and final-gate before Ready/Rebase Merge and
branch cleanup. No GitLab deployment or installed-device acceptance is
claimed.
