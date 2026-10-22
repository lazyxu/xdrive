# G2c2d2b3c2b2d: fail-closed first-file restart claim probe

The owning Desktop can already manually upload **one** local Backup-only regular file (<=64 MiB) through the real native Agent → HTTP Stage → physical CAS/SQL path (#2212). Detached IPC job ownership, original Writer O_EXCL and restart detection are merged. This patch narrows the **read-only restart status** probe; it does not activate full-folder Push.

## Changes

- Check the exact production Native Writer, Stage admission and Operation request paths under the current Server/account/registered Device/Source. Preserve the original on-disk V1 slot names.
- Reject symlinked/non-directory private parents, group/world-accessible POSIX private directories, directory-shaped or symlinked claim files, and group/world-accessible POSIX claim files. Return an opaque error so the owning Agent shows **uncertain**, not **not-recorded**.
- Do not open marker contents or private request keys, delete/recreate files, alter SQL/CAS, issue uploads/cancel, infer physical COMMIT or grant a fresh Stage. The probe is not authoritative, including when it sees no marker.
- Add native filesystem regressions for directory/symlink/file permissions, recovery of a private regular marker, false success prevention and unchanged marker bytes. Windows must reject non-regular claims; Windows ACL/reparse-point parity remains a separate native security review.

## Boundaries and validation

This change **does not** implement the missing physical per-file COMMIT/CANCEL terminal insertion, native remote-writer quiescence, audited Stage/key retirement, second file, SourceRun, schedule, Mirror, NAS, or Web/foreign-Desktop write access. The original once-per-Source claim remains quarantined, even after SQL/CAS first-file observation.

Require this PR's current-head Go Linux/Windows, genuine PostgreSQL Race, Web/Desktop, build/artifact, and Final Gate as applicable before merging. Local installed-device tests, 4 GiB and 100k runs are **not claimed**.

Production-only security acceptance: **按用户决定跳过（未验收）**, permanently by operator decision. Do not request production access, credentials, HAR, traffic capture or human signoff or use those as a source/CI/PR blocker. Continue code-level Owner/Device/Root/OS/CAS/SQL checks.

## Current-HEAD CI test-fixture correction (2026-10-22)

The first full correct-source CI found `go-linux` failing two restart status tests, **not** the upload writer: Go `t.TempDir()` may create its root as POSIX `0755`, whereas the newly hardened runtime intentionally requires its Agent-private root to be `0700`. The two affected test fixtures now chmod **only their own isolated temp config root** to `0700` on POSIX before asserting fresh/retained claims; Windows remains unchanged. No production source, claim format, OS-private marker, Agent/Server write permission, SQL/CAS behavior, or recovery semantics are relaxed. The former failed CI for `71c5268b` is not acceptance; the new rebased single work commit requires completely fresh exact-head CI/Final Gate.
