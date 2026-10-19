# L03-G2a — Production Push Runner first-leaf orchestration boundary

## Purpose

The operator explicitly authorized starting implementation of a production-grade Local Push Runner. The existing owning-Agent HTTP Stage and Server-only first-leaf CAS/SQL writer remain separate. No reviewed trusted cross-machine native↔SQL commit protocol or durable key-retirement safety exists yet, so this phase introduces a **bounded, testable coordinator** rather than activating an unsafe HTTP writer.

## Implemented

- `internal/localpushrunner` provides a cancellable **single Source, first canonical leaf only** state machine: authenticate/validate → stage one exact native original (0..64 MiB) → authenticate/validate again → prepare unique durable operation → submit COMMIT → perform an **independent bounded reconciliation even after HTTP errors/cancellation**.
- All receipts must match the same Source/revision/digest/size and exact Stage UUID + operation UUID/generation. Verified first-file completion requires immutable SQL, real physical CAS and held native-original proofs; stage ACK and commit HTTP ACK are insufficient. A missing/conflicting proof is `ErrUncertain` and cannot become success/abort.
- Per-Source overlap is rejected; before potentially durable preparation the Source stays process-local quarantined even if the caller cancels before commit, or the commit appears successful. **This is not durable multi-process fencing**: Agent persisted request key, owning native Root grant, SQL COMMIT record and crash recovery remain independent mandatory checks for any future Driver.
- Scope, operation, stage, proof and result JSON-marshalling emit `{}`; no local path, SecretStore claim, private receipt or key leaks through the shared read-only DTO. Relative paths reject traversal and platform separator forms. Unit tests cover cancellation before/after commit, lost-response reconciliation, mismatched receipts, double-run attempts and source isolation.

## Not enabled

No existing Router/Agent IPC/Renderer/Web/scheduler code calls the new coordinator. No Source activation, SourceRun, upload completion, rollback, native request-key retirement, 64MiB+ chunking, automatic start, trusted device execution reporting, Mirror delete or NAS Push. In particular, an injected `Driver` is NOT runtime authority: production integration must independently bind exact real Agent-held original, authenticated device/Root, Stage and latest SQL Operation inside actual rechecked transactions. The coordinator cannot attest a native OS handle on a remote Server.

## Next release gates

1. Merge dependency L03-G1e immutable COMMIT guard and reconcile this PR onto its accepted master with precisely one work commit.
2. Add a real owning-Agent Driver wiring native two-generation inventory, ephemeral encrypted request-key journal, authenticated Stage and current-operation commit. Expose no Web/foreign Desktop mutations and do not enable local_folder SourceRun until genuine distributed commit-vs-cancel reconciliation is proven.
3. Implement durable restart recovery and key retirement, verified source/run progress, explicit Go context cancellation and tests for loss of HTTP ACK after SQL COMMIT, physical CAS GC, A-B-A local mutation, device revoke, Root replacement and multi-process races.
4. Real installed Windows/Linux 1k/10k/100k and >=4GiB end-to-end run/cancel/resume + separate Pull regression; only measured and approved performance/identity results unlock production activation.

Require this exact one-work HEAD's full 77+ GitHub CI including PostgreSQL Go API Race, Linux/Windows, Web/Desktop, Rootless/packaging/images and Final Gate, plus fresh mergeability, before merge.