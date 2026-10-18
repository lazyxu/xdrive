# L03-G0-A2b2b2c2c2 — current owning native Root held terminal proof

**Prerequisite accepted:** #2012 exact corrected one-commit HEAD
`d4359d67f0ca06443020b9b5837d07e03e0f601e` completed
[full CI #39088435218](https://github.com/lazyxu/xdrive/actions/runs/39088435218)
(76 jobs, 25 success/51 conditional skipped, final-gate green), was
Ready/Rebase merged as `b163f2c038bb8d89a001c8df65f673a6cdf469ed`,
and its remote work branch disappeared. This c2c2 is the next, separately
scoped **read/attestation** stage: no physical file or deletion authority.

## Boundary 1 — Server terminates only the original reservation

The new `POST /api/v1/sources/:id/local-operation/terminal-proof` is
protected by the existing owner JWT, per-source `requireLocalSourceExecutor`
(Device token and exact Root), private/no-store guard and If-Match.
Its strict bounded JSON body carries the original 32-byte OS request
key in canonical base64url, the original UUID and positive Generation.
No query parameters, arbitrary HTTP proxy path or unbounded error text
are accepted. The original key is transmitted only by the owning
credentialed Agent; it is never put in GET URLs, persisted as plaintext
in PostgreSQL, echoed in the JSON response or exposed to the UI.

Inside the existing Owner→Device→Source→Root→latest-intent SQL transaction,
the Server validates live account/session, unrevoked owning device, Root
fingerprint, Source revision/current cloud target, latest UUID/Generation
and the domain-separated stored request-key digest. The immutable
`LocalPushOperationTerminalReceipt` is created/reloaded only for
DB-clock-aborted or DB-clock-expired **private reservation** state.
Live, stale, replaced, corrupt, wrong-key or unauthorized inputs deny.
The narrow response returns source/revision/UUID/generation, terminal
reservation state and canonical UTC SQL recorded_at, with ALL:
`commit_supported=false`, `backup_complete=false`,
`authoritative=false`, `missing_inference_safe=false`,
`retirement_supported=false`. This is *not* an upload ticket.

## Boundary 2 — current owning Agent pins native CURRENT

The new private `withBoundLocalPushHeldTerminal` composes the previously
approved `withBoundLocalPushHeldRequest(newRequest=false)`, which
independently verifies current session, registered device, exact Root
grant, Source revision/target, sealed CURRENT/PREVIOUS inventory and
real native OS-held first-directory identity. Only after the SECOND
Server/Root read inside the still-held descriptor callback may it
recover the **same** original SecretStore request key and HMAC-verified
`localPushPrivatePreparedReceipt` UUID/generation. The Go Client
then calls the authenticated Server terminal route while the held
OS directory is pinned; it strictly checks canonical UTC timestamp,
Source/revision, UUID/generation, terminal state, explicit negative
capabilities, ETag and no-store. A THIRD live Server/Root/session read
and final native identity check must complete before returning a private,
unexported struct serializing to `{}`.

Only the real owning Agent's `inspectLocalBoundBackupTerminalProof`
provides the original native reader, local config and enrolled
credential under `localFolderGrantMu.TryLock`. It remains UNROUTED:
no Electron Main/Preload/Renderer, Web/PWA/Mobile Web, Agent loopback
capability, generic Source manager or background scheduler receives
this private function. Foreign same-account Desktops cannot use a
shared owner JWT as device/Root ownership.

## Hard safety exclusion and next stages

A materialized **reservation** receipt can never attest physical byte
durability, SourceRun/FileVersion/CAS state, a canceled transfer, a
complete backup or the absence of an in-flight native operation.
Even `aborted` and `expired` do NOT grant permission to delete,
rotate or retire the original request key/claim, create a new operation,
run local_folder, lift stage <=64 MiB, infer Mirror deletion or grant
Desktop start/pause/cancel. A lost reply, changed device/Root/owner,
stale generation, cancellation or reboot must fail CLOSED.

Tests comprise actual PostgreSQL two-pool Router authorization/negative
fields; Go Client authenticated HTTP and strict malformed replies;
owning Agent durable RootGrant/SecretStore and held-native callback
ordering, plus actual Go Client codec over httptest; Desktop static
no-IPC/no-public-renderer contract. These are not native Windows/Linux
installed physical descriptor-to-PostgreSQL atomicity, 100k original
files or >=4 GiB end-to-end backup acceptance.

**Next c2c3:** independently design durable *file/commit/cancel exclusion*
plus request-key/claim retirement under ABA/crash/lost ACK/revocation,
without mistaking a 30-second reservation terminal for a physical file
completion. Production original-file/CAS/SQL Runner and own-Desktop
operations remain a separate later gate. Delivery requires one scoped
work commit, exact HEAD full CI/PostgreSQL Race/Windows/Web/Desktop/
Rootless/artifacts/final-gate, clean Ready/Rebase and branch cleanup.
