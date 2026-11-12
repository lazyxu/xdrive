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

Updates are **manual**. The existing standalone CLI-only updater does not
promise atomic in-place installation; it must not launch a Desktop installer
or claim post-install verification. Old CLI installations remain usable when
the Server upgrades, subject to normal protocol compatibility checks.
