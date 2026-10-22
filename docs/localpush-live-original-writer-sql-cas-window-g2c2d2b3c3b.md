# G2c2d2b3c3b — live original Writer lock maintained across real first-leaf CAS/SQL

## Already enabled
[#2212](https://github.com/lazyxu/xdrive/pull/2212) is merged: a real owning Windows/Linux Desktop can manually upload ONE first-level Backup-only regular file (<=64 MiB) through the authenticated original Agent Stage→CAS/SQL path. This remains enabled. Success is only a physical first-file observation; `backup_complete=false`, `retirement_safe=false`, SourceRun and automatic/safe second-file upload are NOT enabled.

## Actual source change

`internal/localpushwriter.WithHeldLiveOriginalWriterObservation` validates the **same original live Claim returned from `Begin`**, not a rebuilt claim or an acquired historical OS lock. It holds the Claim mutex across a bounded callback so `Close` cannot release the native kernel lock while remote HTTP/SQL/CAS is underway; rechecks Agent-private directory mode, exact original inode/path, regular type/size and constant-time immutable marker contents before and after. Failures do not create/unlink/rotate a marker, Stage or key.

The actual owning Desktop upload path stores its already-held Claim **only inside Agent memory** on `localPushFirstLeafDriver`, sets `liveWriterRequired=true`, and wraps its existing HTTP `CommitLocalPushFirstLeafWithOperation` and historical physical CAS receipt readback in that same Claim's validation callback **inside** a separately held and post-hashed real native file descriptor. A different Root/session/original file cannot substitute a new marker. Private testing helpers without owning Desktop entrypoint retain their existing explicit test-only contract; no remote/public caller can supply a Claim.

Native Go OS tests cover a concurrent Writer lock denial while callback is running, original marker survival after Close, different session rejection, cancellation and private callback failure, POSIX same-path marker tampering and replaced inode with identical bytes. Windows cannot safely rename a locked descriptor in a portable fixture; the standard Windows native Writer lock tests remain required.

## Not a full remote file-terminal witness

The local lock/callback and native original are **process-local**. The Server still needs an authenticated cross-machine native held witness tied to the exact original Operation and the same retained CAS pinned SQL transaction to record `physical-commit`. Source-wide terminal INSERT, lost-ACK replay, remote writer quiescence/physical CANCEL, durable Stage/Key retirement and safe next-file admission are intentionally NOT enabled here. An OS lock released by a crash never proves remote physical CANCEL.

This work is independent of #2319's historical marker postread race and #2327's UNROUTED Server precommit hook; neither PR is subsumed by this source change. No rollback of existing first-file code or unrelated source/CI.

Required merge gate: single-work commit directly on complete master, fresh exact-HEAD Linux/Windows Go (including genuine PostgreSQL API Race), Desktop/Web, build/images/artifacts and Final Gate success plus current clean PR. Inaccessible production-only safety acceptance is permanently **按用户决定跳过（未验收）** and cannot gate source/CI/PR; no production accounts/secrets/HAR/capture/manual sign-off requested. All code-level Owner/Device/Root/native/SQL/CAS checks remain mandatory.
