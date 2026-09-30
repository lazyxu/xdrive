# Photo Source v2 roadmap

> **Boundary:** External Source is a generic file synchronization subsystem. See `docs/external-source-architecture.md`. Photo Source v2 only adds media semantics after ordinary files have been preserved; it must never assume every SourceItem is a photo or video. Synology Files Pull (`synology_files`) is therefore a generic External Source connector and syncs arbitrary file types.

This document is the implementation roadmap for turning Yike Photos Pull, Synology Photos Pull, and Synology Photos Push into one mature photo-ingestion subsystem.

It is a **design/TODO document**. It does not describe new runtime behavior until the corresponding phase is implemented.

The scope is photo/video backup, import, organization, metadata preservation, search, recovery, and read-only synchronization. It is intentionally **not** a plan to clone every vendor application feature such as vendor photo editing, social features, or proprietary AI model training. When a provider exposes useful semantic results such as people, tags, favorites, descriptions, or albums, xDrive should import those results instead of reimplementing the provider's recognition pipeline.

## Current foundation already in master

The following pieces already exist and should be reused rather than rebuilt:

- The connector-neutral External Source core already models `Source`, stable `SourceItem` identity, `SyncRun`, planning, resumable execution, cancellation, missing inference, schedules, and backup semantics.
- Logical albums already use `SourceCollection` / `SourceCollectionItem`, so one media object can belong to multiple albums without duplicating the xDrive file.
- `SourceItemMetadata` already stores connector-neutral source hints such as original path, owner identity, capture time, remote creation time, MD5, thumbnail URL, and the reserved `PairGroupID` / `PairRole` fields for explicit multi-resource relationships.
- The reserved pair roles are `still`, `motion`, and `container`. Connectors must not infer a pair from filename similarity alone.
- `MediaMetadata` is already the canonical, node-scoped media index for **all** xDrive files, not only External Source files.
- The universal media layer already performs image/video classification, MIME detection, dimensions, EXIF orientation, EXIF camera/lens/date fields, GPS extraction, MP4/MOV duration/display dimensions/rotation/frame rate/bitrate/codec extraction, derived thumbnail caching, and Gallery indexing.
- Yike Pull already uses stable `yike:<owner_uk>:<fsid>` identities, imports albums, stores capture/create time, MD5 and remote thumbnail hints, rate-limits the private control-plane API to about 2 requests/second, supports Range downloads, resumable xDrive uploads, verified MD5-to-SHA256 reuse, durable cancellation, and incomplete-inventory safety.
- Synology Pull already uses Photos item identity as `synology:<space>:<item_id>`, supports Personal/Shared spaces, imports logical albums, uses resumable Range downloads, and exposes the Photos `live_type` field in the adapter.
- Synology Push already has robust filesystem identities, including portable identity state, birth-time-aware remount handling, inode-reuse protection, atomic identity persistence, and fail-closed root replacement detection.
- The Pull worker dispatches eligible sources with bounded source-level concurrency (default 2, configurable 1-8), prioritizes pending manual requests, then persisted retryable failures, then the oldest computed scheduled next-run time.
- Backup mode intentionally never deletes or trashes xDrive content because a source item disappeared.

Therefore Photo Source v2 must **extend the existing layers**, not introduce a second parallel photo database.

## Target architecture

The canonical layering is:

```text
Yike / Synology provider semantics
        |
        v
Source + SourceItem + SourceItemMetadata + SourceCollection
        |
        | stable identity, source metadata, album membership, pair evidence
        v
Node + File + CAS
        |
        | one xDrive file node for each preserved original resource
        v
MediaMetadata + derived previews + Gallery
        |
        | optional validated multi-resource projection
        v
MediaGroup / semantic search
```

A separate `PhotoAsset` primary entity is **not** planned. `Node + MediaMetadata` already owns the canonical xDrive media object. A future logical Live Photo, RAW+JPEG pair, sidecar bundle, or burst is represented as a relationship among normal xDrive Nodes, not as a replacement storage model.

## Design invariants

1. Yike Pull, Synology Pull, and Synology Push use the same Source planner, run model, execution commit protocol, metadata conventions, and Gallery projection wherever the transport permits it.
2. `SourceItem` remains the synchronization/identity object. Provider-specific photo fields must not be added directly to `xd_source_items`.
3. `MediaMetadata` remains the canonical technical media index for xDrive content, independent of how the file entered xDrive.
4. Embedded/original-file metadata is authoritative for technical properties when available. Provider metadata may fill missing values but should not silently overwrite stronger original-file evidence.
5. Provider semantic results such as people, tags, favorites, descriptions, addresses, and albums remain traceable to their source.
6. One preserved remote resource maps to one normal xDrive Node/File/CAS object. Album membership never copies media bytes.
7. Multi-resource media is grouped only from explicit provider evidence, a validated container format, or a validated embedded asset identifier. Filename/time proximity is never sufficient evidence.
8. Synology Pull keeps Photos item IDs as canonical identity.
9. Synology Push should use Photos item IDs for indexed media when available, while retaining filesystem identity as the data-path/fallback identity for unindexed files, sidecars, unsupported objects, and API outages.
10. Existing Synology Push `fs:*` / `fs2:*` SourceItems must migrate without duplicate Nodes or duplicate transfers.
11. Yike keeps `yike:<owner_uk>:<fsid>` as its canonical remote identity unless the provider exposes a demonstrably stronger stable identity in the future.
12. Source-side providers remain read-only by default.
13. Backup mode never removes xDrive content because the provider removed an item.
14. Mirror mode, when implemented, only moves content to xDrive trash after deletion safety checks; it never permanently deletes directly.
15. Incremental synchronization is enabled only when the provider exposes a proven reliable cursor/diff/tombstone contract. Otherwise the connector continues using full reconciliation.
16. Every incremental connector periodically runs a full reconciliation to heal cursor drift or missed remote events.
17. Multi-source parallelism is bounded globally, while each connector/account retains its own rate limit and conservative transfer concurrency.
18. Connector capabilities are declared explicitly. Core code should not accumulate scattered vendor-name conditionals.
19. A provider API outage must never cause mass missing inference or identity reset.
20. Integrity repair must be idempotent and must never mutate the remote provider unless source-side writes are explicitly enabled by a future feature.

## Capability model

Each photo connector should eventually declare capabilities rather than relying on vendor-specific branching:

```text
SupportsStableItemIdentity
SupportsCollections
SupportsSharedCollections
SupportsSourceMetadata
SupportsPeople
SupportsTags
SupportsFavorite
SupportsDescription
SupportsRemoteGPS
SupportsRemoteThumbnail
SupportsLivePhoto
SupportsContainerMedia
SupportsRange
SupportsIncrementalChanges
SupportsExplicitDeleteEvents
SupportsLocalFastPath
```

A missing capability is normal. The core must degrade predictably instead of guessing.

## Data-model extensions

Photo Source v2 should add only the structures that are not already represented by the current Source and Media models.

### 1. Source identity aliases

Add a server-side alias mapping so an existing SourceItem can acquire a stronger canonical provider identity without recreating the xDrive Node:

```text
xd_source_item_aliases
----------------------
source_id
source_item_id
alias_external_id
alias_kind
created_at

UNIQUE(source_id, alias_external_id)
```

The planner resolves aliases before deciding that an observed external ID is new.

For Synology Push migration, the NAS agent should make the match locally where it can prove that a Photos item and filesystem object are the same physical file. The server must not guess identity from a loose path/name/time heuristic.

A successful migration can make `synology:<space>:<item_id>` canonical while preserving the old `fs:*` or `fs2:*` value as an alias. SourceCollection, SourceItemMetadata, run history, and the Node binding remain attached to the same SourceItem row.

### 2. Source semantic facets

Technical EXIF/video metadata already belongs to `MediaMetadata`. Provider-only semantics should use a normalized source-level representation instead of dozens of JSON arrays on SourceItem:

```text
xd_source_facets
----------------
id
source_id
kind              person | tag | place
external_id
display_name
metadata_json

xd_source_item_facets
---------------------
source_item_id
facet_id
```

Scalar provider semantics such as favorite, description, remote address, or remote GPS may extend `SourceItemMetadata` or use a small dedicated source-semantic record. Preserve an opaque vendor payload only when it is required for forward compatibility; normalized fields remain the API contract.

### 3. Canonical multi-resource grouping

`SourceItemMetadata.PairGroupID/PairRole` is the source-side evidence. Once the referenced SourceItems are attached to xDrive Nodes, project validated relationships into a connector-neutral node-level group:

```text
xd_media_groups
---------------
id
owner_id
kind              live_photo | raw_pair | sidecar | burst
created_at
updated_at

xd_media_group_items
--------------------
group_id
node_id
role
ordinal
```

This preserves the normal xDrive filesystem/CAS model while allowing Gallery to render one logical Live Photo tile or one grouped RAW/JPEG asset.

## Synology Photos plan

### Pull

Synology Pull already has the correct canonical file identity:

```text
synology:personal:<item_id>
synology:shared:<item_id>
```

TODO work should extend the existing Photos adapter rather than alter that identity:

- Request and normalize additional Photos metadata when the installed DSM/Photos version exposes it.
- Import description, favorite, GPS/address, tags, and people as optional capabilities.
- Preserve stable provider IDs for tag/person facets when the API provides them.
- Keep album membership in the existing SourceCollection model.
- Translate Live Photo information into `PairGroupID/PairRole` only when a stable group/paired item identifier is available.
- If the API exposes only `live_type` without a reliable pair identifier, defer pairing to validated post-import media parsing rather than guessing.
- Treat unsupported optional metadata APIs as capability absence, not as a failed file inventory.
- Continue to use the xDrive-derived thumbnail as the durable canonical preview after import.

### Push: hybrid semantic identity + filesystem fast path

Synology Push should not abandon the native NAS agent. The target design is two cooperating lanes:

```text
Synology Photos API
  -> stable item identity
  -> albums / people / tags / favorite / description / GPS
  -> optional Live Photo evidence

DSM filesystem
  -> authoritative local bytes
  -> complete root traversal and unsupported/sidecar files
  -> direct local upload without NAS -> HTTPS -> NAS round trip
```

The important behavior is a **union**, not an API-only replacement:

- Media indexed by Synology Photos uses `synology:<space>:<item_id>` when a local API item can be proven to correspond to the file.
- Files under the configured Photos roots that are not indexed by Photos remain backed up through the existing filesystem identity path.
- Sidecars and unsupported files continue to work even when Photos has no item row for them.
- A later Photos indexing event can migrate an existing filesystem SourceItem to the Photos item ID through the alias table without re-uploading content.
- Once a filesystem object has been associated with a canonical Photos item ID, temporary Photos API failure must not make the object appear new. The agent persists the proven mapping and can continue using the filesystem fast data path.
- A semantic-metadata failure must be distinguishable from an incomplete filesystem inventory so metadata enrichment cannot accidentally disable or trigger missing inference for the media inventory.

The preferred credential boundary is local to the NAS agent: optional Photos API credentials are stored in the agent's existing secure/fallback local credential store, scoped to the configured Source. xDrive Server should not need to send a stored DSM password back to the NAS merely to enable the local fast path.

## Yike Photos plan

Yike remains a private-Web-API adapter and therefore needs stronger compatibility isolation than Synology:

- Keep the provider protocol entirely inside `internal/yike` and the Yike scanner.
- Keep the existing per-client control-plane rate limiter and bounded retries.
- Maintain contract tests from recorded/sanitized shapes plus the existing opt-in live smoke test.
- Import every stable remote metadata field that can be obtained without mutating the account.
- Continue to rely on the universal xDrive media index for EXIF/GPS/video metadata after the original is imported.
- Do not duplicate the universal EXIF parser inside the Yike connector.
- Preserve original `.livp` files as originals when that is what the provider returns.
- Pair Live Photos using this evidence order:
  1. explicit remote pair/group identifier;
  2. a validated `.livp` container relation;
  3. a validated embedded Apple asset identifier after download;
  4. otherwise leave the resources unpaired.
- Never pair merely because names or capture times are similar.
- If the private API changes, fail the affected capability narrowly. A missing album/metadata endpoint must not be converted into a destructive empty-library result.

## Metadata precedence

Use field-specific precedence instead of one generic "remote wins" rule:

| Field class | Primary source | Fallback |
| --- | --- | --- |
| File size/hash/content | xDrive transfer verification | provider digest as a hint only |
| Width/height/orientation/codecs/duration | parsed original | provider value if parsing is unsupported |
| EXIF camera/lens/exposure/ISO | parsed original | provider metadata |
| Capture time | embedded original when valid | provider capture time |
| GPS | embedded original when valid | provider GPS |
| Album membership | provider collection API | none |
| People/tags/favorite/description/address | provider semantic API | none |
| Thumbnail | xDrive derived preview | provider thumbnail only as optional bootstrap |

Keep both original-derived and provider-derived values where provenance matters; do not destroy the source value after projecting a canonical Gallery field.

## Live Photo and auxiliary resources

The grouping layer should support more than Apple Live Photo so the design does not need to be replaced later.

### Live Photo

Possible preserved resources:

```text
group kind = live_photo
  still     -> IMG_0012.HEIC/JPG
  motion    -> IMG_0012.MOV
  container -> optional original .livp
```

Gallery may render the still as the cover and play the motion resource on demand. Both originals remain normal xDrive files.

### RAW + JPEG

Preserve both files. Group only when explicit metadata or a deterministic embedded identifier proves the relationship. RAW formats should gain technical metadata/preview support without converting or discarding the original.

### Sidecars

XMP/AAE and similar files remain normal backed-up files. A sidecar relation may link them to a primary media Node, but the sidecar is never hidden from the filesystem namespace.

### Burst / auxiliary resources

Model them as ordered MediaGroup members when the provider or embedded metadata supplies a reliable group identifier.

## Incremental synchronization contract

Introduce one connector-neutral scanner capability:

```text
ScanFull(...)
ScanChanges(checkpoint ...)
```

`ScanChanges` may be enabled only when the connector can prove:

- checkpoint monotonicity or a documented reset condition;
- stable item IDs;
- explicit enough create/update/move/delete semantics;
- a safe reset path back to `ScanFull`.

A stale/invalid cursor must request a full reconciliation, never silently continue from an unknown point.

Even with reliable incremental changes, schedule periodic full reconciliation. Full reconciliation remains the deletion-safety baseline.

Until Yike or Synology exposes a tested reliable change cursor, continue full paginated scans rather than approximating change detection from timestamps.

## Scheduler and retry policy

The Pull runner uses bounded source-level concurrency:

- default global active Source limit: 2;
- configurable from 1 through 8;
- per-Source transfer concurrency remains 1;
- connector/account-specific API rate limits remain independent of global Source concurrency.

The queue priority is:

```text
P0 pending manual "run now"
P1 due persisted retryable failure
P2 most-overdue scheduled Source
P3 normally due scheduled Source
```

Retry state is persisted on the Source so worker restarts do not erase or multiply retries. Transient failures use exponential backoff starting at about one minute and capped at 30 minutes; rate-limit/multiple-login failures start at about two minutes and cap at one hour. Stable per-Source jitter spreads retries, and the selected `retry_at` deadline is persisted. Explicit `manual` schedule Sources never become automatically due from retry state, preserving the manual-only contract. A user-triggered **立即扫描** request still overrides a pending backoff.

Only connector-classified transient/rate-limit failures enter this source-level retry path. Authentication, permission, OTP, invalid TLS certificates, missing provider capabilities, invalid configuration, and deterministic item errors remain non-retryable at the scheduler level.

If multiple Sources share one provider account, a later connector-account limiter should prevent source-level parallelism from multiplying the provider's effective API request rate beyond the account policy.

## Deletion semantics

### Backup

Default and current behavior:

```text
provider deletion
  -> SourceItem missing
  -> xDrive Node preserved
```

### Mirror

TODO:

```text
provider deletion
  -> deletion candidate
  -> grace / confirmation policy
  -> xDrive trash
```

Requirements:

- Never permanently delete directly.
- Accept a deletion immediately only from an explicit reliable provider tombstone, or require repeated completed inventories before acting on inferred absence.
- A partial/cancelled/failed inventory can never advance inferred deletion.
- Keep a configurable grace period.
- Restore from xDrive trash remains possible.
- Mirror must remain opt-in and visually distinct from Backup.

### Source-side writes / two-way synchronization

Not part of Photo Source v2 initial delivery. Delete/rename/album mutation on Yike or Synology is last-priority work and must be separately enabled, audited, and protected from feedback loops.

## Integrity verifier and repair

Add a read-only verifier before any automatic repair mode. It should check:

- SourceItem uniqueness and alias collisions;
- SourceItem -> Node ownership and current revision consistency;
- Node -> File -> CAS presence and SHA256 consistency;
- verified MD5 alias consistency;
- SourceCollection membership pointing to valid SourceItems;
- SourceItemMetadata rows attached to the correct Source;
- MediaMetadata revision/SHA freshness;
- MediaGroup members and pair roles;
- derived thumbnail cache consistency;
- stale running Source runs and incomplete migration state.

Repair actions must be explicit and idempotent:

- rebuild media metadata/thumbnail from the preserved original;
- requeue a SourceItem transfer when the Node/File is genuinely missing;
- rebuild collection/facet projection from a complete source snapshot;
- restore a proven identity alias;
- never repair by deleting remote content.

## Unified capability matrix

Legend: **Current** = implemented in master; **Foundation** = model/parser exists but connector projection is incomplete; **TODO** = roadmap work.

| Capability | Yike Pull | Synology Pull | Synology Push |
| --- | --- | --- | --- |
| Stable source file ID | Current | Current | Current filesystem ID; Photos ID TODO |
| Personal/shared spaces | Shared albums/current API shape | Current | Current |
| Original image/video transfer | Current | Current | Current |
| HEIC/HEIF original preservation | Current | Current | Current |
| RAW file preservation | Current as ordinary file | Current as ordinary file | Current as ordinary file |
| RAW Gallery metadata/preview | TODO | TODO | TODO |
| Logical albums without duplicate bytes | Current | Current | TODO via Photos semantic lane |
| Source capture/create time | Current | Current capture time | Filesystem metadata only |
| Source MD5 hint | Current | Provider dependent | Filesystem/server hash path |
| Universal EXIF/camera/lens metadata | Current after import | Current after import | Current after import |
| Universal GPS extraction | Current after import | Current after import | Current after import |
| Video duration/rotation/codecs | Current after import | Current after import | Current after import |
| xDrive-derived thumbnails | Current | Current | Current |
| Provider thumbnail hint | Current | Adapter foundation | TODO semantic lane |
| Favorite/description | TODO | TODO | TODO semantic lane |
| People/tags | TODO | TODO | TODO semantic lane |
| Provider GPS/address | TODO | TODO | TODO semantic lane |
| Live Photo relation storage | Foundation | Foundation | Foundation |
| Live Photo reliable pairing | TODO | TODO | TODO |
| `.livp` container handling | TODO | N/A/provider dependent | N/A/provider dependent |
| RAW/JPEG grouping | TODO | TODO | TODO |
| XMP/AAE sidecar grouping | TODO | TODO | TODO |
| Burst grouping | TODO | TODO | TODO |
| Range/resumable transfer | Current | Current | Current resumable upload |
| Content dedupe/CAS | Current | Current | Current |
| Full reconciliation | Current | Current | Current |
| Reliable incremental cursor | TODO if API proven | TODO if API proven | TODO event/API capability |
| Durable cancellation | Current | Current | Current |
| Multi-source bounded parallelism | Current | Current | N/A for central Pull runner; agent scheduling separate |
| Manual/overdue task priority | Current | Current | Pending manual request current |
| Persisted fast retry scheduling | Current | Current | TODO where applicable |
| Backup deletion safety | Current | Current | Current |
| Mirror-to-trash mode | TODO | TODO | TODO |
| Source-side delete/write | Not planned for v2 | Not planned for v2 | Not planned for v2 |
| Integrity verifier/repair | TODO | TODO | TODO |
| Gallery date/folder/source album foundation | Current | Current | Current after import |
| Gallery people/tag/favorite/location filters | TODO | TODO | TODO |

## Implementation roadmap

The ordering prioritizes reliability and identity before feature breadth.

| Phase | TODO | Priority |
| --- | --- | --- |
| P0 | Complete: bounded multi-source scheduler, manual/retry/overdue priority, persisted classified retry backoff | Highest |
| P1 | `SourceItemAlias` model + planner alias resolution + migration tests | Highest |
| P2 | Synology Files Pull (`synology_files`) for arbitrary shares/directories and arbitrary file types | Highest |
| P3 | Synology Push hybrid Photos-API semantic lane + filesystem fast path + no-duplicate canonical item-ID migration | Highest |
| P4 | Source semantic capability declarations + normalized scalar/facet storage | High |
| P5 | Synology description/favorite/GPS/address/tag/person import with graceful API capability detection | High |
| P6 | Connector-neutral `MediaGroup` / member projection from validated pair evidence | High |
| P7 | Synology Live Photo pairing using stable provider relation when available, otherwise validated post-import identifiers | High |
| P8 | Yike Live Photo / `.livp` discovery, parser, pair projection, and real-account compatibility tests | High |
| P9 | Yike optional semantic metadata expansion and private-API contract hardening | High |
| P10 | `ScanFull` / `ScanChanges` capability, checkpoint reset contract, periodic full reconciliation | High |
| P11 | Mirror mode with reliable deletion evidence, grace period, and xDrive trash only | Medium-high |
| P12 | RAW metadata/preview, RAW+JPEG, XMP/AAE sidecar, burst and auxiliary-resource grouping | Medium |
| P13 | Source/media integrity verifier and explicit idempotent repair commands | Medium |
| P14 | Gallery search/filter projection for person, tag, favorite, description, remote place/GPS | Medium |
| P15 | Optional provider-thumbnail bootstrap while keeping xDrive-derived preview canonical | Medium-low |
| P16 | Cross-connector capability/contract tests, sanitized fixtures, live smoke matrix, migration/rebuild acceptance coverage | Continuous |
| P17 | Optional audited source-side writes / two-way sync; disabled by default and not required for Photo Source v2 | Last |

## Acceptance criteria for Photo Source v2

Before calling the subsystem mature, the following must be true:

- Rebuilding a Source index does not duplicate already imported media when stable provider identity is available.
- A Synology Push library can move between volumes/remounts without turning indexed Photos media into new xDrive files.
- A transition from legacy Synology filesystem identity to Photos item identity performs zero unnecessary media uploads for already verified files.
- An unavailable optional semantic API never looks like an empty media inventory.
- Cancelling a scan/transfer stops connector requests and cannot trigger missing inference.
- A Live Photo with reliable pair evidence is rendered as one logical Gallery asset while both originals remain preserved and addressable.
- A media pair without reliable evidence remains unpaired rather than being guessed incorrectly.
- Album membership never creates duplicate Node/File/CAS objects.
- Technical EXIF/GPS/video metadata can be rebuilt from xDrive originals without the provider being online.
- Provider-only semantic metadata remains attributable to its source.
- Incremental mode can always fall back to full reconciliation after checkpoint reset or drift.
- Backup mode never trashes a file because it disappeared remotely.
- Mirror mode never acts on a partial/cancelled/failed inventory and never permanently deletes directly.
- Integrity verification can detect broken SourceItem/Node/CAS/metadata/group relationships without mutating anything.
- Repair can rebuild derived state without changing remote provider data.
- Yike private-API changes are contained inside the connector and covered by contract/live smoke tests.

## Non-goals for the initial v2 milestone

Do not block Photo Source v2 on:

- reproducing Synology's or Yike's proprietary face-recognition model;
- implementing a photo editor;
- social/feed features;
- remote provider mutation;
- perceptual duplicate merging across differently encoded photos;
- AI classification that the provider does not already expose.

Those can be independent future modules after the backup/import path is demonstrably safe.
