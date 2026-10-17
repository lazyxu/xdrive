# L03-G0-A2b2a · Owning-Agent private native operation request key

**Status:** Non-operational, Agent-package-private durable idempotency-key
preparation, directly following merged #1964. No Local Push runner, Server
prepare/abort/commit transport, automatic schedule, Desktop start/pause/cancel
control or ordinary UI entrypoint is added.

## What is implemented

`cmd/xdrive-agent/device_backup_local_operation_request.go` introduces a
32-byte OS-CSPRNG request key. It is minted only through an Agent-private
function given a fully verified trusted scope: current Server, account,
login session ID, owning registered Device, Source ID and revision, approved
Root UUID and fingerprint, and authoritative cloud target Node ID. The
**current caller must independently obtain/revalidate these values from the
owning Agent and authenticated Server**; this preparatory function is not
itself device attestation and has no production caller.

Each Server/account/Device/Source has at most one pending private slot. An
exclusive on-disk **nonsecret** claim (`O_EXCL`, user-only local directory)
prevents two Agent processes from silently minting two different requests.
The 32-byte random key and full-scope SHA-256 binding are saved only through
the existing `internal/secretstore` credentials backend: Windows user DPAPI;
Linux Secret Service when available, otherwise the existing 0600 fallback.
Never claim that a Linux fallback file is encrypted. Root paths, enrollment
tokens, file names, original bytes and per-file data are not stored in the
claim; the private request struct has no serializable fields.

The recovery function refuses missing, corrupt, oversized, wrong-version,
wrong-session, re-bound Root, changed Source revision, different target,
foreign account/Server/Device, unexpected JSON fields or altered claim.
It returns the original 32 bytes for exact scoped retries. A failed write,
missing credential after a crash, or uncertain Secret Service result leaves
the exclusive claim in place and **fails closed**, rather than silently
minting a replacement key. A missing claim also cannot replace an already
persisted secret. There is deliberately **no automatic expiry, reset, delete,
new-operation generator, startup worker, or endpoint** in this phase.

## Validations and explicit non-goals

Owning-Agent Go unit tests cover the exact recovered bytes, distinct Source
slots, 16 concurrent claimers, claim tampering and 0600 permissions on Linux,
missing/corrupt credentials, invalid scope and all account/session/device/
Root/revision/target isolation cases. A Desktop source-contract test guards
against accidental Server REST, Agent IPC, Electron, Web and Renderer exposure.
The isolated new helper can be tested locally, but the authoritative merge
gate is this exact head's **full** Linux/PostgreSQL API Race, Go Windows,
Web/Desktop, images/artifacts, single-work-commit and `final-gate` CI.

This work **does not** bind a live native OS file handle to the request, obtain
an authenticated Server operation UUID/generation, prove Server receipt,
advance a file, accept a SourceRun, commit CAS/SQL, or certify successful
backup. It cannot lift the paused `local_folder` activation/Run block or the
64 MiB Stage prototype limit. Web/Mobile Web/foreign Desktop remain read-only,
Pull behavior unchanged, Mirror deletion and NAS Push still unavailable.

## Next: G0-A2b2b

An independently reviewed owning Agent must acquire the key under the real
Root/Source/Session lock, retain a verified **native OS handle** across a
bounded authenticated Server prepare/abort/receipt window, reconcile lost
responses without broadening Source/Root/generation, and retire this key
**only after** a durable terminal receipt authorizes a fresh generation.
Crash, canceled Context, revoked device, changed account, replaced Root,
different contents and 2-pool PostgreSQL tests are release gates. Only
following phases may wire a production first-file uploader or UI action.
