# Account storage and global storage inventory

This document is the normative contract for the separation between xDrive **云端存储** (current-account logical view) and **全局存储** (administrator physical view), including host-path presentation and safe cache cleanup.

## Goals

The storage UI must explain where xDrive-managed disk space is actually used. It must not stop at account quota or CAS logical references.

The administrator **全局存储** surface reports:

- canonical file data;
- upload staging and transient files;
- regenerable media derivatives;
- PostgreSQL physical data;
- backups;
- xDrive host-side configuration/program/log/state files;
- Caddy persistent data/configuration;
- any xDrive-reserved but currently unclassified file data.

Every row has a path. A size without a location is not a complete storage record.

## Absolute host-path contract

User-facing paths are the **resolved absolute paths on the Server host**.

Do not display:

- environment templates such as `$XD_FILES_DATA_DIR/.xdrive-blobs`;
- relative values such as `../data/files`;
- container-only paths such as `/data/.xdrive-blobs`.

A normal installation therefore shows paths such as:

```text
/home/<server-user>/.xd/data/files/.xdrive-blobs
/home/<server-user>/.xd/data/files/.xdrive-uploads
/home/<server-user>/.xd/data/files/.xdrive-media/thumbnails/*-512.jpg
/home/<server-user>/.xd/data/files/.xdrive-media/thumbnails/*-1280.jpg
/home/<server-user>/.xd/data/postgres
/home/<server-user>/.xd/backups/snapshots
/home/<server-user>/.xd/backups/pre-upgrade
/home/<server-user>/.xd/backups/pre-restore
/home/<server-user>/.xd/config
/home/<server-user>/.xd/bin
/home/<server-user>/.xd/logs
/home/<server-user>/.xd/state
/home/<server-user>/.xd/data/caddy/data
/home/<server-user>/.xd/data/caddy/config
```

The installer already canonicalizes managed data directories to absolute host paths. Compose passes these resolved values to the API Server as display metadata:

- `XD_FILES_DATA_HOST_PATH`
- `XD_POSTGRES_DATA_HOST_PATH`
- `XD_BACKUP_ROOT_HOST_PATH`
- `XD_HOME_HOST_PATH`
- `XD_CADDY_DATA_HOST_PATH`
- `XD_CADDY_CONFIG_HOST_PATH`

The API Server must not infer a host path from `XD_STORAGE_ROOT=/data`.

If a legacy or unsupported deployment cannot supply an absolute host path, the UI must say that the host absolute path is unavailable rather than substituting a container path.

## Security boundary for host inventory

The API container must not gain broad host-file access merely to calculate storage usage.

In particular, do not mount all of `~/.xd`, PostgreSQL data, or backup contents into the API container for inventory purposes.

The existing host-control process runs on the Server host and periodically publishes only aggregate counters to the already protected `state/control` bridge:

- byte count;
- regular-file count.

It never publishes configuration contents, database contents, backup contents, connector secrets, JWT secrets, or file names from secret-bearing host directories.

The API Server combines these aggregate host counters with its own storage-root scan.

## Inventory scopes

### File-data root

The Server scans the entire xDrive file-data root through the storage backend. Every non-directory entry belongs to exactly one physical category.

The canonical categories are:

| Key | Meaning | Physical location | Cleanup |
| --- | --- | --- | --- |
| `cas` | content-addressed canonical file data | `.xdrive-blobs/` | never |
| `legacy` | legacy canonical file objects outside reserved xDrive prefixes | file-data root | never |
| `upload_staging` | resumable upload parts/staging | `.xdrive-uploads/` | only existing expiry/orphan-safe candidates |
| `media_thumbnail` | 512px Gallery/FileExplorer image thumbnail cache | `.xdrive-media/thumbnails/*-512.jpg` | yes |
| `analysis_preview` | 1280px Photo Intelligence analysis preview cache | `.xdrive-media/thumbnails/*-1280.jpg` | yes |
| `media_other` | other current/future media-derived files | `.xdrive-media/` | no automatic deletion until classified |
| `write_temp` | atomic storage-write temporary files | `**/.xdrive-upload-*` | only after safety age |
| `readiness_temp` | storage readiness-probe temporary files | `.xdrive-ready-*` | only after safety age |
| `unclassified` | unknown xDrive-reserved file data | file-data root | never automatically |

The sum of these physical entries is `storage_root_bytes`.

This number, not “CAS + legacy + staging”, is the authoritative xDrive physical usage for the file-data filesystem. It therefore includes `.xdrive-media` and any otherwise missed xDrive-owned files.

### Database

The PostgreSQL row displays the resolved `XD_POSTGRES_DATA_DIR`.

Host Control measures the physical PostgreSQL data directory. When that host snapshot is temporarily unavailable, the Server may fall back to PostgreSQL's `pg_database_size(current_database())` for a database-byte estimate.

Database storage is always read-only in the global-storage cleanup surface.

### Backups

Backups are split into:

- `backups/snapshots`;
- `backups/pre-upgrade`;
- `backups/pre-restore`;
- residual files under the backup root when present.

Backups are disaster-recovery assets. They are reported but are never deleted by “clear cache” operations.

Scheduled backup retention remains owned by the backup subsystem and its configured retention policy.

### Host service files

The inventory also reports persistent xDrive host-side occupancy that is outside the file-data root:

- `config/`;
- `bin/`;
- `logs/`;
- `state/`;
- Caddy data;
- Caddy config;
- regular files directly under xDrive Home.

These are read-only storage records. Their contents are not exposed through the inventory API.

## Current media cache reality

Do not invent disk usage for a feature that does not currently persist Server-side data.

Today:

- **512px image thumbnails** are persisted Server-side.
- **1280px Photo Intelligence analysis previews** are persisted Server-side.
- ordinary Image/PDF/Video/Audio Preview Engine playback streams canonical original bytes and does not persist a separate ordinary-preview cache;
- video poster generation does not currently create a Server-side persistent poster cache;
- video transcoding/proxy storage is not currently enabled;
- archive folder downloads are streamed as ZIP output and do not create a persistent Server-side archive cache.

The inventory still reserves resolved future paths for ordinary preview cache, video posters, and video transcodes. Until those pipelines exist, they must report zero / **未启用**.

## Reclaimable storage and cleanup

The only cleanup kinds are:

- `media_thumbnail`;
- `analysis_preview`;
- `upload_staging`;
- `storage_temp`;
- `all`.

### Media caches

512px and 1280px files are deterministic derivatives of canonical media bytes.

Deleting them is safe:

- no Node/File is deleted;
- no Source identity or binding is deleted;
- no PhotoAsset/PhotoResource/PhotoMetadata canonical record is deleted;
- the derivative is regenerated on demand.

When a persisted 512px thumbnail is removed, persisted thumbnail-key presentation metadata must be cleared so metadata does not claim a missing cache object.

### Upload staging

Upload-staging cleanup reuses the existing staging lifecycle rules.

It may remove:

- expired-session staging files;
- untracked orphan files older than the orphan grace window.

It must not remove:

- active registered parts;
- recent untracked files inside the race-safety window;
- data that has already been promoted to canonical storage.

### Atomic/readiness temporary files

`.xdrive-upload-*` and `.xdrive-ready-*` files are reclaimable only when they are older than the explicit safety age. Current policy is one hour.

A recent temporary file may belong to an active write or readiness operation and is never removed by storage cleanup.

### Never-clean categories

Storage cleanup must never delete:

- CAS canonical content;
- legacy canonical file content;
- PostgreSQL data;
- backups;
- trash/history canonical content;
- Source items, Source bindings, or connector credentials;
- PhotoAsset/PhotoResource/PhotoMetadata canonical data;
- host config/bin/log/state/Caddy files;
- unknown/unclassified xDrive-reserved files;
- media-derived files whose regeneration contract has not been explicitly classified.

Unknown data is **counted first, reviewed second, deleted never by default**.

## Request and cancellation semantics

Inventory scans and cleanup use the caller request context.

A cleanup checks cancellation between file deletions. Cancellation may therefore result in a safe partial cleanup: already-deleted regenerable/cache files stay deleted, untouched files remain, and canonical data remains intact.

Upload-staging cleanup retains its existing persisted cleanup-run/failure audit trail.

A cache cleanup is an explicit administrator maintenance action. It is not a durable background rewrite of canonical data and does not create a Task Center item solely to delete deterministic cache files.

## UI contract

The two storage destinations have deliberately different scopes.

### 云端存储 — current account

Web and Desktop use the shared `XDriveCloudStoragePage` for the current account.

It reports only account-scoped information:

- quota-accounted physical usage;
- available quota / server free space when quota is unlimited;
- current logical file bytes and file count;
- trash and history usage;
- active upload reservation;
- current-file size distribution by count and logical bytes.

The current-account size distribution is a **file-size distribution**, not a CAS distribution.

The `/api/v1/me/storage` response must not expose:

- global CAS Blob counts or physical CAS bytes;
- Server physical inventory;
- database or backup bytes;
- host absolute paths;
- global cache cleanup controls;
- global disk totals.

Administrator status does not widen the scope of `/api/v1/me/storage`. An administrator sees the same account-scoped cloud-storage contract as any other user.

### 全局存储 — whole instance

The administrator global-storage surface owns all physical-instance information:

- disk total / used / available capacity;
- xDrive physical managed bytes;
- global CAS Blob count, physical bytes, logical references and dedup metrics;
- CAS P50/P90/P99 and CAS Blob size distribution;
- CAS health;
- upload staging;
- the complete Server physical inventory;
- absolute host paths;
- database, backup, host-service and cache byte counts;
- reclaimable bytes and per-class cleanup actions.

CAS Blob size distribution is **global by definition**. CAS is a content-addressed deduplicated physical object pool, so one Blob may be referenced by multiple files and multiple users. The UI must not present a CAS Blob as belonging to a single account merely because that account references it.

The global page renders two complementary CAS distribution charts:

- **by Blob count** — highlights small-object/object-count pressure;
- **by physical bytes** — highlights the size ranges that actually consume disk.

A precise bucket table may remain below the charts for exact values.

Database, backups, and canonical data rows never render a delete action.

## Adding a new persisted Server file class

Any change that introduces a new Server-side cache, temporary directory, derivative, sidecar, index, model artifact, conversion output, or other persistent file class must update this document and the inventory implementation in the same change.

The change must define:

1. canonical key/category;
2. resolved host path;
3. whether its bytes are included in an existing parent total;
4. whether it is canonical, regenerable, temporary, or read-only;
5. the exact safe cleanup condition, if any;
6. regeneration behavior after cleanup;
7. tests proving cleanup cannot cross into canonical data.

Do not leave a newly introduced xDrive-reserved path permanently hidden from storage accounting.


## Sidebar physical-capacity breakdown

When an account has no explicit quota and physical disk totals are available, the shared sidebar storage summary renders a stacked physical-capacity bar:

- **My xDrive storage** uses the primary accent;
- **other disk usage** uses a distinct secondary accent;
- free disk remains the track background.

Other disk usage is physical disk used bytes minus the current account's xDrive physical bytes, clamped at zero. Explicit user quotas keep their existing quota-progress semantics instead of mixing quota and physical-disk accounting.
