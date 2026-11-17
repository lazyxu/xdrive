# GitLab stable and portable xd/Agent: source-exact Server-first downloads

The current-Server manual installer and Desktop automatic GitLab
`master/snapshot` updater are distinct workflows.

- A GitLab `stable` release may publish a full source Commit in its Release
  API (`commit.id`). The native Desktop update checker can compare it to
  the authenticated xd Server's current Bundle, only if `channel`, full
  `commit`, published version and platform/installer match. Missing or malformed
  Commit leaves the original independent GitLab updater unchanged.
- When GitLab Release metadata lacks an inline SHA-256, the updater reads
  GitLab's `SHA256SUMS.txt` *before* accepting the Server Bundle as a download
  origin. Conflicting hashes always reject Server-cache substitution.
- Portable `xd update --cli-only --download --source gitlab` may use the
  current authenticated xd Server's verified `xdrive-backup-*` archive when
  exact Commit/version/channel/filename/size and GitLab's independent SHA-256
  agree. When no Owner login exists, the package is absent, or the hashes
  disagree, normal GitLab release download and validation remain available.
  The archive is still checked for the expected xd and Agent Go binary layout;
  this action never extracts/installs binaries or starts a Desktop installer.
- New standalone `xdrive-cli-*` manual archives are a distinct product from
  the existing `xdrive-backup-*` CLI-only update command. The explicit
  `xd update --cli-only --standalone --download` switch targets the independent
  xd/Agent archives, verifies the exact Go binary/member allowlist, and may
  use the authenticated Server cache only when the separately selected GitLab
  release, Commit/version/channel and independent SHA-256 all agree.
  The default `--cli-only` remains Backup-only. Neither command installs
  in place or automatically updates the Server or Desktop.
- An xd Server upgrades via its *independent* GitLab/GitHub Server release
  image and signature/health gates, not through its currently installed
  client's Release Bundle. Client Bundle failures never roll back a healthy
  Server; a client is never required to match the Server Commit.

Download preference is verified authenticated xd Server cache, same-Commit
GitLab and then GitHub only when the client has already established the
exact independent release digest. Never copy Owner credentials to mirrors,
accept cross-Commit packages, bypass OS admission or claim real-device
acceptance based only on GitHub Actions.
