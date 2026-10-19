# L03-G2b2b · Private owning-Agent first-file Runner Driver (review gate)

## Dependency and exact current scope

This work is stacked **only** on the one-work G2b2a PR #2165, whose real,
device-authenticated first-leaf HTTP CAS/SQL writer is required by the
private Go Client call. Neither PR authorizes ordinary Desktop backup
activation until both are independently validated and merged.

One private Go localpushrunner.Driver now connects the preexisting
native StageVerifiedNativeOriginalBytes, exact current Server
Source/Device/Root reads, O_EXCL durable original OS request key, MAC-bound
prepared Operation UUID/generation, authenticated immutable Stage↔Operation
binding, held-original native file descriptor around the G2b2a HTTP COMMIT,
and an independently authenticated **historical** exact-key SQL/physical CAS
receipt while the original native handle is held and hashed again.

An unexposed agentController.runLocalPushFirstLeafPrivate serializes the
Source under the native Agent mutex through the post-COMMIT reconciliation
and accepts only one first-level, 0–64 MiB Backup-mode file. Its selected
leaf/digest/size are provisional; the native CURRENT journal, persistent
Root grant, original content hash, owning Server admission and pinned
native descriptor independently revalidate actual authority. Never treat
a caller-supplied path or checksum as the authorization.

## Fail-closed/uncertainty contract

- Check same Server, account, login session, enrolled Device secret, native
  Root ID/fingerprint, Source revision, target, complete Source settings,
  Backup mode and saved Root before/after physical work.
- Stage success requires a physically verified temporary Stage and an
  independently reread immutable, OS-private local recovery hint.
- The original 32-byte request key is minted at most once per
  Server/account/Device/Source; after any potentially durable prepare, a
  lost response or cancellation leaves the O_EXCL claim and key intact.
  Persist the exact prepared UUID/generation **before** Stage binding.
- HTTP COMMIT ACK is not success. Reopen the same local request and
  MAC-bound Operation, require matching Stage hint and still-open
  native original, read an authenticated immutable SQL/pinned-CAS receipt,
  then post-hash the original descriptor before returning a one-file
  observation. A timeout, changed original, account switch or missing
  evidence means **uncertain**, never aborted or rolled back.
- No secret, local path or operation key is serialized to Web/Renderer/IPC.
  There is no SourceRun, backup-completed state, local key retirement,
  Mirror deletion, scheduled work, new operation generation or remote
  start/cancel route. The Server Source remains paused and first
  SourceItem remains PENDING.

## Validation and release gates

New owning-Agent Go tests reject foreign session/server/account/Device,
wrong Root/target/revision, nested paths, Mirror mode, revoked Root,
missing Stage/Operation and accidental public IPC entrypoints. Existing
G2b2a tests cover real PostgreSQL CAS/SQL COMMIT and Linux/Windows
held-descriptor rehash. **These alone are not installed-device E2E.**

This stacked PR MUST pass its **own** source-exact full 77+ CI, including
real PostgreSQL Go API Race, Linux/Windows Agent, Web/Desktop, rootless,
images/packages and one-work Final Gate. Parent PR #2165 must separately
pass its own exact-head CI and merge first. Then rebase/rebuild this
single work commit on the COMPLETE current master with full additive
AGENTS history, rerun full CI and require fresh mergeable_state=clean.
No old/head-mismatched green can authorize merge.

Before enabling ordinary Desktop execution, G2c must implement durable
terminal receipt, commit-vs-cancel exclusion, crash recovery/key
retirement, explicit user-controlled lifecycle, and real installed
Linux/Windows cross-process/cross-device E2E. Subsequent multi-file
checkpointing, hierarchical directories, >=4 GiB chunks, 1k/10k/100k
scale, scheduling, Mirror and NAS Push remain independently gated.

## G2b2b write-window contract correction (2026-10-20)

The original exported native held-original checkpoint remains **read-only** by contract. The Agent-only G2b2b COMMIT code now uses a distinctly named `WithHeldCurrentOriginalFirstLeafCommitWindow` wrapper around the same OS-fd verification core. This new operation may invoke only the exact currently authenticated private first-file HTTP commit while the real native file descriptor is held and later rehashed. **It does not authorize generic Writer/Renderer/IPC use, G2c crash-safe cancel/COMMIT reconciliation, durable key retirement, SourceRun completion or product activation.** New native tests verify the specialized callback is called once with the actual original and that post-checkpoint native mutation remains fail-closed. The existing read-only helper tests retain their original contract. This is an explicit split of read-only vs COMMIT test protocol, not a new distributed atomic lease.
