const fs = require('node:fs')
const path = require('node:path')
const scenarios = ['upload', 'download', 'download-discard']
const primaryScenarios = ['upload', 'download']
const fields = ['elapsedMs', 'throughputMiBps', 'heapDeltaBytes', 'rendererWorkingSetPeakKB', 'rendererWorkingSetDeltaKB']
const budgets = { rendererWorkingSetPeakKB: 512 * 1024, rendererWorkingSetDeltaKB: 256 * 1024, heapDeltaBytes: 128 * 1024 * 1024 }

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[1], min: sorted[0], max: sorted[2] }
}

function indexSamples(samples, label, sizeBytes = 1073741824, expectedScenarios = scenarios) {
  if (samples.length !== expectedScenarios.length * 3) throw new Error(`${label}: expected ${expectedScenarios.length * 3} samples`)
  const result = new Map()
  for (const row of samples) {
    const key = `${row.scenario}/${row.sample}`
    if (!expectedScenarios.includes(row.scenario) || !/^sample-[123]$/.test(row.sample) || result.has(key)) {
      throw new Error(`${label}: unexpected or duplicate sample ${key}`)
    }
    if (row.sizeBytes !== sizeBytes) throw new Error(`${label}: unexpected workload size in ${key}`)
    for (const field of fields) {
      if (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || row[field] < 0) {
        throw new Error(`${label}: invalid ${field} in ${key}`)
      }
    }
    if (row.elapsedMs === 0 || row.throughputMiBps === 0 || row.rendererWorkingSetPeakKB === 0) throw new Error(`${label}: empty measurement in ${key}`)
    for (const runtime of ['electron', 'chromium', 'node']) {
      if (typeof row.runtimeVersions?.[runtime] !== 'string' || !row.runtimeVersions[runtime]) throw new Error(`${label}: missing runtime ${runtime} in ${key}`)
    }
    const validPayload = row.scenario === 'upload'
      ? row.server?.uploadBytes === row.sizeBytes && row.server?.uploadChunks === sizeBytes / (8 * 1024 * 1024) && row.server?.uploadInitSize === row.sizeBytes
      : row.server?.downloadBytes === row.sizeBytes
    if (!validPayload) throw new Error(`${label}: incomplete payload in ${key}`)
    result.set(key, row)
  }
  return result
}

function allMemoryBudgetsSatisfied(samples) {
  return samples.every(row => Object.entries(budgets).every(([field, maximum]) => row[field] <= maximum))
}

function summarizeTransferComparison(beforeSamples, afterSamples) {
  const before = indexSamples(beforeSamples, 'before')
  const after = indexSamples(afterSamples, 'after')
  const result = {
    sizeBytes: 1073741824, samplesPerScenario: 3,
    thresholds: { minimumHeapReductionPercent: 50, minimumWorkingSetDeltaReductionPercent: 50, minimumWorkingSetPeakReductionPercent: 25, maximumElapsedRegressionPercent: 5, maximumElapsedMs: 60000, everyPairedWorkingSetMustDecrease: true, memoryBudgets: budgets },
    scenarios: {},
  }
  for (const scenario of scenarios) {
    const left = [1, 2, 3].map(n => before.get(`${scenario}/sample-${n}`))
    const right = [1, 2, 3].map(n => after.get(`${scenario}/sample-${n}`))
    for (const [index, row] of right.entries()) {
      for (const runtime of ['electron', 'chromium', 'node']) {
        if (row.runtimeVersions[runtime] !== left[index].runtimeVersions[runtime]) throw new Error(`runtime mismatch for ${scenario}/${row.sample}: ${runtime}`)
      }
    }
    const metrics = Object.fromEntries(fields.map(field => {
      const baseline = distribution(left.map(row => row[field]))
      const current = distribution(right.map(row => row[field]))
      return [field, { before: baseline, after: current, reductionPercent: baseline.median > 0 ? (1 - current.median / baseline.median) * 100 : null }]
    }))
    const heapNonRegressionSatisfied = metrics.heapDeltaBytes.after.median <= metrics.heapDeltaBytes.before.median * 1.05
    const memoryThresholdSatisfied = metrics.heapDeltaBytes.after.median <= metrics.heapDeltaBytes.before.median * 0.5 &&
      metrics.rendererWorkingSetDeltaKB.after.median <= metrics.rendererWorkingSetDeltaKB.before.median * 0.5 &&
      metrics.rendererWorkingSetPeakKB.after.median <= metrics.rendererWorkingSetPeakKB.before.median * 0.75 &&
      ['rendererWorkingSetPeakKB', 'rendererWorkingSetDeltaKB'].every(field => right.every((row, index) => row[field] < left[index][field]))
    result.scenarios[scenario] = {
      diagnosticOnly: scenario === 'download-discard', metrics, memoryThresholdSatisfied, heapNonRegressionSatisfied,
      elapsedThresholdSatisfied: metrics.elapsedMs.after.median <= metrics.elapsedMs.before.median * 1.05,
      allElapsedBudgetsSatisfied: right.every(row => row.elapsedMs <= 60000),
      allMemoryBudgetsSatisfied: allMemoryBudgetsSatisfied(right),
    }
  }
  result.accepted = primaryScenarios.every(scenario => {
    const row = result.scenarios[scenario]
    return row.memoryThresholdSatisfied && row.elapsedThresholdSatisfied && row.allElapsedBudgetsSatisfied && row.allMemoryBudgetsSatisfied
  })
  return result
}

function summarizeLargeFileBaseline(samples) {
  const indexed = indexSamples(samples, 'current-4gib', 4294967296, primaryScenarios)
  const result = { sizeBytes: 4294967296, samplesPerScenario: 3, comparison: 'current baseline only; original 4 GiB path not measured', memoryBudgets: budgets, maximumElapsedMs: 240000, scenarios: {} }
  for (const scenario of primaryScenarios) {
    const rows = [1, 2, 3].map(n => indexed.get(`${scenario}/sample-${n}`))
    result.scenarios[scenario] = {
      metrics: Object.fromEntries(fields.map(field => [field, distribution(rows.map(row => row[field]))])),
      allMemoryBudgetsSatisfied: allMemoryBudgetsSatisfied(rows),
      allElapsedBudgetsSatisfied: rows.every(row => row.elapsedMs <= result.maximumElapsedMs),
    }
  }
  result.accepted = Object.values(result.scenarios).every(row => row.allMemoryBudgetsSatisfied && row.allElapsedBudgetsSatisfied)
  return result
}

exports.summarizeTransferComparison = summarizeTransferComparison
exports.summarizeLargeFileBaseline = summarizeLargeFileBaseline
if (require.main === module) {
  const [beforeDir, afterDir, outputFile] = process.argv.slice(2)
  if (!beforeDir || !afterDir || !outputFile) throw new Error('Usage: node compare-large-transfer-results.cjs <before-dir|--current-4gib> <after-dir> <output.json>')
  const read = directory => fs.readdirSync(directory).filter(name => /^web-.*\.json$/.test(name)).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')))
  const result = beforeDir === '--current-4gib'
    ? summarizeLargeFileBaseline(read(afterDir))
    : summarizeTransferComparison(read(beforeDir), read(afterDir))
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n')
  console.log('__XDRIVE_LARGE_TRANSFER_COMPARISON__' + JSON.stringify(result))
  if (!result.accepted) process.exitCode = 1
}
