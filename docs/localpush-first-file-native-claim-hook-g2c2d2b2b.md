# L03-G2c2d2b2b · wire OS-private Writer Claim into the real owning-Agent first-file upload

## Dependency and exact product capability
This incremental child follows #2238 G2c2d2b2a and keeps the already merged #2212 manual owning Windows/Linux Desktop first-leaf Backup-only 0..64 MiB path enabled. No new Web, Mobile Web, foreign Desktop or public Server control is granted. #2229 Agent-owned lifetime across IPC disconnect remains intact.

## Integration
Immediately before the existing authentic `localpushrunner.Runner.RunFirstLeaf`, recheck the exact first-file Driver/Root/Source/Owner state and construct `localpushwriter.NewScope` from only the current **Agent-owned** config directory, private Root grant, account/session, Source revision/target, server-verified device/Root and natively hashed journal original. Renderer supplies only Source ID.

`localpushwriter.Begin` creates the permanent O_EXCL hashed slot and holds the Linux/Windows nonblocking kernel lock BEFORE Stage, across private request-key mint, authenticated Operation Prepare/Bind, HTTP physical CAS/SQL COMMIT, and exact historical physical SQL/CAS/native descriptor reconciliation. Both successful and ambiguous/failure paths call Close; Close releases only the OS lock and NEVER deletes the disk marker. A reboot, interrupted upload or altered session/Root/target cannot mint another first-file writer for that Source. A failure before the O_EXCL creation does not create the slot.

## Not yet authorized
Native lock release, successful historical SQL read or timeout never proves physical CANCEL/quiescence. This child DOES NOT insert `LocalPushFileTerminal`, reopen the original quarantine, retire Stage/request key, permit another file or generation, mark SourceRun complete, enable an automatic scheduler, overwrite or Mirror-delete. All uncertain cases remain quarantined, with `BackupComplete=false` and `RetirementSafe=false`. G2c2d2b2 crash-recoverable writer-quiescence and G2c2d2b3 authenticated SQL/CAS/native terminal replay remain separate follow-ups.

## Validation
Added original production Agent source-regression test for ordering, complete native scope bindings, safe lock release and no premature success. #2238 separately tests the actual Linux/Windows writer primitive. Require the child to be reconstructed as ONE work commit directly on complete master **after parent #2238 merges**; then the child's own exact-head full Go Windows/Linux, genuine PostgreSQL Race, Desktop/Web, rootless/packages, single-commit and Final Gate CI must pass with fresh clean mergeability. No installed-device, 4GiB, 100k or production-environment acceptance evidence is claimed. Production safety acceptance is **SKIPPED BY USER (NOT VERIFIED)** and is not a source/PR/CI merge gate.
