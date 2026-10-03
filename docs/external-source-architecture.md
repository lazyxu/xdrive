# External Source architecture

External Source is xDrive's connector-neutral **file ingestion and synchronization** subsystem. The user-facing product name is **同步文件夹**.

## Normative boundary: Source syncs files, Media understands files

A synchronization-folder connector is responsible only for getting the correct original files into xDrive safely and repeatably.

```text
provider / filesystem
  -> enumerate file identity/path/size/revision
  -> transfer original bytes
  -> SourceItem
  -> Node + File + CAS
```

Everything that interprets the contents of a media file belongs after that boundary:

```text
Node + File + CAS
  -> xDrive-native media parser/indexer
  -> MediaMetadata
  -> EXIF / GPS / image parameters / video parameters
  -> derived thumbnails
  -> validated Live Photo / RAW / sidecar / burst projection
  -> Gallery / search
```

This boundary is mandatory for Yike Photos Pull, Synology Photos Pull, Synology FileStation Pull, Synology Push, and future connectors.

### Allowed provider dependencies

A connector may depend on provider APIs for:

- authentication and read-only session management;
- file/directory enumeration;
- stable file identity;
- remote path/name, size, sync-relevant timestamps and revision hints;
- digest/checksum hints used to verify or deduplicate bytes;
- original-file download and Range/resume;
- collections only when needed to discover files or preserve optional source provenance;
- reliable incremental change/tombstone APIs when their contract is proven.

### Media data that must be local

A connector must not depend on provider APIs for canonical:

- EXIF/camera/lens/exposure data;
- image dimensions/orientation or other media parameters that can be parsed from the original;
- GPS/geolocation/address;
- video duration/rotation/frame rate/bitrate/codecs;
- Live Photo pairing/projection;
- RAW/JPEG, XMP/AAE, sidecar, burst or auxiliary-media grouping;
- people/tags/favorites/descriptions/face recognition;
- Gallery thumbnails/previews.

Existing provider hints may remain stored for backward compatibility, but they are non-authoritative and must not be required to rebuild xDrive media state.

## Core invariant: every file stays a file

A connector may discover any regular file or directory:

```text
DOCX / PDF / XLSX / ZIP / TAR
source code / binaries / databases
images / video / audio
RAW / XMP / AAE / sidecars
unknown future formats
```

All use the same base pipeline. Media indexing is an optional derived layer; failure to parse media metadata must never fail, hide, delete, rename, or prevent backup of the original file.

## Connector families

### Yike Photos Pull — `yike_photos`

Yike is a private-Web-API file adapter. It uses `yike:<owner_uk>:<fsid>` as stable file identity, preserves visible filenames and original bytes, and uses remote MD5/download metadata as synchronization hints. Album/shared traversal may be used to discover files that are not reachable through the root listing.

Yike does not own EXIF/GPS/Live Photo/media parsing. `.livp` and other originals are preserved and processed later by the common xDrive media pipeline.

### Synology Photos Pull — `synology_photos`

Synology Photos Pull uses Personal/Shared Photos item IDs as file-sync identity and Photos endpoints for file enumeration/download. Existing album provenance may be preserved, but media interpretation must not depend on Synology semantic APIs.

`live_type`, provider GPS/address, people/tags/favorite/description, and provider media parameters are not canonical xDrive inputs. Live Photo and all media metadata are reconstructed locally from synchronized originals.

### Synology Files Pull — `synology_files`

FileStation is the generic DSM source for arbitrary selected shares/subdirectories and arbitrary file types.

Current behavior includes recursive multi-root enumeration, directory preservation, original visible filenames, scan/sync modes, cancellation/retry, CAS/digest reuse, Range downloads, missing-inventory safety, protected directory browsing, and Web/Desktop configuration.

FileStation currently uses explicit path identity when a stable provider item identity is not proven. File revisions use `mtime + ctime + crtime + size` when DSM exposes the change/create times, with compatibility fallback to legacy `mtime + size`.

`SYNO.FileStation.MD5` is capability-detected but must not be used to hash an entire NAS on every scan. It is reserved for future explicit/narrow integrity checks if useful.

### Synology NAS Push

Push remains a filesystem synchronization path. It follows the same rule: upload original files and preserve robust filesystem identity; do not turn the NAS agent into a Synology Photos semantic client.

Any future local media processing should happen in the common xDrive media pipeline after original bytes are stored, not by depending on provider-specific media APIs.

## File identity and aliases

`SourceItemAlias` belongs to the generic file-identity layer. A stronger provider file identity may replace an older identity only when the connector has deterministic proof that both identify the same remote file.

```text
old file identity
  -> verified alias promotion
  -> stronger canonical file identity
  -> same SourceItem
  -> same Node
  -> same CAS content
  -> zero identity-driven re-upload
```

The server must never infer identity merges from filename, path similarity, size, mtime, EXIF, GPS, or visual similarity.

## Source collections

`SourceCollection` may preserve provider album/collection provenance where it is already available. It is optional source metadata, not a media database.

A collection API may also be necessary to discover provider files that the root listing omits. In that case it is part of file enumeration. Collection failure must never be translated into a completed empty file inventory.

Media parsing, Live Photo grouping, EXIF/GPS, thumbnails and Gallery behavior must work without any SourceCollection data.

## SourceItemMetadata contract

`SourceItemMetadata` stores synchronization/provenance hints such as original remote path, remote owner ID, remote create/capture hints, MD5 and provider thumbnail URL.

These fields are not canonical media state. In particular:

- provider capture time must not override valid embedded capture metadata;
- provider thumbnail URL is never the durable xDrive preview;
- new connector code must not use `PairGroupID/PairRole` to import provider Live Photo semantics;
- pair/group relations are derived by the local media layer from original files.

The existing pair fields may remain for schema/backward compatibility until a migration removes or repurposes them.

## Native media layer

`MediaMetadata` is canonical for technical media state and is derived from xDrive originals. The parser/indexer should cover:

- image format/MIME/dimensions/orientation and supported technical fields;
- EXIF/TIFF capture time, camera/lens and exposure metadata;
- GPS latitude/longitude/altitude;
- video/container duration, dimensions, rotation, frame rate, bitrate and codecs;
- xDrive-derived thumbnails/previews.

A future connector-neutral `MediaGroup` layer should represent locally validated Live Photo, RAW/JPEG, sidecar and burst relationships.

Live Photo evidence must come from local originals such as a validated `.livp` container or matching embedded Apple content identifiers. Do not use provider `live_type`, provider pair IDs, filename matching, or timestamp proximity as the canonical relation.

## Integrity verification

`xdrive-server source verify [--json]` is the read-only Source integrity verifier. It checks core Source/SourceItem -> Node/File bindings, canonical/alias identity collisions and cross-Source aliases, SourceCollection membership ownership/state, and SourceItemMetadata Source/MD5/pair-field invariants.

Media verification covers MediaMetadata freshness, MediaGroup/Live Photo evidence, LIVP derived resources, and metadata-referenced thumbnail cache presence/format. Deterministic thumbnail-cache issues support explicit local metadata reset through `xdrive-server media repair [--dry-run]`; repair never changes original files, CAS content, Source state, or remote providers. Remaining verifier/repair work includes storage/digest cross-checks, orphan derived-cache cleanup, stale runs, migrations, and other issue types only after their repair semantics are deterministic.

Storage/CAS byte verification remains the separate `xdrive-server storage verify` responsibility.

## Deletion and recovery

- Backup: remote disappearance marks SourceItem missing while xDrive content remains.
- Mirror: TODO; only confirmed deletion may move a Node to xDrive trash after safety/grace checks.
- Partial, failed, or cancelled inventories never infer deletion.
- Remote providers remain read-only by default.

## Synchronization-folder management contract

The backend subsystem remains named `External Source` / `Source` in code and APIs, while Web/Desktop call it **同步文件夹**.

Every synchronization folder has two management planes that remain separate:

1. **Target identity**
   - `target_node_id` is the persisted xDrive binding.
   - API responses expose resolved `target_path`.
   - Settings render the target directory read-only.
   - Ordinary settings saves do not move, rename, recreate, or rewrite the target.
   - Target changes require an explicit target-selection or verified identity/binding workflow.

2. **Credential identity**
   - Credentials remain encrypted server-side.
   - Normal list/status/test APIs expose metadata only.
   - Explicit reveal is owner-scoped, audited, `Cache-Control: no-store`, and allowlisted by connector.
   - Current reveal allowlist: Yike Pull `cookie`; Synology Photos/FileStation Pull `password`.
   - Web/Desktop mask by default, reveal only on click, keep plaintext in memory briefly, and clear it on timeout/close.
   - Reveal and replacement are separate operations.

New synchronization-folder connectors must follow both this management contract and the Source-vs-Media boundary above.

## Implementation order

1. Complete: Source scheduler/retry/cancellation/account coordination.
2. Complete: `SourceItemAlias` and explicit canonical identity promotion.
3. Complete: Synology FileStation Pull backend and Web/Desktop management.
4. Complete: basic read-only Source binding verifier.
5. Expand xDrive-native media extraction from original files; do not add provider semantic dependencies.
6. Add local connector-neutral MediaGroup and Live Photo projection.
7. Add local RAW/sidecar/burst parsing/grouping.
8. Extend integrity verification and explicit local repair.
9. Add incremental scanners only where a reliable provider change contract exists.
10. Add Mirror-to-trash only after deletion evidence/grace semantics are proven.
