# Synology Photos source agent

The native `xdrive-source-agent` is intended for Synology DSM Task Scheduler. It scans Synology Photos filesystem roots and reports them to xDrive through the External Source scan protocol.

## Current scope

This phase is intentionally **scan-only**:

- Personal Space and Shared Space can both be enabled.
- Scans are fast metadata scans using stable Linux filesystem identity plus size and mtime.
- Gitignore-style Source ignore rules are honored.
- First-seen ignored objects are not persisted by the server.
- A complete scan may mark previously managed source items as `missing`.
- Source-side deletion never deletes or trashes xDrive content.
- File upload/update execution is not enabled yet. A Source configured with `run_mode=sync` is rejected safely and the run is recorded as failed.

## Install/build

Build the Linux binary from the repository:

```bash
go build -o xdrive-source-agent ./cmd/xdrive-source-agent
```

The binary is pure Go. DSM deployment packaging for amd64/arm64 is a later Phase 13C step.

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
  --target Photos/Synology
```

Setup records the Linux filesystem identity of each configured root. Every run verifies that identity before scanning; if a root disappears, is replaced, or the final path becomes a symlink, the run fails with `complete_inventory=false` rather than inferring that the entire source was deleted.

Setup creates or reuses an xDrive Source with:

- `kind=synology_photos`
- `direction=push`
- `sync_mode=backup`
- `run_mode=scan`

The target path is created in xDrive when needed.

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
6. receives `create/update/move/unchanged` planner actions;
7. records scan statistics;
8. marks the inventory complete only if the entire traversal and all observation batches succeed.

If traversal is interrupted, unavailable, or permission-denied, the run is finished as failed/cancelled with `complete_inventory=false`. The server therefore does not infer source-side deletion.

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
