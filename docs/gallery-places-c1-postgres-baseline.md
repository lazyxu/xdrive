# C1-PG1 · Places 10k/100k genuine PostgreSQL BEFORE baseline

**Stage:** Measurement-only; no production SQL/index tuning, map provider changes, Web/Mobile/Desktop UI changes or new permissions. Parent: [C1 #2210](https://github.com/lazyxu/xdrive/issues/2210). Historical B1-A/B/C/D PRs are merged; don't repeat their implementation.

## Exact experiment

`TestC1PlacesPostgresBaseline` is an opt-in **Linux / real PostgreSQL 17** test enabled only with `XD_C1_PLACES_BASELINE=1` plus `XD_TEST_DATABASE_URL`. It builds separate disposable PostgreSQL schemas, with **10,000** and **100,000** actual, indexed Owner `PhotoAsset`, `Node`, `File`, `MediaMetadata`, `PhotoMetadata`, `PhotoResource`, `PhotoAnalysisState`, and GeoNames provenance rows. Each dataset also includes 37 different-Owner records. Fixtures have distinct legal WGS84 points, a mix of indexed JPEG/HEIC/video/Live-photo *metadata*, deterministic UTC dates, favorites, ISO country/Admin1 identities and nearby GeoName city IDs. GeoNames current-version and IEEE754 GPS fingerprints are persisted exactly as the B1 read predicate requires: the seed coordinates are stored first, then fingerprints recomputed from those stored PostgreSQL float8 values (never from separately inlined coordinate expressions). The parent DB is not changed outside those disposable schemas.

Measurements execute the **real production Go read functions**, rather than reimplementing their SQL:

- Authenticated Owner country, Japan Admin1 region, and Tokyo nearby-city bounded Facets.
- Existing 48-item Owner Media Range/Count for country, region and city; existing Gallery VirtualCollection remains out of scope, since this benchmark is server/database only.
- Current worldwide native map overview (at most 64 authenticated GPS representatives, actual 100k distinct PhotoAsset count).
- Cross-Owner map count and pre-cancelled Go Context failure checks.

For each operation, save first-request elapsed time, seven repeated warm-query durations summarized as p50/p95/max, exact returned count and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` from the **actual SQL executed**, including real PostgreSQL execution timings and buffers. Capture seed time, PostgreSQL version, CI checkout SHA, and Go test process maximum RSS separately; **Go process RSS is not PostgreSQL database RSS/CPU**. The measurement file and logs are uploaded to Actions; no fabricated timings or prewritten numbers are committed.

Use the [Places C1 baseline workflow](../.github/workflows/places-c1-postgres-baseline.yml) on a PR or `workflow_dispatch` to run the measurement. It has a bounded two-hour job with a 105-minute Go timeout, and is **not included in ordinary `go test ./...`** unless opt-in env is set. Any failure in real count, version/GPS fidelity, 64-marker bound, Owner isolation or SQL execution plan fails the measurement gate.

## Evidence boundaries and next decisions

1. **Do not claim an optimized AFTER.** First preserve the BEFORE artifact, the actual source SHA, environment and EXPLAIN plans. Only optimize if that evidence identifies a bottleneck; run exactly the same fixture size/version/query sequence and compare, reverting non-beneficial changes.
2. These are **real indexed PostgreSQL rows**, but **synthetic metadata without JPEG/HEIC/MP4 physical CAS bytes**. They cannot establish 100k real-image thumbnail bandwidth, video poster/Live decode, Baidu JSAPI network, Safari/PWA/Android/Electron gestures or iOS27 screenshot 1:1. C1 remains open for those distinct tests.
3. Seven repetitions give useful directional p50/p95, not production service-level percentile estimates. A clean GitHub CI success alone is not a latency value; quote metrics only after reading the produced artifact.
4. Inaccessible production security testing is **按用户决定跳过（未验收）**, never a code/CI/PR merger blocker. Actual source-level Owner, GPS/provenance, cancellation and negative tests remain required.

## 2026-10-23 · Artifact completeness requirement

The Go package test runs with working directory `internal/api`, not the checkout root. The focused workflow therefore sets an **absolute workspace output path** via `XD_C1_PLACES_OUTPUT`, and a dedicated CI step fails unless both 10k and 100k JSON reports contain all seven P50/P95 measurements and PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` plans. A log-only run, even when its Go test succeeds, is **not accepted as the BEFORE plan artifact**. No production SQL or indexes changed.

## 2026-10-23 · Exact PR HEAD and report SHA

GitHub's default pull_request checkout may use a synthetic merge ref. This workflow **explicitly checks out the PR HEAD SHA**, requires the checkout to equal the GitHub PR source, injects `XD_C1_PLACES_SOURCE_HEAD` into the Go test, and rejects JSON reports whose `ci_git_head` does not match the uploaded `places-c1-source-sha.txt`. The baseline must be comparable by exact commit identity; a successful synthetic-merge ref is not enough for the declared source-exact gate.

## C1-PG1 · 逐条 SQL 归因（Count / 时间分组 / Page）

2026-10-23 的首轮 100k 同条件数据库测量证明：`range_country:JP`
的端到端 warm P50 为约 2 秒，但原脚本只保存了 SQL 字符最长的
一条 `EXPLAIN`（约 0.6 秒）。`queryMediaItemRange` 实际还运行了
Count、Timeline Groups、分页和媒体实体查询，不能把这条最长 SQL
误称为唯一瓶颈，也不能直接给生产表盲加索引。

本次改进只修改 opt-in 测试，不改变任何生产查询：
- 在 `c1PlacesTrace` 按执行顺序记录 **首轮真实生产 SQL** 的耗时、行数、
  语句 SHA-256 与基本类型（distinct count / grouped read / CTE / page）。
- 对每条安全只读 SQL 分别执行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`，
  保存到 `metrics[].statement_plans`，最多 32 条、每条最多 128 KiB。
  原来的最长语句 `explain_analyze_buffers` 保持兼容。
- 工作流强制校验 10k/100k 各 7 类操作的计划齐全；Range 至少要有两条
  SQL 的计划，禁止只上传日志或单条最长 SQL 的片面数据。
- `first_sql_ms` 是 GORM 日志覆盖的 SQL 总耗时，和整个 Go 端首轮
  `first_ms` 并列展示；`EXPLAIN` 是额外运行的一次计划采样，
  不等同于首次请求或 P50/P95，也不代表生产环境 CPU/RSS。
- 复测仍使用相同 PostgreSQL17、隔离 10k/100k、Owner、同一查询顺序，
  先完整保存 BEFORE，后续再提出针对性的生产变更与配对 AFTER。

**注意：** 此阶段只细化归因，不是生产优化；不会因样本化硬盘缓存/GC
差异，将不同 GitHub Runner 上的耗时下降误判为代码收益。
