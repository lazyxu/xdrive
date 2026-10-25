# Server host layout and Rootless Docker contract

This document defines the supported host-side layout, permissions, Docker modes, migration rules, and operational invariants for the xDrive server deployment.

The design goal is that a normal Unix user can install, update, back up, restore, and diagnose xDrive without running the installer with `sudo`. The same deployment must work with either a conventional rootful Docker daemon that the user is authorized to access, or Docker Rootless Mode.

## Canonical host layout

The default xDrive server home is:

```text
~/.xd/
├── config/
│   ├── .env
│   └── docker-compose.yml
├── bin/
│   ├── xdrive-server
│   ├── server-backup.sh
│   ├── server-backup-scheduled.sh
│   ├── server-restore.sh
│   ├── server-verify.sh
│   └── server-doctor.sh
├── data/
│   ├── files/
│   ├── postgres/
│   └── caddy/
│       ├── data/
│       └── config/
├── backups/
│   ├── snapshots/
│   ├── pre-upgrade/
│   └── pre-restore/
├── logs/
│   ├── backup.log
│   └── install-pull.log
└── state/
    ├── install.lock
    ├── scheduled-backup.lock
    ├── upgrade-transaction/
    ├── control/
    ├── photo-face/
    ├── layout-version
    └── legacy-volumes-retained
```

The top level is intentionally limited to stable subsystem directories. New persistent files must be placed in the appropriate directory instead of accumulating in `~/.xd/`.

For backward compatibility, the historical environment variable `XD_CONFIG_DIR` continues to mean the xDrive server home directory, not the new `config/` child.

## Directory responsibilities

### `config/`

Contains declarative deployment configuration only.

- `.env`: secrets, release source/channel, image names, resource limits and host data paths.
- `docker-compose.yml`: installed Compose definition. The Caddy/Web configuration and React build are embedded in the versioned `xdrive-caddy` image.

The directory is private to the installing user. `.env` is always mode `0600`.

### `bin/`

Contains host-management executables and maintenance scripts. These files manage Docker from the host and are not mounted into application containers.

The canonical host manager is `~/.xd/bin/xdrive-server` (or `$XD_CONFIG_DIR/bin/xdrive-server` when the xDrive home is overridden). The installer never creates a system-wide command in `/usr/local/bin`. Instead it idempotently adds the active xDrive `bin` directory to the installing user's shell PATH. This contract is identical for root and non-root users.

### `data/`

Contains the persistent application data as host bind mounts.

- `data/files` -> server `/data`
- `data/postgres` -> PostgreSQL `/var/lib/postgresql/data`
- `data/caddy/data` -> Caddy `/data`
- `data/caddy/config` -> Caddy `/config`
- `data/caddy/assets` -> Caddy `/srv/assets`
- `data/geonames` -> read-only Server `/geonames`

Operational sockets may appear under container-local `/run`, and Docker
Engine may keep image layers under its own data root (such as
`/var/lib/docker`). Neither location is a separate xDrive-managed
persistent data home. All default xDrive-managed bind mounts, runtime state,
logs, configuration and backups resolve beneath the active `$XD_CONFIG_DIR`
(default `~/.xd`); explicit operator-chosen external data paths are retained.

Docker named volumes are not the default for new installations.

The default paths may be overridden through:

```text
XD_FILES_DATA_DIR
XD_POSTGRES_DATA_DIR
XD_CADDY_DATA_DIR
XD_CADDY_CONFIG_DIR
XD_CADDY_ASSET_DIR
XD_GEONAMES_HOST_DIR
XD_MEDIA_WORKER_RUNTIME_DIR
XD_PHOTO_FACE_RUNTIME_DIR
```

Overrides must be absolute host paths. The installer persists the resolved paths so later updates use the same data locations.

### `backups/`

Backup classes are separated so retention and recovery logic cannot accidentally delete upgrade or restore safety points.

- `backups/snapshots`: manual and scheduled normal backups.
- `backups/pre-upgrade`: automatic backup created immediately before an upgrade transaction.
- `backups/pre-restore`: automatic safety backup created before a destructive restore.

Scheduled retention applies only to `backups/snapshots`.

Before restoring an upgrade backup, operators can inspect the external-source rows in its PostgreSQL dump without modifying the live database:

```bash
xdrive-server backup sources ~/.xd/backups/pre-upgrade/xdrive-backup-<timestamp>
```

The command verifies backup checksums first, then streams only the `xd_sources` table through `pg_restore` inside the existing PostgreSQL container. It prints source identity and status fields only; connector credential ciphertext is not read or displayed. This is intended for selecting the correct pre-upgrade recovery point before a destructive restore.

### `logs/`

Contains host-side operational logs, not container logs.

- `backup.log`: scheduled backup output.
- `install-pull.log`: detailed Docker image pull output used when the summarized installer progress is insufficient.

Container logs remain managed by Docker's configured logging driver.

### `state/`

Contains short-lived or transactional host-management state.

- `install.lock`: exclusive install/update lock.
- `scheduled-backup.lock`: scheduled backup overlap protection.
- `upgrade-transaction/`: rollback state retained only while an upgrade is armed or when rollback itself fails.
- `control/`: narrowly scoped host-update bridge containing request/status/heartbeat files. It never contains a Docker socket or deployment secrets.
- `photo-face/`: optional runtime directory for the Photo Intelligence Unix socket. It is transient IPC state and may be recreated empty.
- `layout-version`: host-layout schema marker.
- `legacy-volumes-retained`: exact legacy named-volume IDs retained after a successful migration until explicit cleanup.

No user content is stored under `state/`. The `state/photo-face` runtime directory is not included in backup or migration data.

## Host update control bridge

Web and Desktop may request a server update only through the authenticated administrator API. The API container does **not** execute Docker commands and does **not** receive `/var/run/docker.sock`.

The supported flow is:

1. an administrator submits an update source (`github` or `gitlab`), channel (`stable` or `master`), and a one-shot `backup_file_data` choice;
2. `backup_file_data` defaults to false for every new Web/Desktop update request; enabling it asks the installer to include a full file-data snapshot in that upgrade's rollback backup;
3. the server writes the restricted request into the bind-mounted `state/control` bridge;
4. the user-owned host control runner validates the request again and invokes the existing `xdrive-server update` transaction, forwarding `--backup-file-data` only when requested;
5. the runner preserves the selected backup mode in update status together with stage and byte progress, so another Web/Desktop client can see how the current update was protected;
6. the API exposes that status to Web/Desktop. During the maintenance window the API/Caddy may briefly be unavailable; clients retain the last known progress and resume polling when service returns.

The runner is installed as `bin/server-control.sh`, is started by the installer, and is registered in the user's crontab with an `@reboot` entry when crontab is available. The bridge uses setgid mode `2770`: the installing host user remains the owner and the configured server GID receives bridge access solely so the API can create the restricted request file. It is not world-writable. Parent xDrive directories remain private to the installing user.


### Web/Desktop update-controller concurrency

The shared Server Update controller uses latest-request ownership for overlapping
status polls: a poll completing after a newer read cannot roll back progress or
turn the accepted status into a stale error (including an old HTTP 403).
Submitting `Start Update` invalidates earlier status reads; while the start
request is in flight, subsequent polling does not own the not-yet-accepted
task state. The start action has immediate in-flight ownership, so two
submissions in the same React render cannot issue duplicate update commands.
This client-side fence does not replace the host installer lock or stop the
durable server-side update transaction.

Four controlled-Promise interleaving regressions extract the actual shared
`refresh` and `start` callbacks in
`desktop/tests/server-update-async-race.cjs`. Before the fix: 4 failures
(old idle after new running, old 403 after new queued, pre-start poll overwriting
request ID, duplicate same-tick start). After the fix: 4 passing under the
same schedules. CI still owns Web/Desktop builds and the normal validation
gate.

## Docker modes

xDrive supports both of these modes.

### Rootful Docker, non-root xDrive user

The installing user is a normal Unix account and has permission to use the Docker daemon, commonly through the `docker` group.

The installer itself is not run with `sudo`. Docker may still create containers with container-root privileges because the daemon is rootful; access to a rootful Docker socket is therefore security-equivalent to powerful host administration and must be granted deliberately.

### Rootless Docker

The current Docker context points at a rootless daemon owned by the installing user.

xDrive does not require host root privileges, privileged containers, host networking, host devices, or a Docker socket mounted inside application containers.

The default published ports are deliberately unprivileged:

```text
Web:   3000
HTTPS: 8443
```

When Rootless Docker is active, configuring a host port below 1024 is rejected unless the host explicitly allows that unprivileged port.

## Server storage ownership

The xDrive server image runs as UID/GID `65532:65532`. The installer persists the same numeric runtime identity in both supported Docker modes:

```text
XD_SERVER_UID=65532
XD_SERVER_GID=65532
XD_DOCKER_MODE=rootful|rootless
```

The one-shot `storage-init` service runs as container root only to prepare `data/files` for the non-root server identity. Under rootful Docker this results in container-owned numeric IDs on the host bind tree. Under Rootless Docker those container IDs are translated through the daemon owner's user namespace into subordinate host IDs; container root does not become host root.

PostgreSQL and Caddy retain their image-native ownership behavior inside their bind-mounted directories.

Because bind-mounted data is intentionally owned according to container runtime identities, the host user must not rely on direct recursive `rm -rf`, `chown`, or in-place editing of `data/postgres` or other container-owned trees. xDrive maintenance, migration, backup, restore, and eventual uninstall/cleanup flows must use Docker/container-assisted operations when ownership translation is required. This is especially important for Rootless Docker, where container UIDs can map to subordinate host IDs.

## Root-to-user migration

A deployment originally installed as root can be migrated to a normal user with:

```bash
/root/.xd/bin/xdrive-server migrate-user USER
```

The root-only `migrate-user USER` command first tries the target user's
clean Docker context, Rootless socket and rootful socket **without changing
permissions**. When all probes fail, it automatically checks the local
rootful Docker daemon, the `docker` group and the socket's numeric group
owner. If valid, migration adds the target to Docker's group:

```bash
usermod -aG docker USER
```

It then verifies the updated supplementary groups using a fresh target-user
process (conceptually `runuser -u USER -- docker info`). The verification
clears inherited root Docker context and TLS overrides and pins
`DOCKER_HOST=unix:///var/run/docker.sock`. It checks the target's Docker
access **before** stopping the root-owned deployment. Unavailable daemon,
mismatched socket/group, failed system group authorization, or failed target-user verification
aborts before service downtime. The migration resolves administrative tools
through standard sbin paths when the root PATH is restricted, and permits
`gpasswd` / `adduser` fallback only after verifying the rootful system
daemon and group-owned socket.

To forbid automatic privilege changes, use:

```bash
/root/.xd/bin/xdrive-server migrate-user USER --no-grant-docker-group
```

The former explicit `--grant-docker-group` switch remains available for
compatibility, but is no longer required.

**Security:** Docker group membership confers near-root privileges on a
rootful Docker host, and the host command prints a warning at grant time.
Membership persists **even if the subsequent migration fails**, without
automatic revocation. Prefer Docker Rootless Mode when host-root-equivalent
permissions are not appropriate. The regular non-root installer still
never modifies system groups.

By default, the migration preflights the target user's Docker access and free
disk space, stops the root-owned deployment, and copies the **complete** xDrive
home (including all historical backup archives) to `/home/USER/.xd`. It then
rewrites all eight xDrive-managed absolute data/runtime paths (file data,
PostgreSQL, Caddy data/config/assets, GeoNames data, media worker and photo
runtime), and
transfers the backup schedule,
**explicitly reruns the target Compose `storage-init` using the copied
configuration and target Docker context before starting any target Server**,
starts the copied deployment through the target user's Docker context, and
requires the server health check to pass before committing the migration.
Storage initialization re-applies the container UID/GID and upload-staging
ownership contract; a failed initialization aborts and restores the original
root deployment. It does not chown the complete host data tree to the login
user or modify PostgreSQL volume ownership. A later `docker compose up
--no-deps --force-recreate server` intentionally skips the one-shot dependency;
for an owner-mismatch incident, rerun `storage-init` first with the canonical
Compose config. Even when the marker is current, the one-shot preparer
now also repairs directory access for `.xdrive-blobs`, `sha256` and the
existing 00–ff shard parents (up to 258 directories). This fixes the case
where the Server health probe succeeds but the stage-5 offline consistency
verifier reports `walk storage: open /data/.xdrive-blobs: permission denied`.
It never recursively changes immutable CAS file ownership in this bounded
path; any still-unreadable blobs remain a hard verification failure.

For older currently deployed images, the non-root upgrade installer performs
the same **bounded parent-directory-only** repair before stage 5. It first
requires a valid `state/migrated-from-root` record, the canonical in-home
file data directory, an exact matching active Server bind mount, and a locally
pinned helper image; it rejects unexpected symlinks/ownership environments
rather than mounting arbitrary external data. No verification bypass or
database restore is introduced. Note: an absent/stale
`.xdrive-uploads/.ownership-v1` marker can cause the built-in preparer
to traverse the full file storage tree during an explicit preparation.
Old root-to-user migrations wrote a `state/migrated-from-root` marker but
sometimes left `XD_CADDY_ASSET_DIR`, `XD_GEONAMES_HOST_DIR`,
`XD_MEDIA_WORKER_RUNTIME_DIR` and `XD_PHOTO_FACE_RUNTIME_DIR` pointing
into the previous root home. The next
unprivileged update previously failed in stage 4 with `mkdir /root: Permission
denied`. The installer now repairs only those persisted paths whose exact
prefix matches the migration record's `source_home`, with matching
`target_home` and current login; intentional paths elsewhere remain unchanged.
A missing/invalid marker or an explicit process-environment override inside
`/root` fails with a named key and recovery instructions, before `mkdir`.
The saved `.env` and runtime configuration must never be replaced wholesale,
because PostgreSQL, JWT and connector secrets must survive the update.

Startup or verification failure restarts the original root deployment.
The original root xDrive home is retained as a rollback copy, never deleted
automatically.

Copy progress is reported roughly every ten seconds from the live `cp`
process's kernel I/O counters, not repeated `du` scans of the full target
tree. Because copy-on-write reflinks and metadata are not reflected reliably
in I/O byte counts, percentages are **estimates**, capped below 100% until
the copy command actually succeeds.

### Optional historical backup separation

For hosts with many large historical archives, the operator can explicitly
defer backup transfer to minimize the service downtime window:

```bash
/root/.xd/bin/xdrive-server migrate-user USER --defer-backups
```

This mode skips only `~/.xd/backups` during the initial copy. Live server
files, configuration, database, and media storage are still copied before
switching to the target user's Docker context. It creates an empty
`/home/USER/.xd/backups` for new backups, records a pending-backups marker,
and **never deletes** the original `/root/.xd/backups` archives. These
historical archives will be absent from the target's backup list until they
are imported, but remain recoverable from the original root copy. Do not
remove the root copy while backups are pending.

After the user-owned deployment has passed health checks, run this as root to
bring over the historical archives **without stopping the active server**:

```bash
/root/.xd/bin/xdrive-server migrate-user USER --backups-only
```

This checks the recorded migration source and destination, copies individual
archive directories through hidden staging paths, publishes them atomically,
and does not overwrite snapshots created by the new deployment. Successful
archive publications are recorded in a small idempotency journal, so retries
can skip previously imported archives without rereading large `blobs.tar`
files. If an unrelated new target backup has the same name, import reports a
**conflict**, leaves the pending marker in place, and never silently discards
the original history. Rename or resolve the conflicting snapshot explicitly
before retrying. If interrupted, already published archives remain usable;
the original archives remain at the root source. The pending marker is
cleared only when all archive imports have succeeded. A backup import failure
is not a reason to roll back a healthy target that may contain new user data.

If the initial migration is already running, changing CLI options or replacing
the script **does not alter that in-flight copy**. Do not interrupt an active
migration just to enable the optional optimization.

The original root xDrive home is intentionally retained after any successful
migration, and operators should independently verify backups before deciding
whether to remove it. The target user's shell PATH is updated to use `/home/USER/.xd/bin`; an already-open target-user shell must run the printed `source <rc-file>` command or start a new login shell.

## Non-root installation contract

A supported installation must succeed when all of the following are true:

1. the user can create and modify `~/.xd`;
2. `docker info` succeeds for that user;
3. Docker Compose v2 is available;
4. required outbound registry/update endpoints are reachable;
5. requested host ports are permitted for the active Docker mode.

The installer must not:

- require EUID 0;
- invoke `sudo`;
- require writes to `/etc`, `/var/lib`, or any system-wide command directory;
- mount `/var/run/docker.sock` into xDrive application containers;
- require `--privileged`;
- require host networking.

The supported command remains user-local. The installer updates the detected shell rc file (`.bashrc`, `.zshrc`, or `.profile`) with a managed PATH block and prints the exact `source <rc-file>` command needed for an already-open parent shell to pick up that change.

## Legacy layout migration

Existing installations may use the historical flat layout. Historical Caddyfile files are retained only long enough for transactional rollback while upgrading to the merged Caddy/Web image:

```text
~/.xd/.env
~/.xd/docker-compose.yml
~/.xd/Caddyfile
~/.xd/xdrive-server
~/.xd/server-*.sh
~/.xd/backups/
~/.xd/pre-upgrade-backups/
~/.xd/pre-restore-backups/
~/.xd/.upgrade-transaction/
```

and Docker named volumes such as:

```text
xdrive_postgres-data
xdrive_file-data
xdrive_caddy-data
xdrive_caddy-config
```

Migration is transactional.

1. Detect the legacy deployment before replacing any deployment files.
2. Copy the legacy configuration into the canonical `config/` location; keep the original flat files untouched while rollback is armed.
3. Create a normal pre-upgrade backup using the legacy deployment.
4. Stop writers before copying persistent data.
5. Copy named-volume contents into the new bind directories without modifying the source volumes.
6. Start and verify the new bind-mounted deployment.
7. Only after all health/readiness checks succeed, commit the upgrade and finalize host-layout migration.
8. If any step fails, restore the old deployment files and continue using the untouched legacy named volumes.

Legacy named volumes are not automatically deleted after a successful migration. Keeping them avoids irreversible data loss. Once the active deployment uses bind mounts, those live mounts are authoritative: retained named volumes must never be rediscovered and replayed over current data on later upgrades. As a second line of defense, any legacy-volume copy refuses to overwrite a non-empty bind target. A later explicit cleanup feature may remove retained volumes after the operator confirms the bind-mounted deployment and backups are healthy.

## Uninstall and retained-data contract

Uninstall is intentionally conservative. Runtime removal and data destruction are separate operations.

```text
xdrive-server uninstall --yes
```

removes the xDrive containers/network, managed backup schedule, installed Compose/Caddy files, host maintenance tools, operational logs, and transient transaction state. It preserves:

- `config/.env`, because retained databases/backups may still require PostgreSQL, JWT, and connector-encryption secrets;
- all configured live data directories;
- `backups/`;
- any `legacy-volumes-retained` record.

To remove live data explicitly:

```text
xdrive-server uninstall --purge-data --yes
```

To remove backups explicitly:

```text
xdrive-server uninstall --purge-backups --yes
```

A complete uninstall requires both destructive flags:

```text
xdrive-server uninstall --purge-data --purge-backups --yes
```

Container-owned bind directories are cleared through a short-lived Docker helper rather than host-side `sudo rm -rf`. The purge implementation refuses obviously dangerous paths such as `/`, the user's home, the xDrive home itself, and core system directories.

If retained legacy named volumes still exist, the uninstall leaves only a cleanup-capable `~/.xd/bin/xdrive-server` plus the exact volume record. This allows:

```text
~/.xd/bin/xdrive-server cleanup legacy-volumes --yes
```

after runtime uninstall. Once all recorded volumes are gone, that temporary cleanup manager and its retained state remove themselves. A full-purge uninstall is finalized at that point as well.

### Legacy named-volume cleanup

Legacy cleanup never guesses xDrive volume names. Candidates come only from `state/legacy-volumes-retained`, which was written by a successful migration.

```text
xdrive-server cleanup legacy-volumes
```

prints the exact candidates and makes no changes. Deletion requires:

```text
xdrive-server cleanup legacy-volumes --yes
```

Before removal each candidate is checked through Docker. Any volume still referenced by a container is refused and remains recorded. Missing volumes are treated as already cleaned. The record is deleted only when every recorded volume is absent.

## Backup and restore invariants

Backups are storage-backend neutral. They must work whether `/data` and PostgreSQL are backed by a bind mount or a legacy named volume.

Backup and restore code discovers the actual mount through Docker metadata rather than assuming a volume name. Full backups estimate file-data bytes plus PostgreSQL database bytes before entering the maintenance window; database-only backups estimate only the database portion. Both add a 10% margin and 64 MiB fixed reserve and refuse to start when the backup filesystem does not have enough free space.

Each completed backup contains checksums and a manifest with its creation time, consistency status, whether file data was included, server/Caddy images, release channel and commit, update source, Docker mode, and the space-preflight measurements. A full backup contains `blobs.tar`; a database-only backup intentionally omits it and records `file_data_included=false`. Checksums are verified once before the partial directory is atomically promoted to a completed backup.

Host-side backup inspection is available without touching the running services:

```text
xdrive-server backup list
xdrive-server backup verify
xdrive-server backup verify ~/.xd/backups/snapshots/xdrive-backup-YYYYMMDDTHHMMSSZ
```

`backup list` reports normal snapshot backups with creation time, size, release channel/commit and completeness/consistency state; snapshots that intentionally omit file data are reported as `database-only` rather than `incomplete`. `backup verify` validates the latest snapshot by default, or an explicitly supplied backup directory, using the stored SHA-256 checksums and the manifest's `file_data_included` contract. It therefore accepts a valid database-only pre-upgrade backup without requiring `blobs.tar`. `backup sources BACKUP_DIR` uses the same verification path, so source metadata can be inspected from either full or database-only upgrade backups. Existing `xdrive-server backup` behavior remains a create operation and still includes file data by default; `xdrive-server backup create` is an explicit alias.

A restore must never depend on direct host ownership of `data/files`; containerized copy/extract operations are used where numeric container ownership matters. Production restore drills are not run automatically because they are destructive; CI continues to exercise the full backup-corrupt-restore-verify sequence in an isolated deployment.

## Installation environment summary and diagnostics

The installer, `xdrive-server status`, and `server-doctor.sh` share one host-environment summary contract. A successful installation prints this summary before returning, and operators can reproduce it at any time with:

```text
xdrive-server status
xdrive-server status --summary-only
```

The summary explicitly reports:

- canonical xDrive home;
- Docker mode: `rootful`, `rootless`, or unavailable;
- active Docker context and Docker data root;
- update source, release channel, and pinned commit when present;
- the resolved host paths for file data, PostgreSQL data, Caddy data/config, and backups;
- filesystem total/used/free/percentage information for the xDrive home and every persistent path;
- the active container mount source for each data path when the corresponding container exists;
- every exact volume from `state/legacy-volumes-retained`, including whether it is present and whether a container still references it;
- the normal Compose service table unless `--summary-only` is requested.

`server-doctor.sh` prints the same installation-environment section at the top of its redacted diagnostic report and then continues with deeper checks:

- current Unix user and whether Docker is usable without sudo;
- container state and health;
- PostgreSQL authentication and CAS metadata health;
- HTTP/HTTPS readiness;
- update-provider connectivity;
- host-layout consistency and legacy-layout warnings;
- recent redacted container logs.

Doctor keeps its existing redaction contract: home-relative paths are displayed with `~` and secrets are never printed. Diagnostics are read-only.

## CI contract

Normal CI must verify at least:

- the Compose file uses host bind mounts by default and does not reintroduce named data volumes;
- installer source contains no `sudo` requirement or EUID-root gate;
- rootless detection selects the rootless runtime GID contract;
- default data paths resolve under the selected xDrive home;
- installation and update do not create or require a `/usr/local/bin/xdrive-server` entry;
- legacy flat configuration is recognized and migrated;
- legacy named-volume data is copied before the new deployment is opened;
- rollback keeps the old named-volume deployment usable;
- backup/restore tests use the bind-mounted layout;
- GitHub and GitLab server validation enforce the same layout contract;
- uninstall without purge flags preserves `.env`, data and backups;
- destructive uninstall requires `--yes` and purges container-owned bind trees through Docker;
- legacy-volume cleanup reads only the migration record, refuses in-use volumes, and requires `--yes`.

GitHub CI includes a mandatory `server-rootless-e2e` gate on a hosted Ubuntu runner. That job installs the official Rootless Docker prerequisites, starts a real `dockerd-rootless.sh` daemon as the non-root runner user, asserts that Docker reports the `rootless` security option, imports the exact server/Web images produced earlier in the same CI run, installs xDrive against that daemon, and verifies the live `status`, `doctor`, bind mounts, readiness endpoint, and non-root server UID/GID.

This is intentionally a provider-specific CI capability rather than a fake parity job. The current GitLab pipeline uses Docker-executor Linux runners, where nested user namespaces cannot be assumed. GitLab server validation syntax-checks the same Rootless E2E script and enforces the status/doctor contracts, while the GitHub hosted Rootless job is the authoritative mandatory real-daemon gate.
