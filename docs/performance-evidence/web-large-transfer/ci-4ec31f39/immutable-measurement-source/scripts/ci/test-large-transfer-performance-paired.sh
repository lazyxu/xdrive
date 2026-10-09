#!/usr/bin/env bash
set -euo pipefail

# Use the identical current measurement harness on both production trees.
# Never overlay api.ts, downloadSink.ts, transferTransport.ts, or their helpers.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
baseline_ref="${1:-HEAD^}"
baseline_commit="$(git -C "$repo_root" rev-parse "$baseline_ref^{commit}")"
candidate_commit="$(git -C "$repo_root" rev-parse HEAD)"
baseline_dir="$(mktemp -d "${TMPDIR:-/tmp}/xdrive-transfer-baseline.XXXXXX")"
trap 'rm -rf -- "$baseline_dir"' EXIT
git -C "$repo_root" archive "$baseline_commit" | tar -x -C "$baseline_dir"
cp "$repo_root/web/src/LargeTransferPerformanceHarness.tsx" "$baseline_dir/web/src/LargeTransferPerformanceHarness.tsx"
cp "$repo_root/desktop/scripts/large-transfer-performance-main.cjs" "$baseline_dir/desktop/scripts/large-transfer-performance-main.cjs"

# Both builds use exactly the installed dependency versions; package links resolve
# to the matching source snapshot. No dependency installation occurs during timing.
node - "$repo_root" "$baseline_dir" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [current, baseline] = process.argv.slice(2)
const target = path.join(baseline, 'web/node_modules')
fs.mkdirSync(target, { recursive: true })
for (const name of fs.readdirSync(path.join(current, 'web/node_modules'))) {
  if (name === '@xdrive') continue
  fs.symlinkSync(path.join(current, 'web/node_modules', name), path.join(target, name), 'dir')
}
fs.mkdirSync(path.join(target, '@xdrive'), { recursive: true })
fs.symlinkSync(path.join(baseline, 'ui/shared'), path.join(target, '@xdrive/ui'), 'dir')
fs.symlinkSync(target, path.join(baseline, 'ui/shared/node_modules'), 'dir')
fs.symlinkSync(path.join(current, 'desktop/node_modules'), path.join(baseline, 'desktop/node_modules'), 'dir')
NODE
VITE_XDRIVE_LARGE_TRANSFER_PERF=1 npm --prefix "$baseline_dir/web" run build -- --config vite.config.ts
output_dir="$repo_root/desktop/large-transfer-perf-results"
rm -rf -- "$output_dir"
mkdir -p "$output_dir/before" "$output_dir/after"
node - "$output_dir" "$baseline_commit" "$candidate_commit" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const [output, beforeCommit, afterCommit] = process.argv.slice(2)
const root = path.resolve(output, '../..')
const harnessFiles = ['web/src/LargeTransferPerformanceHarness.tsx', 'desktop/scripts/large-transfer-performance-main.cjs']
const harnessSHA256 = Object.fromEntries(harnessFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]))
fs.writeFileSync(path.join(output, 'provenance.json'), JSON.stringify({ beforeCommit, afterCommit, measurementHarness: afterCommit, harnessSHA256, sizeBytes: 1073741824, currentLargeFileSizeBytes: 4294967296, samplesPerScenario: 3, order: 'before/after for odd samples; after/before for even samples; current 4 GiB only after the 1 GiB acceptance gate passes', forcedGC: false, host: { platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model }, ci: { run: process.env.GITHUB_RUN_ID || process.env.CI_PIPELINE_ID || null, job: process.env.GITHUB_JOB || process.env.CI_JOB_ID || null } }, null, 2) + '\n')
NODE

for scenario in upload download download-discard; do
  for sample in 1 2 3; do
    sides=(before after)
    if (( sample % 2 == 0 )); then sides=(after before); fi
    for side in "${sides[@]}"; do
      source_root="$repo_root"
      if [[ "$side" == before ]]; then source_root="$baseline_dir"; fi
      (
        cd "$source_root/desktop"
        xvfb-run -a --server-args="-screen 0 1920x1200x24" ./node_modules/.bin/electron --no-sandbox scripts/large-transfer-performance-main.cjs "$scenario" "sample-$sample"
      )
      mv "$source_root/desktop/large-transfer-perf-results/web-$scenario-sample-$sample.json" "$output_dir/$side/"
    done
  done
done
node "$repo_root/scripts/ci/compare-large-transfer-results.cjs" "$output_dir/before" "$output_dir/after" "$output_dir/comparison.json"

# Grow the current bounded implementation only after the paired 1 GiB gate
# passes. This is a 4 GiB baseline, not a claimed original/candidate speedup.
mkdir -p "$output_dir/after-4gib"
for scenario in upload download; do
  for sample in 1 2 3; do
    (
      cd "$repo_root/desktop"
      xvfb-run -a --server-args="-screen 0 1920x1200x24" ./node_modules/.bin/electron --no-sandbox scripts/large-transfer-performance-main.cjs "$scenario" "sample-$sample" --size-gib=4
    )
    mv "$output_dir/web-$scenario-sample-$sample-4gib.json" "$output_dir/after-4gib/"
  done
done
node "$repo_root/scripts/ci/compare-large-transfer-results.cjs" --current-4gib "$output_dir/after-4gib" "$output_dir/current-4gib.json"
