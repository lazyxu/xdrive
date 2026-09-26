# Synology Photos source agent

The native `xdrive-source-agent` is intended for Synology DSM Task Scheduler. It scans Synology Photos filesystem roots and reports them to xDrive through the External Source scan protocol.

## Current scope

The agent supports both **scan** and **sync** modes:

- Personal Space and Shared Space can both be enabled.
- Discovery is a fast metadata scan using stable Linux filesystem identity plus size and mtime.
- Gitignore-style Source ignore rules are honored identically in both modes.
- `scan` reports create/update/move/missing and estimated transfer bytes without changing xDrive content.
- `sync` materializes directories and executes create/update/move/move-update plans.
- SHA-256 is calculated only for files that actually need create/update transfer; pure moves do not read the file contents.
- Uploads reuse the existing resumable/instant-upload path. Already received chunks, server-reused ranges, and instant-finalized files consume no new transfer bytes.
- Every successful mutation is acknowledged through the Source execution commit protocol before the SourceItem baseline advances.
- First-seen ignored objects are not persisted by the server.
- A complete scan may mark previously managed source items as `missing`.
- Source-side deletion never deletes or trashes xDrive content.

## Install

Published snapshots and stable releases contain two directly downloadable, pure-Go binaries:

```text
xdrive-source-agent-linux-amd64
xdrive-source-agent-linux-arm64
```

Check the NAS architecture:

```bash
uname -m
```

Use `xdrive-source-agent-linux-amd64` for `x86_64` DSM systems and `xdrive-source-agent-linux-arm64` for `aarch64` / `arm64` systems.

Example installation:

```bash
mkdir -p /volume1/tools
cp xdrive-source-agent-linux-amd64 /volume1/tools/xdrive-source-agent
chmod 0755 /volume1/tools/xdrive-source-agent
/volume1/tools/xdrive-source-agent version
```

Verify the downloaded file against the release `SHA256SUMS.txt` before installing it.

The binaries are built with `CGO_ENABLED=0`, so Go, Docker, Python, glibc development packages, and other application runtimes are not required on DSM.

For development, the same exact cross-build path used by CI is:

```bash
bash scripts/build-source-agent.sh 0.0.0+dev release/source-agent
```

## Login

```bash
export XD_PASSWORD='your-password'
./xdrive-source-agent login \
  --server https://drive.example.com \
  --username alice
```

Credentials use the existing xDrive secret store. On Linux, Secret Service is used when available; otherwise a private `0600` credential file is used.

For headless DSM environments you can override the config directory:

```bash
export XD_SOURCE_AGENT_CONFIG_DIR=/volume1/@appdata/xdrive-source-agent
```

If the account requires a first-login password change:

```bash
export XD_PASSWORD='old-password'
export XD_NEW_PASSWORD='new-password'
./xdrive-source-agent password
```

## Setup

Example with both Synology Photos spaces:

```bash
./xdrive-source-agent setup \
  --personal /volume1/homes/alice/Photos \
  --shared /volume1/photo \
  --mode scan \
  --target Photos/Synology
```

Setup records the Linux filesystem identity of each configured root. Every run verifies that identity before scanning; if a root disappears, is replaced, or the final path becomes a symlink, the run fails with `complete_inventory=false` rather than inferring that the entire source was deleted.

Setup creates or reuses an xDrive Source with:

- `kind=synology_photos`
- `direction=push`
- `sync_mode=backup`
- `run_mode=scan` by default, or `run_mode=sync` with `--mode sync`

The target path is created in xDrive when needed. New Sources default to `scan` when `--mode` is omitted; re-running setup for an existing Source preserves its current mode unless `--mode` is explicitly supplied. Existing ignore rules are likewise preserved unless `--ignore-file` is supplied.

A recommended first deployment is to run in `scan` mode, review the planned counts/bytes, and then repeat setup with `--mode sync`:

```bash
./xdrive-source-agent setup \
  --personal /volume1/homes/alice/Photos \
  --shared /volume1/photo \
  --mode sync \
  --target Photos/Synology
```

The default ignore rules are:

```gitignore
@eaDir/
\#recycle/
```

Supply a custom rules file with:

```bash
./xdrive-source-agent setup \
  --personal /volume1/homes/alice/Photos \
  --shared /volume1/photo \
  --ignore-file /volume1/config/xdrive-source.ignore
```

## Run

```bash
./xdrive-source-agent run
```

A run:

1. reads the Source configuration from xDrive;
2. starts an idempotent Source run;
3. scans Personal and Shared roots;
4. batches up to 500 non-ignored observations per request;
5. heartbeats the server run lease during long scans;
6. receives `create/update/move/move_update/unchanged` planner actions;
7. in `sync` mode, executes planned directory/file mutations and commits the verified final node state;
8. records planned and actual transfer statistics;
9. marks the inventory complete only if the entire traversal and all observation batches succeed.

If traversal is interrupted, unavailable, or permission-denied, the run is finished as failed/cancelled with `complete_inventory=false`. The server therefore does not infer source-side deletion. Individual execution conflicts leave only those SourceItems pending and make the run `partial`; other items continue syncing.

## DSM Task Scheduler

Create a scheduled user-defined script such as:

```bash
export XD_SOURCE_AGENT_CONFIG_DIR=/volume1/@appdata/xdrive-source-agent
/volume1/tools/xdrive-source-agent run
```

Run the task as a DSM account that has **read access** to every configured Photos root. No source-side write permission is needed.

## Status

```bash
./xdrive-source-agent status
```

Status shows the configured Source, run mode, roots, credential backend, and the latest scan summary.

## External identity

Filesystem objects use:

```text
fs:<root-key>:<device>:<inode>
```

with separate `personal` and `shared` namespaces. This preserves identity across normal renames/moves within the same filesystem. The logical xDrive paths are rooted under:

```text
Personal/...
Shared/...
```

Later Synology Photos metadata integration may replace or augment filesystem identity with stable Photos item IDs where available.
