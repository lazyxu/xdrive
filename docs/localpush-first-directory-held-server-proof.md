# L03-F2d8c3b2x — owning Agent rechecks Server scope while local native handle remains open

**Status:** Private read-only Local Push preflight. Depends on merged #1942 (L03-F2d8c3b2w), not a production backup executor. No public write API, real upload, SourceRun, scheduler, Mirror deletion or remote control.

## Why

Previously `observeLocalBoundFirstDirectory` and `sealLocalBoundFirstDirectoryAdvisory` checked the owner/device/Root/Source/target **before** and **after** a native CURRENT inventory recheck, but the second Server proof request occurred after the native OS directory handle had already closed. The local held window in #1942 also existed only as an unexported helper without an owning Agent caller.

## Bounded implementation

- Add exported **internal package** `localpush.RecheckLocalFirstDirectoryNativeWithHeldCheckpoint`: requires non-nil trusted checkpoint, calls #1942's local private held-window verifier, keeps the SAME verified directory OS handle open until the checkpoint returns and the post-checkpoint Root/CURRENT/native identity checks finish. Its callback sees only non-JSON private metadata, never the descriptor or write capability.
- Preserve existing `RecheckLocalFirstDirectoryNative` and `observeLocalBoundFirstDirectory` / `sealLocalBoundFirstDirectoryAdvisory` as compatible read-only private methods. Legacy test-injected readers cannot claim handle lifetime; existing caller behavior remains unchanged.
- Add Agent-private `observeLocalBoundFirstDirectoryHeld` and `sealLocalBoundFirstDirectoryAdvisoryHeld` that require one and only one checkpoint. Check the FIRST independently authenticated Server proof and exact native CURRENT identity **before** the second Server read. Reject absent/replayed/modified callback outputs, native fake authority, wrong Owner-Device-Root/Source revision/target, invalid credentials, revoked/paused status drift, and canceled Context.
- Rewire the existing **Agent-private non-routed** `inspectLocalBoundBackupFirstDirectoryNative` and `sealOwnLocalBoundBackupFirstDirectoryNative` to use the held native callback and perform the second `localBoundBackupConfig` Server read WHILE the OS handle is open. Existing local ownership lock, authenticated account identity, root-grant proof, bounded Context and final session equality checks remain.
- Regression: native Linux/Windows real temp-fs validates held callback and nil rejection; owning Agent synthetic identity tests assert second Server read happens in the held window, missing/duplicate checkpoint and changed final observation are denied, revocation, target drift, errors and Context cancel deny, sealed MAC remains private. Desktop security contract asserts there are no newly routed Reader/Agent IPC/Electron/Web mutations.

## Unresolved authority boundary

A local open handle only protects the Agent-side directory observation window. The Server's independent PostgreSQL transaction is on a different computer and is **not** locked atomically by this callback; native contents may still change, OS path may undergo A-B-A, and a compromised device token is not hardware attestation. No Server operation intent, durable lease, CAS/SQL commit, receipt, recovery or SourceRun is wired. A previous valid HMAC/nonce **must not** be used to call `consumeBoundLocalPushFirstDirectoryChallengeTx` together with `commitBoundLocalPushFirstDirectoryTx` merely because these private methods now exist. No SourceItem promoted to Synced or fake backup-complete state. Web/Mobile Web/foreign Desktop remain read-only; Stage <=64 MiB; Mirror deletion, NAS Push and production local_folder run remain closed.

## Release gate and next

Maintain exactly one scoped work commit on fixed parent. Require this exact HEAD's complete GitHub 76-job CI with Linux Go/API real PostgreSQL Race, Windows, shared Web/Desktop, image/artifact, single-commit and final-gate before Ready/Rebase. Upon successful merge independently check work branch cleanup. Tests are **not** installed Windows/Linux 100k or >=4GiB end-to-end real backup evidence; no GitLab or physical power-loss acceptance claimed.

Next stage must build a *separately reviewed* authenticated Agent/Server operation intent, session generation, owner-bound lifetime fencing, durable prepare/abort/receipt/reconciliation and cancellation. Do not activate production Push until physical native/current, server permission and atomic persistent state are bound to the same recoverable operation.
