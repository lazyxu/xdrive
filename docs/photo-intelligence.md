# xDrive Photo Intelligence

> **Normative boundary:** Photo Intelligence is an optional, connector-neutral analysis layer that runs only after xDrive has created local `PhotoAsset` / `PhotoResource` / `PhotoMetadata` state. Yike, Synology Photos, FileStation, Synology Push, and future synchronization-folder connectors must not provide canonical face/person/place intelligence.

This document defines the architecture for automatic face/person analysis and human-readable place analysis. It is deliberately separate from `docs/photo-source-v2-roadmap.md`: Photo Source v2 is the file-ingestion and native-media foundation; Photo Intelligence is a later derived product layer.

## Goals

Photo Intelligence may add rebuildable facets such as:

- detected faces and face embeddings;
- automatic person clusters;
- human-readable place labels derived from locally parsed GPS;
- future smart Gallery facets based on those derived results.

The same local original must produce the same analysis inputs regardless of whether it arrived through upload, Web, Desktop, Yike, Synology Photos, FileStation, Synology Push, FUSE, or CfAPI.

## Hard boundaries

The analysis pipeline begins from local xDrive state:

```text
Node + File + CAS
  -> native media parser/indexer
  -> PhotoAsset / PhotoResource / PhotoMetadata
       |
       +-> face detector / embedding model
       |    -> PhotoFace
       |    -> PhotoPersonCluster
       |
       +-> local GPS
            -> place resolver
            -> PhotoPlaceLabel
```

Photo Intelligence must not:

- call Yike/Synology/provider semantic endpoints for faces, people, tags, favorites, descriptions, addresses, or place names;
- change Source identity, SourceItem state, scan behavior, transfer behavior, Mirror semantics, or synchronization-folder success/failure;
- infer media identity or relationships from filenames, timestamps, visual similarity, face similarity, or place proximity;
- write anything back to an upstream provider;
- overwrite user-managed favorite/tag/people-label/description/manual-album state;
- make media indexing fail merely because an optional intelligence analyzer is unavailable or fails.

Two-way/source write remains a non-goal.

## Derived state versus user state

Automatic intelligence is **derived and rebuildable**. User edits are **durable intent** and must survive analyzer/model upgrades.

Current user-managed Gallery fields stay authoritative:

- `PhotoMetadata.Favorite`;
- `PhotoMetadata.TagsJSON`;
- `PhotoMetadata.PeopleJSON`;
- `PhotoMetadata.Description`;
- manual `PhotoCollection` membership;
- smart-album saved queries.

In particular, the existing `PeopleJSON` field is a user-managed label list. Automatic clustering must not silently write person names into it. A later UX may let the user explicitly promote/name/merge a suggested cluster, but that requires a separate durable user-intent contract and migration plan.

## Durable foundation

### `PhotoAnalysisState`

One current row exists per `(asset, analysis kind)`. It records:

- analyzer/model version;
- an input fingerprint representing the exact local inputs used by that analyzer;
- `pending / running / ready / failed / stale` state;
- attempt count, last error, and completion time.

Changing the original, the relevant parsed metadata, or the analyzer version makes the row stale. Stale/failed intelligence never invalidates the underlying media asset.

Initial analysis kinds are:

- `face_detection`;
- `face_embedding`;
- `place_label`.

### `PhotoFace`

`PhotoFace` is asset-scoped derived evidence. Bounding boxes use normalized coordinates relative to the analyzed still image. A detection key is unique within an asset so a single analyzer pass cannot duplicate the same detection.

Embeddings are opaque versioned derived bytes. Their encoding is identified by `EmbeddingFormat` and `EmbeddingVersion`; application code must never compare embeddings produced by incompatible versions as if they were the same vector space.

### `PhotoPersonCluster` / `PhotoPersonClusterFace`

An automatic person cluster belongs to one xDrive owner and contains detected faces. It is **not** a provider person record and is not yet a durable user-named person identity.

A face can belong to at most one current automatic cluster. Cluster keys and embeddings are analyzer-versioned derived state and may be rebuilt when the clustering algorithm changes.

### `PhotoPlaceLabel`

A photo asset may have one current derived human-readable place label. The row records the exact GPS coordinates used plus resolver/dataset version and structured country/region/city/district/locality fields.

The canonical coordinates remain `PhotoMetadata.Latitude/Longitude`; a place label is only a rebuildable presentation/search facet.

## Face/person analysis policy

Face analysis is optional and disabled unless an implementation is explicitly enabled by the product configuration.

### Canonical analysis input

Face analyzers must not independently decode HEIC/HEIF, RAW, LIVP, orientation, or other xDrive media formats. xDrive Server owns that normalization and exposes one owner-scoped analysis input:

```text
GET /api/v1/media/items/:id/analysis-preview
```

The contract is:

- JPEG output with orientation already applied;
- longest edge bounded to `1280` pixels; smaller originals are not upscaled;
- the same native source selection as Gallery thumbnails, including validated LIVP still resources, Canon CR3 embedded previews, TIFF-based DNG/NEF/ARW embedded previews, and locally decoded ordinary image formats;
- deterministic cache key derived from the exact local node revision/content SHA plus the analysis-preview edge;
- `X-XDrive-Analysis-Preview-Version` and `X-XDrive-Analysis-Preview-Edge` response headers plus a content-bound `ETag`;
- no `Node`, `File`, Source item, or user-visible Gallery asset is created for the preview;
- the existing 512px Gallery thumbnail remains a separate presentation cache and is not replaced by the analysis preview.

The analysis preview is a derived cache only. Current image rows protect both the 512px Gallery key and 1280px analysis key from thumbnail GC; after the underlying media row disappears, either cache becomes eligible for the existing conservative GC window.

A future local inference worker should authenticate as the asset owner through the existing short-lived owner-JWT pattern and consume this HTTP contract instead of mounting the server storage root or reimplementing media decoding. Its analyzer input fingerprint must include at least the preview `ETag`/contract version and the detector/embedding model versions.

### Analyzer/runtime requirements

Requirements for any future analyzer:

1. Read only local xDrive-derived analysis previews or other explicitly versioned local analysis inputs.
2. Version detector, embedding model, preprocessing, and clustering behavior.
3. Keep normalized face geometry and embedding provenance so results can be invalidated safely.
4. Rebuild derived rows transactionally for the affected asset/model version.
5. Never merge PhotoAssets or files because faces appear similar.
6. Never treat an automatic cluster as a confirmed person name without explicit user intent.
7. Prefer local inference. A future remote inference backend would require a separate privacy/security design and explicit opt-in; it is not part of this foundation.
8. Do not make the main `xdrive-server` binary depend on a particular ML runtime, cgo, GPU stack, or model package. Native inference dependencies belong behind an optional worker/process/container boundary so the current static server build contract remains intact.

## Place-name analysis policy

The current Gallery GPS facet keeps its stable `place:<latitude-cell>:<longitude-cell>` identity and filter contract. Human-readable names are an optional derived label layered on top; canonical GPS remains `PhotoMetadata.Latitude/Longitude`.

The first resolver is **offline GeoNames**. xDrive does not call the GeoNames web service. An administrator may provide a local directory with the official free-data files:

- `cities500.txt`;
- `admin1CodesASCII.txt`;
- `countryInfo.txt`.

Configure the server with:

```text
XD_PHOTO_PLACE_GEONAMES_DIR=/path/visible/to/xdrive-server/geonames
XD_PHOTO_PLACE_MAX_DISTANCE_KM=100
```

The directory is optional. When it is absent, the place-analysis worker is disabled. Assets that have never been resolved continue to use the existing approximate-coordinate labels; previously derived labels remain available as local cached state until they are superseded or explicitly cleaned. When the directory is configured, xDrive validates all three files at startup, builds an in-memory spatial index, and never downloads data at runtime.

Resolver rules:

1. Use only GPS already parsed by xDrive from local originals.
2. Resolve to the nearest `cities500` populated place only within the configured maximum distance; no match is a valid cached result and must not be replaced by a misleading distant city.
3. Persist the resolver name, exact coordinates, and a resolver version derived from the analysis algorithm version plus SHA-256 fingerprints of the three local GeoNames files.
4. A GPS metadata update or resolver/data version change invalidates the derived label and schedules it for bounded background re-analysis.
5. Place analysis is lower priority than native media indexing. Failed rows retry with backoff; abandoned `running` rows become eligible again after a timeout.
6. Never replace canonical GPS with the resolver result and never use a place label as media or Source identity.
7. Preserve the existing Gallery place-cell IDs so saved smart albums and place filters remain compatible while their display names improve.
8. If a network resolver is ever supported, it must be explicitly configured/opted in, must not upload image bytes, and must define caching/rate/privacy behavior here before implementation.

GeoNames free gazetteer data is licensed under **Creative Commons Attribution 4.0**. xDrive must retain attribution to GeoNames whenever this resolver/data is used. See https://www.geonames.org/export/.

## Scheduling and lifecycle

Photo Intelligence is lower priority than file synchronization, user-triggered file operations, and native media indexing.

The intended lifecycle is:

```text
PhotoAsset ready
  -> compute analyzer input fingerprint
  -> no matching ready state: pending
  -> analyzer runs with bounded concurrency
  -> atomically replace derived rows for that asset/kind
  -> ready

input/model changes
  -> stale
  -> re-run when resources allow
```

Failures are isolated per asset and analysis kind. Retry/backoff must be bounded; a failing model must not create an endless hot loop.

Deleting a `PhotoAsset` cascades its asset-scoped analysis state, faces, place label, and cluster memberships. Owner-scoped automatic clusters with no members are derived garbage and may be garbage-collected.

## Product/API rules

The first foundation intentionally adds **no new Gallery UI and no public API**. Existing manual People and GPS place facets continue to behave exactly as before.

When automatic facets are exposed later:

- Web and Desktop must share their MUI presentation/interaction model through `ui/shared`;
- platform transports remain adapters;
- automatic suggestions must be visually distinguishable from user-authored metadata;
- search/smart-album filters must remain usable with all synchronization providers offline;
- deleting/rebuilding intelligence must not delete or mutate originals or user-authored metadata.

## Delivery sequence

1. **Foundation — current**
   - durable analysis state;
   - face/embedding rows;
   - automatic cluster rows/membership;
   - derived place-label row;
   - migration and model-contract tests;
   - no analyzer, API, or UI behavior change.
2. **Place names — current**
   - optional local GeoNames `cities500` resolver with no runtime network calls;
   - dataset-hash/analyzer-version invalidation and durable negative-result caching;
   - bounded low-priority background worker with retry/running timeout;
   - existing Gallery place-cell/filter IDs preserved while labels become human-readable when available.
3. **Face analysis input — current**
   - owner-scoped, versioned 1280px JPEG analysis-preview endpoint;
   - one native decode path for ordinary images, HEIC/HEIF, CR3, DNG/NEF/ARW, and LIVP still resources;
   - deterministic derived cache with existing thumbnail GC lifecycle;
   - Gallery 512px thumbnail semantics remain unchanged.
4. **Face detection + embeddings**
   - benchmark candidate local detector/embedding runtimes behind the worker boundary;
   - define model packaging/update policy and CPU/GPU fallback;
   - add bounded worker and deterministic invalidation without changing the static main Server build.
5. **Person clustering**
   - cluster only within one owner;
   - support rebuilds across model versions;
   - then design explicit user actions for naming, merge/split, hide, and cover selection.
6. **Gallery integration**
   - shared Web/Desktop People/Places facets;
   - smart-album filters;
   - integrity verify/repair and derived-state GC.

The model/runtime choice is intentionally deferred until representative accuracy, memory, CPU/GPU cost, package size, and platform support are measured. The schema must not force xDrive to one ML runtime.
