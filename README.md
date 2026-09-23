# xDrive

> **Mount your cloud as a local drive.**

xDrive is an Apache-2.0 open-source file service with a Web file manager and native desktop filesystem access. The first MVP deliberately keeps storage simple: every object is stored as one complete file on the xDrive server, while PostgreSQL stores the directory tree and metadata.

## MVP scope

| Area | First release |
| --- | --- |
| Server | Go, Gin, GORM, PostgreSQL, JWT |
| Storage | Local filesystem only |
| Web | React + TypeScript + Ant Design; login/register, browse, upload/download, create folders, rename and delete |
| Linux | FUSE mount with `go-fuse/v2`, read/write/create/mkdir/rename/delete |
| Windows | Windows Cloud Files API (CfAPI), Explorer sync root, placeholders, on-demand hydration, whole-file write-back |
| CLI | `xd register`, `login`, `status`, `mount`, `logout` |
| Multi-user | Per-user metadata and storage isolation |

Not in the MVP: chunking, instant upload/deduplication, small-file packs, CDC, thumbnails, transcoding, public share links, conflict resolution, MinIO, macOS, or mobile clients.

> **Windows note:** CfAPI integrates xDrive as an Explorer cloud-sync directory rather than a WinFsp drive letter. It requires no WinFsp installation. The minimum Windows platform for the Cloud Files API is Windows 10 version 1709. See Microsoft's [Cloud Files API documentation](https://learn.microsoft.com/windows/win32/cfapi/cloud-files-api-portal).

## Architecture

```text
                         ┌─────────────────────┐
                         │      xDrive Web     │
                         │ React + Ant Design  │
                         └─────────┬───────────┘
                                   │ HTTPS / REST
 Linux                             │                              Windows
 ┌──────────────┐                  ▼                        ┌──────────────────┐
 │ xd + go-fuse │ ───────►  xDrive Server  ◄────────────── │ xd + Windows    │
 │ /mnt/xdrive  │          Gin + GORM + JWT                │ Cloud Files API │
 └──────────────┘                  │                        │ Explorer folder  │
                                   ├────────► PostgreSQL    └──────────────────┘
                                   │          metadata
                                   ▼
                            Local filesystem
                            whole-file blobs
```

A stored object uses a key shaped like:

```text
<user-id>/<logical-directory>/<uuid>
```

The visible filename and directory tree live in PostgreSQL. Renaming a file changes metadata without rewriting the underlying blob.

## Repository layout

```text
cmd/
  server/              xDrive HTTP server
  xd/                  CLI
internal/
  api/                 Gin routes and handlers
  auth/                password hashing + JWT
  client/              HTTP client shared by filesystem clients
  config/              environment configuration
  meta/                GORM models and portable filename validation
  mount/               Linux FUSE + Windows CfAPI
  storage/             storage abstraction + Local implementation
web/                    React Web UI
deploy/
  docker-compose.yml    PostgreSQL + server + Web
.github/workflows/
  ci.yml                Linux, Windows, Web CI
```

## Quick start with Docker Compose

Set a real JWT secret and start the stack:

```bash
export XD_JWT_SECRET='replace-with-a-long-random-secret'
docker compose -f deploy/docker-compose.yml up --build
```

Then open:

```text
http://localhost:3000
```

Compose persists:

- PostgreSQL in the `postgres-data` volume.
- File blobs in the `file-data` volume.

The default development credentials in Compose are only for the bundled PostgreSQL container; change them before exposing the service publicly.

## Run the server directly

Requirements:

- Go 1.23+
- PostgreSQL

Create a database, then:

```bash
export XD_DATABASE_URL='postgres://xdrive:xdrive@localhost:5432/xdrive?sslmode=disable'
export XD_JWT_SECRET='replace-with-a-long-random-secret'
export XD_STORAGE_ROOT='./data'
go run ./cmd/server
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `XD_LISTEN_ADDR` | `:8080` | HTTP bind address |
| `XD_DATABASE_URL` | local PostgreSQL URL | PostgreSQL DSN |
| `XD_JWT_SECRET` | required | JWT HMAC secret |
| `XD_JWT_TTL` | `24h` | login token lifetime |
| `XD_STORAGE_ROOT` | `./data` | Local blob storage root |
| `XD_ALLOWED_ORIGIN` | `http://localhost:5173` | CORS origin for standalone Web dev |
| `XD_MAX_UPLOAD_BYTES` | `21474836480` | max whole-file upload size (20 GiB) |

## Web development

```bash
cd web
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:8080` by default. Set `VITE_DEV_API` to change the development proxy target. For a separately hosted production frontend, `VITE_API_BASE` can be set at build time.

## CLI

Build:

```bash
go build -o xd ./cmd/xd
```

Register or log in:

```bash
./xd register --server http://localhost:8080 --username alice --password 'change-me-123'
# or
./xd login --server http://localhost:8080 --username alice --password 'change-me-123'

./xd status
```

`XD_PASSWORD` can be used instead of `--password`. The CLI stores the server URL and JWT token under the operating system's user config directory with user-only file permissions where supported.

## Linux mount

Linux uses [`github.com/hanwen/go-fuse/v2`](https://github.com/hanwen/go-fuse). The machine must have FUSE support available.

```bash
mkdir -p "$HOME/xdrive"
./xd mount "$HOME/xdrive"
```

The MVP uses a whole-file write strategy:

1. opening an existing file downloads it to a temporary local file;
2. reads/writes operate on that temporary file;
3. dirty content is uploaded as one complete object on flush/release.

This is intentionally simple and will be replaced by chunk-aware I/O in a later release.

## Windows Cloud Files API

Windows uses the operating system's Cloud Files API (`cldapi.dll`) directly, so no WinFsp runtime is required.

Build on Windows (or cross-compile):

```powershell
go build -o xd.exe ./cmd/xd
```

After login, choose an empty or dedicated local folder as the sync root:

```powershell
mkdir "$env:USERPROFILE\xDrive"
.\xd.exe mount "$env:USERPROFILE\xDrive"
```

The current MVP behavior is:

- remote directories are represented as local directories;
- remote files are represented by CfAPI placeholders carrying the server node ID;
- opening a placeholder triggers `CF_CALLBACK_TYPE_FETCH_DATA`, and xDrive hydrates the requested byte ranges from the server;
- local file additions are uploaded as complete files;
- local modifications are detected and written back as complete files;
- Web/API-side changes are reconciled into the sync root periodically;
- the provider does **not** perform conflict detection or merging. Concurrent edits are outside the MVP scope.

CfAPI support is intentionally isolated in `internal/mount/*_windows.go`, so future Windows work can add richer Explorer registration, pin/dehydrate controls, background startup and a GUI without changing the server protocol.

## HTTP API

All authenticated endpoints use:

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

Downloads use Go's `http.ServeContent`, so HTTP range requests are supported. This is also used by the Windows hydration path.

## Tests

Run the local test suite:

```bash
go test ./...
```

The API integration test requires PostgreSQL and runs when `XD_TEST_DATABASE_URL` is set:

```bash
export XD_TEST_DATABASE_URL='postgres://xdrive:xdrive@localhost:5432/xdrive_test?sslmode=disable'
go test ./internal/api
```

CI additionally:

- runs the Go suite with the race detector on Linux;
- exercises PostgreSQL-backed API CRUD and multi-user isolation;
- builds the server and CLI on Linux;
- compiles/tests the Windows CfAPI code on a Windows runner;
- type-checks and builds the React Web UI.

The Windows CI validates API bindings, struct layouts and compilation. A real Explorer hydration/write-back smoke test still requires an interactive Windows machine and is therefore a release/manual test rather than a hosted-CI claim.

## Security and MVP limitations

- Use HTTPS in production. JWTs are bearer credentials.
- Use a long random `XD_JWT_SECRET` and rotate it through your deployment secret manager.
- xDrive validates names against a Windows-compatible filename subset so the same namespace can be represented on Linux and Windows.
- Local storage rejects path traversal and writes uploads through temporary files followed by rename.
- File operations are owner-scoped at the metadata layer.
- Deleting a directory recursively deletes its metadata subtree and associated blobs.
- No quota, antivirus scanning, version history, sharing, audit log or conflict resolution is implemented yet.

## Roadmap

After this MVP is stable, likely next steps are:

1. resumable/chunked upload and content hashing;
2. instant upload/deduplication;
3. small-file packing;
4. richer Windows CfAPI integration and offline pinning;
5. macOS File Provider integration;
6. thumbnails/EXIF and media processing;
7. sharing and version/conflict semantics.

## License

Apache License 2.0. See [LICENSE](LICENSE).
