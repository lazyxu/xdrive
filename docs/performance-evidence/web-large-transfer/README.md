# Web large-transfer evidence archive

This archive supports the PR #1063 continuation in [file-explorer-performance.md](../../file-explorer-performance.md#pr-1063-continuation-reusable-web-byob-buffers). Initial same-run paired Electron CI passed on AFTER4ec/BEFOREdeab; the reconstructed head requires authoritative CI before merge. Historical hosted runs, local headless diagnostics and current 4 GiB coverage remain distinct.

- `large-transfer-before-e1faa488.json`, `large-transfer-baseline-2ca7f021.json`: original hosted baseline samples with exact heads/run/job IDs.
- `remote1063-ac4571d5-full-samples.json` and matching job log: all nine complete original hosted launcher records, including working-set and byte/chunk counters; the normalized `remote1063-ac4571d5.json` is retained as an additional audit.
- `transfer-baseline-headless/`: original production, corrected local ready/start harness, n3 per scenario.
- `transfer-remote-candidate-verified/`: valid Blob/native-pipe candidate local samples; incorrect-path initial experiments are excluded.
- `transfer-xhr-cleanup/`, `transfer-owned-release/`, `transfer-blob-hash-release/`: rejected n1 experiments.
- `transfer-byob-upload/`: final n3 upload samples; `transfer-upload-evidence-summary.json` includes source/provenance limits.
- `transfer-download-byob-headless/`: full-min candidate replaced for slow publication; memory/timing samples and prior full-suite failure log retained.
- `transfer-download-byob-min1/`: final n3 default-min download samples, controlled slow-stream before/after, red/green and build logs; summary-provenance.json has final frozen gates.
- `transfer-4gib-upload/`, `transfer-4gib-download/`, `transfer-4gib-evidence-summary.json`: current bounded Web n3 per direction, exact payloads, OPFS preflight, source/dist hashes. Original Web 4 GiB was not measured.
- `reproduce-native-pipe-progress.cjs/.log`: rejected pipeTo failed-write progress counterexample.
- `run-transfer-headless.cjs`, `run-transfer-download-byob-headless.cjs`, `transfer-download-byob-min1/slow-stream-probe.cjs`: final size-aware local driver, full-min no-GC driver, and controlled latency probe. Archived after runs; original baseline runner was not captured contemporaneously.
- `manifest.json`: original capture locations and hashes; scratch paths inside copied summaries are historical provenance rather than required read locations.

No final acceptance calculation uses forced GC or buffer transfer(0). Rejected experiments and optional post-result diagnostic fields are preserved for audit, not promoted as passing evidence.

- `ci-4ec31f39/`: exact successful hosted run37870615110/job113627600871, complete original log, nine BEFORE+nine AFTER+six current4GiB records, independently verified comparisons, and explicitly reconstructed provenance (original ZIP materialization returnedHTTP403).
- `memory-reconstructed-*.log`: normal local checks after the real canonical-document conflict was resolved; fullmain1212pass/0fail/1skip.
