# P071 — Gallery 100k physical mixed/H264 CURRENT rebaseline

Base: `c4d8ae4c5db16396d00205c76b91d901a63e543b`. This is a pure test/CI/documentation branch: **no production UI, Go/SQL/CAS, Agent IPC, transfer, auth, cancellation or Race changes**.

Dedicated source-exact opt-in n=3 original workflow copies are protected by `desktop/tests/p071-gallery-source-parity.cjs`. Branch `perf/p071-gallery-100k-current-20261022`. The parity guard verifies every native benchmark workflow is identical to the previously accepted original except name, activation branch and artifact label; no data seeding, budget, test code or binary source is relaxed.

Workloads: 1440px real Chromium Web Gallery five virtualized viewports × 3 true 100k logical/115k distinct physical JPEG/H264/Live CAS originals; Mobile Web 390px same physical mixture, narrow breakpoint and four new visible decodes; Wide Web genuine H264 cold poster generation/PUT/warm signed preview over real 100k media × three independent runs, 15 actual viewport measurements. CPU/RSS/late bytes, first required tile decoded, SQL, cancellation and source SHA evidence remain as the original scripts output. No physically installed iOS Safari, Android, WAN or Desktop Gallery runtime is being claimed.

Report CURRENT/BEFORE median, P95/worst and memory for exact source only. A/B **AFTER = N/A** because this PR does not optimize product code. The existing P020 100k FileExplorer baseline and P068 Web/Desktop 4 GiB and Sync tests are separate; don't compare different CI runners as speedup. All specialty jobs and full 77+ CI/Final Gate must pass on exact new HEAD and GitHub must report clean mergeability before merging. If a Gallery case misses its accepted budget, run matched same-runner n>=3 BEFORE→AFTER for one narrowly scoped change and retain only meaningful improvement without CPU/RSS/I/O correctness regression.

Inaccessible production-only acceptance: 按用户决定跳过（未验收）. Native code-level safety tests and Source Owner/ACL remain required.

## Verified old-HEAD genuine CURRENT results (2026-10-22)

**Source measured:** `dda020c751a0998cc59644f402e4c45f6f6a497b` before this evidence-only restack, with exact-source opt-in native GitHub Action jobs and independent **n=3**, each with 100000 logical PhotoAssets / 115000 distinct physically stored CAS originals (JPEG/H264/Live pairs). This is unchanged production performance, not a same-runner optimization A/B:

| Original accurate-HEAD specialty | Median of each fixture's five viewports, ms | Peak renderer working-set growth | Exact source CI |
| --- | ---: | ---: | --- |
| Real Chromium 1440px Wide Gallery, six newly decoded JPEG/Live stills + two rAF | **2243.107** | **137285632 bytes** | [SUCCESS #39636079355](https://github.com/lazyxu/xdrive/actions/runs/39636079355) |
| Real Chromium 390px Mobile Web Gallery, four newly decoded JPEG/Live stills + two rAF | **1831.591** | **84000768 bytes** | [SUCCESS #39636079510](https://github.com/lazyxu/xdrive/actions/runs/39636079510) |
| Real Wide Web H264 cold poster from video + signed preview + CAS PUT + warm GET | **3148.407** | See native artifact | [SUCCESS #39636079072](https://github.com/lazyxu/xdrive/actions/runs/39636079072) |

The exact source [full CI + Final Gate #39636079711](https://github.com/lazyxu/xdrive/actions/runs/39636079711) was also green. The real measured Wide mixed-case peak Go RSS increase was 208896 bytes and maximum active thumbnail HTTP handlers 6; Mobile median summary peak handler concurrency 6. Only the newly visible small image/poster subset was decoded; 100k media items were not simultaneously fetched, nor were 15k independent video scenes encoded.

**Restack hygiene:** New branch head is a new commit on newer complete master, with exactly five original scope files and only this measurement documentation appended. The three above represent preserved prior-head immutable CURRENT, *not* verified new-head CURRENT. Full new exact-HEAD CI, three 100k specialties and clean mergeability are required before Ready/merge; matched optimization AFTER/speedup **N/A**. Do not compare P0-C1/P067 different SHAs/runner epochs as speedup. H264 actual video playback, full Live motion, RAW/HEVC, native Desktop and physical installed iOS Safari/WAN are not covered. Inaccessible production-only safety acceptance: **按用户决定跳过（未验收）**; code-level authorization and CI still apply.
