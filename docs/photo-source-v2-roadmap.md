# Photo Source v2 roadmap

> **Normative boundary:** External Source / 同步文件夹 is a generic file synchronization subsystem. A connector is responsible for discovering remote files, preserving file identity/path/content, and transferring the original bytes safely. Media understanding happens only after the original file exists in xDrive.

This document is the implementation roadmap for Yike Photos Pull, Synology Photos Pull, and Synology FileStation Pull. Synology Push follows the same architectural boundary, but is not required for the three-connector milestone described here.

## Hard architecture boundary

### Source / synchronization-folder layer

A synchronization-folder connector may use provider APIs only for file synchronization concerns:

- authenticate and establish a read-only session;
- enumerate files and directories, including provider collections only when they are needed to discover otherwise unreachable files;
- obtain stable remote file identity when the provider exposes one;
- preserve remote path/name, size, remote modification/create timestamps, download locator, and provider digest/checksum hints;
- download original bytes, including Range/resume support where available;
- detect reliable create/update/move/delete events only when the provider exposes a proven change contract;
- preserve optional collection provenance that already exists in xDrive, without making it a dependency of media indexing.

The connector must **not** be the implementation source for:

- EXIF or camera/lens parameters;
- image dimensions/orientation when they can be read from the original;
- video duration, codec, rotation, frame rate, bitrate, or similar media parameters;
- GPS coordinates, altitude, address/geocoding, or capture-location semantics;
- Live Photo pairing or projection;
- RAW/JPEG, XMP/AAE, burst, or auxiliary-media grouping;
- people, tags, favorites, descriptions, face recognition, or other vendor semantic metadata;
- canonical thumbnails or Gallery media interpretation.

Provider fields in these categories may be decoded for compatibility/debugging when necessary, but future synchronization-folder behavior must not depend on them and must not project them into canonical xDrive media state.

### Native xDrive media layer

After an original file is committed as `Node + File + CAS`, xDrive owns all media interpretation:

```text
remote provider
  -> Source / SourceItem
  -> original bytes
  -> Node + File + CAS
  -> native media parser/indexer
       -> MediaMetadata
       -> EXIF / GPS / camera / lens
       -> video technical parameters
       -> thumbnails / previews
       -> validated Live Photo / RAW / sidecar / burst relations
  -> Gallery / search / filters
```

The same media pipeline must produce the same result regardless of whether a file arrived through Yike, Synology Photos, FileStation, upload, Web, Desktop, FUSE, CfAPI, or another future connector.

## Current foundation already in master

The following foundations already exist and should be extended rather than replaced:

- connector-neutral `Source`, `SourceItem`, `SyncRun`, planning, resumable execution, cancellation, scheduling, retry/backoff, missing inference, and backup semantics;
- `SourceItemAlias` and explicit canonical identity promotion;
- `SourceCollection` / `SourceCollectionItem` for optional provider collection provenance;
- `SourceItemMetadata` for source-side file hints such as original path, owner identity, remote times, MD5, and provider thumbnail URL;
- canonical `MediaMetadata` for node-scoped media indexing;
- xDrive-native image/video classification, MIME detection, image dimensions, EXIF orientation/camera/lens/date fields, GPS extraction, MP4/MOV duration/display dimensions/rotation/frame rate/bitrate/codec parsing, derived thumbnail caching, and Gallery indexing;
- Yike Pull stable `yike:<owner_uk>:<fsid>` identity, file/albums discovery, MD5 hint, Range download, resumable upload, bounded API rate, cancellation, and incomplete-inventory safety;
- Synology Photos Pull stable `synology:<space>:<item_id>` identity, Personal/Shared spaces, file/albums discovery, Range download, cancellation, retry classification, and optional-album failure isolation;
- Synology FileStation Pull arbitrary-file recursion, multi-root selection, Range download, stronger `mtime + ctime + crtime + size` revision when available, and path-scoped identity fallback;
- account-aware scheduling and PostgreSQL advisory coordination so Sources using the same upstream account do not multiply login/API pressure;
- `xdrive-server source verify [--json]` for basic read-only SourceItem -> Node/File binding verification.

`SourceItemMetadata.CapturedAt`, `ThumbnailURL`, and the reserved `PairGroupID/PairRole` fields may remain for backward compatibility. Going forward they are **not canonical media inputs**. New connector code must not populate pair relations from provider semantic APIs.

## Design invariants

1. A synchronization folder succeeds or fails based on file synchronization, not on media enrichment.
2. Original bytes are the durable source of truth for media parameters and metadata.
3. `MediaMetadata` is derived locally from the original file and is independent of connector kind.
4. EXIF/GPS/video parsing must be rebuildable while the remote provider is offline.
5. Live Photo and other multi-resource grouping must be derived from locally available originals using validated container/embedded identifiers; filename or timestamp similarity alone is insufficient.
6. Provider `live_type`, remote GPS, face/tag/favorite/description fields, or similar semantic fields must not be required for xDrive media behavior.
7. Provider thumbnails are non-canonical hints at most; xDrive-derived previews are authoritative and rebuildable.
8. Provider collection APIs may be used for file discovery when necessary, but collection metadata must never gate file backup or media indexing.
9. A provider semantic/optional endpoint outage must never turn a valid file inventory into an empty inventory or trigger mass missing inference.
10. Yike keeps `yike:<owner_uk>:<fsid>` as file identity unless a demonstrably stronger file identity is proven.
11. Synology Photos Pull keeps `synology:<space>:<item_id>` because that ID is a file-sync identity, not because xDrive depends on Synology media semantics.
12. FileStation uses only provider-stable file identity when proven; otherwise path identity remains explicit and scoped.
13. Backup mode never removes xDrive content because the provider removed a file.
14. Mirror mode, when implemented, moves only confirmed deletions to xDrive trash and never permanently deletes directly.
15. Incremental synchronization is enabled only for a proven cursor/diff/tombstone contract and always retains a full-reconciliation reset path.
16. Source-side providers remain read-only by default.

## Connector responsibilities

### Yike Photos Pull

Yike is a private-Web-API file adapter. Its responsibilities are:

- enumerate every reachable original file, including album/shared traversal when required to discover files absent from the root listing;
- preserve stable owner + FSID identity, visible filename, size, remote timestamps, MD5 hint, and download information;
- preserve the original object exactly as returned, including `.livp` when that is the remote original;
- keep private API compatibility, bounded retries, rate limiting, pagination validation, and cancellation safety inside the Yike connector.

Yike must not implement EXIF/GPS/media-parameter parsing or Live Photo pairing. `.livp` and other media originals are passed to the common xDrive media pipeline after sync.

### Synology Photos Pull

Synology Photos Pull uses Photos APIs as a **file enumeration/download transport**:

- use Personal/Shared file item IDs as stable SourceItem identity;
- enumerate/download original files and preserve remote file paths/names/timestamps needed for synchronization;
- album APIs may continue to discover files and preserve optional collection provenance, but album availability is not a media-indexing dependency;
- `live_type` and other Photos semantic fields are not used to build xDrive Live Photo state;
- optional semantic APIs for people/tags/favorite/description/GPS/address are not part of the connector roadmap.

Live Photo, EXIF, GPS, technical metadata, and thumbnails are generated locally from synced originals.

### Synology FileStation Pull

FileStation remains the generic DSM connector for arbitrary files:

- enumerate selected shares/subdirectories and preserve directory structure;
- sync every regular file type, not only media;
- use `mtime + ctime + crtime + size` as the zero-extra-request revision where supported;
- use path identity until a provider-stable identity is proven and safely promotable through `SourceItemAlias`;
- do not hash every NAS file on every scan merely to strengthen change detection;
- media files entering through FileStation use exactly the same native media pipeline as every other xDrive file.

`SYNO.FileStation.MD5` may be used later for explicit/on-demand integrity verification or narrowly targeted verification, but not as an unconditional full-library scan tax.

## Source metadata contract

`SourceItemMetadata` is limited to synchronization/provenance hints. It must not become a second media database.

Allowed examples:

- original remote path;
- upstream owner/account identifier;
- remote create/modify timestamps useful for reconciliation;
- provider content digest hints such as MD5;
- provider download/thumbnail locator kept only as a non-canonical hint.

Canonical media fields belong to `MediaMetadata` or a future connector-neutral media relation model and are derived from local originals.

## Native media extraction

### Technical metadata

xDrive owns extraction of:

- image format, MIME, dimensions, bit depth where supported, orientation and color/profile information where useful;
- EXIF/TIFF fields including capture time, camera make/model, lens and exposure-related fields;
- GPS latitude/longitude/altitude and related EXIF location fields;
- video/container duration, dimensions, rotation, frame rate, bitrate, video/audio codec, creation metadata and other supported container fields;
- canonical thumbnails/previews.

Provider timestamps may remain sync hints, but must not override valid embedded capture metadata.

### Live Photo

Live Photo projection is entirely local. The provider is responsible only for syncing the original resources.

Evidence order for local pairing:

1. validated `.livp` container structure and its contained originals;
2. matching embedded Apple content/asset identifiers between still and motion resources;
3. other deterministic embedded/container identifiers that xDrive explicitly validates;
4. otherwise leave files unpaired.

Do not pair by filename, path proximity, capture-time proximity, provider `live_type`, or provider pair/group IDs alone.

A future connector-neutral representation may use:

```text
xd_media_groups
  kind = live_photo | raw_pair | sidecar | burst

xd_media_group_items
  group_id
  node_id
  role
  ordinal
```

The group is a derived local projection. Every original remains an ordinary visible xDrive file and normal CAS object.

### RAW, sidecars and auxiliary resources

- preserve RAW, JPEG/HEIC, XMP/AAE, MOV and other resources as ordinary files;
- add RAW metadata/preview parsers locally;
- create RAW/JPEG, sidecar, or burst relations only from validated embedded/container evidence;
- never require a provider semantic endpoint to reconstruct these relationships.

## Incremental synchronization contract

The Source core already has opaque checkpoints, but the three connectors currently use full reconciliation as the deletion-safety baseline.

A connector may add `ScanChanges(checkpoint)` only when it can prove:

- checkpoint monotonicity or a documented reset condition;
- stable file identity;
- explicit enough create/update/move/delete semantics;
- safe fallback to `ScanFull`;
- periodic full reconciliation to heal drift.

Until such a provider contract is tested, keep full paginated scans rather than approximating changes from timestamps.

## Deletion semantics

### Backup — current default

```text
provider disappearance
  -> SourceItem missing
  -> xDrive Node preserved
```

### Mirror — TODO

Mirror may be added only with:

- explicit reliable tombstones, or repeated completed inventories before inferred deletion is accepted;
- configurable grace/confirmation policy;
- no deletion advancement from partial, failed, or cancelled inventories;
- move to xDrive trash only;
- opt-in configuration clearly distinct from Backup.

### Source-side writes

Remote delete/rename/album mutation and general two-way synchronization are not part of this roadmap. They require a separate audited design with feedback-loop protection.

## Integrity verification and repair

### Implemented

`xdrive-server source verify [--json]` currently checks core Source/SourceItem -> Node/File binding invariants, including missing/wrong-owner/wrong-type/deleted Nodes and file size/SHA drift when SourceItem SHA is available.

### Still TODO

Extend read-only verification to cover:

- SourceItem uniqueness and `SourceItemAlias` collisions/invariants;
- Node -> File -> CAS presence and storage SHA integrity through the existing storage verifier boundary;
- verified digest-alias consistency;
- SourceCollection membership validity;
- SourceItemMetadata Source ownership/attachment consistency;
- MediaMetadata revision/SHA freshness;
- future MediaGroup membership/role consistency;
- derived thumbnail cache consistency;
- stale running Source runs and incomplete migrations.

Only after a read-only issue type is deterministic should an explicit idempotent repair be added, for example rebuilding local media metadata/thumbnail or requeueing a genuinely missing local file. Repair must never modify the remote provider.

## Capability matrix

Legend: **Current** = implemented in master; **Foundation** = common local model/parser exists but coverage/projection is incomplete; **TODO** = future work; **By design: local** = intentionally not obtained from provider APIs.

| Capability | Yike Pull | Synology Photos Pull | FileStation Pull |
| --- | --- | --- | --- |
| Stable file identity | Current owner+FSID | Current Photos item ID | Path identity fallback; promotion only if proven |
| Arbitrary original-file preservation | Current | Current | Current |
| Directory hierarchy | Provider-visible filename model | Photos folder projection | Current recursive hierarchy |
| Optional collection traversal | Current, also needed for some discovery | Current | N/A |
| Range/resume transfer | Current | Current | Current |
| Provider digest hint | Current MD5 | Provider-dependent | MD5 capability exists; not scanned globally |
| Strong zero-extra-request revision | MD5 when present | Cache/indexed revision | Current mtime+ctime+crtime+size |
| EXIF/camera/lens | By design: local | By design: local | By design: local |
| GPS/geolocation | By design: local | By design: local | By design: local |
| Video technical metadata | By design: local | By design: local | By design: local |
| Canonical thumbnail | By design: local | By design: local | By design: local |
| Live Photo pairing/projection | Current local foundation; Gallery presentation pending | Current local foundation; Gallery presentation pending | Current local foundation; Gallery presentation pending |
| `.livp` parsing | Current local parser + zero-copy resources | Same common local parser | Same common local parser |
| RAW metadata/preview | TODO/partial local | TODO/partial local | TODO/partial local |
| RAW/JPEG/XMP/AAE/burst grouping | TODO local | TODO local | TODO local |
| People/tags/favorite/description from provider | Not used by design | Not used by design | Not used by design |
| Reliable incremental cursor | TODO only if proven | TODO only if proven | TODO only if proven |
| Backup deletion safety | Current | Current | Current |
| Mirror-to-trash | TODO | TODO | TODO |
| Basic Source binding verifier | Current shared verifier | Current shared verifier | Current shared verifier |
| Extended integrity/repair | TODO shared | TODO shared | TODO shared |

## Implementation roadmap

The ordering keeps file synchronization independent from media enrichment:

| Phase | Work | Priority |
| --- | --- | --- |
| P0 | Complete: scheduler, retries, cancellation, account coordination, SourceItemAlias, FileStation Pull | Complete |
| P1 | Complete: basic read-only Source binding verifier | Complete |
| P2 | Formalize this Source-vs-Media boundary in code contracts/tests; prevent new provider semantic projections | Highest |
| P3 | Expand native media parser coverage from original files: EXIF/TIFF/GPS/video/container edge cases | Highest |
| P4 | Complete foundation: connector-neutral `MediaGroup` / member model plus owner-scoped idempotent local projection store; parser-driven population continues in P5/P6 | Complete |
| P5 | In progress: local Apple still/MOV identifiers drive fail-closed MediaGroup projection; validated `.livp` containers now expose zero-copy still/motion derived resources through the media API; HEIC thumbnail decoding and Gallery playback/presentation remain | High |
| P6 | Add RAW metadata/preview and validated RAW/JPEG, XMP/AAE, burst/auxiliary grouping | High |
| P7 | Extend read-only Source/media integrity verification and add explicit idempotent local repair actions | High |
| P8 | Add `ScanFull` / `ScanChanges` only for connectors with a proven provider change contract | Medium-high |
| P9 | Add Mirror-to-trash with reliable deletion evidence and grace policy | Medium |
| P10 | Expand Gallery filters/search from xDrive-native metadata such as local capture time and GPS | Medium |
| P11 | Maintain sanitized connector fixtures, live smoke tests, migration tests, and cross-connector media-parser equivalence tests | Continuous |

Provider semantic metadata import is deliberately removed from the roadmap. If xDrive later implements people/tag/place recognition, it belongs to a separate connector-neutral media-analysis subsystem operating on local originals, not to Yike/Synology/FileStation connectors.

## Acceptance criteria

Before calling this subsystem mature:

- the same original file produces the same MediaMetadata regardless of connector;
- EXIF/GPS/video metadata can be fully rebuilt with all providers offline;
- Live Photo projection can be rebuilt from local originals without Synology/Yike semantic APIs;
- a Live Photo without deterministic local evidence remains unpaired;
- `.livp` is preserved as an original and locally interpreted without destroying the container;
- provider semantic endpoint changes cannot break file backup;
- collection endpoint failure cannot masquerade as an empty file inventory;
- rebuilding Source state does not duplicate files when stable Source identity exists;
- cancellation and failed/partial scans cannot trigger missing inference;
- Backup never trashes content because it disappeared remotely;
- Mirror, if enabled, acts only on proven deletion and moves to trash rather than permanent delete;
- integrity verification detects local binding/media corruption without mutating anything;
- repair rebuilds local derived state without writing to the provider.

## Explicit non-goals

Do not add connector dependencies on:

- Synology/Yike EXIF, GPS, location, media-parameter, Live Photo, people, tag, favorite, description, or face-recognition APIs;
- vendor thumbnails as canonical previews;
- filename/time-based heuristic media pairing;
- proprietary photo editing/social features;
- source-side mutation or two-way sync as part of the initial milestone;
- perceptual duplicate merging across differently encoded media.

Those capabilities, if desired later, must be implemented as connector-neutral local media features unless they are strictly necessary to enumerate or transfer files.
