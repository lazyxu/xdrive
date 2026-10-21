# G2c2d2b3b1 · Bind private previous-first-file recovery to the original held Writer

## Current production-path baseline

Already merged #2212 opens a real *manually initiated*, owning-Windows/Linux-Desktop, Backup-only first regular file of at most 64 MiB through the authenticated Stage -> CAS/SQL operation. #2241 retains the original O_EXCL native Writer marker across process death, and the existing private `recoverPreviousFirstLeafReadOnly` rehydrates precisely the original Stage, Operation/generation, SecretStore request key and SQL/CAS receipt without creating a new operation. Stacked prerequisite #2266 adds a **private** nonblocking OS-lock observation on that same historical Writer marker.

## This scoped integration

- Only the **unrouted** owning Agent's `recoverLocalPushFirstLeafPrivate` entrypoint changes. It first validates the exact original disk admission/key/Operation/hint, before opening a verified native original read checkpoint against the same CURRENT journal.
- While the original OS file handle remains open, derive the actual strong **native key from that descriptor** (never a renderer or guessed key), construct the original scoped Writer marker identity and acquire the #2266 nonblocking Linux flock / Windows LockFileEx on the EXISTING marker. A live Writer, missing/replaced/corrupt marker, changed Root/session, different inode, or permission failure denies the callback.
- Only under that held marker lock re-invoke the existing `recoverPreviousFirstLeafReadOnly` (exact original immutable SQL/CAS/native historical read). Preserve the outer native post-hash and Root/journal recheck before returning any positive observation. Callback errors are redacted, and every unverified or cancelled outcome remains `Uncertain`.
- New Go regression tests prove missing/live/closed original lock behavior, single callback invocation, failed/cancelled historical SQL reads never becoming success, private-error redaction and permanent Writer quarantine. Node contract forbids new write calls and public IPC routing.

## Security and negative result

This changes **zero public Server routes, files, upload APIs, schema, Stage/key records, or Writer creation**. The original first-file upload remains enabled. Even after a successful held local read, the kernel lock **does not prove remote HTTP writer quiescence or physical CANCEL**, does not persist a `LocalPushFileTerminal`, and cannot retire an original Stage/request key or enable retry, a second file, SourceRun, scheduler, Mirror/NAS Push or Web/foreign-Desktop mutation. B3 terminal writers, authenticated cross-process replay and G2c2d2c key retirement remain separate work.

## Stacked PR and verification

One child work commit on #2266 only, with all earlier owner commits preserved. After #2266 passes its own exact-head complete CI and merges to master, restack this child as precisely ONE independent work commit on the entire then-current master, preserving cumulative AGENTS and original source Blob SHAs. Require a new accurate-head full Go Linux/Windows, real PostgreSQL API Race, Web/Desktop, Rootless/images/installers/Final Gate and fresh clean mergeability. Do not use the parent CI to approve the child.

Production-only safety acceptance: **按用户决定跳过（未验收）** and never a source/PR/CI gate; do not request production credentials, host access, HAR or human signoff. Source-level authorization/native/SQL/CAS regression remains mandatory.
