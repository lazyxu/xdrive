# SH-P002 immutable original-source React mounted metadata GET cancellation evidence

- Original source commit: `f944b5877e291d84a6cf3628b9432a603677a047` (one baseline-only scoped work commit; production unchanged).
- Exact original [successful specialized run #39107293759](https://github.com/lazyxu/xdrive/actions/runs/39107293759) and [artifact #12128119068](https://github.com/lazyxu/xdrive/actions/runs/39107293759/artifacts/12128119068).
- Original 1773-byte ZIP: [ci-run-39107293759.zip](ci-run-39107293759.zip), SHA256 `bf42a58879f7a45853df76283ca4ece2b2b47874d2c47391109e19661e581051`.
- ZIP members exactly `run.log`, `source.txt`, `summary.json`, `resources.txt`. Original n3 signals: 0/3, aborted on unmount 0/3, all `abort_ms=null`. Actual HTTP=false; distinct physical CAS=0; this is a mounted React source + held mocked network request.
- Original full Node process: max RSS 133268KiB, userCPU 0.68s, sysCPU 0.06s. These are not per-request costs. No comparable original successful abort latency; speedup=N/A.
- Earlier special CI #39107214716 INVALID before test due non-existent npm lock cache file; not measured product red.
- Candidate must prove 3/3 synchronous frontend abort <=16ms and separate real PostgreSQL n3 Handler+SQL waiter cancellation <=160ms with 0 retained work. End-to-end six-client physical Web→Go remains Not measured.

Verify the historical binary via `sha256sum docs/performance-evidence/sh-p002-public-share-first-get/ci-run-39107293759.zip`. Never replace the original archive to manufacture an AFTER.

## Accepted candidate first GET signal and authentic Go/PG, source-exact n3

- Source: `9c976a6a38acbb3e0ca4e3582ec5b448fb7cb265`, [GitHub specialty #39108356394](https://github.com/lazyxu/xdrive/actions/runs/39108356394) both actual workflows succeeded. Later documentation/CI heads are different and must re-run.
- React actual production mounted source + held mocked metadata promise [complete 4-file raw ZIP](ci-run-39108356394-react.zip): 1812 bytes SHA256 `dc78663094785ae47eb38188b9fe14993ddb07dd776aae9cbc0c2ba29edb6f63`, SHA-cited [original artifact](https://github.com/lazyxu/xdrive/actions/runs/39108356394/artifacts/12129372144). Signal and synchronous abort 3/3, times 0.158245 / 0.066174 / 0.073157 ms, P50 0.073157ms, <=16ms. Not actual HTTP. Node whole-process RSS 139640KiB, userCPU1.00s, sysCPU0.10s, not per-GET CPU.
- Go Gin **real PostgreSQL17** lock waiter first GET [complete 4-file raw ZIP](ci-run-39108356394-go.zip): 1819 bytes SHA256 `c5766b210eb5d5560917f86e5ebccbe77a8277e1e941946b20f31365ef2e170f`, [original artifact](https://github.com/lazyxu/xdrive/actions/runs/39108356394/artifacts/12129770993). Handler 0.128/0.114/0.067ms; SQL waiter release 6.781/6.439/6.222ms; 0 residual; all <=160ms. Not actual browser. Whole-process RSS1488508KiB, Go compile+test CPU 88.06s user, 6.87s system, not a single canceled GET CPU.
- Do not combine independent components into a fabricated browser-to-Go ETA. Original baseline 0/3 could not cancel: absolute/percent speedup N/A. Six genuine client GUI, installed PWA, physical100k JPEG/H264/Live share, and WAN remain Not measured.
- [Canonical contract](../../public-share-request-cancel-performance.md), [registry](../../performance-test-registry.md), [matrix](../../performance-platform-coverage.md). New exact evidence HEAD dedicated+full GitHub CI/final gate required before merge.
