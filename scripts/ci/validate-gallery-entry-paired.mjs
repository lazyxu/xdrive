import fs from 'node:fs'

const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const failure = []
const report = {
  workload: 'gallery-entry-native-postgres-100k',
  before_valid_success: false,
  after_valid_success: true,
  same_host_paired_ci: true,
  before_medians_ms: before.medians_ms,
  after_medians_ms: after.medians_ms,
  route_outcomes: {},
  errors: failure,
}
const fastPaths = ['http-memories', 'http-cleanup-duplicates', 'http-cleanup-bursts']
const unaffectedPaths = ['http-sync-folders', 'http-sync-folder-open']
for (const phase of [...fastPaths, ...unaffectedPaths]) {
  const left = before.samples.filter(s => s.phase === phase)
  const right = after.samples.filter(s => s.phase === phase)
  if (left.length !== 3 || right.length !== 3) failure.push(phase + ': missing 3 matched samples')
  const expectedBaselineError = fastPaths.includes(phase)
  if (left.some(s => expectedBaselineError ? !s.error?.includes('HTTP 500') : Boolean(s.error))) {
    failure.push(phase + ': old HTTP behavior changed; this is not the frozen baseline')
  }
  if (right.some(s => s.error || !(s.bytes > 0))) {
    failure.push(phase + ': modified handler has an error or returned empty body')
  }
  const oldMs = Number(before.medians_ms[phase])
  const newMs = Number(after.medians_ms[phase])
  if (!(oldMs > 0) || !(newMs > 0)) failure.push(phase + ': invalid elapsed time')
  const savedMs = oldMs - newMs
  const relative = savedMs / oldMs
  if (fastPaths.includes(phase) && (savedMs < 100 || relative < 0.30)) {
    failure.push(phase + ': diagnostic latency gain was below frozen 30% and 100 ms gate')
  }
  if (unaffectedPaths.includes(phase) && newMs > Math.max(oldMs * 1.25, oldMs + 150)) {
    failure.push(phase + ': unaffected Sync Folder latency materially regressed')
  }
  report.route_outcomes[phase] = {
    before_ms: oldMs,
    after_ms: newMs,
    observed_elapsed_saved_ms: savedMs,
    observed_elapsed_reduction_percent: relative * 100,
    before_http_500: expectedBaselineError,
    after_http_200: right.length === 3 && right.every(s => !s.error && s.bytes > 0),
    after_bytes: right.map(s => s.bytes ?? 0),
  }
}
for (const phase of ['memories-index', 'sync-folders-index', 'sync-folder-open', 'cleanup-duplicates', 'cleanup-bursts']) {
  const left = before.samples.filter(s => s.phase === phase)
  const right = after.samples.filter(s => s.phase === phase)
  if (left.length !== 3 || right.length !== 3 || right.some(s => s.error || s.result_rows < 1)) {
    failure.push(phase + ': direct projection result rows changed or disappeared')
  }
  if (left.length === right.length && right.some((s, i) => s.result_rows !== left[i].result_rows)) {
    failure.push(phase + ': direct projection result count changed')
  }
  const oldMs = Number(before.medians_ms[phase]), newMs = Number(after.medians_ms[phase])
  if (newMs > Math.max(oldMs * 1.5, oldMs + 150)) {
    failure.push(phase + ': direct read stage materially regressed')
  }
}
if (before.logical_media_assets !== 100000 || after.logical_media_assets !== 100000 ||
  before.physical_media_nodes !== 115000 || after.physical_media_nodes !== 115000 ||
  before.synthetic_burst_groups !== 2000 || after.synthetic_burst_groups !== 2000 ||
  before.synthetic_child_folders !== 256 || after.synthetic_child_folders !== 256) {
  failure.push('Fixture metadata differs between parent and optimization')
}
const countOld = before.samples.filter(s => s.phase === 'owner-index-refresh')
const countNew = after.samples.filter(s => s.phase === 'owner-index-refresh')
report.remaining_background_reconciliation_issue = {
  before: countOld.map(s => ({elapsed_ms: s.elapsed_ms, error: s.error ?? null})),
  after: countNew.map(s => ({elapsed_ms: s.elapsed_ms, error: s.error ?? null})),
  scope: 'Full-owner background reconcile is NOT fixed by read-only handler fast path',
}
report.passed = failure.length === 0
const filepath = process.argv[4]
fs.writeFileSync(filepath, JSON.stringify(report, null, 2) + '\n')
console.log('GALLERY_ENTRY_PAIRED_ACCEPTANCE ' + JSON.stringify({passed:report.passed, routes:report.route_outcomes, errors:failure}))
if (!report.passed) process.exitCode = 1
