# G2c2d2b3c2b2b — single native Writer claim-slot algorithm

## Runtime improvement
The already enabled, owning Windows/Linux Desktop Backup-only real manual first-file Push (<=64 MiB; #2212) remains unchanged. This follow-up is stacked on #2300's restart-status quarantine: the Agent now derives the existing original Native Writer claim through the same exported **internal-only** `localpushwriter.OriginalClaimPath` that actual `Begin` uses, rather than duplicating a hash algorithm across packages.

`OriginalClaimPath` is pure and returns an OS-private file path only to the owning Agent. It validates the canonical configuration directory and stable Server/account/Device/Source identity. It does not touch disk, admit a writer, read secrets, perform an HTTP request or grant any backup/retry/retirement capability. Mutable login session, Root, revision, target and original file do not reset the original Source-wide slot.

## Verification and boundaries
New Go tests compare the same physical Writer's path before and after the refactor, assert source isolation across Server/account/Device/Source, verify mutable-scope stability, reject invalid/noncanonical inputs and ensure pure derivation does not create a claim. The Agent restart test explicitly compares its native claim probe path against the actual `localpushwriter` implementation, in addition to existing Stage and Operation slot regressions.

This is **not** a physical COMMIT terminal INSERT, native/remote physical CANCEL proof, audited Stage/key retirement, second file, complete SourceRun, automatic scheduler or full production-installed backup. Keep the parent #2300 independent; this child remains Draft until parent CI/merge, one-work rebase onto full master, exact-source Go Linux/Windows/real PostgreSQL API Race/Web/Desktop/Rootless/images/artifacts/Final Gate, and clean mergeability.

Production environment safety acceptance: **按用户决定跳过（未验收）**, not a CI/PR gate. Source Owner/Device/Root/OS/SQL/CAS security tests remain required.
