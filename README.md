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
| Multi-user | Per-user metadata and storage isolation |

Not in the MVP: chunking, instant upload/deduplication, small-file packs, CDC, thumbnails/transcoding, public sharing, conflict resolution, MinIO, macOS, or mobile clients.

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
- an inbound port for the Web UI (default TCP 3000), or an HTTPS reverse proxy on 80/443.

No PostgreSQL installation is required on the host; Compose runs PostgreSQL for xDrive.

### One-line install from `master` / edge images

```bash
curl -fsSL https://raw.githubusercontent.com/lazyxu/xdrive/master/deploy/install-server.sh | bash
```

Optional values can be supplied on the same command, for example:

```bash
XD_WEB_PORT=8088 XD_WEB_BIND=0.0.0.0 \
  curl -fsSL https://raw.githubusercontent.com/lazyxu/xdrive/master/deploy/install-server.sh | bash
```

For a tagged release, download and run the release asset `xdrive-server-install.sh`; it pins the matching container image tag.

The installer:

1. checks Docker and Docker Compose v2;
2. creates `~/.xd` with user-only permissions;
3. writes `~/.xd/docker-compose.yml`;
4. creates `~/.xd/.env` with random PostgreSQL and JWT secrets if they do not already exist;
5. pulls the xDrive server/Web container images;
6. starts PostgreSQL, the xDrive API server, and the Web UI.

The default Web endpoint is:

```text
http://SERVER_IP:3000
```

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
- `xdrive_file-data`: uploaded file blobs.

For production, put the Web container behind an HTTPS reverse proxy and back up both volumes.

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

For normal use, **no PowerShell or `xd` command is required**. After installation, use the xDrive tray icon:

- the first two disabled lines show the current account/login state and sync state;
- **登录 / 注册...** opens xDrive's local account page in the default browser;
- **打开 xDrive** opens the current sync root in Explorer;
- **暂停同步 / 恢复同步** disconnects/reconnects the provider while preserving the configured state across restarts;
- **账户 / 设置...** lets the user re-login, register, or change the local xDrive directory;
- **检查更新** immediately runs the stable-release update check;
- **注销** removes the local JWT credentials and stops the active mount;
- **退出 xDrive** closes the tray agent. The Start menu contains an **xDrive** shortcut to start it again.

The local account/settings page listens only on `127.0.0.1`, uses a random per-agent-session URL token, sends credentials directly to the configured xDrive server, and does not save the password. The default sync root is:

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
- opening a placeholder hydrates the byte ranges Windows requests from the server;
- once hydrated, the content currently remains cached locally; xDrive does not yet automatically dehydrate old files;
- local new files/directories are created on the server;
- local file modifications are uploaded as complete files;
- local deletions are propagated to the server;
- Web/API-side creates, changes and deletes are reconciled back into the sync root roughly every 3 seconds;
- conflict detection/merging is not implemented yet, so concurrent edits use MVP last-writer-style behavior.

The current Windows installer is not code-signed, so Windows SmartScreen may warn on downloaded builds until release signing is added.

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

Unlike Windows CfAPI, the Linux FUSE client is **not a fully mirrored sync folder**. It presents the remote tree as a mounted filesystem. Opening an existing file downloads it into a temporary local cache; reads/writes operate there, and dirty content is uploaded as one complete file on flush/release. It does not proactively download the entire drive.

## Client version checks and automatic updates

Automatic updates only follow stable GitHub Releases tagged `vMAJOR.MINOR.PATCH`. Snapshot builds from `master` deliberately do not auto-update.

Before an update is installed, the client downloads the Release `SHA256SUMS.txt` and verifies the installer/package checksum.

**Windows:** the background agent checks after startup and then about every 6 hours. When a newer stable release exists it downloads `xDriveSetup-amd64.exe`, verifies it, launches the installer silently, exits, and the updated installer starts the agent again.

**Linux:** the `.deb` installs `xdrive-update.timer` as a root-level systemd timer. It checks about every 6 hours and installs a newer verified `xdrive-client-linux-amd64.deb` through `apt-get`. The optional user-level mount agent is separate from this updater.

Useful commands:

```text
xd version
xd update
xd update --install
```

`xd update` only checks. On Windows, `--install` launches the verified installer. On Linux, normal automatic installation is handled by the root timer; a manual root update can be run with `sudo xdrive-updater`.

Set `XD_DISABLE_AUTO_UPDATE=1` to disable the Windows agent's automatic update checks.

## CLI

```text
xd register --server URL --username USER --password PASS
xd login    --server URL --username USER --password PASS
xd status
xd config --mount PATH
xd mount [PATH]
xd version
xd update [--install]
xd logout
```

`XD_PASSWORD` can be used instead of `--password`.

The client config is stored under the operating system's user config directory. The access token is user-local configuration; use HTTPS when connecting over an untrusted network.

## Authentication

xDrive uses first-party username/password authentication with **rotating Access Token + Refresh Token sessions**:

1. registration/login sends the username/password over HTTPS to `/api/v1/auth/register` or `/api/v1/auth/login`; the server stores only a bcrypt password hash;
2. a successful login returns a short-lived HS256 access JWT plus a long-lived opaque refresh token;
3. authenticated file/API calls send the access token as `Authorization: Bearer <access-token>`;
4. before the access token expires, Windows, Linux and the Web UI call `POST /api/v1/auth/refresh` automatically;
5. every successful refresh rotates the refresh token: the old token is revoked and a new access/refresh pair is returned;
6. logout calls `POST /api/v1/auth/logout` to revoke the current refresh session before local credentials are removed.

Defaults:

```text
XD_ACCESS_TOKEN_TTL=15m
XD_REFRESH_TOKEN_TTL=720h   # 30 days
```

The refresh token is random and opaque. The server stores only its SHA-256 hash in PostgreSQL, never the raw refresh token. Desktop clients persist the current access/refresh pair and token expiry in the current user's xDrive config; the **password is never stored**. The Linux and Windows clients share the same refresh logic, so mounted sessions renew without interrupting FUSE/CfAPI under normal operation.

For migration, pre-refresh JWTs are still accepted until they expire, and the login response retains the legacy `token` field as an alias of `access_token`.

This MVP does not yet implement OAuth/OIDC, SSO or MFA. Use HTTPS for any non-local deployment.

## HTTP API

Authenticated endpoints use:

```text
Authorization: Bearer <jwt>
```

Main routes:

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
GET    /api/v1/nodes/root
GET    /api/v1/nodes/:id/children
POST   /api/v1/nodes/:id/directories
POST   /api/v1/nodes/:id/files
PATCH  /api/v1/nodes/:id
DELETE /api/v1/nodes/:id
GET    /api/v1/files/:id/content
PUT    /api/v1/files/:id/content
```

Existing-node mutations use revision preconditions via `If-Match`; node JSON includes `revision`, and file downloads expose the same revision as an `ETag`.

Downloads support HTTP Range requests, which are also used by the Windows hydration path.

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
  -InstallerPath .\dist\xDriveSetup-amd64.exe
```

If `-Username` and `-Password` are omitted, the script registers a unique temporary account, so the dedicated E2E server must allow registration. Supplying credentials makes it use an existing test account instead.

The real-machine script validates installer deployment, CfAPI mounting, placeholder/hydration, local-to-server create/update/rename/delete, server-to-local create/delete, and a stale-write conflict where both versions must survive. `-TokenRefreshWaitSeconds` can additionally validate a test server configured with a deliberately short access-token TTL.

A manual GitHub workflow, **Windows Real-Machine E2E**, targets a self-hosted runner labeled:

```text
self-hosted, windows, x64, xdrive-e2e
```

Optional repository secrets `XD_E2E_USERNAME` and `XD_E2E_PASSWORD` select an existing test account; otherwise the workflow registers a temporary account.

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

Every push to `master` also produces a snapshot bundle and publishes `edge` server images to GHCR.

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
docker-compose.yml
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
  api/                    Gin routes + handlers
  auth/                   password hashing + JWT
  client/                 REST client
  config/                 server environment config
  meta/                   GORM models + filename validation
  mount/                  Linux FUSE + Windows CfAPI
  storage/                Local storage backend
  userconfig/             per-user client configuration
  update/                 release check/download/checksum/update logic
  version/                build-time client version
web/                       React Web UI
packaging/
  windows/                 Inno Setup definition
  linux/                   systemd user mount service + root update timer
scripts/
  build-linux-deb.sh
  build-windows-installer.ps1
deploy/
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
- There is no quota, antivirus scanning, version history, sharing, audit log, or edit-conflict handling yet.

## Roadmap

1. resumable/chunked upload and content hashing;
2. instant upload/deduplication;
3. code-signed Windows installer and richer tray notifications;
4. richer CfAPI pin/dehydrate/offline controls;
5. small-file packing;
6. macOS File Provider integration;
7. thumbnails/EXIF/media processing;
8. sharing and version/conflict semantics.

## License

Apache License 2.0. See [LICENSE](LICENSE).
