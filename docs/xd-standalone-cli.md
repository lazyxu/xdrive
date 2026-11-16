# xDrive portable xd / Agent CLI (manual-only)

This archive contains the **original source-exact** `xd` and
`xdrive-agent` binaries built in the same CI run as the Desktop client.
It is **not** the existing Backup-only CLI archive, and contains **no**
Electron Desktop, service auto-registration, installer or automatic updater.

Extract the archive to a user-controlled directory. On Linux run
`./xdrive-cli/xd version --json` and
`./xdrive-cli/xdrive-agent --build-info-json`; both must report the
**same full 40-character Commit** recorded below and in the public Bundle.
On Windows run the corresponding `.exe` commands. Compare the downloaded
archive SHA-256 to the published `release-bundle.json` before use.

The CLI exposes the commands supported by the included `xd` binary. A
headless Backup Agent may use the existing `--backup-only` mode where
supported; this archive does **not** silently enable a second uploader,
background Desktop installation, system service or mounting privileges.
Any operation requiring an authenticated Server or OS permission still
requires its usual explicit authentication and authorization.

Updates are **manual**. For a separately published standalone `xdrive-cli-*`
archive (rather than the legacy Backup-only `xdrive-backup-*` archive), use:

```sh
xd update --cli-only --standalone --source github --channel master --download
```

The explicit `--standalone` switch selects the independent original
`xd` / `xdrive-agent` pair, verifies source/channel digest and the
exact archive member/Go binary layout, and downloads only to the user's
cache. When an authenticated current Server and the independent GitLab
release SHA-256 agree, `--source gitlab` can reuse that Server's verified
exact-Commit `xdrive-cli-*` bytes first. Missing GitLab standalone assets
never cause substitution with the Backup-only or Desktop installer.

Without `--standalone`, existing `--cli-only` remains the prior
Backup-only archive behavior. Neither variant promises atomic in-place
installation: `--install` stays rejected in CLI-only mode, and the
command must never launch a Desktop installer or claim a post-install
verification. Old CLI installations remain usable when the Server upgrades,
subject to normal protocol compatibility checks.
