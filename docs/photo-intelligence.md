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

Embeddings are opaque versioned derived bytes. Their encoding is identified by `EmbeddingFormat` and `EmbeddingVersion`; application code must never compare embeddings produced by incompatible versions as if they were the same vector space. `PhotoFace.LandmarksJSON` stores the detector's five normalized alignment landmarks as derived evidence so embedding/model upgrades do not lose the exact geometry contract used for face alignment.

### `PhotoPersonCluster` / `PhotoPersonClusterFace`

An automatic person cluster belongs to one xDrive owner and contains detected faces. It is **not** a provider person record and is not yet a durable user-named person identity.

A face can belong to at most one current automatic cluster. Cluster keys and embeddings are analyzer-versioned derived state and may be rebuilt when the clustering algorithm changes.

### `PhotoPersonClusterState`

Person clustering is owner-scoped rather than asset-scoped. One state row per owner records the clustering algorithm version, current embedding version, deterministic face-input fingerprint, participating face count, latest source-face update time, retry state, and completion time. This lets xDrive detect additions, deletions, face-row replacement, embedding-model upgrades, and algorithm changes without pretending clustering belongs to one photo.

When an owner temporarily has more than one ready embedding version during a model migration, clustering enters `pending`. xDrive does not compare or merge vectors from incompatible embedding spaces. Existing cluster rows may remain as internal derived leftovers while upstream face rows are being replaced, but they are **not authoritative unless the owner cluster state is `ready`**. Any future API/UI must gate automatic People suggestions on that ready state. Once the owner's ready faces converge on one embedding version, the next rebuild atomically replaces all automatic clusters for that owner.

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

Local inference workers must consume this HTTP contract through the short-lived revision-scoped `preview_stream(kind=analysis)` ticket issued by xDrive Server. They must not receive a normal user access token, mount the server storage root, or reimplement media decoding. The analyzer input fingerprint is the canonical analysis-preview ETag identity, while detector/embedding analyzer versions are derived separately from the reported model/pipeline manifest.

### Analyzer/runtime requirements

The host-side face pipeline uses the existing 1280px analysis-preview contract instead of adding another image-decoding path. The Server selects only current image `PhotoAsset` rows whose `MediaMetadata.node_revision/SHA256` still matches the current `Node + File`. For each selected asset it issues a short-lived preview-stream ticket bound to owner, node, revision, and `kind=analysis`, then sends only a signed preview URL plus preview contract identity to the local analyzer.

The local analyzer contract is:

```text
GET  /v1/info
POST /v1/analyze
```

`GET /v1/info` reports:

- protocol version, analyzer name, and required `pipeline_version`;
- detector model name/version/SHA-256/license;
- embedding model name/version/SHA-256/license;
- embedding format and exact vector dimensions.

`POST /v1/analyze` receives JSON containing the signed analysis-preview URL, preview contract version/edge, and input fingerprint. The analyzer fetches that scoped URL from xDrive Server and returns normalized detections. xDrive currently accepts `f32le` embeddings, requires exactly the declared vector dimensions, rejects NaN/Inf, accepts at most 256 faces per image, and requires exactly five normalized alignment landmarks per face.

The scoped preview ticket is intentionally narrower than a normal user access token: the analyzer cannot enumerate files or call unrelated user APIs, and the ticket becomes stale immediately when the file revision changes. The analyzer never mounts xDrive storage and never receives Source credentials.

Detector and embedding analyzer versions are compact SHA-256 tokens derived from the reported model manifest plus `pipeline_version`. The analyzer must change `pipeline_version` whenever detector thresholds/NMS, color normalization, face alignment, crop policy, embedding normalization, or other inference/preprocessing behavior can change outputs without changing model files. The input fingerprint is the same identity used by the canonical analysis-preview ETag (`media-analysis-...`), so changing original bytes, node revision fallback, preview version, or preview edge makes derived face state eligible for rebuild without a second input-identity scheme.

Configuration is optional:

```text
XD_PHOTO_FACE_ANALYZER_SOCKET=/run/xdrive/photo-face.sock
XD_PHOTO_FACE_ANALYZER_TOKEN=<optional analyzer-local bearer token>
XD_PHOTO_FACE_PREVIEW_BASE_URL=http://server:8080
```

If the socket is absent, automatic face analysis is disabled. The preview base URL must be an absolute HTTP(S) origin without credentials, query, fragment, or path. Analyzer failures only move the affected `face_detection` / `face_embedding` state to failed with bounded retry; native media indexing, Gallery, Source sync, originals, and user metadata remain usable.

Requirements for every analyzer:

1. Read only xDrive-issued analysis-preview URLs or another explicitly versioned local analysis input; never mount the storage root or independently decode HEIC/RAW/LIVP.
2. Version detector, embedding model, preprocessing, and clustering behavior and report exact model hashes/licenses.
3. Keep normalized face geometry, five alignment landmarks, and embedding provenance so results can be invalidated safely.
4. Rebuild derived rows transactionally for the affected asset/model version.
5. Never merge PhotoAssets or files because faces appear similar.
6. Never treat an automatic cluster as a confirmed person name without explicit user intent.
7. Never overwrite user-managed `PeopleJSON`, tags, favorites, descriptions, or album membership.
8. Do not make the main `xdrive-server` binary depend on a particular ML runtime, cgo, GPU stack, or model package. Native inference dependencies belong behind an optional worker/process/container boundary so the current static Server build remains `CGO_ENABLED=0` and distroless.
9. A future remote/cloud inference backend requires a separate privacy/security design and explicit opt-in; it is not part of this contract.

### Reference analyzer — current

The first supported reference backend is the separate **`xdrive-photo-face`** container under `services/photo-face-analyzer/`. It is not linked into `xdrive-server` and does not mount `/data`.

The CPU reference pipeline is deliberately explicit and versioned:

1. OpenCV DNN CPU backend.
2. YuNet `face_detection_yunet_2023mar.onnx` with confidence `0.9`, NMS `0.3`, top-K `5000`.
3. The five YuNet landmarks feed SFace `alignCrop`.
4. SFace `face_recognition_sface_2021dec.onnx` produces a **128-dimensional** feature.
5. xDrive reference preprocessing L2-normalizes that vector.
6. The normalized vector is serialized as little-endian float32 (`f32le`).

The container reports these exact semantics through `pipeline_version`, so an OpenCV/runtime/preprocessing change invalidates derived embeddings even when ONNX files remain unchanged.

Model provenance is pinned to OpenCV Zoo commit `47534e27c9851bb1128ccc0102f1145e27f23f98`. The image build downloads the models from that commit and verifies the official Git LFS SHA-256 object IDs before the image can be built:

- YuNet: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` — MIT;
- SFace: `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` — Apache-2.0.

Upstream sources:

- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface

The image also carries the upstream model license texts and xDrive's third-party provenance note. Model binaries are not committed to the xDrive Git repository.

The analyzer rejects preview URLs whose origin/path/query do not exactly match the configured xDrive analysis-preview contract, does not follow redirects, checks content type/version/edge/ETag before inference, and bounds both task and preview response sizes. The standard Compose service is attached only to an `internal: true` Photo Intelligence network shared with xDrive Server, so the reference analyzer has no direct runtime Internet egress.

Deployment remains opt-in. The standard Compose file contains a `photo-face` service behind the `photo-intelligence` profile. Enabling the profile causes the installer to prepare a shared runtime directory, configure a local analyzer token when one is not already present, set the Server's Unix socket path, pull the exact CI-tested analyzer image, and verify the analyzer health endpoint. With the profile disabled, the analyzer image is not pulled or started and `XD_PHOTO_FACE_ANALYZER_SOCKET` remains empty.

Reference configuration:

```text
COMPOSE_PROFILES=photo-intelligence
XD_PHOTO_FACE_ANALYZER_SOCKET=/run/xdrive-photo-face/photo-face.sock
XD_PHOTO_FACE_PREVIEW_BASE_URL=http://server:8080
# XD_PHOTO_FACE_ANALYZER_TOKEN is generated by the installer when absent.
```

CI builds a dedicated image target that runs Python protocol tests, real YuNet/SFace model loading, SFace alignment/feature extraction, a CPU smoke test, and a one-iteration benchmark. The final runtime image is then exported as an exact image artifact and release publishing loads/pushes that artifact without rebuilding it.

InsightFace remains a valid bring-your-own/licensed backend, but xDrive must not silently redistribute or select its public pretrained model packages as defaults: InsightFace documents those supplied pretrained models as non-commercial research by default even though the library code itself is MIT licensed.


## Person clustering policy

Automatic person clustering is a conservative, owner-local derived projection over ready `PhotoFace` embeddings.

The current algorithm is versioned as a deterministic greedy-centroid policy:

- all input embeddings are decoded from `f32le` and L2-normalized again before comparison;
- only faces whose asset-level `face_embedding` state is `ready` and whose state analyzer version exactly matches `PhotoFace.EmbeddingVersion` participate;
- all participating faces for an owner must share exactly one embedding version;
- candidate faces are ordered deterministically by detection quality, stable asset evidence, detection key, and face id;
- a face may join an existing cluster only when cosine similarity to the cluster centroid is at least **0.55** and similarity to the cluster representative is at least **0.40**;
- a second conservative merge pass requires centroid similarity at least **0.60** and representative similarity at least **0.50**;
- two faces from the same `PhotoAsset` are never automatically placed in the same cluster;
- two singleton clusters are never merged in the second pass;
- only clusters with at least **2** faces are persisted; unmatched single faces remain unclustered.

OpenCV's SFace documentation gives `0.363` cosine similarity as the LFW verification threshold for "same identity". xDrive intentionally uses higher centroid/merge thresholds for automatic clustering because verification is a pairwise decision while clustering can amplify one false-positive edge into a much larger identity error. The current thresholds therefore prefer duplicate/split automatic clusters over false merges:

- https://docs.opencv.org/4.12.0/d0/dd4/tutorial_dnn_face.html

The persisted cluster embedding is the L2-normalized centroid serialized as `f32le`. Membership confidence is cosine similarity to that final centroid; it is a cohesion score, **not a calibrated identity probability**.

Cluster keys are derived only from sorted stable asset/detection evidence membership. Adding/removing a face can therefore change the derived cluster key. A future user-named person identity must be a separate durable user-intent model that can explicitly adopt/merge/split automatic suggestions; it must not treat the rebuildable cluster key as a permanent person id.

The complete owner projection is replaced in one database transaction. A clustering transaction failure cannot expose a half-written replacement; the owner state becomes failed. Because upstream face analysis may independently replace face rows and cascade old memberships, automatic cluster rows are product-visible only while `PhotoPersonClusterState.State == ready`. Deleting a face/asset cascades its membership and the face-count/source-update state makes the owner eligible for a new rebuild. Disabled users and users forced to change password are not scheduled.

Gallery consumes the automatic projection through separate Suggested People APIs. Only `ready` clusters are listed or filterable. The API exposes cluster id, face/item counts, cover node, and update time; embeddings and cohesion internals remain server-side. Opening a suggestion is a transient view over the current automatic cluster plus ordinary temporary Gallery filters. The cluster id is never serialized into `MediaGalleryQuery`, a smart album, or `PhotoMetadata.PeopleJSON`.

## Durable person identity policy

Automatic clusters are rebuildable suggestions; user-authored person identity is durable intent. xDrive therefore persists named/managed people in a separate model:

```text
PhotoPerson
  -> stable person:v1:<uuid> public id
  -> owner
  -> optional user name
  -> hidden flag
  -> optional cover PhotoAsset
  -> revision

PhotoPersonAsset
  -> durable many-to-many membership between PhotoPerson and PhotoAsset
```

Durable membership is asset-scoped rather than face-row-scoped. `PhotoFace.ID`, detector ordering, embedding model versions, and automatic `PhotoPersonCluster.ClusterKey` may all change during re-analysis; none of those identifiers may be used as the permanent user person id.

The initial durable-person Server contract supports:

- adopt a current ready Suggested People cluster into a new durable person by snapshotting its distinct `PhotoAsset` memberships;
- rename or unname the durable person;
- hide/unhide the durable person;
- choose a cover from one of that person's current member assets;
- merge one or more durable people into a chosen target while preserving the target person id;
- split selected member media nodes into a newly created durable person while keeping the source person id;
- browse durable-person items with ordinary temporary Gallery filters.

All mutations are transactional and revisioned. Rename/hide/cover/merge/split use the same `If-Match` optimistic-concurrency contract as manual/smart albums. Merge preserves the target identity and deletes only the source person records after copying memberships. Split must leave at least one member in the source identity.

Adoption is intentionally a **snapshot** of the current automatic cluster. A later cluster rebuild does not mutate the durable person and cannot silently add/remove assets. If a future suggestion contains new photos of the same real person, the user may explicitly adopt/merge it; automatic similarity is never allowed to rewrite durable intent.

A current suggestion whose asset set exactly matches an existing durable person cannot be adopted a second time. This prevents accidental duplicate identities from repeated UI actions while still allowing a later changed cluster snapshot to be handled explicitly.

`PhotoMetadata.PeopleJSON` remains the existing manual per-photo label list. Durable `PhotoPerson` operations do not rewrite, infer, rename, or delete `PeopleJSON`. The two surfaces remain distinct until an explicit migration/product contract is designed.

Durable person ids are the canonical saved-filter identity because they survive face/cluster rebuilds. The shared Web/Desktop Gallery exposes durable People cards, adopt-from-suggestion, rename/unname, hide/unhide, member cover selection, merge, split, and durable-person browsing through the same shared component and transport contract.

`MediaGalleryQuery.person_identity` stores a durable `person:v1:<uuid>` reference. It is intentionally distinct from `person`, which remains the manual `PhotoMetadata.PeopleJSON` label filter. Durable-person views keep the stable identity in the shared filter draft without exposing the UUID as editable text, so “保存为智能相册” captures the durable person plus any ordinary search/date/location/favorite/tag/manual-person constraints.

Smart-album create/update locks the referenced durable person while persisting the rule. Merging durable people rewrites every affected smart-album `person_identity` from a source id to the preserved target id in the same transaction and increments the smart-album revision. Split keeps the source id, so existing saved filters remain attached to the source identity.

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

Deleting a `PhotoAsset` cascades its asset-scoped analysis state, faces, place label, and cluster memberships. Durable person membership is checked separately because its owner and cover invariants represent user intent. Smart-album `person_identity` references are verified but never guessed or silently removed when they are broken.

Automatic person clusters remain rebuildable derived state. `xdrive-server media repair` may remove corrupt memberships, clear a cover that no longer points at one of the durable person's own assets, or reset an inconsistent automatic cluster projection. `--gc-intelligence` additionally removes automatic clusters older than 24 hours when they are empty or no longer authoritative because their owner cluster state is missing, non-ready, stale, or version-mismatched. It never deletes a durable `PhotoPerson`, manual `PeopleJSON`, originals, or smart-album rules.

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
4. **Face detection + embeddings — reference CPU path current**
   - reuse the canonical 1280px analysis-preview input with short-lived revision-scoped tickets;
   - Unix-socket analyzer protocol with model/license/hash/dimension manifest;
   - bounded worker with dual detection/embedding state, retry/running timeout, and deterministic invalidation;
   - transactional PhotoFace replacement with normalized box, five-point landmarks, and embedding;
   - separate opt-in `xdrive-photo-face` image using pinned YuNet + SFace with exact model SHA/license provenance;
   - exact-image CI self-test/benchmark and GitHub/GitLab publish-without-rebuild path;
   - CPU is the supported reference target; GPU/NPU backends remain a future optional runtime optimization and must use a distinct `pipeline_version`.
5. **Person clustering + Suggested People — current**
   - owner-scoped clustering state and deterministic full-projection rebuilds;
   - conservative centroid/representative cosine policy with same-photo exclusion and minimum cluster size 2;
   - never mix embedding versions; model transition keeps automatic suggestions hidden until vectors converge and a complete rebuild succeeds;
   - derived cluster centroid/membership confidence persisted transactionally;
   - shared Web/Desktop Gallery exposes ready automatic clusters as read-only **人物建议** cards and a transient cluster-items view;
   - rebuildable cluster ids never enter manual `PeopleJSON` or smart-album query contracts.
6. **Durable Person Identity + management — current**
   - stable owner-scoped user person identities independent from face/cluster ids;
   - asset-based durable membership and cover;
   - adopt, rename/unname, hide/unhide, merge, split, and item browsing;
   - optimistic revision control and transactional mutations;
   - shared Web/Desktop Gallery lists durable people separately from automatic suggestions and provides one common management UI;
   - durable-person views preserve ordinary temporary Gallery filters/pagination and allow a member photo to become the cover;
   - hidden people stay durable and can be revealed again from the shared People section;
   - automatic clustering never rewrites durable memberships or manual `PeopleJSON`.
7. **Durable-person smart albums — current**
   - public/shared `person_identity` filter contract using stable `person:v1:<uuid>` ids;
   - Web/Desktop shared Gallery can save a durable-person view as a smart album without exposing raw ids;
   - smart-album edits preserve/remove the durable-person rule explicitly;
   - merge rewrites persisted source-person filters to the preserved target identity transactionally.
8. **Integrity lifecycle — current**
   - `media verify` checks durable person keys, membership ownership, cover membership/ownership, and smart-album `person_identity` references;
   - `media repair` deterministically removes invalid cross-owner/orphan memberships and clears invalid covers while incrementing the durable-person revision;
   - corrupt ready automatic-person projections are reset as rebuildable derived state; user-authored durable people are never inferred or deleted;
   - `media repair --gc-intelligence` conservatively removes automatic clusters older than 24 hours when empty or non-authoritative;
   - broken smart-album person references are reported and intentionally left for explicit user repair rather than silently dropping a saved rule.

The model/runtime choice is intentionally deferred until representative accuracy, memory, CPU/GPU cost, package size, and platform support are measured. The schema must not force xDrive to one ML runtime.
