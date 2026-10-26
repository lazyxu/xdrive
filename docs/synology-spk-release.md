# Synology armada38x SPK publication contract

This is a follow-up to the original Backup-only DSM package in PR #2642.
Nothing here introduces a second agent, Runner or CAS writer. The original
`cmd/xd` and `cmd/xdrive-agent --backup-only` stay the only executables;
`packaging/synology` only adapts them to DSM 7.

## One source revision, one exact package

- GitHub and GitLab `build-client-core` cross-compile from the original Go
  entry points and test the SPK archive. Release publication **downloads and
  verifies**, but never recompiles, the bytes from that job.
- Both providers derive one monotonically increasing DSM package version
  from the full commit ancestry count, not provider-specific run numbers.
  During the NAS beta the package feature version remains `0.1.0`; a
  master snapshot at commit count N uses `0.1.0-(2*N)`, and stable `v*`
  on the same commit uses `0.1.0-(2*N+1)`. The following master commit
  becomes `0.1.0-(2*N+2)`. This supports switching release channels
  without requiring a downgrade or uninstall. Optional stable SemVer suffixes
  are allowed; invalid tags fail closed. Both providers require complete
  Git history and GitHub/GitLab fast-forward ancestry for identical versions.
- The actual embedded xDrive client version remains `snapshot` / `v*`.
  `XDRIVE_SPK_VERSION` is DSM's **package** version, not a new Go application
  release identity.
- The CI original binary version, source architecture (`linux/arm, GOARM=7`),
  payload allowlist and `conf/privilege` are checked before upload.
- Release requires exactly one non-symlink `xdrivenas-armada38x-*.spk` and
  its matching portable `.spk.sha256`. Reject duplicate SPKs, digest
  mismatch, a mismatched `INFO.version`, wrong package or architecture,
  and unknown top-level release archives.
- GitHub adds both SPK files to the signed global `SHA256SUMS.txt` release
  manifest; GitLab publishes both with all other exact artifacts into its
  immutable per-commit package then updates the floating release reference
  only after remote SHA-256 verification.

## Deliberate boundaries

Only `armada38x` DSM 7 (minimum 7.0-40759) is in scope; the DS218j is
ARMv7, not an ARM64 device. The SPK is a client, not a NAS-hosted xDrive
Server, and does not include Electron. A local package administrator must
perform the initial restricted-user login/Root grant; the remote xDrive Web
UI and other devices cannot mutate that NAS Root grant.

Source-exact Go ARMv7 compilation, QEMU Cortex-A9 smoke and sparse >4GiB
offsets are code-level evidence, not physical NAS backup/SQL/CAS E2E.
Inaccessible production-only safety acceptance remains **按用户决定跳过（未验收）**,
not a development or merge blocker. Code-level security and publishing
tests remain required.

The full Shared-MUI DSM graphical front end is a later, separately reviewed
platform adapter; no exposed private Agent loopback token or new public
remote device-control endpoint is authorized by this packaging work.
