# Caddy Host admission: cross-Server atomic queue ownership

The Host Control runner and each Linux Server replica now acquire one fixed
kernel flock on `caddy-env-admission.lock` around the Active precheck and
O_EXCL queue publish/promotion. The Host claim is a Python standard-library
helper using O_NOFOLLOW, regular-inode and link-count validation, link+unlink
promotion, and directory fsync. It drops stale queued requests while Sticky
Active remains, but never clears Sticky Active or replays a deployed candidate.

Host installer installs the helper beside server-control.sh; both no-DB
fixture and Linux Go security regression exercise contention and symlinks.

**Boundary:** This PR closes the precise Host admission TOCTOU. Independent
Rescue, process-external Watchdog, verified Sticky Active release, signed
Applied Receipt and configuration history remain separately blocked. No Host
configuration authority outside ~/.xd/config/.env. Production-only security
acceptance: 按用户决定跳过（未验收）; full source CI mandatory.

Queue publication explicitly unlinks its private O_EXCL temp name and fsyncs the bridge directory before releasing the shared admission lock. The Host rejects lingering multi-linked request inodes. The Go Server permits an existing Host-owned 0660 lock without attempting an unauthorized chmod; unsafe modes still fail closed. Python regression models both hardlink states.

## Independent process-external watchdog (one-shot)

The Host installer registers a second, independent crontab entry for
\`caddy-watchdog-once\` once per minute. Unlike the normal Host sampling
loop, this process survives a runner crash and is serialized by the runner
and installer locks. It acts only on an exact original 24-hex Deploy ID with
either an immutable deployed terminal or intact private original rollback
journal. A known failed terminal, missing/malformed backup, lock contention,
or unsafe directory remains fenced. A private O_EXCL/fsync, one-shot marker
is published before the existing exact-ID recovery, so a second invocation
cannot repeat physical recovery after a crash. The offline Host/Docker
fixture checks both recovered and rejected scenarios.

This is not yet a general Operator Rescue that can safely lift a double-failed
rollback with a missing trusted previous runtime anchor. In that case Sticky
Active remains isolated; no browser/Server API can bypass it. Environments
without cron do not gain an independent scheduled watcher; source UI may not
present it as ready. Signed Applied Receipt remains separate.

## Explicit Host-local Rescue (manual, separate immutable evidence)

\`server-control.sh caddy-rescue <exact-24-hex-operation-id> --confirm\` is
a privileged Host CLI only, not a Web/Admin/Agent endpoint. It serializes
against the common Host admission + installer locks, demands the exact
immutable failed request, a fully restored nonpending .env with different
fingerprint, no unresolved rollback journal or queued requests, and a fresh
same-generation Caddy Ready/TLS/Live-Config window. For the configured domain
it additionally enforces the existing bounded runtime/TLS alignment. Only
then does it publish an independent, fixed nonsecret \`recovered-local\` Host
receipt with O_EXCL, fsync and no overwrite and remove the original Sticky
Active with directory fsync. It never changes the historical failed terminal
to deployed and never proves signed Applied/WAN/client trust. Missing or
corrupt evidence permanently retains the fence for operator investigation.

### Crash-safe Rescue record and Host-only locks

Rescue now opens the shared admission inode read-only with a current-path
identity check instead of truncating a file in the Server-group-writable Host
bridge. The independent watchdog uses a Host-private lock and observes the
existing runner lock read-only. A matching immutable Rescue result can be
reconciled after an ACK/process crash, including the single provably identical
temporary hardlink left between atomic publication and cleanup; conflicting
or malformed records remain isolated. The original FAILED terminal is never
rewritten. The source-only Host fixture covers restart reconciliation without
additional Docker recreates. An independent signed Applied receipt is still
outside this recovery-only scope.
