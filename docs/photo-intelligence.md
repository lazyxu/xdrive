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

Requirements for any future analyzer:

1. Read only local xDrive originals/derived previews needed for analysis.
2. Version detector, embedding model, preprocessing, and clustering behavior.
3. Keep normalized face geometry and embedding provenance so results can be invalidated safely.
4. Rebuild derived rows transactionally for the affected asset/model version.
5. Never merge PhotoAssets or files because faces appear similar.
6. Never treat an automatic cluster as a confirmed person name without explicit user intent.
7. Prefer local inference. A future remote inference backend would require a separate privacy/security design and explicit opt-in; it is not part of this foundation.

## Place-name analysis policy

The current Gallery GPS facet groups coordinates locally into cells and intentionally shows approximate coordinates. Human-readable naming is a separate optional resolver stage.

Requirements for a future resolver:

1. Use only GPS already parsed by xDrive from local originals.
2. Prefer an offline dataset/resolver so Gallery works with providers offline and no photo location leaves the server.
3. Persist resolver and dataset version so labels can be invalidated/rebuilt after data upgrades.
4. Never replace canonical GPS with the resolver result.
5. If a network resolver is ever supported, it must be explicitly configured/opted in, must not upload image bytes, and must define caching/rate/privacy behavior in this document before implementation.

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
2. **Place names**
   - choose/validate an offline resolver/data source;
   - add bounded background resolver worker;
   - expose structured place facets while keeping raw GPS canonical.
3. **Face detection + embeddings**
   - benchmark candidate local models on server target platforms;
   - define model packaging/update policy and CPU/GPU fallback;
   - add bounded worker and deterministic invalidation.
4. **Person clustering**
   - cluster only within one owner;
   - support rebuilds across model versions;
   - then design explicit user actions for naming, merge/split, hide, and cover selection.
5. **Gallery integration**
   - shared Web/Desktop People/Places facets;
   - smart-album filters;
   - integrity verify/repair and derived-state GC.

The model/runtime choice is intentionally deferred until representative accuracy, memory, CPU/GPU cost, package size, and platform support are measured. The schema must not force xDrive to one ML runtime.
