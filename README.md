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

Not in the MVP: global/cross-file deduplication, content-defined chunking (CDC), small-file packs, thumbnails/transcoding, directory/upload sharing, MinIO, macOS, or mobile clients.

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
xdrive-server verify
xdrive-server admin list
xdrive-server admin reset-password admin
xdrive-server admin enable admin
xdrive-server admin disable USER
```

The host-side `xdrive-server` command runs **outside Docker** and controls `~/.xd` plus Docker Compose. The `xdrive-server` executable inside `xdrive-server-1` remains the API daemon. The API container is not given `/var/run/docker.sock` or host-management privileges.

The host manager downloads the latest bootstrap installer to a temporary file, validates it with `bash -n`, and then runs that file with stdin detached from any download pipe. The installer resolves the selected successfully published release/commit and uses immutable `sha-<commit>` images for master/commit channels.

For a tagged release, download and run the release asset `xdrive-server-install.sh`; it pins the matching container image tag. Releases also publish the standalone host manager asset `xdrive-server`.

Upgrades are serialized with an exclusive `flock` lock. Existing deployments enter a maintenance window after the pre-upgrade backup: public Web/Caddy containers are stopped, the new API is started and health-checked before public services are reopened, and deployment files are treated as a transaction. If the new API fails after migration/startup begins, xDrive restores the verified pre-upgrade database/blob backup plus the previous deployment files and images. Failures before the database is touched restore deployment state only. Docker pull's noisy per-layer output is captured to a private log; the terminal shows concise xDrive transfer summaries instead. If rollback itself cannot complete, the transaction state is retained under `~/.xd/.upgrade-transaction` for manual recovery.

The installer:

1. checks Docker and Docker Compose v2 and acquires the exclusive install/update lock;
2. detaches every non-interactive Docker/Compose operation from installer stdin so a piped source stream can never be consumed by a child process;
3. creates `~/.xd` with user-only permissions and preserves existing secrets;
4. stages the new Compose/Caddy/maintenance files and host manager;
5. on upgrades, creates a verified **pre-upgrade backup before replacing deployment files** without creating/recreating the formal server service;
6. creates `~/.xd/.env` with random PostgreSQL and JWT secrets if they do not already exist;
7. pulls the xDrive server/Web images and, when a domain is configured, the `xdrive-caddy` image containing the AliDNS plugin;
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

It checks Docker/Compose, current release state, container health, PostgreSQL authentication, data mounts, disk space, upgrade-lock/rollback state, TLS/public reachability, GitHub/GHCR reachability, and appends the last 100 container log lines after automatic secret redaction. It is read-only by default. Use `--strict` when automation should fail on diagnostic errors.

By default, the installer registers a daily scheduled backup at 03:17 local server time and retains seven days. Override with `XD_BACKUP_SCHEDULE` and `XD_BACKUP_RETENTION_DAYS`. Scheduled runs skip rather than overlap if a previous backup is still running.

#### Consistency verification

A normal verification briefly stops the API so the database and blob tree cannot change during the scan:

```bash
~/.xd/server-verify.sh
```

It checks current `xd_files.storage_key` **and historical `xd_file_versions.storage_key`** references against `file-data` and reports:

- database references whose blob is missing;
- blob size mismatches;
- SHA-256 mismatches for current or historical blobs that have a recorded content hash;
- duplicate metadata references to the same blob key;
- orphan blobs that exist on disk but have no current or historical database reference.

The underlying server command is also available inside the container:

```bash
docker compose --env-file ~/.xd/.env -f ~/.xd/docker-compose.yml \
  exec -T server xdrive-server storage verify --json
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

The installer is per-user and does not require WinFsp. It installs:

```text
xd.exe
xdrive-agent.exe
```

under `%LOCALAPPDATA%\Programs\xDrive`, adds the install directory to the user PATH, and starts `xdrive-agent.exe` automatically at login.

The agent is a hidden user-session process with a native Windows notification-area (system tray) UI. It is intentionally a user-session process rather than a Windows service because the CfAPI sync root belongs to the interactive user/Explorer session.

For normal use, **no PowerShell or `xd` command is required**. After installation, use the xDrive tray icon. The icon itself now has five branded states — **normal, syncing, paused, offline, and conflict** — and Windows notifications surface completed sync batches, preserved conflict copies, and expired logins.

- the first two disabled lines show the current account/login state and sync state;
- **登录...** opens xDrive's local account page in the default browser;
- **打开 xDrive** opens the current sync root in Explorer;
- **暂停同步 / 恢复同步** disconnects/reconnects the provider while preserving the configured state across restarts;
- **立即同步** immediately flushes pending local changes and performs a full remote reconciliation;
- **冲突（N）...** opens the local conflict center when unresolved conflict copies exist;
- **账户 / 设置...** opens the local control center for login/password, mount path, file availability, and conflict handling;
- **检查更新** immediately runs the stable-release update check;
- **注销** removes the local JWT credentials and stops the active mount;
- **退出 xDrive** closes the tray agent. The Start menu contains an **xDrive** shortcut to start it again.

The local control center listens only on `127.0.0.1`, uses a random per-agent-session URL token, sends credentials directly to the configured xDrive server, and does not save the password. It shows the current sync state and unresolved-conflict count, and it can inspect/control a file or directory inside the xDrive root:

- **始终保留在此设备 / Always keep on this device** pins the placeholder and hydrates its content;
- **释放空间 / Free up space** and **仅在线 / Online only** unpin and dehydrate in-sync placeholders;
- **立即同步 / Sync now** requests an immediate provider reconciliation;
- a file that is not yet safely represented in the cloud is never dehydrated: xDrive asks the user to finish synchronization first.

There is no registration button; accounts are provisioned by an administrator. If the administrator issued a temporary password with `must_change_password`, the agent blocks synchronization until the user changes it. The default sync root is:

```text
%USERPROFILE%\xDrive
```

The `xd` CLI remains available for advanced use and troubleshooting:

```powershell
xd status
xd config --mount "D:\xDrive"
xd mount "D:\xDrive"
```

### Windows synchronization behavior

Windows uses a **hybrid online-on-demand + bidirectional metadata/content sync** model:

- remote files first appear as CfAPI online placeholders, so their full contents are not downloaded up front;
- Explorer uses Windows' native cloud-file state icons and hydration verbs for xDrive placeholders;
- opening a placeholder hydrates the byte ranges Windows requests from the server;
- pinned placeholders are kept locally; in-sync unpinned placeholders can be explicitly dehydrated and xDrive opts into Windows' automatic-dehydration support;
- local new files/directories are uploaded and then converted into in-sync CfAPI placeholders, so they participate in the same Explorer availability controls;
- local file modifications use resumable 8 MiB chunks with per-chunk SHA-256 and server-side whole-file SHA-256;
- local deletions are propagated to the server;
- Web/API-side creates, changes and deletes are reconciled back into the sync root, with **立即同步** available for an explicit reconciliation;
- concurrent stale writes are rejected by server revisions; the desktop preserves the stale local version as a conflict copy instead of silently overwriting the server winner.

Conflict records are persisted locally per server/account so they survive an agent restart. The conflict center offers four actions:

- **查看冲突** reveals the conflict copy in Explorer;
- **打开两个版本** opens both the current server winner and the preserved local conflict copy;
- **保留本地版本** overwrites the current server node using its latest revision, preserves normal server version history, then removes the conflict copy;
- **保留服务器版本** keeps the server winner and removes the conflict copy.

A resolution failure leaves the conflict record intact so the user can retry instead of silently losing either version.

Stable tagged Windows releases are Authenticode-signed: `xd.exe` and `xdrive-agent.exe` are signed before packaging, then `xDriveSetup-amd64.exe` is signed after Inno Setup builds it. The release workflow refuses to publish a stable Windows installer when the signing certificate secrets are absent. Development/snapshot artifacts can remain unsigned unless signing secrets are configured.

## Linux client

Download:

```text
xdrive-client-linux-amd64.deb
```

Install on Debian/Ubuntu:

```bash
sudo apt install ./xdrive-client-linux-amd64.deb
```

The package installs `xd`, `xdrive-agent`, and a systemd user service definition. `fuse3` is declared as a package dependency.

Login and mount:

```bash
xd login --server https://drive.example.com --username alice --password 'your-password'
# If the administrator issued a temporary password:
xd password --current 'temporary-password' --new 'new-password'
xd mount ~/xDrive
```

To use the optional Linux background agent:

```bash
systemctl --user enable --now xdrive-agent
```

Change the background mount path with:

```bash
xd config --mount /path/to/xDrive
```

Unlike Windows CfAPI, the Linux FUSE client is **not a fully mirrored sync folder**. It presents the remote tree as a mounted filesystem. Opening an existing file downloads it into a temporary local cache; reads/writes operate there, and dirty content is uploaded through the same resumable 8 MiB chunk protocol on flush/release. It does not proactively download the entire drive.

## Client version checks and automatic updates

Windows and Linux clients use the same three release channels as the server:

- **stable** — latest stable GitHub Release tagged `vMAJOR.MINOR.PATCH`;
- **master** — latest fully successful master build from the rolling `snapshot` prerelease;
- **commit** — an immutable successfully published master build identified by commit SHA and released as `snapshot-<sha12>`.

Stable builds default to `stable`. Builds whose embedded version is `snapshot-<sha12>` default to `master`. Plain local `dev` builds do not auto-update unless a channel is explicitly selected. Before any installation, the client downloads `SHA256SUMS.txt` from the same release and verifies the installer/package checksum. Interactive/manual updates print five stages (check, checksum, download, verify, install); installer downloads report bytes, percentage, current transfer rate, and elapsed time. The short metadata timeout is not used as the total installer download deadline.

**Windows:** the background agent checks after startup and then about every 6 hours. Stable builds follow stable; snapshot builds follow master. When an update exists it verifies `xDriveSetup-amd64.exe`, launches it silently, exits, and the updated installer starts the agent again.

**Linux:** the `.deb` installs `xdrive-update.timer` as a root-level systemd timer. It uses the same default channel logic and installs a verified `xdrive-client-linux-amd64.deb` through `apt-get`. The optional user-level mount agent is separate from this updater.

Useful commands:

```text
xd version
xd update
xd update --install
xd update --channel stable
xd update --channel master --install
xd update --channel commit --commit 0123456789ab --install
xd doctor
```

`xd doctor` produces a copy/paste-safe client report with version/update channel, GitHub update metadata reachability, local config, credential backend, server/TLS health, authenticated API access, sync-root state, free disk space, and platform updater/mount integration. Windows additionally checks CfAPI sync-root registration and xDriveAgent autorun; Linux checks FUSE mount state plus the systemd updater and user mount-agent services. Secrets, tokens, session IDs, and the user's home path are not printed. Use `xd doctor --strict` to return non-zero when a check fails.

For a persistent pinned commit target, set both `XD_UPDATE_CHANNEL=commit` and `XD_UPDATE_COMMIT=<sha>` in the updater environment. `XD_UPDATE_CHANNEL=stable|master` can also override the build's default channel. On Linux a manual root update can use `sudo xdrive-updater --channel ...`.

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
- `physical_used_bytes = logical_file_bytes + trash_bytes + history_bytes`.

Current files, recycle-bin content, and historical versions therefore all count. Moving a file into the recycle bin does **not** free quota; permanent deletion does. Restoring a historical version swaps which retained blob is current versus historical, so it does not change total physical usage. A successful overwrite consumes the full size of the new blob because the previous current blob becomes a retained historical version.

Direct uploads and resumable-session creation perform an early capacity check. The authoritative publish/finalize transaction checks quota again while holding a per-user database lock, so concurrent uploads cannot each observe the same remaining capacity and collectively exceed it. A rejected write returns HTTP `507` with `error: quota_exceeded`, the configured quota, current physical usage, and required byte counts.

Administrators may lower a quota below current usage. Existing data is never deleted; the account is reported as over quota and positive-size uploads/overwrites remain blocked until usage falls below the limit or the quota is raised. In-progress resumable-upload chunks are temporary staging data and are not counted as retained user quota; they are deleted after finalize/abort or session expiry, so host-level free-space monitoring remains a separate concern.

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

## HTTP API

Authenticated endpoints use:

```text
Authorization: Bearer <jwt>
```

Main routes:

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
GET    /api/v1/me/quota
POST   /api/v1/me/change-password
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

GET    /api/v1/public/share
POST   /api/v1/public/share/download
       X-XDrive-Share-Token: <raw-share-token>

GET    /api/v1/admin/users
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

This phase is **fixed-block resumable transfer with same-file revision reuse**. For example, if a 10 GiB file keeps the same block alignment and only one 8 MiB block changes, the desktop client can upload roughly that changed block instead of retransmitting the other unchanged blocks. It is still not content-defined chunking or global/cross-file deduplication: insertions near the beginning can shift later fixed blocks, and identical blocks belonging to unrelated files are not shared.

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

Every push to `master` first runs CI. **Build Packages waits for that exact master SHA to pass CI** before publishing anything. It builds immutable `sha-<sha12>` server images and `snapshot-<sha12>` client/deployment assets; only after the complete bundle succeeds are those server images promoted to `edge` and the rolling **snapshot prerelease** advanced. This makes `master` mean the most recent fully successful published master build, not merely the newest commit that started building.

Each successful master build also keeps an immutable prerelease named `snapshot-<sha12>`. The `commit` channel resolves a requested SHA to that prerelease; if no such successful build exists, installation is refused. Snapshot releases expose `.exe`, `.deb`, and shell/config assets directly; single-file deliverables are not wrapped in an extra ZIP/TAR archive. GitHub Actions artifacts are CI plumbing and are not used as the update distribution source.

A `v*` tag creates a GitHub Release and publishes versioned server images plus `latest`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release assets are client/deployment deliverables rather than raw application archives:

```text
xDriveSetup-amd64.exe
xdrive-client-linux-amd64.deb
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
  storage/                Local storage backend
  userconfig/             per-user non-secret client configuration
  update/                 release check/download/checksum/update logic
  version/                build-time client version
web/                       React Web UI
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
- There is no antivirus scanning or audit log yet; public sharing is download-only and file-only in this phase.

## Roadmap

1. instant upload/global deduplication and optional content-defined chunking;
2. selective-sync rules, configurable cache/dehydration policy, and richer version-history UI;
3. small-file packing;
4. macOS File Provider integration;
5. thumbnails/EXIF/media processing;
6. directory/upload sharing and richer retention/version policies.

## License

Apache License 2.0. See [LICENSE](LICENSE).
