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

When the Source was created from the xDrive Web/Desktop UI, bind the NAS agent to that exact Source ID:

```bash
./xdrive-source-agent setup \
  --source-id 42 \
  --personal /volume1/homes/alice/Photos \
  --shared /volume1/photo
```

With `--source-id`, setup preserves the Source name, target node, current run mode, and existing ignore rules unless those values are explicitly overridden. This avoids duplicate Sources and avoids reconstructing the UI-selected target path on DSM.

The Web/Desktop External Sources UI includes a **DSM 配置** guide with the generated Source ID, copyable commands, and DSM Task Scheduler diagrams.

For a CLI-created Source, setup can still create or reuse by name/path:

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

Force one run immediately:

```bash
./xdrive-source-agent run
```

For normal scheduling, use the due gate:

```bash
./xdrive-source-agent run --due --interval 6h
```

Web/Desktop store the schedule on the Source itself. Supported schedules are:

- `interval`, such as `30m`, `6h`, or `24h`;
- standard five-field `cron`, such as `0 3 * * *`, with an IANA timezone such as `Asia/Shanghai`;
- `manual`, which never starts from the scheduled due gate and runs only after Web/Desktop **立即扫描** creates a pending manual request.

With `--due`, the agent reads the Source schedule and exits without traversing the Photos roots until that Source is due. A pending manual request created by the Web/Desktop **立即扫描** action always overrides interval/cron and is the only way a `manual` Source becomes due. Paused Sources are skipped. `--interval` is retained only as the compatibility fallback for Sources created before per-Source schedules existed; newly created Sources default to `interval=6h`.

A run:

1. reads the Source configuration from xDrive;
2. starts an idempotent Source run;
3. scans Personal and Shared roots;
4. batches up to 500 non-ignored observations per request;
5. heartbeats the server run lease during long scans;
6. receives `create/update/move/move_update/unchanged` planner actions;
7. in `sync` mode, executes planned directory/file mutations and commits the verified final node state;
8. records planned and actual transfer statistics;
9. publishes live scan/planning progress after each observation batch and current-file upload progress while a file is transferring;
10. marks the inventory complete only if the entire traversal and all observation batches succeed.

Web/Desktop poll the persisted SyncRun while it is active and can request **停止**. Cancellation is cooperative and durable: xDrive sets `cancel_requested_at`; the next heartbeat, observation, progress update, or commit returns a cancellation signal. The source-agent cancels its current run context, which interrupts an active resumable upload rather than waiting for the entire file to finish. The run is then finalized as `cancelled` with `complete_inventory=false`.

If traversal is interrupted, unavailable, permission-denied, or cancelled, the run is finished as failed/cancelled with `complete_inventory=false`. The server therefore does not infer source-side deletion. Individual execution conflicts leave only those SourceItems pending and make the run `partial`; other items continue syncing.

## DSM Task Scheduler

For Web-triggered **立即扫描** without running a full scan every minute, configure a user-defined task to execute once per minute:

```bash
export XD_SOURCE_AGENT_CONFIG_DIR=/volume1/@appdata/xdrive-source-agent
/volume1/tools/xdrive-source-agent run --due --interval 6h
```

The one-minute task is a lightweight control-plane check. It performs a real Photos traversal only when either:

- that Source's configured interval/cron schedule is due; or
- xDrive has a pending manual run request from the Web/Desktop UI.

A Source configured as `manual` never runs merely because this one-minute DSM task fires; it remains idle until a manual request exists.

The `--interval 6h` value shown above is only the legacy fallback for Sources without explicit schedule fields; it does not override a configured per-Source schedule.

This keeps the NAS as the initiator of the Push connection while allowing a Web request to start on the next Task Scheduler invocation. The pending request remains visible in xDrive until an agent run actually starts.

Run the task as a DSM account that has **read access** to every configured Photos root. No source-side write permission is needed.

## Status

```bash
./xdrive-source-agent status
```

Status shows the configured Source, run mode, roots, credential backend, and the latest scan summary.

## External identity

The first version of the agent used:

```text
fs:<root-key>:<device>:<inode>
```

as the external identity. Existing Sources keep those IDs for backward compatibility.

Current agents also maintain a private, sharded identity state below the source-agent config directory. On the first run after upgrade, the current legacy ID is persisted as the stable external ID. Later scans recover that same ID from a portable filesystem fingerprint based on the root namespace, inode, and Linux birth time when `statx` exposes it. This keeps normal rename/move identity and also survives a filesystem remount where `st_dev` changes.

When birth time is unavailable, the agent uses a weaker inode key only for records that were still present in the previous completed generation, or whose path/size/mtime still match. If an inode is reused for a different object, the agent allocates a collision-safe `fs2:<root-key>:<uuid>` identity instead of reusing an existing SourceItem.

Identity state is written atomically in 256 small JSON shards. New mappings are flushed before observations are sent to xDrive, and the completed generation is advanced only after the local traversal succeeds. Corrupt state is treated as an error; it is never silently discarded because doing so could duplicate a previously synchronized library.

The setup configuration also stores a remount-stable root fingerprint. Existing configurations migrate automatically on the first identity-aware run. When Linux `statx` exposes birth time, an NAS that was already remounted before that upgrade run can still recover when the configured root inode is unchanged: the old device number embedded in the saved root ID is reused as the legacy device seed for the first scan, preserving the server's existing file IDs while the new portable state is created. Once migrated, later device-number changes do not require re-running setup. If birth time is unavailable, the root fingerprint intentionally retains the device number and remounts fail closed instead of guessing. A genuinely replaced root always fails closed and requires explicit setup.

The logical xDrive paths remain:

```text
Personal/...
Shared/...
```

Later Synology Photos metadata integration may replace or augment filesystem identity with stable Photos item IDs where available.
