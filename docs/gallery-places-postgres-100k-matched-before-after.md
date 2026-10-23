# Places native map overview: PostgreSQL 100k matched BEFORE / AFTER

## Scope

PR #2393 fixed map-cover/GPS pairing and overmerging of sparse cities. Its
small real PostgreSQL regression was not an actual 100k query performance
measurement. This follow-up measures the real Go production function
`queryMediaPlacesMapOverview` without editing its production implementation.

## Evidence design

- Historical BEFORE code is pinned to master `6043128d8609e0beb6d7581f8ec1ab60c2fc3ea0`,
  directly before #2393. AFTER uses the exact submitted PR source. The same
  new measurement-only Go test file is injected into both worktrees and
  the two original production queries run against one seeded PostgreSQL 17
  schema, with unchanged Owner ACL and WGS84 logic.
- Existing production-shaped Gallery fixture: 70k still images, 15k videos,
  15k Live logical PhotoAssets, 115k indexed media nodes. Valid actual
  latitude/longitude are assigned to all 100k primary PhotoAssets:
  78k around Jinhua, 17k Shanghai, 5k New York, with duplicate coordinates
  and an additional foreign Owner. The original media bytes are not
  generated; this is a **database metadata query test**, not physical CAS
  decoding, WAN, real Baidu SDK/network or client rendering.
- Query windows: world 100k, dense Jinhua 78k, Jinhua+Shanghai 95k,
  and empty 0. Both binaries use exactly the same database and ANALYZE
  statistics; repeated sequence B1/A1/A2/B2/B3/A3 provides three timed
  samples per window and version plus one untimed query warmup per run.
- Record server elapsed milliseconds (without startup, fixture seeding or
  cover-check overhead), P50, 64-point budget, exact distinct PhotoAsset
  count, Owner-only filter and thumbnail Node GPS consistency on AFTER.
  Keep the existing three-second query context deadline; errors/timeouts
  remain first-class evidence rather than being hidden.

## Decision

First measure baseline and corrected behavior on the same fixture. Do not
change production SQL unless a meaningful bottleneck or regression is
demonstrated, and then rerun the exact same benchmark. Compare actual
latencies and preserve correct Owner counts and bounded output. A real
PostgreSQL 17 metadata benchmark cannot establish 100k physical media
performance, mobile UI speed, real devices or production Baidu behavior.

Only the deliberately opt-in CI workflow may reset its fixed disposable
schema. Ordinary tests skip the fixture. Inaccessible production security
acceptance: **按用户决定跳过（未验收）**; source security checks remain mandatory.

## First actual PostgreSQL 17 n=3 evidence (2026-10-23)

- [Source-exact scoped CI #39879918656](https://github.com/lazyxu/xdrive/actions/runs/39879918656): **SUCCESS**, same database, two independently compiled real production functions.
- Fixture accepted **100,000 owner logical PhotoAssets, 115,000 media metadata rows and one foreign Owner photo**. Source seeding 42,105.760 ms, excluded from query timing.
- All 24 measured queries had correct Owner totals, output <=64 pins, no timeout, and AFTER image-cover/GPS pairs independently verified (43-44 image covers per populated window).

| Viewport | BEFORE p50 | AFTER p50 | AFTER / BEFORE | Map pins BEFORE → AFTER |
|---|---:|---:|---:|---:|
| Worldwide 100k | 334.511 ms | 899.042 ms | 2.688× | 3 → 50 |
| Jinhua 78k | 302.243 ms | 696.315 ms | 2.304× | 64 → 50 |
| Jinhua+Shanghai 95k | 469.566 ms | 988.513 ms | 2.105× | 2 → 50 |
| Empty viewport | 35.422 ms | 35.164 ms | 0.993× | 0 → 0 |

**Conclusion:** the correctness repair dramatically increases spatial representation
under sparse multi-city distributions, but costs approximately 2.1–2.7× more
PostgreSQL time on these populated windows. All remain under the existing
3,000 ms deadline. This is NOT a performance optimization; benchmark evidence
justifies a separate profiled SQL optimization candidate with paired
performance and correctness rechecks. Do not remove the density-aware
distribution or GPS-cover pairing merely to recover the old low timings.

Results measure real PostgreSQL SQL on GitHub runners, not a physical 100k
CAS media benchmark, browser runtime, user instance, or a production database.
