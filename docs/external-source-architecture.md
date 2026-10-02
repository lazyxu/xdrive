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

### Synology Files Pull — `synology_files`

A generic DSM/File Station source for arbitrary shared folders and arbitrary file types.

Status: File Station API/session, multi-root validation, generic directory execution, recursive scanner, worker registration, credential/config activation gates, cancellation/retry integration, Backup missing safety, Web/Desktop creation/configuration, protected directory browsing, and root-selection UI are implemented.

Current behavior:

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

Photos Pull and Files Pull may coexist. If their remote scopes overlap, xDrive keeps separate SourceItems because provenance differs, while CAS may still deduplicate identical content bytes. Pull scheduling coordinates Synology Sources by a hashed DSM-origin + username key, so Photos and File Station using the same DSM account do not create competing login/API sessions; unrelated accounts still run concurrently within the global worker limit.

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

## Integrity verification

`xdrive-server source verify [--json]` performs a read-only consistency check of Source targets and persisted SourceItem -> Node/File bindings. It reports deterministic binding damage such as synced items without Nodes, deleted/wrong-owner/wrong-type bound Nodes, missing File metadata, and SourceItem size/SHA drift against the currently bound File.

This verifier intentionally does not repair or mutate Source state. A later repair command may requeue only issue types with a proven idempotent recovery path. Storage/CAS byte verification remains the separate `xdrive-server storage verify` responsibility.

## Deletion and recovery

The generic rules remain:

- Backup: remote disappearance marks SourceItem missing while xDrive content remains.
- Mirror (TODO): confirmed remote deletion may move the xDrive Node to trash after safety/grace checks.
- Partial, failed, or cancelled inventories never infer deletion.
- Remote providers remain read-only by default.

## Synchronization-folder management contract

The backend subsystem remains named **External Source / Source** in code and APIs, but the Web/Desktop product surface calls each configured connector a **同步文件夹**. This distinction is intentional: user terminology can stay stable without forcing a database or API rename.

Every synchronization folder has two management planes that must remain separate:

1. **Target identity**
   - `target_node_id` is the persisted xDrive binding.
   - API responses expose `target_path`, resolved from the current Node tree, so clients show the database-backed path instead of reconstructing it from a template.
   - Settings render the target directory read-only.
   - Saving ordinary settings does not move, rename, recreate, or rewrite the target.
   - A target may change only through an explicit target-selection workflow or a connector-owned verified identity/binding transition. A managed connector may repair its deterministic hierarchy in that binding transition while preserving the existing target node/data where required.

2. **Credential identity**
   - Encrypted credential payloads remain server-side and normal list/status/test APIs expose metadata only.
   - The owner may explicitly request a short-lived reveal for connector fields that are safe and useful to inspect. The reveal endpoint is owner-scoped, audited, marked `Cache-Control: no-store`, and returns only an allowlisted field rather than the complete credential object.
   - Current allowlist: Yike Pull -> `cookie`; Synology Photos/File Station Pull -> `password`.
   - Synology Push is not included because its connector credential lives on the NAS agent rather than xDrive Server.
   - Web/Desktop show a mask by default, request plaintext only after the user clicks **显示**, hold it only in memory, automatically hide it after roughly 30 seconds, and clear it when settings close.
   - Revealed plaintext is never copied into the replacement form automatically. “Inspect current secret” and “replace secret” are separate operations.

This contract is the default for new synchronization-folder connectors. A new connector should deviate only when its transport/security model makes one of these operations inapplicable, and that exception should be documented explicitly.

## Implementation order

1. Complete: SourceItemAlias + explicit canonical identity promotion.
2. Complete: Synology Files Pull (`synology_files`) backend + Web/Desktop source management and directory selection.
3. Synology Push Photos-item semantic identity lane.
4. Provider semantic metadata and media grouping.
5. Incremental change scanners only where a reliable provider change contract exists.
