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

### Install from `master` / edge images

```bash
curl -fsSL https://raw.githubusercontent.com/lazyxu/xdrive/master/deploy/install-server.sh | bash
```

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

GitHub Container Registry packages are private when first created unless their visibility is changed. For public xDrive distribution, make both packages **Public** once in GitHub package settings. After that, server machines can pull them anonymously.

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

The agent is a hidden user-session process. It waits until a valid xDrive login exists, then keeps the configured CfAPI sync root mounted. This is intentionally a user-session background agent rather than a Windows service because the sync root belongs to the interactive user/Explorer session.

Open a **new** PowerShell/Terminal after installation and log in:

```powershell
xd login --server https://drive.example.com --username alice --password "your-password"
```

The default sync root is:

```text
%USERPROFILE%\xDrive
```

Change it with:

```powershell
xd config --mount "D:\xDrive"
```

The background agent notices login/config changes automatically. `xd logout` removes the local credentials and causes the active background mount to stop.

You can still run an explicit foreground mount for troubleshooting:

```powershell
xd mount "D:\xDrive"
```

### Windows MVP behavior

- remote files appear as CfAPI placeholders;
- opening a placeholder hydrates requested ranges from the server;
- local new files are uploaded as whole files;
- local modifications are written back as whole files;
- Web/API-side changes are reconciled periodically;
- conflict detection/merging is not implemented yet.

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

## CLI

```text
xd register --server URL --username USER --password PASS
xd login    --server URL --username USER --password PASS
xd status
xd config --mount PATH
xd mount [PATH]
xd logout
```

`XD_PASSWORD` can be used instead of `--password`.

The client config is stored under the operating system's user config directory. The access token is user-local configuration; use HTTPS when connecting over an untrusted network.

## HTTP API

Authenticated endpoints use:

```text
Authorization: Bearer <jwt>
```

Main routes:

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
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

Downloads support HTTP Range requests, which are also used by the Windows hydration path.

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
internal/
  api/                    Gin routes + handlers
  auth/                   password hashing + JWT
  client/                 REST client
  config/                 server environment config
  meta/                   GORM models + filename validation
  mount/                  Linux FUSE + Windows CfAPI
  storage/                Local storage backend
  userconfig/             per-user client configuration
web/                       React Web UI
packaging/
  windows/                 Inno Setup definition
  linux/                   systemd user service
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
3. Windows tray UI and code-signed installer;
4. richer CfAPI pin/dehydrate/offline controls;
5. small-file packing;
6. macOS File Provider integration;
7. thumbnails/EXIF/media processing;
8. sharing and version/conflict semantics.

## License

Apache License 2.0. See [LICENSE](LICENSE).
