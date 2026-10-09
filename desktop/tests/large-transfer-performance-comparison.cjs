const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { summarizeTransferComparison, summarizeLargeFileBaseline } = require('../../scripts/ci/compare-large-transfer-results.cjs')

function samples(scale = 1) {
  return ['upload', 'download', 'download-discard'].flatMap(scenario => [1, 2, 3].map(index => ({
    scenario, sample: `sample-${index}`, sizeBytes: 1073741824,
    runtimeVersions: { electron: '44.4.5', chromium: '152.0.7977.130', node: '24.14.0' },
    elapsedMs: 2000, throughputMiBps: 512,
    heapDeltaBytes: (200 + index) * 1048576 * scale,
    rendererWorkingSetPeakKB: (800 + index) * 1024 * scale,
    rendererWorkingSetDeltaKB: (650 + index) * 1024 * scale,
    server: scenario === 'upload'
      ? { uploadBytes: 1073741824, uploadChunks: 128, uploadInitSize: 1073741824, downloadBytes: 0 }
      : { uploadBytes: 0, uploadChunks: 0, uploadInitSize: 0, downloadBytes: 1073741824 },
  })))
}

test('reports comparable repeated memory reduction separately from absolute budgets', () => {
  const result = summarizeTransferComparison(samples(), samples(0.5))
  assert.equal(result.scenarios.upload.memoryThresholdSatisfied, true)
  assert.equal(result.scenarios.upload.elapsedThresholdSatisfied, true)
  assert.equal(result.scenarios.upload.allMemoryBudgetsSatisfied, false)
  assert.equal(result.scenarios.upload.metrics.rendererWorkingSetPeakKB.reductionPercent, 50)
})

test('rejects an apparent memory win with more than five percent elapsed regression', () => {
  const after = samples(0.5).map(row => ({ ...row, elapsedMs: 2200 }))
  assert.equal(summarizeTransferComparison(samples(), after).scenarios.upload.elapsedThresholdSatisfied, false)
})

test('does not accept a median reduction when one paired run regresses memory', () => {
  const after = samples(0.5)
  after[0].rendererWorkingSetPeakKB = 2000 * 1024
  assert.equal(summarizeTransferComparison(samples(), after).scenarios.upload.memoryThresholdSatisfied, false)
})

test('rejects a working-set win that materially regresses heap memory', () => {
  const before = samples().map(row => ({ ...row, heapDeltaBytes: 64 * 1048576 }))
  const after = samples(0.5).map(row => ({ ...row, heapDeltaBytes: 512 * 1048576 }))
  const result = summarizeTransferComparison(before, after).scenarios.upload
  assert.equal(result.heapNonRegressionSatisfied, false)
  assert.equal(result.memoryThresholdSatisfied, false)
})

test('rejects missing samples and malformed memory measurements', () => {
  assert.throws(() => summarizeTransferComparison(samples(), samples().slice(1)), /sample/)
  const malformed = samples()
  malformed[0].rendererWorkingSetDeltaKB = null
  assert.throws(() => summarizeTransferComparison(samples(), malformed), /rendererWorkingSetDeltaKB/)
})

test('rejects comparisons that omit upload bytes or change workload size', () => {
  const short = samples()
  short[0].server.uploadBytes -= 8388608
  assert.throws(() => summarizeTransferComparison(samples(), short), /payload/)
  const different = samples()
  different[0].sizeBytes *= 4
  assert.throws(() => summarizeTransferComparison(samples(), different), /size|payload/)
})

test('requires fifty percent heap and working-set delta reduction, not only a twenty-five percent peak reduction', () => {
  const result = summarizeTransferComparison(samples(), samples(0.65))
  assert.equal(result.scenarios.upload.memoryThresholdSatisfied, false)
  assert.equal(result.accepted, false)
})

test('acceptance requires every primary budget while discard remains diagnostic', () => {
  const after = samples(0.2)
  for (const row of after.filter(row => row.scenario === 'download-discard')) row.heapDeltaBytes = 900 * 1048576
  assert.equal(summarizeTransferComparison(samples(), after).accepted, true)
  after[0].rendererWorkingSetPeakKB = 513 * 1024
  assert.equal(summarizeTransferComparison(samples(), after).accepted, false)
})

test('rejects comparisons made with different runtimes', () => {
  const after = samples(0.2)
  after[0].runtimeVersions.chromium = '999.0.0.0'
  assert.throws(() => summarizeTransferComparison(samples(), after), /runtime/)
})

test('CI exits unsuccessfully for a rejected comparison and still writes reviewable evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xdrive-transfer-comparison-'))
  try {
    for (const side of ['before', 'after']) {
      fs.mkdirSync(path.join(directory, side))
      for (const row of samples()) fs.writeFileSync(path.join(directory, side, `web-${row.scenario}-${row.sample}.json`), JSON.stringify(row))
    }
    const output = path.join(directory, 'comparison.json')
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/ci/compare-large-transfer-results.cjs'), path.join(directory, 'before'), path.join(directory, 'after'), output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).accepted, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('four GiB baseline checks all six actual payloads and fixed memory budgets', () => {
  const current = samples(0.2).filter(row => row.scenario !== 'download-discard').map(row => ({
    ...row, sizeBytes: 4294967296,
    server: row.scenario === 'upload'
      ? { uploadBytes: 4294967296, uploadChunks: 512, uploadInitSize: 4294967296, downloadBytes: 0 }
      : { uploadBytes: 0, uploadChunks: 0, uploadInitSize: 0, downloadBytes: 4294967296 },
  }))
  assert.equal(summarizeLargeFileBaseline(current).accepted, true)
  current[0].heapDeltaBytes = 129 * 1048576
  assert.equal(summarizeLargeFileBaseline(current).accepted, false)
  current[0].server.uploadChunks = 128
  assert.throws(() => summarizeLargeFileBaseline(current), /payload/)
})
