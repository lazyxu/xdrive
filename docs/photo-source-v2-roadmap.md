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
- `SourceItemAlias` and explicit canonical identity promotion; this is the Source-domain `SourceIdentityAlias` and is intentionally not duplicated by the Photo domain;
- `SourceCollection` / `SourceCollectionItem` for optional provider collection provenance;
- provenance-only `SourceItemMetadata` for original path, owner identity, remote create time, and provider MD5; media-semantic legacy columns are removed during migration;
- canonical `MediaMetadata` for node-scoped parsing plus the derived `PhotoAsset` / `PhotoResource` / `PhotoMetadata` logical asset layer;
- xDrive-native image/video classification, MIME detection, image dimensions, EXIF orientation/camera/lens/date fields, GPS extraction, MP4/MOV duration/display dimensions/rotation/frame rate/bitrate/codec parsing, versioned local relation evidence (`ImageUniqueID` / Apple `BurstUUID` / XMP Media Management IDs), local JPEG/PNG/GIF/HEIC/HEIF/WebP/AVIF/TIFF/BMP/DNG-preview thumbnails, derived thumbnail caching, and Gallery indexing;
- Yike Pull stable `yike:<owner_uk>:<fsid>` identity, file/albums discovery, MD5 hint, Range download, resumable upload, bounded API rate, cancellation, and incomplete-inventory safety;
- Synology Photos Pull stable `synology:<space>:<item_id>` identity, Personal/Shared spaces, file/albums discovery, Range download, cancellation, retry classification, and optional-album failure isolation;
- Synology Push hybrid identity foundation: filesystem-complete inventory/fast byte reads plus optional Photos item-ID canonicalization with filesystem aliases and in-place promotion;
- Synology FileStation Pull arbitrary-file recursion, multi-root selection, Range download, stronger `mtime + ctime + crtime + size` revision when available, and path-scoped identity fallback;
- account-aware scheduling and PostgreSQL advisory coordination so Sources using the same upstream account do not multiply login/API pressure;
- `xdrive-server source verify [--json]` for basic read-only SourceItem -> Node/File binding verification.

Legacy Source-side media-semantic columns (`CapturedAt`, `ThumbnailURL`, `PairGroupID`, `PairRole`) are removed during migration. `SourceItemMetadata` is provenance-only, so new connector code cannot persist provider media semantics there.

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
10. Yike keeps `yike:<owner_uk>:<fsid>` as file identity unless a demonstrably stronger file identity is proven; owner scope is mandatory because shared-album FSIDs are not treated as globally unique.
11. Synology Photos Pull keeps `synology:<space>:<item_id>` because that ID is a file-sync identity, not because xDrive depends on Synology media semantics.
12. File inventory, metadata snapshots, collection memberships, deduplication, and transfer planning must obtain provider identities through one connector-owned canonical helper rather than rebuilding identity strings independently.
13. Current Yike/Synology Pull identities were canonical from their initial implementations; do not fabricate migration aliases. Use `SourceItemAlias` only when a future stronger provider identity is deterministically proven.
14. FileStation uses only provider-stable file identity when proven; otherwise path identity remains explicit and scoped.
15. Backup mode never removes xDrive content because the provider removed a file.
16. Mirror mode, when implemented, moves only confirmed deletions to xDrive trash and never permanently deletes directly.
17. Incremental synchronization is enabled only for a proven cursor/diff/tombstone contract and always retains a full-reconciliation reset path.
18. Synology Push keeps the filesystem as inventory authority and byte path; Photos item identity enrichment is optional/best-effort and must fail back to filesystem identity without causing missing inference.
19. Push may promote a filesystem canonical ID to `synology:<space>:<item_id>` only when the exact provider folder graph + filename maps inside the configured root and the provider-reported size matches as a consistency guard.
20. Source-side providers remain read-only by default.

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

Allowed fields are intentionally narrow:

- original remote path;
- upstream owner/account identifier;
- remote create timestamp useful for reconciliation/provenance;
- provider content digest hints such as MD5.

Provider thumbnail locators, capture-time hints and pair/group semantics are not stored in `SourceItemMetadata`.

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

### Current format support matrix

Support is tracked by capability rather than file extension alone. "Gallery" means the original is indexed and shown as a logical `PhotoAsset`; "thumbnail" means xDrive can generate its own local JPEG preview without provider thumbnails.

| Format / family | Detection + metadata | Local thumbnail | Gallery presentation | Current limits |
| --- | --- | --- | --- | --- |
| JPEG / JPG | Complete for common EXIF/GPS/camera/lens fields | Complete | Complete | Animated/multi-picture JPEG variants are not treated as animation |
| PNG | Dimensions/basic image metadata | Complete | Complete | No special animation handling |
| GIF | Dimensions/basic image metadata | First-frame thumbnail | Complete as image | Animated GIF playback is not yet a Gallery feature |
| HEIC / HEIF | Dimensions + supported embedded EXIF; Apple asset ID where present | Complete through local HEIC decoder | Complete | Apple Live Photo supported when deterministic local evidence exists |
| WebP | Dimensions/basic image metadata | Complete through local WebP decoder | Complete | Animated WebP playback is not yet a Gallery feature |
| AVIF | ISO-BMFF classification and dimensions | Complete through local AVIF decoder | Complete as image | Animated/multi-image AVIF playback is not yet a Gallery feature |
| TIFF | TIFF/EXIF/GPS metadata | Complete through local TIFF decoder | Complete | Common TIFF still images only |
| BMP | Dimensions/basic metadata | Complete through local BMP decoder | Complete | Still image only |
| DNG | TIFF/DNG metadata, EXIF/GPS, safe embedded-JPEG preview | Complete when a valid embedded JPEG preview exists | Complete; may become `raw_pair` | DNG without a safe embedded preview has no thumbnail |
| CR3 / NEF / ARW / other RAW | Original file preserved | Not yet | Not yet native Gallery media | Parser work remains P6 |
| `.livp` | Strict local container validation | Complete from embedded still resource | Complete as one `live_photo` asset | Original container remains one Node/CAS object |
| Apple still + MOV Live Photo | Exact embedded Apple identifiers | Still thumbnail complete | Complete as one `live_photo` asset | No filename/time fallback |
| MP4 / MOV / M4V / 3GP / 3G2 | ISO-BMFF duration/dimensions/rotation/frame-rate/codec where present | No ordinary video poster yet | Indexed and stream-playable in Gallery when the browser/Electron codec supports the file | Playback uses authenticated HTTP Range streaming; poster generation remains TODO |
| MKV / WebM / AVI / MTS / M2TS / MPEG / MPG | File type classification only | No | Indexed with fallback tile; stream transport is available | Native technical metadata/poster remain TODO; playback succeeds only when the browser/Electron runtime supports that container/codec |
| XMP | Local relation evidence such as `DocumentID` / `DerivedFrom` | N/A | Not shown as standalone Gallery media | Can join a validated RAW/image asset as sidecar |
| AAE | Original file preserved | N/A | Not shown as standalone Gallery media | No pairing without a deterministic embedded target identity |

Phone-oriented status:

- iPhone common still formats (JPEG/HEIC), common video containers (MOV/MP4), Apple Live Photo, and preserved `.livp` are supported by the shared local pipeline.
- Manufacturer-specific Huawei/Xiaomi/OPPO/vivo/Samsung moving-photo protocols are intentionally deferred; do not infer them from filename or timestamp proximity.
- Animated GIF/WebP files remain preserved originals and are indexed as images, but Gallery animation playback is a separate feature from thumbnail support.
- Ordinary phone-video playback uses HTTP Range streaming rather than Desktop base64 IPC, so large 4K files do not have to be buffered in renderer/main/Agent memory.
- Web playback uses a short-lived signed media ticket scoped to the current user session, Node and Node revision. Desktop uses the loopback-only Agent IPC as a Range proxy with a separate media-only token; the general Desktop IPC bearer is never exposed to the renderer.
- Video playback still depends on codecs supported by the browser/Electron runtime. The streaming transport does not imply that every classified container/codec is decodable.

### Gallery video streaming

Ordinary videos are never marshalled through JSON/base64 for playback.

- the Server's authenticated media-video endpoint delegates byte serving to `http.ServeContent`, preserving HTTP Range/206 behavior;
- Web requests a short-lived signed playback ticket and gives the resulting scoped URL directly to the shared Gallery `<video>` element;
- the ticket is bound to user ID, current session version, Node ID and Node revision, and becomes invalid after logout/session revocation, account disable/password-change enforcement, expiry, or file revision change;
- Desktop exposes a loopback-only Agent Range proxy. The discovery file carries a dedicated random `media_token` separate from the general Desktop IPC bearer; only `GET /v1/media/video` accepts that token in the query string;
- the Agent forwards Range to the Server with its normal authenticated client and streams the body through without whole-file buffering;
- Electron CSP permits media only from self/data/blob and ephemeral `127.0.0.1` HTTP endpoints.

This completes the transport needed for large phone videos. Container/codec decoding still depends on the browser/Electron media stack, and poster extraction remains separate work.

### Live Photo

Live Photo projection is entirely local. The provider is responsible only for syncing the original resources.

Evidence order for local pairing:

1. validated `.livp` container structure and its contained originals;
2. matching embedded Apple content/asset identifiers between still and motion resources;
3. other deterministic embedded/container identifiers that xDrive explicitly validates;
4. otherwise leave files unpaired.

Do not pair by filename, path proximity, capture-time proximity, provider `live_type`, or provider pair/group IDs alone.

The connector-neutral logical asset layer is now implemented as:

```text
xd_photo_assets
  primary_node_id
  kind
  evidence_key

xd_photo_resources
  asset_id
  resource_kind = node | derived
  node_id
  role
  byte_offset / size

xd_photo_metadata
  asset_id
  captured_at / dimensions / duration / GPS
  exif_json / video_json
  tags_json / people_json / vendor_json

xd_photo_collections
  external_key = folder:<node_id> | source:<collection_id> | future manual:/smart:

xd_photo_collection_assets
  collection_id
  asset_id
  position
```

`MediaGroup` remains the deterministic local evidence layer for Live Photo/RAW/sidecar/burst relations. `PhotoAsset` is the higher-level Gallery projection. Every original remains an ordinary visible xDrive file and normal CAS object.

### RAW, sidecars and auxiliary resources

- preserve RAW, JPEG/HEIC, XMP/AAE, MOV and other resources as ordinary files;
- add RAW metadata/preview parsers locally;
- create RAW/JPEG, sidecar, or burst relations only from validated embedded/container evidence;
- never require a provider semantic endpoint to reconstruct these relationships.

Current deterministic relation projection is intentionally narrow:

- DNG + one rendered image may form a `raw_pair` only when both local originals expose the same exact EXIF/Apple `ImageUniqueID`;
- an `.xmp` sidecar may join one local image (or an existing RAW pair containing that image) only when XMP `DerivedFrom` explicitly references a unique local XMP `DocumentID` / `OriginalDocumentID`;
- Apple burst images may form a `burst` only from an exact shared Apple MakerNote `BurstUUID`;
- relations that would overlap an already validated Live Photo, or are otherwise ambiguous, fail closed;
- `.AAE` files remain ordinary ungrouped files unless a future parser finds a deterministic embedded target identity. Filename stems and capture-time proximity are not evidence.

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

`xdrive-server source verify [--json]` checks core Source/SourceItem -> Node/File bindings plus SourceItem canonical/alias identity collisions, SourceCollection membership ownership/state, and SourceItemMetadata Source/provenance/MD5 invariants. `xdrive-server media verify [--json]` checks MediaMetadata freshness, MediaGroup/Live Photo evidence and membership invariants, MediaDerivedResource ownership/revision/SHA/range, validated LIVP resource consistency, and metadata-referenced thumbnail cache state. Both are read-only.

### Still TODO

Extend read-only verification to cover:

- Node -> File -> CAS presence and storage SHA integrity through the existing storage verifier boundary;
- verified digest-alias consistency;
- derived thumbnail cache orphan cleanup beyond metadata-referenced entries;
- stale running Source runs and incomplete migrations.

Deterministic thumbnail-cache issues now support explicit idempotent metadata reset via `xdrive-server media repair [--dry-run]`; cache bytes are left in place because identical content may share one cache key, and the next thumbnail request rebuilds/overwrites the derived cache as needed. Additional repairs should follow the same rule: prove the issue read-only first, mutate only local derived state, and never modify the remote provider.

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
| Live Photo pairing/projection | Current local pairing + PhotoAsset/Gallery playback | Same shared local pipeline | Same shared local pipeline |
| `.livp` parsing | Current local parser + zero-copy resources | Same common local parser | Same common local parser |
| RAW metadata/preview | DNG metadata + embedded-JPEG preview current; other RAW TODO local | DNG metadata + embedded-JPEG preview current; other RAW TODO local | DNG metadata + embedded-JPEG preview current; other RAW TODO local |
| RAW/JPEG/XMP/AAE/burst grouping | Current local subset: DNG/rendered exact ImageUniqueID, XMP explicit DerivedFrom, Apple BurstUUID; AAE/other RAW TODO | Same shared local pipeline | Same shared local pipeline |
| People/tags/favorite/description from provider | Not used by design | Not used by design | Not used by design |
| Reliable incremental cursor | TODO only if proven | TODO only if proven | TODO only if proven |
| Backup deletion safety | Current | Current | Current |
| Mirror-to-trash | TODO | TODO | TODO |
| Basic Source binding verifier | Current shared verifier | Current shared verifier | Current shared verifier |
| Extended integrity/repair | Current shared read-only verify; partial local repair | Current shared read-only verify; partial local repair | Current shared read-only verify; partial local repair |

## Implementation roadmap

The ordering keeps file synchronization independent from media enrichment:

| Phase | Work | Priority |
| --- | --- | --- |
| P0 | Complete: scheduler, retries, cancellation, account coordination, SourceItemAlias, FileStation Pull | Complete |
| P1 | Complete: basic read-only Source binding verifier | Complete |
| P2 | Formalize this Source-vs-Media boundary in code contracts/tests; prevent new provider semantic projections | Highest |
| P3 | In progress: common phone still formats are indexed; JPEG/PNG/GIF/HEIC/HEIF/WebP/TIFF/BMP/DNG-preview thumbnails are local; ordinary ISO-BMFF videos use Range playback; video posters, animation playback, and non-ISO video metadata remain | Highest |
| P4 | Complete: connector-neutral `MediaGroup` evidence plus `PhotoAsset` / `PhotoResource` / `PhotoMetadata` / `PhotoCollection` logical projection | Complete |
| P5 | Complete: local Apple identifiers, fail-closed MediaGroup projection, validated `.livp` zero-copy resources, logical Gallery semantics, shared Web/Desktop playback, and local HEIC/HEIF thumbnail decoding | Complete |
| P6 | In progress: DNG metadata/preview plus exact-ID DNG-rendered pairing, explicit XMP DerivedFrom sidecars, and Apple BurstUUID grouping are local; AAE without embedded target identity and other RAW formats remain ungrouped/TODO | High |
| P7 | In progress: Source binding/alias/collection/item-metadata verify, media relationship/thumbnail verify, and idempotent thumbnail-metadata repair are current; broader deterministic local repair actions remain | High |
| P8 | Add `ScanFull` / `ScanChanges` only for connectors with a proven provider change contract | Medium-high |
| P9 | Add Mirror-to-trash with reliable deletion evidence and grace policy | Medium |
| P10 | In progress: logical PhotoAsset kinds/resources and authenticated Range video playback are exposed in Gallery; next add video posters, animation playback, then filters/search from capture time/GPS | Medium |
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
- relation-evidence version/JSON corruption is detectable locally and stale evidence is re-indexed without provider access;
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
