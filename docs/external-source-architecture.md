# External Source architecture

External Source is xDrive's connector-neutral **file ingestion and synchronization** subsystem.

It is not a photo-only subsystem. Photos and videos are ordinary files first. Media indexing is an optional derived capability that runs after a file has been materialized in xDrive.

## Core invariant: every file stays a file

A connector may discover any regular file or directory:

```text
DOCX / PDF / XLSX / ZIP / TAR
source code / binaries
database files
images / video / audio
RAW / sidecars
arbitrary unknown extensions
```

All of them use the same base pipeline:

```text
Remote provider / local source
        |
        v
Source + SourceItem identity
        |
        v
planner + SyncRun
        |
        v
Node + File + CAS
```

Nothing in the Source core may require an item to be an image or video.

After import, the universal media index may independently recognize supported media:

```text
Node + File + CAS
        |
        +--> ordinary file: no MediaMetadata required
        |
        +--> recognized image/video: MediaMetadata + thumbnail + Gallery
```

Failure to parse media metadata must never fail, hide, delete, rename, or prevent backup of the original file.

## Connector families

### Synology Photos Pull — `synology_photos`

Uses Synology Photos semantics and stable Photos item identity when available.

It may additionally import albums, capture metadata, people, tags, favorite state, descriptions, GPS, thumbnails, and Live Photo relationships.

### Synology Files Pull — `synology_files` (TODO)

A generic DSM/File Station source for arbitrary shared folders and arbitrary file types.

Target behavior:

- select one or more DSM shares/subdirectories;
- recursively preserve directory structure;
- preserve original visible file names;
- sync every regular file type, not just media;
- support scan and sync modes;
- reuse the shared Source planner, cancellation, schedules, retry/backoff, CAS, digest reuse, progress, and missing-inventory safety;
- use File Station/provider identity only when it is proven stable;
- fall back to a clearly scoped path identity when DSM does not expose a stable file identity;
- use `SourceItemAlias` when a stronger provider identity later becomes available;
- never guess rename/move identity from filename or timestamps alone;
- treat media indexing as an optional post-import projection.

Recommended source kind:

```text
kind=synology_files
direction=pull
sync_mode=backup
```

Photos Pull and Files Pull may coexist. If their remote scopes overlap, xDrive keeps separate SourceItems because provenance differs, while CAS may still deduplicate identical content bytes.

### Synology NAS Push — source agent

The NAS reads its local filesystem and pushes observations/transfers to xDrive. This is also generic at the Source protocol level even when a particular setup targets Photos roots.

A future Photos semantic lane may enrich indexed files with Photos item IDs and metadata without changing the fact that non-media files, sidecars, and unsupported objects remain normal SourceItems.

## Identity aliases are file-generic

`SourceItemAlias` belongs to the Source identity layer, not the media layer.

Example for an ordinary text file:

```text
fs:documents:11:22
        |
        | verified identity promotion
        v
synology-file:documents:9001   canonical

old fs:* identity remains an alias
same SourceItem
same Node
same CAS content
zero identity-driven re-upload
```

An observation may only promote a canonical external ID when the connector explicitly supplies verified alias evidence. xDrive Server must never infer an identity merge from path, filename, size, mtime, EXIF, or visual similarity.

Older or rolled-back connectors may continue to address a SourceItem through a stored alias. Alias lookup must not downgrade the stronger canonical identity.

## Media-specific extensions are projections

The following concepts are optional enrichments layered above generic files:

- EXIF / GPS / camera / lens;
- video duration / codec / rotation;
- thumbnails and Gallery;
- albums and photo collections;
- people and tags;
- Live Photo grouping;
- RAW+JPEG or sidecar grouping.

They do not replace `Node + File + CAS`, and unsupported/non-media files never need them.

## Deletion and recovery

The generic rules remain:

- Backup: remote disappearance marks SourceItem missing while xDrive content remains.
- Mirror (TODO): confirmed remote deletion may move the xDrive Node to trash after safety/grace checks.
- Partial, failed, or cancelled inventories never infer deletion.
- Remote providers remain read-only by default.

## Implementation order

1. SourceItemAlias + explicit canonical identity promotion.
2. Synology Files Pull (`synology_files`) using DSM/File Station.
3. Synology Push Photos-item semantic identity lane.
4. Provider semantic metadata and media grouping.
5. Incremental change scanners only where a reliable provider change contract exists.
