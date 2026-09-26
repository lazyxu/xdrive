# xDrive

> **Mount your cloud as a local drive.**

xDrive is an Apache-2.0 open-source file service with a Docker-deployed server, a Web file manager, and native desktop filesystem clients.

## MVP scope

| Area | First release |
| --- | --- |
| Server | Go + Gin + GORM + PostgreSQL + JWT |
| Storage | Local filesystem, whole-file objects |
| Web | React + TypeScript + Ant Design |
| Linux | FUSE client (`go-fuse/v2`) |
| Windows | Cloud Files API (CfAPI), Files On-Demand style placeholders |
| Client delivery | Windows `.exe` installer; Linux `.deb` installer |
| Multi-user | Administrator-provisioned accounts, roles, per-user isolation |

Not in the MVP: content-defined chunking (CDC), small-file packs, thumbnails/transcoding, directory/upload sharing, MinIO, macOS, or mobile clients. Full-file content-addressed deduplication is supported for new writes.

## Architecture

```text
                            ┌──────────────────────┐
                            │      xDrive Web      │
                            │ React + Ant Design   │
                            └──────────┬───────────┘
                                       │ /api
                                       ▼
 Windows                        ┌──────────────────┐                      Linux
 ┌────────────────┐             │  xDrive server   │              ┌────────────────┐
 │ xDrive Agent   │ ◄──HTTPS──► │ Gin + GORM + JWT │ ◄──HTTPS───► │ xd / FUSE      │
 │ Windows CfAPI  │             └────────┬─────────┘              │ xdrive-agent*  │
 └────────────────┘                      │                        └────────────────┘
                                       ┌─┴──────────────┐
                                       │                │
                                  PostgreSQL       Local storage
```

`*` The Linux background agent is optional; the Windows installer enables the Windows agent automatically for the current user.

## Server: Docker only

The supported server deployment is Docker Compose. The installer uses these default paths:

```text
~/.xd/docker-compose.yml
~/.xd/.env
```

### Prerequisites

Before running the one-line installer, the server needs:

- Linux amd64;
- Docker Engine with Docker Compose v2 (`docker compose`);
- `curl` or `wget`;
- outbound HTTPS access to GitHub/GHCR and Docker Hub;
- enough disk space for PostgreSQL plus uploaded file blobs;
- for public HTTPS, a domain managed by AliDNS, API credentials allowed to edit its DNS records, and inbound TCP 8443 (or your configured `XD_HTTPS_PORT`) reachable from clients;
- enough host resources for the configured container limits.

No PostgreSQL, Nginx, or Caddy installation is required on the host; Compose runs PostgreSQL and the optional xDrive Caddy image with the AliDNS DNS-01 module. DNS-01 certificate issuance does not require inbound ports 80 or 443.

### Bootstrap install and server management

Do not stream the installer directly into `bash`. Download it completely first, then execute the file so Docker/Compose subprocesses can never consume the shell source stream:

```bash
tmp="$(mktemp)"
curl -fsSL --retry 3 --connect-timeout 15 \
  https://raw.githubusercontent.com/lazyxu/xdrive/master/deploy/install-server.sh \
  -o "$tmp"
bash "$tmp" --channel master
rc=$?
rm -f "$tmp"
exit "$rc"
```

The bootstrap installer supports three release channels. The selected channel is persisted in `~/.xd/.env`.

```bash
# Latest stable vMAJOR.MINOR.PATCH release
bash "$tmp" --channel stable

# Latest fully successful master snapshot
bash "$tmp" --channel master

# A specific successfully published master commit
bash "$tmp" --channel commit --commit 0123456789ab
```

For weak/regionally constrained registry connectivity, xDrive can use an alternate registry namespace for its own three images:

```bash
XD_IMAGE_REGISTRY=registry.example.com/xdrive \
bash "$tmp" --channel master
```

The value is persisted as `XD_IMAGE_REGISTRY` and produces `<registry>/xdrive-server`, `<registry>/xdrive-web`, and `<registry>/xdrive-caddy`. PostgreSQL defaults to `postgres:17-alpine` and can be redirected separately with `XD_POSTGRES_IMAGE`. Docker pulls are performed by the **Docker daemon**, so a shell-level `HTTPS_PROXY` is not sufficient on many hosts; configure the Docker daemon proxy when a proxy is required.

For a fully non-interactive public deployment, export the deployment variables before executing the downloaded installer:

```bash
XD_DOMAIN=drive.example.com \
XD_HTTPS_PORT=8443 \
ALIYUN_ACCESS_KEY_ID=your-key-id \
ALIYUN_ACCESS_KEY_SECRET=your-key-secret \
bash "$tmp" --channel stable
```

After the first successful install, the installer places the host-side manager at `~/.xd/xdrive-server` and, when `/usr/local/bin` is writable, links it as:

```bash
xdrive-server
```

Routine server operations should then use the host manager rather than re-running a pipe bootstrap:

```bash
xdrive-server update
xdrive-server update --channel master
xdrive-server update --channel commit --commit 0123456789ab
xdrive-server doctor
xdrive-server status
xdrive-server backup
xdrive-server restore BACKUP_DIR --yes
xdrive-server verify
xdrive-server verify --repair --dry-run
xdrive-server verify --repair
xdrive-server admin list
xdrive-server admin reset-password admin
xdrive-server admin enable admin
xdrive-server admin disable USER
```

The host-side `xdrive-server` command runs **outside Docker** and controls `~/.xd` plus Docker Compose. The `xdrive-server` executable inside `xdrive-server-1` remains the API daemon. The API container is not given `/var/run/docker.sock` or host-management privileges.

The host manager downloads the latest bootstrap installer to a temporary file, validates it with `bash -n`, and then runs that file with stdin detached from any download pipe. The installer resolves the selected successfully published release/commit and uses immutable `sha-<commit>` images for master/commit channels.

For a tagged release, download and run the release asset `xdrive-server-install.sh`; it pins the matching container image tag. Releases also publish the standalone host manager asset `xdrive-server`.

Upgrades are serialized with an exclusive `flock` lock. Existing deployments enter a maintenance window after the pre-upgrade backup: public Web/Caddy containers are stopped, the new API is started and health-checked before public services are reopened, and deployment files are treated as a transaction. If the new API fails after migration/startup begins, xDrive restores the verified pre-upgrade database/blob backup plus the previous deployment files and images. Failures before the database is touched restore deployment state only. Container images are pulled **one service at a time** so a transient failure retries only the affected service. On Docker Compose versions with JSON progress support, the terminal shows real downloaded bytes / known total bytes / percentage / current rate for that service while raw Docker events remain in the private pull log. Older Compose versions fall back to host RX reporting. If rollback itself cannot complete, the transaction state is retained under `~/.xd/.upgrade-transaction` for manual recovery.

The installer:

1. checks Docker and Docker Compose v2 and acquires the exclusive install/update lock;
2. detaches every non-interactive Docker/Compose operation from installer stdin so a piped source stream can never be consumed by a child process;
3. creates `~/.xd` with user-only permissions and preserves existing secrets;
4. stages the new Compose/Caddy/maintenance files and host manager;
5. on upgrades, creates a verified **pre-upgrade backup before replacing deployment files** without creating/recreating the formal server service;
6. creates `~/.xd/.env` with random PostgreSQL and JWT secrets if they do not already exist;
7. pulls PostgreSQL plus the xDrive server/Web images one service at a time and, when a domain is configured, the `xdrive-caddy` image containing the AliDNS plugin;
8. starts PostgreSQL, waits for database/API/Web health checks, and applies log rotation plus CPU/memory/PID limits;
9. for a public domain, obtains/renews the TLS certificate through AliDNS DNS-01 and waits until the real HTTPS health endpoint succeeds on `XD_HTTPS_PORT`;
10. installs a scheduled backup job when `crontab` is available, with retention and overlap protection;
11. if no administrator exists, securely prompts on the terminal to create the first administrator.

With a configured domain and the default external HTTPS port the endpoint is:

```text
https://drive.example.com:8443
```

Without a domain, xDrive runs in HTTP/private mode on `XD_WEB_PORT` (default 3000).

### Administrator bootstrap

xDrive does **not** expose public or self-service registration. All accounts are created by an administrator.

On an interactive first install, `install-server.sh` asks for the initial administrator username and password after the containers start. The password is piped to the server process through stdin; it is not written to `~/.xd/.env` or passed as a command-line argument.

For non-interactive installs, or for an existing deployment that has users but no administrator yet, create the first administrator locally on the server:

```bash
XD_DIR="$HOME/.xd"
read -s -p 'Admin password: ' P; echo
printf '%s\n' "$P" | docker compose \
  --env-file "$XD_DIR/.env" \
  -f "$XD_DIR/docker-compose.yml" \
  exec -T server \
  xdrive-server admin create --username admin --password-stdin
unset P
```

The bootstrap command works only while **no administrator account exists**. Existing ordinary users do not block first-admin bootstrap. Once an administrator exists, all additional users and administrators must be created through the authenticated administrator interface.

If an account password is forgotten, the original password cannot be read back: xDrive stores only a password hash. A Docker-host administrator can list account names and securely reset a password with the host manager:

```bash
xdrive-server admin list
xdrive-server admin reset-password admin
xdrive-server admin enable admin
xdrive-server admin disable USER
```

The interactive reset prompts twice on `/dev/tty` with terminal echo disabled. The password is not placed in shell history, process arguments, `~/.xd/.env`, or xDrive logs. A successful reset immediately increments the account session version and revokes all outstanding refresh sessions, so existing clients must sign in again. Recovery resets require a password change at the next login by default; pass `--no-must-change` only when the replacement password is already the account's final password.

For automation, explicitly opt into stdin mode:

```bash
read -s -p 'New password: ' P; echo
printf '%s\n' "$P" | xdrive-server admin reset-password \
  admin --password-stdin
unset P
```

`xdrive-server admin disable USER` immediately revokes that account's sessions. The last active administrator is protected from disable so the deployment cannot accidentally lose all active administrators; `enable` reverses an account disable. `xdrive-server admin list` prints only non-secret account metadata (ID, username, role, status, password-change flag, quota, and last-login time); it never prints password hashes or session tokens.

### Audit log

xDrive stores security-sensitive audit events in PostgreSQL table `xd_audit_events`. Administrators can review them from the Web **Audit** page or through `GET /api/v1/admin/audit`.

The first audit phase intentionally avoids ordinary file reads/downloads. It records:

- login success/failure;
- password changes and administrator password resets;
- administrator user creation, role changes, enable/disable, session revocation, quota changes, and user deletion;
- permanent recycle-bin deletion and historical-version restore;
- host-manager backup, restore, and update outcomes when the running server version supports the audit recorder.

Audit rows contain actor identity, action, target identifiers, success/failure, time, client IP, request ID when available, and small structured metadata such as old/new role or quota values. Passwords, password hashes, access/refresh tokens, share tokens, and file contents are never placed in audit metadata. File audit events use node/version identifiers rather than storing file contents.

Host maintenance audit writes are best-effort by design: a catastrophic restore/update failure can leave the API or database intentionally unavailable, and an old pre-audit image cannot write the new audit schema. The maintenance command's original success/failure result is never changed merely because its audit write is unavailable.

### Server observability

The API now emits a bounded request ID for every request. A valid incoming `X-Request-ID` is preserved; otherwise the server generates one and returns it in the response. The same ID is available to security audit events, so an administrator can correlate an Audit row with the corresponding server request log.

Normal API access logs are structured JSON written to server stdout. They include the request ID, HTTP method, Gin route template, status, duration, response size, client IP, and authenticated numeric user ID when available. The logger intentionally uses route templates rather than raw query strings and does not log Authorization, refresh tokens, share tokens, passwords, or file contents. Successful liveness/readiness/metrics probes are omitted from access logs to avoid probe noise; failed probes are logged.

Health is split into two endpoints:

- `GET /api/v1/healthz` is **liveness only**: if the Go process can serve the request it returns 200.
- `GET /api/v1/readyz` is **readiness**: it requires PostgreSQL to respond and the local blob-store root to be writable. Docker health checks, install/upgrade gates, HTTPS readiness checks, and server doctor use this endpoint.

Prometheus-compatible metrics are exposed by the API process at:

```text
GET http://server:8080/metrics
```

This route is intentionally outside `/api/`. The bundled Web Nginx and Caddy path therefore do **not** proxy it to the public Web endpoint; it is intended for a collector attached to the Docker network or another explicitly configured private monitoring path.

The first metric set includes:

- request count and cumulative latency by method/route/status;
- API 5xx count;
- login failures;
- quota rejections;
- upload session/chunk/finalize/overwrite/multipart success and failure;
- active non-expired upload sessions;
- PostgreSQL database size and SQL connection-pool gauges;
- retained blob bytes, in-progress non-reused staging bytes, and managed blob-object counts;
- CAS physical/logical bytes, dedup saved bytes and dedup ratio;
- CAS blob count, average size, p50/p90/p99 size percentiles, and eight non-overlapping size buckets from `<16 KiB` through `>=64 MiB`;
- retained pre-CAS legacy object count/bytes, reported separately from the CAS distribution;
- live metric-collection success/error counters.

`xdrive_managed_blob_bytes` counts unique retained physical blob objects referenced by current files/history plus non-reused staging chunks. Multiple metadata references to one content-addressed blob are counted once. It is not a filesystem crawler and therefore intentionally does not claim to include orphan files; use `server-verify.sh` and host disk monitoring for orphan/free-space diagnostics.


Common operations:

```bash
XD_DIR="$HOME/.xd"

docker compose --env-file "$XD_DIR/.env" -f "$XD_DIR/docker-compose.yml" ps
docker compose --env-file "$XD_DIR/.env" -f "$XD_DIR/docker-compose.yml" logs -f
docker compose --env-file "$XD_DIR/.env" -f "$XD_DIR/docker-compose.yml" pull
docker compose --env-file "$XD_DIR/.env" -f "$XD_DIR/docker-compose.yml" up -d
docker compose --env-file "$XD_DIR/.env" -f "$XD_DIR/docker-compose.yml" down
```

Data is persisted in Docker volumes:

- `xdrive_postgres-data`: PostgreSQL data;
- `xdrive_file-data`: uploaded file blobs;
- `xdrive_caddy-data` / `xdrive_caddy-config`: Caddy certificate/account state when HTTPS is enabled.

For production, set `XD_DOMAIN`, provide `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`, point the domain at the server, and allow inbound TCP `XD_HTTPS_PORT` (default 8443). The bundled Caddy service uses AliDNS DNS-01 for certificate issuance/renewal, so inbound 80/443 are not required for ACME. No hand-written reverse-proxy configuration is required.

### Backup, restore, and storage consistency

The Docker deployment installs five maintenance tools in `~/.xd`:

```text
~/.xd/server-backup.sh
~/.xd/server-backup-scheduled.sh
~/.xd/server-restore.sh
~/.xd/server-verify.sh
~/.xd/server-doctor.sh
```

For support and troubleshooting, run:

```bash
~/.xd/server-doctor.sh
```

It checks Docker/Compose, current release state, container health, PostgreSQL authentication, lightweight CAS metadata health, data mounts, disk space, upgrade-lock/rollback state, TLS/public reachability, GitHub/GHCR reachability, and appends the last 100 container log lines after automatic secret redaction. It is read-only by default. Use `--strict` when automation should fail on diagnostic errors.

By default, the installer registers a daily scheduled backup at 03:17 local server time and retains seven days. Override with `XD_BACKUP_SCHEDULE` and `XD_BACKUP_RETENTION_DAYS`. Scheduled runs skip rather than overlap if a previous backup is still running.

#### Consistency verification

A normal verification briefly stops the API so the database and blob tree cannot change during the scan:

```bash
~/.xd/server-verify.sh
```

For conservative CAS metadata repair, inspect the plan first and then apply it:

```bash
xdrive-server verify --repair --dry-run
xdrive-server verify --repair
```

The repair path runs with the API stopped. It only rebuilds or reconciles CAS metadata when durable references agree and the physical object passes size/SHA-256 verification; unreferenced CAS metadata is moved to `deleting` for the normal janitor. Missing/corrupt content, key/hash identity conflicts, legacy duplicates, and orphan files remain visible for manual investigation rather than being guessed or deleted.

It checks current `xd_files.storage_key` **and historical `xd_file_versions.storage_key`** references against `file-data` and reports:

- database references whose blob is missing;
- blob size mismatches;
- SHA-256 mismatches for current or historical blobs that have a recorded content hash;
- unexpected duplicate references to legacy blob keys;
- valid shared references to content-addressed blobs as informational `shared_references`;
- CAS refcount/state/key drift between `xd_content_blobs` and current/history metadata;
- orphan blobs that exist on disk but have no current or historical database reference.

The underlying server command is also available inside the container:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T server xdrive-server storage verify --json
```

For the lightweight DB-only invariant check used by Doctor and monitoring:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T server xdrive-server storage health --json
```

#### Backup

```bash
~/.xd/server-backup.sh
```

The default destination is `~/.xd/backups/xdrive-backup-<UTC timestamp>/`. A backup is a directory rather than a recompressed mega-archive:

```text
database.dump
blobs.tar
verify.json
manifest.json
SHA256SUMS.txt
```

`database.dump` is PostgreSQL custom format. `blobs.tar` is intentionally **uncompressed** because uploaded content is frequently already compressed and avoiding another compression layer makes large backups faster and more predictable. The script stops the API for a short maintenance window, runs consistency verification, creates both snapshots, writes the manifest, computes SHA-256 checksums, and restarts the API only after the backup directory is complete.

Choose another destination, preferably a different disk or remote-mounted backup target:

```bash
~/.xd/server-backup.sh --output-dir /mnt/backup/xdrive
```

By default an inconsistent source is rejected. `--allow-inconsistent` exists for emergency capture only and records `consistency_verified: false` in the manifest.

#### Restore

```bash
~/.xd/server-restore.sh /mnt/backup/xdrive/xdrive-backup-20260923T120000Z
```

Restore verifies `SHA256SUMS.txt` before changing anything. By default it then creates a **pre-restore safety backup** of the current installation, stops the API, recreates the xDrive PostgreSQL database, replaces `file-data`, and runs an offline consistency check. The API is reopened only if that check succeeds. In non-interactive automation, pass `--yes`.

For a recovery drill where a safety copy is unnecessary:

```bash
~/.xd/server-restore.sh BACKUP_DIR --yes --no-safety-backup
```

Backup directories contain user metadata and all file contents and must be protected like the live server. The generated `~/.xd/.env` is deliberately **not copied into data backups**; store deployment secrets separately.

### GHCR visibility

The official Compose file uses:

```text
ghcr.io/lazyxu/xdrive-server
ghcr.io/lazyxu/xdrive-web
```

The installer pulls these images anonymously. If a server gets `denied` from GHCR, verify that both container packages allow public/read access, or authenticate that server first with `docker login ghcr.io`.

## Windows client

Download and run:

```text
xDriveSetup-amd64.exe
```

This is the **unified Windows client installer**. It is per-user, does not require WinFsp, and installs all three client components under `%LOCALAPPDATA%\Programs\xDrive`:

```text
desktop\xdrive-desktop.exe   Electron graphical client
xdrive-agent.exe             headless CfAPI/sync core
xd.exe                       CLI / diagnostics / automation
```

The installer adds `xd` to the user PATH, registers the headless Agent for current-user login startup, creates the visible **xDrive** Start-menu shortcut for Electron Desktop, and starts Desktop after an interactive install. Silent updates restart Desktop in background/Tray mode.

Electron is the only graphical client. It owns the window, Tray, notifications, login/password UI, sync controls, cloud-file management, transfer center, diagnostics/self-repair, conflict center, storage-policy tree/cache controls, and Agent lifecycle monitoring. `xdrive-agent.exe` remains a hidden user-session process because the CfAPI sync root belongs to the interactive user/Explorer session; it is not a Windows service. Quitting Electron does not stop synchronization.

Windows publishes only the unified `xDriveSetup-amd64.exe` installer.

Stable tagged Windows releases Authenticode-sign `xd.exe`, `xdrive-agent.exe`, the embedded `xdrive-desktop.exe`, and the final unified `xDriveSetup-amd64.exe`. Stable publishing is refused when the signing certificate secrets are absent.

## Linux client

Download:

```text
xdrive-linux-amd64.deb
```

Install on Debian/Ubuntu:

```bash
sudo apt install ./xdrive-linux-amd64.deb
```

This is the **unified Linux client package**. It contains Electron Desktop together with `xd`, `xdrive-agent`, the FUSE client, updater, and systemd unit definitions. The package absorbs/replaces the earlier standalone `xdrive-desktop` package during migration, so users do not need to install two packages.

Electron Desktop starts at user login by default and keeps the Agent healthy. The background Agent can still run independently, and `xd` remains available for terminal workflows. `fuse3` and the Electron runtime dependencies are declared by the unified package.

Linux publishes only the unified `xdrive-linux-amd64.deb` installer.

Unlike Windows CfAPI, the Linux FUSE client is **not a fully mirrored sync folder**. It presents the remote tree as a mounted filesystem. Opening an existing file downloads it into a temporary local cache; reads/writes operate there, and dirty content is uploaded through the same resumable 8 MiB chunk protocol on flush/release.

## Client version checks and automatic updates

Windows and Linux clients use the same three release channels as the server:

- **stable** — latest stable GitHub Release tagged `vMAJOR.MINOR.PATCH`;
- **master** — latest fully successful master build from the rolling `snapshot` prerelease;
- **commit** — an immutable successfully published master build identified by commit SHA and released as `snapshot-<sha12>`.

Stable builds default to `stable`. Builds whose embedded version is `snapshot-<sha12>` default to `master`. Plain local `dev` builds do not auto-update unless a channel is explicitly selected. Before installation, the client prefers the SHA-256 digest and exact asset size already returned by the GitHub Release API; legacy releases without a digest fall back to `SHA256SUMS.txt`. Release assets are downloaded from the GitHub asset API first and the browser download URL second. Interactive/manual updates print five stages (check, checksum, download, verify, install), show the target installer/package size before transfer, and report downloaded bytes / total / percentage / current rate / elapsed time during transfer. Partial files are kept as `.part` files and resumed with HTTP Range across retries **and across a later rerun of the update command**, so a weak connection no longer forces a large installer back to byte zero. Metadata and checksum requests also retry with backoff. The short metadata timeout is not used as the total installer download deadline.

**Windows:** the background updater resolves and verifies `xDriveSetup-amd64.exe`. That single asset contains Electron Desktop, Agent, and `xd`, so `xd update --install` upgrades the complete client rather than only the Go Core. The updater now hands installation to a detached transaction: it stops Desktop/Agent, creates a last-known-good copy of the installed client, installs with automatic starts suppressed, verifies the new `xd` version and Agent Desktop-IPC handshake, then starts the new Desktop. Only after those checks pass does it remove an older standalone `xDrive Desktop` installation from Phase 2–5. If installation or health verification fails, the previous client directory is restored and the old Agent/Desktop are restarted. Transaction state is written under the user cache directory. Run `xd update --status` to inspect the latest state (`preparing`, `installing`, `verifying`, `success`, `rolled_back`, or `failed`) together with the target version and local transaction log path. `xd doctor` reports only the state, target version, and timestamp; local paths and transaction error text are intentionally omitted from the diagnostic report.

**Linux:** `xdrive-update.timer` installs a verified `xdrive-linux-amd64.deb` through `apt-get`. That package contains Desktop, Agent, `xd`, FUSE integration, and updater files, so the same package transaction advances the complete client. The package post-install hook verifies that all three client executables exist and that `xd version` matches the package's embedded target version before reporting success.

Useful commands:

```text
xd version
xd update
xd update --install
xd update --channel stable
xd update --channel master --install
xd update --channel commit --commit 0123456789ab --install
xd update --status
xd doctor
```

`xd doctor` and Electron Diagnostics share the same Go diagnostic engine. It produces a copy/paste-safe report with version/update channel, GitHub update metadata reachability, local config, credential backend, cache policy, server/TLS health, authenticated API access, sync-root state, free disk space, and platform updater/mount integration. Windows additionally checks the most recent client-upgrade transaction state, CfAPI sync-root registration, and xDriveAgent autorun; Linux checks FUSE mount state plus the systemd updater and user mount-agent services. Secrets, tokens, session IDs, and the user's home path are not printed. Use `xd doctor --strict` to return non-zero when a check fails.

`xd update --status` shows the full local transaction record on platforms that support detached update transactions, including the local log path. Use `xd doctor` when a redacted, copy/paste-safe summary is needed.

For a persistent pinned commit target, set both `XD_UPDATE_CHANNEL=commit` and `XD_UPDATE_COMMIT=<sha>` in the updater environment. `XD_UPDATE_CHANNEL=stable|master` can also override the build's default channel. On Linux a manual root update can use `sudo xdrive-updater --channel ...`.

For restricted or high-latency networks, the updater honors the standard `HTTPS_PROXY` environment used by Go's HTTP transport. A regional/custom asset mirror can be configured with:

```text
XD_UPDATE_ASSET_MIRROR=https://mirror.example.com/xdrive
```

The mirror contract is `<base>/<release-tag>/<asset-name>`; it is tried before the GitHub asset API and browser download URL, while SHA-256 verification remains mandatory. `XD_UPDATE_API_BASE` can additionally point metadata/API requests at a compatible GitHub API proxy.

Set `XD_DISABLE_AUTO_UPDATE=1` to disable the Windows agent's automatic update checks.

## CLI

```text
xd login --server URL --username USER --password PASS
xd password --current CURRENT --new NEW
xd status
xd config --mount PATH
xd mount [PATH]
xd version
xd update [--channel stable|master|commit] [--commit SHA] [--install]
xd update --status
xd doctor [--strict]
xd logout
```

`XD_PASSWORD` can be used instead of `--password`.

The desktop client config is stored under the operating system's user config directory, but **authentication tokens are not stored in `config.json`**. Windows keeps the long-lived refresh credential encrypted with current-user DPAPI. Linux prefers Secret Service through `secret-tool`; when no Secret Service is available (for example on a headless server), xDrive falls back to a credential file inside a `0700` directory with `0600` permissions. `libsecret-tools` is a recommended, not mandatory, Linux package. Access tokens are kept in process memory and are reacquired from the protected refresh credential after a client restart.

## Authentication

xDrive uses first-party username/password authentication with **rotating Access Token + Refresh Token sessions**:

1. there is no public registration endpoint; administrators create every user account;
2. login sends the username/password over HTTPS to `/api/v1/auth/login`; the server stores only a bcrypt password hash;
3. a successful login returns a short-lived HS256 access JWT plus a long-lived opaque refresh token;
4. authenticated file/API calls send the access token as `Authorization: Bearer <access-token>`;
5. before the access token expires, Windows, Linux and the Web UI call `POST /api/v1/auth/refresh` automatically;
6. every successful refresh rotates the refresh token: the old token is revoked and a new access/refresh pair is returned;
7. logout calls `POST /api/v1/auth/logout` to revoke the current refresh session before local credentials are removed.

Each user also has a server-side `session_version`. Disabling an account, resetting its password, or revoking sessions increments that version and revokes refresh tokens, so already-issued access JWTs stop working immediately on the next API request.

Defaults:

```text
XD_ACCESS_TOKEN_TTL=15m
XD_REFRESH_TOKEN_TTL=720h   # 30 days
```

The refresh token is random and opaque. The server stores only its SHA-256 hash in PostgreSQL, never the raw refresh token. Desktop clients persist only the refresh credential in the platform-protected store described above; the access JWT remains memory-only and the **password is never stored**. Older xDrive desktop configs containing plaintext access/refresh tokens are migrated automatically on first load and immediately rewritten without those fields. The Linux and Windows clients share the same refresh logic, including protection against two local processes racing refresh-token rotation.

For migration, pre-refresh JWTs are still accepted until they expire, and the login response retains the legacy `token` field as an alias of `access_token`.

This MVP does not yet implement OAuth/OIDC, SSO or MFA. Use HTTPS for any non-local deployment.

## Administrator-managed accounts

Roles are intentionally simple: `admin` and `user`.

Administrators can use the Web **Users** panel to:

- create users or additional administrators;
- issue a temporary password and require the user to change it at first login;
- enable or disable an account;
- promote/demote roles while protecting the last active administrator;
- reset a password, which immediately revokes existing sessions;
- revoke all sessions without changing the password;
- set a per-user storage quota (or leave the account unlimited);
- inspect current-file, recycle-bin, version-history, and total physical usage;
- permanently delete a user and that user's stored files.

Ordinary users can change only their own password. A user marked `must_change_password` can access only identity/password-change endpoints until the password is changed.

## Storage quota

Each account has an administrator-managed `quota_bytes`; `0` means unlimited. Users can inspect their own usage at `GET /api/v1/me/quota`. The Web header shows **used / total** with a current-files / recycle-bin / history breakdown, and `xd status` prints the same accounting. The administrator **Users** panel shows the breakdown for every account and can change the quota.

Quota follows retained physical file content, not only the visible directory tree:

- `logical_file_bytes`: current blobs belonging to active files;
- `trash_bytes`: current blobs whose nodes are in the recycle bin;
- `history_bytes`: all retained historical-version blobs;
- `physical_used_bytes`: the sum of **unique physical storage objects referenced by that user** across current files, recycle-bin files, and historical versions.

Current files, recycle-bin content, and historical versions therefore all count, but repeated references to identical content count only once per user. Moving a file into the recycle bin does **not** free quota; permanent deletion frees bytes only when that user no longer references the corresponding physical blob. Restoring a historical version swaps which retained blob is current versus historical, so it does not change total physical usage. An overwrite consumes the new blob size only when that user does not already reference identical content. Cross-user deduplication does not reduce either user's quota charge; each account is charged independently for the unique content it references.

Resumable uploads that provide the full-file SHA-256 can perform an early dedup-aware capacity check. Legacy multipart/direct writes must first stream and hash the body before the server can know whether the content is already referenced by that user; their authoritative quota check therefore occurs at publish time. All publish/finalize transactions hold a per-user database lock, so concurrent uploads cannot each observe the same remaining capacity and collectively exceed it. A rejected write returns HTTP `507` with `error: quota_exceeded`, the configured quota, current physical usage, and required byte counts.

Administrators may lower a quota below current usage. Existing data is never deleted; the account is reported as over quota and writes that require a new unique retained blob remain blocked until usage falls below the limit or the quota is raised. Creating another reference to content the same user already retains remains allowed because it adds zero quota bytes. In-progress resumable-upload chunks are temporary staging data and are not counted as retained user quota; they are deleted after finalize/abort or session expiry, so host-level free-space monitoring remains a separate concern.

## Recycle bin and file version history

Deleting a file or directory from Web, Windows CfAPI, or Linux FUSE is now a **soft delete**. The item disappears from normal directory listings and desktop synchronization, but its metadata and blobs remain recoverable in the user's recycle bin.

The Web UI provides **Recycle bin** actions to restore an item to its original parent or permanently delete it. Restore is rejected if the original parent is unavailable or another active sibling now uses the same name. Permanent deletion removes the node subtree, current blobs, and every retained file-version blob.

Every successful content overwrite preserves the previous blob in `xd_file_versions` together with its file revision, size, and timestamp. The Web **History** action can download a historical version or restore it. Restoring a historical version first preserves the then-current content as another history entry, so a restore can itself be reversed.

Recycle-bin and version-restore mutations retain the same `If-Match` revision preconditions used by normal conflict protection.

## Download-only share links

The Web UI can create a public **download-only** link for an individual file. The first version deliberately does not expose directory ZIP downloads or anonymous uploads.

Each share can have:

- an optional expiration time;
- an optional password (bcrypt-hashed, minimum 8 characters when set);
- an optional maximum download count, where `0` means unlimited;
- explicit owner revocation.

The bearer share token contains 256 bits of randomness. xDrive returns the raw token only once, when the share is created, and PostgreSQL stores only its SHA-256 hash. The Web link uses a URL fragment such as:

```text
https://drive.example.com:8443/#/s/<share-token>
```

Browser fragments are not sent in the HTTP request path, so the raw share token is not written into normal Web/Caddy/API access URLs. The Web client sends the token to the API only in the `X-XDrive-Share-Token` request header. Treat a share link like a bearer credential and avoid logging that header in custom reverse-proxy configurations.

Moving a shared file, or a parent directory containing it, into the recycle bin permanently revokes all affected share links in the same database transaction. Restoring the file does **not** reactivate those old links. Permanent deletion removes the corresponding share metadata. Renaming, moving between active directories, or replacing the file contents does not revoke the link; an active share downloads the file's current content.

Download-count admission is serialized with a PostgreSQL row lock, so simultaneous requests cannot collectively exceed a configured maximum. Wrong passwords do not consume the download count. Shares owned by a disabled account are unavailable while that account is disabled.

## Desktop agent IPC

The Go background agent exposes a private, process-lifetime Desktop IPC endpoint for the Electron main process. It is deliberately separate from the public xDrive server API and from the browser-facing Web UI.

At agent startup, xDrive binds an ephemeral **loopback-only** HTTP listener and writes a discovery document named `desktop-ipc.json` below the current user's xDrive config directory. The document contains the loopback base URL, API version, agent PID, and a random 256-bit bearer token. The config directory is restricted to the current user and the discovery file is written with mode `0600` where the platform supports POSIX permissions. The file is removed when the owning agent exits; an agent never deletes a discovery file whose token belongs to another process.

Desktop IPC authentication is independent of the xDrive server login. Every request must originate from a loopback address and send:

```text
Authorization: Bearer <desktop-ipc-token>
```

The IPC does **not** expose access or refresh tokens. In the Electron integration phase, only the Electron main process should read the discovery file; the renderer should continue to use the narrow preload bridge.

Phase 3 endpoints are:

```text
GET   /v1/hello
GET   /v1/status
GET   /v1/events?after_revision=N&timeout_ms=25000

POST  /v1/auth/login
POST  /v1/auth/logout
POST  /v1/auth/change-password

POST  /v1/sync/pause
POST  /v1/sync/resume
POST  /v1/sync/now

GET   /v1/settings
PATCH /v1/settings
PUT   /v1/settings/sync-rule

GET   /v1/file-availability?path=<path>
POST  /v1/file-availability

GET   /v1/transfers
GET   /v1/transfer-events?after_revision=N&timeout_ms=25000
POST  /v1/transfers/retry

GET   /v1/diagnostics
GET   /v1/diagnostics/report
POST  /v1/diagnostics/reconnect
POST  /v1/diagnostics/repair-sync-root
POST  /v1/diagnostics/open-logs

GET   /v1/conflicts
POST  /v1/conflicts/open
POST  /v1/conflicts/resolve

POST  /v1/open-folder
POST  /v1/lifecycle/shutdown
```

`/v1/events` is a bounded long-poll over monotonically increasing in-memory status revisions. It returns immediately when the revision changes and otherwise returns `204 No Content` at the requested timeout. `/v1/transfer-events` uses the same bounded long-poll pattern with an independent transfer revision so byte-progress updates do not churn the general account/sync status stream.

The Desktop Cloud Files page also reuses the Server's existing node/quota/trash/version/share APIs through the Go Agent. Directory browsing calls the existing node children endpoints. Full-cloud search now calls the owner-scoped Server `GET /api/v1/search` endpoint instead of downloading the entire tree with Agent-side `Walk()`; the Server returns matched nodes together with relative paths and directory breadcrumbs. Quota shows current logical files, recycle-bin bytes, version-history bytes, and total physical usage. Trash restore/permanent delete and historical-version restore preserve the existing revision/If-Match semantics. Share creation returns the one-time public share token/link only for the creation response; existing share tokens remain non-recoverable and can only be inspected/revoked.

The Agent exposes the cloud directory hierarchy as a storage-policy tree. Folder rows map directly to the existing selective-sync rules: **Default** removes an explicit rule and follows the nearest parent policy, **Not synced** maps to `exclude`, and **Always keep** maps to `always-local`. The old path-entry controls are no longer the primary Desktop UX.

Windows additionally reports persistent CfAPI cache usage as used / configured limit / safely reclaimable / pinned bytes and can release all reclaimable cache in one action. Reclaimable means a synced, non-pinned, non-`always-local` Cloud File; pinned or Always keep content is never evicted by this action. Linux FUSE does not claim persistent cache telemetry because open files use temporary per-handle backing files.

The Agent maintains an in-memory transfer model for uploads, downloads, Windows CfAPI hydration, and dehydration/cache release. Transfer entries expose filename/path, kind/direction, current and total bytes, percentage, instantaneous and average rate, elapsed time, error text, retry count, state, and whether retry is safe. Windows failed upload retries are serialized back through the active sync provider instead of running a second concurrent reconcile. Completed/failed history is bounded and is cleared when the login session changes.

Diagnostics are generated inside the Go Agent from the same `internal/diagnostics` package used by `xd doctor`, then redacted before crossing Desktop IPC. Electron Main adds the already-negotiated Desktop/Agent protocol compatibility result, owns diagnostic report export, and capability-gates diagnostics/actions so an older Agent receives an explicit upgrade-required error instead of an endpoint 404. **Reconnect** serializes a mount restart through the Agent controller; **Repair Sync Root** additionally re-registers Windows CfAPI before reconnecting. **Open logs** opens the per-user Agent log directory. Repair operations never execute shell commands in the renderer.

The Electron desktop client consumes this IPC from its **main process**. The renderer sees only typed business operations through the preload bridge; the discovery URL and bearer token never cross into renderer state. Electron is now the sole graphical client: it covers sign-in, required password changes, cloud browsing/search, quota, recycle bin, version-history restore, share-link management, live sync state, pause/resume, sync-now, transfer-center views for active/completed/failed work, safe retry of retryable failures, a Doctor-backed diagnostics/self-repair page, storage policy/cache management, mount/cache settings, logout, conflict review/resolution, tray actions, and desktop notifications. The Go `xdrive-agent` is headless and owns only sync/system capabilities plus Desktop IPC. The `xd` CLI remains fully supported.

Desktop lifecycle negotiation starts with `GET /v1/hello`. The response advertises the Agent version, PID, platform/architecture, supported Desktop IPC protocol range, and named capabilities. Desktop refuses an incompatible protocol instead of silently calling endpoints with mismatched semantics. The current protocol range is `1..1`.

Electron also owns user-session lifecycle behavior. By default the packaged Desktop registers itself to start at login with `--background`, creates only the Tray surface on that launch, and automatically starts `xdrive-agent` when IPC discovery is absent. If the Agent exits unexpectedly, Desktop retries and restores it. A manual **Restart Agent** action uses the authenticated lifecycle shutdown endpoint, waits for the old process to stop, then starts a fresh single Agent instance. Linux now has a real per-user process lock, matching the existing Windows single-instance guarantee.

## HTTP API

Authenticated endpoints use:

```text
Authorization: Bearer <jwt>
```

Main routes:

```text
GET    /api/v1/healthz
GET    /api/v1/readyz
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
GET    /api/v1/me/quota
GET    /api/v1/me/storage
POST   /api/v1/me/change-password
GET    /api/v1/search?q=report&type=file&limit=50&cursor=...
GET    /api/v1/nodes/root
GET    /api/v1/nodes/:id/children
POST   /api/v1/nodes/:id/directories
POST   /api/v1/nodes/:id/files
PATCH  /api/v1/nodes/:id
DELETE /api/v1/nodes/:id
GET    /api/v1/trash
POST   /api/v1/trash/:id/restore
DELETE /api/v1/trash/:id
GET    /api/v1/files/:id/content
PUT    /api/v1/files/:id/content

POST   /api/v1/uploads
GET    /api/v1/uploads/:id
PUT    /api/v1/uploads/:id/chunks/:index
POST   /api/v1/uploads/:id/finalize
DELETE /api/v1/uploads/:id

GET    /api/v1/files/:id/versions
GET    /api/v1/files/:id/versions/:versionID/content
POST   /api/v1/files/:id/versions/:versionID/restore

POST   /api/v1/files/:id/shares
GET    /api/v1/files/:id/shares
DELETE /api/v1/shares/:id

GET    /api/v1/sources
POST   /api/v1/sources
GET    /api/v1/sources/:id
PATCH  /api/v1/sources/:id
DELETE /api/v1/sources/:id
GET    /api/v1/sources/:id/runs
POST   /api/v1/sources/:id/runs
GET    /api/v1/sources/:id/runs/:runID
POST   /api/v1/sources/:id/runs/:runID/observe
POST   /api/v1/sources/:id/runs/:runID/finish

GET    /api/v1/public/share
POST   /api/v1/public/share/download
       X-XDrive-Share-Token: <raw-share-token>

GET    /api/v1/admin/users
GET    /api/v1/admin/audit
GET    /api/v1/admin/storage
GET    /api/v1/admin/storage/health
GET    /api/v1/admin/storage/history?days=30
POST   /api/v1/admin/users
PATCH  /api/v1/admin/users/:id
DELETE /api/v1/admin/users/:id
POST   /api/v1/admin/users/:id/reset-password
POST   /api/v1/admin/users/:id/revoke-sessions
```

Existing-node mutations use revision preconditions via `If-Match`; node JSON includes `revision`, and file downloads expose the same revision as an `ETag`.

Downloads support HTTP Range requests, which are also used by the Windows hydration path.

## Resumable chunked uploads

Desktop and Web file uploads use fixed-size resumable upload sessions instead of one giant HTTP request.

The default chunk size is **8 MiB**; the server accepts chunk sizes from 4 MiB through 16 MiB:

```text
create/resume session
        ↓
query received chunks + hashes
        ↓
PUT only missing/mismatched chunks
        ↓
finalize
        ↓
stream chunks into the final blob
        ↓
verify whole-file SHA-256
        ↓
atomically publish metadata
```

Each chunk is sent with:

```http
X-Chunk-SHA256: <64 hex chars>
```

The server validates the expected chunk length and SHA-256 before recording the part. Chunk PUTs are idempotent, so a lost response can be retried safely.

Windows and Linux calculate the full local-file SHA-256 plus the SHA-256 of every fixed-size chunk before starting a session. The full hash is the resume key. If an agent or process restarts with the same content, the server returns the existing upload session and only missing or mismatched chunks are transferred. The Web UI also sends a per-chunk hash manifest and recomputes a chunk before transmitting it.

Finalize is also idempotent. A client that loses a successful finalize response can reconnect for up to 24 hours and recover the already-created result rather than create a duplicate. Expired upload-session metadata and temporary chunk blobs are cleaned by the upload janitor.

For overwrites, the server compares the client's chunk-hash manifest with the current revision using the same fixed chunk size. Matching chunks are recorded as **server-reused ranges** that point at the old blob and consume no upload bandwidth; only changed chunks are sent by the client. Finalize streams reused ranges directly from the old blob together with newly uploaded chunks, verifies the whole-file SHA-256, and then performs the existing node-revision compare-and-swap. If another writer changes the file while chunks are uploading, finalize returns `409 revision_conflict` and does not replace the newer server content. On success, the previous current blob is moved into **file version history** before the assembled blob becomes current.

File metadata can expose a server-verified content hash:

```json
{
  "size": 10737418240,
  "sha256": "..."
}
```

Downloads expose the same value as `X-Content-SHA256`. Storage verification checks recorded SHA-256 values for both current files and historical versions. In-progress chunks live below `.xdrive-uploads/` and are intentionally excluded from orphan-blob reporting until their sessions expire, finalize, or are aborted.

The transfer layer remains **fixed-block resumable transfer with same-file revision reuse**. For example, if a 10 GiB file keeps the same block alignment and only one 8 MiB block changes, the desktop client can upload roughly that changed block instead of retransmitting the other unchanged blocks. Final retained files use full-file SHA-256 content-addressed storage: identical complete files and historical versions share one physical blob globally, with reference-counted garbage collection.

When the client supplies the full SHA-256 during `POST /api/v1/uploads`, xDrive can now **instant-finalize** the upload without sending any file chunks if the same user already has a durable current/trash/history reference to that CAS blob. The target name/revision, quota, CAS metadata, and physical object are revalidated transactionally; overwrite instant-finalize still preserves the previous revision in history. This optimization is intentionally owner-scoped: merely knowing the SHA-256 of another user's blob is not proof of possession, so cross-user hash probes fall back to the normal upload path. Global physical deduplication still occurs after those bytes are actually uploaded.

This is intentionally not CDC: insertions near the beginning can still shift later fixed blocks during upload, and partial/chunk-level content is not shared across unrelated files.

Phase 12 adds **Storage Intelligence** before changing the storage format again. Authenticated users can query `GET /api/v1/me/storage` for owner-scoped CAS statistics; administrators can query `GET /api/v1/admin/storage` for the global view. The same user view is exposed in Web and Desktop without exposing another user's storage profile. Statistics include CAS blob count, physical bytes, logical referenced bytes, dedup saved bytes/ratio, average size, p50/p90/p99, and these fixed non-overlapping buckets: `<16 KiB`, `16–64 KiB`, `64–256 KiB`, `256 KiB–1 MiB`, `1–4 MiB`, `4–16 MiB`, `16–64 MiB`, and `>=64 MiB`. Legacy pre-CAS objects are reported separately and are not mixed into CAS percentiles.

The purpose of these measurements is to make the next storage-format decision data-driven: a high count/byte share of very small blobs supports small-file packing, while large-file workloads with meaningful cross-file internal redundancy support evaluating CDC. Percentiles are calculated by PostgreSQL rather than by loading all blob sizes into the API process.

Phase 12B adds a separate **CAS health / verify / repair** layer. `GET /api/v1/admin/storage/health` and `xdrive-server storage health` perform a lightweight DB-only invariant check for missing CAS metadata, refcount/state/size drift, non-canonical key/hash mappings, invalid states, and stale deleting rows. Full `storage verify` remains the authoritative physical check: it walks retained objects, validates size and SHA-256, and reports missing/corrupt/orphan data.

Safe repair is intentionally narrower than verification. `xdrive-server verify --repair` stops the API service, reconciles only CAS metadata that can be proven from durable references plus a size/hash-verified physical object, marks unreferenced metadata as `deleting`, and then runs the full verifier. It never fabricates missing file content, rewrites a corrupt blob, or automatically deletes legacy/orphan data. Use `xdrive-server verify --repair --dry-run` to inspect the repair plan without changing metadata.

Phase 12C adds a small **Storage Decision Gate / Historical Sampling** layer. The server records one global CAS snapshot every six hours and retains 180 days. Each snapshot stores CAS blob count, physical/logical bytes, full-file dedup ratio, p50/p90/p99, and the complete Phase 12 size-bucket distribution. Administrators can query `GET /api/v1/admin/storage/history?days=30`; the Web global-storage panel shows recent trends and a transparent decision signal.

The decision gate intentionally requires at least 24 hours of history before choosing a direction. Over the recent seven-day window, sustained small-object pressure (`<64 KiB` count share >=50% or `<256 KiB` count share >=75%) points to **Small-file Packing**. Otherwise, when blobs `>=16 MiB` dominate at least 60% of physical bytes, `<64 KiB` count share stays below 35%, and whole-file dedup remains below 1.15x, the gate points to **CDC evaluation**. That CDC signal describes workload shape only; it does not claim that block-level redundancy has already been proven. Ambiguous workloads remain in `observe` rather than forcing a storage-format change.

Phase 13A adds a vendor-neutral **External Source Foundation** for future import/sync connectors. `xd_sources` records connector kind, push/pull direction, backup/mirror policy, lifecycle state, revision, and an opaque checkpoint without storing connector credentials. `xd_source_items` preserves stable external identity with `(source_id, external_id)` and optionally maps that identity to an xDrive node while retaining source-side path, revision, hash, and sync state. `xd_sync_runs` records each synchronization attempt, trigger, checkpoints, counters, transferred bytes, terminal state, and error summary.

The mapping deliberately targets `xd_nodes`, not `xd_content_blobs`: a source item describes an external file/directory identity, while CAS describes bytes. Renames and moves can therefore keep the same source identity and node without manufacturing new content. Deleting a mapped xDrive node sets the mapping to NULL for later reconciliation; deleting a source cascades its item/run history. Phase 13A contains no Synology-specific fields, no source credentials, no scheduler, and no file transfer implementation.

Phase 13B adds the **Source Execution Foundation** without introducing a vendor connector yet. A source now binds to one active owner-scoped xDrive target directory, has a default `sync` or `scan` run mode, and stores a bounded ignore-rule set. Source configuration uses optimistic revisions and is exposed through owner-scoped Source CRUD plus read-only run-history APIs. Only `backup` behavior is exposed: a source-side disappearance is represented as `missing` and never deletes or trashes the xDrive node.

The shared `internal/source` planner normalizes discovered items and classifies them as `ignore`, `unchanged`, `create`, `update`, `move`, or `move_update`. Ignore rules use a gitignore-like ordered syntax with `*`, `**`, `?`, comments, rooted/directory patterns, and `!` negation; rules are evaluated identically for scan and sync planning. Fast scan planning does not hash every source file: it uses stable external identity plus size/mtime, or a connector-provided remote revision/hash when available. SyncRun statistics separately record scanned, ignored, new, changed, moved, unchanged, missing, planned-transfer, actual-transfer, and failure counts/bytes. `LastSeenRunID` provides deterministic missing detection for future executors without relying on wall-clock cutoffs.

Phase 13C begins with a connector-neutral **Source Scan Protocol**. A source agent creates an idempotent run with a client-generated UUID, posts normalized observations in bounded batches, receives stable planner actions, and finishes the run with its scan summary. Observation retries are safe because managed baselines are not advanced for pending update/move work. Run startup snapshots the source revision, target directory, ignore rules, mode, and checkpoint so configuration changes cannot alter planning halfway through a scan. Only one live run is accepted per source; stale runs can be superseded after their heartbeat expires.

Missing detection runs only when the agent explicitly marks the inventory complete. The server compares `LastSeenRunID` against the finished run and applies the same snapshotted ignore rules before marking unseen items `missing`; incomplete or interrupted scans therefore never infer deletion. First-seen ignored objects are not persisted, while previously managed objects that become ignored retain their last synchronized baseline for correct reconciliation if the rule is later removed.

Phase 14A adds **Server-side Search** for active files and directories. `GET /api/v1/search` is owner-scoped, accepts a UTF-8 query of at least two characters, optional `type=file|dir`, `limit` from 1–200, and an opaque keyset `cursor`. Matching is case-insensitive against each active node's relative path, preserving the previous Desktop full-path search behavior without transferring the entire namespace to the Agent. Results include the normal node payload, relative `path`, directory `breadcrumbs`, and `next_cursor`; cursors are bound to the original query/type so they cannot be reused across different searches. Deleted/trash nodes and other users' nodes are never included.


## Conflict protection

xDrive uses optimistic concurrency control for mutations of existing nodes. Every node has a monotonically increasing `revision` value.

Content overwrite, rename/move and delete requests send the revision they were based on:

```http
If-Match: "17"
```

The server requires this precondition for `PUT /files/:id/content`, `PATCH /nodes/:id`, and `DELETE /nodes/:id`:

- a matching revision applies the mutation and increments the node revision;
- a missing precondition returns `428 Precondition Required`;
- a stale revision returns `409 Conflict` with `error: revision_conflict`, `expected_revision`, and `current_revision`.

File content replacement is crash/conflict safe: xDrive writes a new blob first, switches metadata with a revision check inside a database transaction, and deletes the old blob only after the transaction commits. A stale writer therefore cannot overwrite the winning blob before the conflict is detected.

For desktop files, xDrive preserves the stale local version rather than silently discarding it. Windows and Linux create a sibling such as:

```text
report (conflict WORKSTATION 20260923-163700.123).docx
```

The server winner remains at the original name.

## Windows end-to-end testing

Normal CI runs a Windows CfAPI E2E test on GitHub's `windows-latest` runner. It exercises sync-root registration, remote placeholder creation, hydration, local upload/overwrite, revision conflicts, conflict-copy preservation, provider shutdown, and the Windows installer lifecycle.

For a real Windows 10/11 desktop against an actual xDrive server, use:

```powershell
.\scripts\windows-e2e.ps1 `
  -Server https://drive-e2e.example.com `
  -InstallerPath .\dist\xDriveSetup-amd64.exe `
  -Username e2e-user `
  -Password 'e2e-password'
```

The E2E account must be created in advance by an xDrive administrator and should not require a first-login password change. The script never creates accounts.

The real-machine script validates installer deployment, CfAPI mounting, placeholder/hydration, local-to-server create/update/rename/delete, server-to-local create/delete, and a stale-write conflict where both versions must survive. `-TokenRefreshWaitSeconds` can additionally validate a test server configured with a deliberately short access-token TTL.

A manual GitHub workflow, **Windows Real-Machine E2E**, targets a self-hosted runner labeled:

```text
self-hosted, windows, x64, xdrive-e2e
```

Repository secrets `XD_E2E_USERNAME` and `XD_E2E_PASSWORD` are required and must identify an administrator-provisioned test account.

## CI, snapshots, and releases

Every push runs cross-platform CI. The test matrix covers:

- Linux Go tests with the race detector;
- PostgreSQL-backed API CRUD and multi-user isolation;
- Linux FUSE build;
- Windows CfAPI tests/build;
- Windows Inno Setup installer build;
- Linux `.deb` installer build;
- React type-check/build;
- server/Web Docker builds;
- Docker Compose validation.

Every push to `master` first runs CI. The Desktop jobs build one unpacked Electron runtime per platform, and the Go jobs embed that exact runtime into the single unified installer (`xdrive-linux-amd64.deb` / `xDriveSetup-amd64.exe`), then run package, upgrade, install, and smoke validation against those exact files. Only after the complete CI gate succeeds does the publish sub-workflow consume the same installer artifacts, build immutable `sha-<sha12>` server images and deployment assets, promote server images to `edge`, and advance the rolling **snapshot prerelease**. No client installer is rebuilt during publishing.

Each successful master build also keeps an immutable prerelease named `snapshot-<sha12>`. The `commit` channel resolves a requested SHA to that prerelease; if no such successful build exists, installation is refused. Snapshot releases expose `.exe`, `.deb`, and shell/config assets directly; single-file deliverables are not wrapped in an extra ZIP/TAR archive. GitHub Actions artifacts are immutable staging inputs to the publish sub-workflow; end users still download from GitHub Releases.

A `v*` tag creates a GitHub Release and publishes versioned server images plus `latest`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release assets are client/deployment deliverables rather than raw application archives:

```text
xDriveSetup-amd64.exe
xdrive-linux-amd64.deb
xdrive-server-install.sh
server-backup.sh
server-backup-scheduled.sh
server-restore.sh
server-verify.sh
server-doctor.sh
xdrive-server
docker-compose.yml
Caddyfile
xdrive.env.example
SHA256SUMS.txt
```

## Repository layout

```text
cmd/
  server/                 HTTP server
  xd/                     CLI
  xdrive-agent/           background client agent
  xdrive-updater/         stable-release updater
internal/
  admin/                  first-administrator bootstrap
  api/                    Gin routes + handlers
  auth/                   password hashing + JWT
  client/                 REST client
  config/                 server environment config
  meta/                   GORM models + filename validation
  mount/                  Linux FUSE + Windows CfAPI
  secretstore/            DPAPI / Secret Service credential storage
  source/                 external-source ignore rules and fast planner
  storage/                Local storage backend
  userconfig/             per-user non-secret client configuration
  update/                 release check/download/checksum/update logic
  version/                build-time client version
ui/
  shared/                  shared Web/Electron UI contracts + pure helpers
web/                       React Web UI
desktop/                   Electron desktop shell
  src/main/                Electron main process
  src/preload/             narrow contextBridge preload
  src/renderer/            React renderer
packaging/
  windows/                 Inno Setup definition
  linux/                   systemd user mount service + root update timer
scripts/
  build-linux-deb.sh
  build-windows-installer.ps1
  server-backup.sh
  server-restore.sh
  server-verify.sh
  server-doctor.sh
  xdrive-server-host.sh
  test-server-backup-restore.sh
  test-server-installer-pipe.sh
  test-xdrive-server-host.sh
  test-server-doctor.sh
deploy/
  Caddy.Dockerfile          Caddy + AliDNS DNS-01 module
  Caddyfile
  docker-compose.yml
  install-server.sh
.github/workflows/
  ci.yml
  release.yml
```

## Security and MVP limitations

- Use HTTPS in production; JWTs are bearer credentials.
- Use the generated long `XD_JWT_SECRET` and keep `~/.xd/.env` private.
- The server validates names against a Windows-compatible filename subset.
- Local storage rejects path traversal and writes uploads through temporary files followed by rename.
- File operations are owner-scoped at the metadata layer.
- There is no antivirus scanning yet; public sharing is download-only and file-only in this phase. Security-sensitive audit logging is enabled, while routine file reads are intentionally not audited.

## Roadmap

1. Phase 13C: build the native Synology source agent for Personal + Shared Photos push, fast scan-only, ignore rules, local incremental state, and resumable/instant upload execution;
2. Phase 13D: add the experimental Yike Photos pull worker for the own library, own albums, and shared albums without mutating the source account;
3. Phase 13E: add optional photo metadata/collection adapters such as Live Photo grouping and album semantics without coupling them to the source schema;
4. use Phase 12/12B/12C Storage Intelligence, CAS health, and 180-day historical sampling as the decision gate for the next storage-format change;
5. optional content-defined chunking when large-file/internal-redundancy data justifies it;
6. small-file packing when small-blob count/metadata pressure justifies it;
7. macOS File Provider integration;
8. thumbnails/EXIF/media processing;
9. directory/upload sharing and richer retention/version policies.

## License

Apache License 2.0. See [LICENSE](LICENSE).
