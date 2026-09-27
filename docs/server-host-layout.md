# Server host layout and Rootless Docker contract

This document defines the supported host-side layout, permissions, Docker modes, migration rules, and operational invariants for the xDrive server deployment.

The design goal is that a normal Unix user can install, update, back up, restore, and diagnose xDrive without running the installer with `sudo`. The same deployment must work with either a conventional rootful Docker daemon that the user is authorized to access, or Docker Rootless Mode.

## Canonical host layout

The default xDrive server home is:

```text
~/.xd/
├── config/
│   ├── .env
│   ├── docker-compose.yml
│   └── Caddyfile
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
    ├── layout-version
    └── legacy-volumes-retained
```

The top level is intentionally limited to stable subsystem directories. New persistent files must be placed in the appropriate directory instead of accumulating in `~/.xd/`.

For backward compatibility, the historical environment variable `XD_CONFIG_DIR` continues to mean the xDrive server home directory, not the new `config/` child.

## Directory responsibilities

### `config/`

Contains declarative deployment configuration only.

- `.env`: secrets, release source/channel, image names, resource limits and host data paths.
- `docker-compose.yml`: installed Compose definition.
- `Caddyfile`: installed reverse-proxy configuration.

The directory is private to the installing user. `.env` is always mode `0600`.

### `bin/`

Contains host-management executables and maintenance scripts. These files manage Docker from the host and are not mounted into application containers.

The canonical host manager is `~/.xd/bin/xdrive-server`. If the configured host bin directory (default `/usr/local/bin`) is writable, the installer may create a symlink there. Lack of permission to write `/usr/local/bin` must never make installation fail.

### `data/`

Contains the persistent application data as host bind mounts.

- `data/files` -> server `/data`
- `data/postgres` -> PostgreSQL `/var/lib/postgresql/data`
- `data/caddy/data` -> Caddy `/data`
- `data/caddy/config` -> Caddy `/config`

Docker named volumes are not the default for new installations.

The default paths may be overridden through:

```text
XD_FILES_DATA_DIR
XD_POSTGRES_DATA_DIR
XD_CADDY_DATA_DIR
XD_CADDY_CONFIG_DIR
```

Overrides must be absolute host paths. The installer persists the resolved paths so later updates use the same data locations.

### `backups/`

Backup classes are separated so retention and recovery logic cannot accidentally delete upgrade or restore safety points.

- `backups/snapshots`: manual and scheduled normal backups.
- `backups/pre-upgrade`: automatic backup created immediately before an upgrade transaction.
- `backups/pre-restore`: automatic safety backup created before a destructive restore.

Scheduled retention applies only to `backups/snapshots`.

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
- `layout-version`: host-layout schema marker.
- `legacy-volumes-retained`: exact legacy named-volume IDs retained after a successful migration until explicit cleanup.

No user content is stored under `state/`.

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
- require writes to `/etc`, `/var/lib`, or `/usr/local/bin`;
- mount `/var/run/docker.sock` into xDrive application containers;
- require `--privileged`;
- require host networking.

If `/usr/local/bin` is not writable, the supported command remains `~/.xd/bin/xdrive-server`, and the installer prints the PATH export needed for the user's shell.

## Legacy layout migration

Existing installations may use the historical flat layout:

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

Legacy named volumes are not automatically deleted after a successful migration. Keeping them avoids irreversible data loss. A later explicit cleanup feature may remove them after the operator confirms the bind-mounted deployment and backups are healthy.

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

Backup and restore code discovers the actual mount through Docker metadata rather than assuming a volume name.

A restore must never depend on direct host ownership of `data/files`; containerized copy/extract operations are used where numeric container ownership matters.

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
- a non-writable `/usr/local/bin` path does not fail installation;
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
