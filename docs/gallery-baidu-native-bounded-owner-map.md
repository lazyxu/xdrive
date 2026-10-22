# Native Baidu Gallery photo clusters: bounded Owner spatial protocol

Implementation: xDrive Gallery → Places, Web / Mobile Web / Electron via shared MUI component.

## One authoritative map engine

Baidu JSAPI4 Map / Convertor / ClusterLayer own camera, WGS84→BD09
conversion, native clusters, hit targets, and fitViewOnClick. xDrive does not
calculate its own map projection or recluster SDK input. Under the existing
prototype decision, the browser SDK executes in Gallery; the separate HTTPS
Child remains available but is NOT activated by this work. Production
environment safety acceptance remains **按用户决定跳过（未验收）**. Source Owner,
revision, cancellation and authorization tests still apply.

## Bounded data and precise counts

GET /api/v1/media/places/overview?west&south&east&north&detail=0|1 is
Owner-authenticated, strictly validates one finite WGS84 envelope and applies
a 3-second database deadline. Its response contains at most 64 records.
At wide zoom the Server groups **distinct genuine WGS84 GPS coordinates**
first (all photos with the same coordinate remain indivisible), then chooses
at most 8 latitude-rank bands × 8 longitude-rank bands. Edge ranks remain
separate for sparse distant cities; dense neighborhoods consume more of the
same 64-point budget than they did under equal-angle global grids.
Each bucket contains an exact sum of distinct Owner PhotoAssets. The chosen
cover Node and WGS84 representative are from the **same coordinate group**:
prefer a real image cover, otherwise retain the real video GPS without a
fabricated cover. Database grouping/ranking never ships 100k coordinates to JS.
Ranked IDs use `map-region:q:<west>:<south>:<east>:<north>:<row>:<col>`.
The `q` cells are bounded rank partitions, **not** geographic rectangles or
valid Media Range identities. Old `map-region:` rectangular IDs remain
parseable for compatibility. At local zoom,
detail=1 returns the complete page of ordinary 0.01-degree Places cells ONLY
if there are ≤64 cells. Otherwise it returns the same bounded buckets. Never
interpret a bucket identifier as a historical place identity.

Each point's `item_count` is a count of actual Owner PhotoAssets, not native
ClusterLayer.pointCount. The photo badge for a native SDK cluster is the sum
of Owner counts from validated member features. The SDK bbox, pointCount,
Owner photo_count and unique current IDs all need to agree. If membership
cannot be safely established, do not draw a synthetic photo count; preserve
Baidu's native bubble. SDK unclustered singles are eligible for a single
photo cover with their authoritative `item_count`, even at low zoom.

Screens receive bounded data through one shared Web/Mobile authenticated
adapter or Desktop renderer→IPC→Agent→Server chain. Each camera generation
replaces the previous ≤64 places. Requests are debounced and AbortController
cancellation propagates through the Desktop IPC/Agent HTTP transport and
Server SQL context. Previous camera or Owner thumbnails are immediately
invalidated. No scanning /media/places/page until exhaustion, no 100k
full-memory coordinates, and no second custom clustering algorithm.

## Navigation and coordinates

An exact `place:` marker opens the existing sparse Owner place collection.
A grouped `map-region:` marker zooms the actual native SDK camera; at very
high zoom it can open the existing *current viewport* WGS84 media Range rather
than misusing a grouping key. The native SDK camera remains BD09. Conversion
from BD09 bounds to the Owner query **only** constructs a padded conservative
WGS84 prefilter; it is never an authoritative location or written back to
EXIF. Actual photo membership is rechecked by the Server on opening the
original Owner Gallery Range / Viewer.

## Verification and explicit limits

- Original-source Node regression: native low-zoom cover groups, SDK singles,
  real photo-count sum, invalid bbox/Owner/revision fallback, date line,
  max 64 map points, native ClusterLayer event-before-data sequencing.
- Server Go input/bucketing regression: query restrictions, date line, finite
  boundaries, rank budgets, same-GPS dedupe, multi-city outliers, and cover
  matching its exact GPS metadata. Web/Desktop/Agent builds and route contracts
  must pass on the exact submitted HEAD.
- The prior 100k helper microbenchmark is NOT physical 100k acceptance; run
  independent real PostgreSQL mixed-media before/after and cross-client tests
  later. The display uses only 64 samples but SQL aggregation still examines
  the indexed Owner spatial range.
- Baidu's actual third-party SDK runtime, desktop origin compatibility and
  physical device acceptance remain separate from the source-level contract.
