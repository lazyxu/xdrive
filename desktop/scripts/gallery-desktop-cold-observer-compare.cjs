'use strict'
const fs = require('node:fs')

function median(xs) {
  if (xs.length !== 3 || xs.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('Three finite, nonnegative real timing samples required')
  }
  return [...xs].sort((a, b) => a - b)[1]
}
function inspect(file, expectObserverDiagnostics) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (data.n !== 3 || !Array.isArray(data.samples) || data.samples.length !== 3) {
    throw new Error('Genuine n=3 independent real Desktop sample report required')
  }
  const samples = data.samples.map(x => {
    if (!x.realProductionDesktop || x.logicalItems !== 100000 ||
        x.physicalNodes !== 115000 || x.liveAssets !== 15000 ||
        x.renderer?.decodedImages < 12 || x.renderer?.decoderErrors !== 0 ||
        x.renderer?.mountedTiles >= 1000 ||
        !x.renderer.longTaskSupported) {
      throw new Error('Wrong fixture / missing genuine 100k decoded media: ' + file)
    }
    const http = x.firstRangeTimings?.find(y => y.result === 'ok')?.http_ms
    const y = x.renderer
    for (const value of [http, y.firstImageTwoRAFMs, y.first12DecodedTwoRAFMs, y.longestLongTaskMs]) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Timing missing from actual Desktop')
    }
    if (expectObserverDiagnostics &&
        (!Number.isInteger(y.gridScanCount) || y.gridScanCount < 1 ||
         !Number.isFinite(y.gridScanCpuMs) || y.gridScanCpuMs < 0 ||
         !Number.isInteger(y.coalescedScanFrames) || y.coalescedScanFrames < 1 ||
         !Number.isInteger(y.mutationNotifications) || y.mutationNotifications < 1)) {
      throw new Error('New batched real observer metrics missing')
    }
    return {
      httpMs: http,
      paintMs: y.firstImageTwoRAFMs,
      first12Ms: y.first12DecodedTwoRAFMs,
      longTaskMs: y.longestLongTaskMs,
      decoded: y.decodedImages,
      mounted: y.mountedTiles,
      scans: y.gridScanCount ?? null,
      scanCpuMs: y.gridScanCpuMs ?? null,
      maxScanCpuMs: y.maxGridScanCpuMs ?? null,
      mutationCallbacks: y.mutationNotifications ?? null,
      coalescedFrames: y.coalescedScanFrames ?? null,
    }
  })
  return {
    n: samples.length,
    samples,
    medianHttpMs: median(samples.map(s => s.httpMs)),
    medianFirstPaintMs: median(samples.map(s => s.paintMs)),
    medianFirst12Ms: median(samples.map(s => s.first12Ms)),
    medianLongestTaskMs: median(samples.map(s => s.longTaskMs)),
  }
}
function compare(beforeFile, afterFile) {
  const before = inspect(beforeFile, false)
  const after = inspect(afterFile, true)
  const ratio = (x, y) => Math.round(1000 * y / x) / 1000
  const ratioHttp = ratio(before.medianHttpMs, after.medianHttpMs)
  const ratioPaint = ratio(before.medianFirstPaintMs, after.medianFirstPaintMs)
  const ratioLongTask = ratio(before.medianLongestTaskMs, after.medianLongestTaskMs)
  return {
    study: 'BENCHMARK-OBSERVER-COST-ONLY',
    conclusion: ratioLongTask <= 0.85
      ? 'Observer-overhead contribution is supported (not app speedup)'
      : ratioLongTask >= 1.15
      ? 'Observer-overhead explanation not supported; candidate slower'
      : 'No material observer Long Task difference detected',
    before, after, ratioHttp, ratioPaint, ratioLongTask,
    observedLongTaskReductionPct: 100 * (1 - ratioLongTask),
    observerCandidateSafe: ratioPaint <= 1.25 && ratioHttp <= 1.25,
    disclaimer: 'Observational n=3 matched runner: ONLY the benchmark observer changed. No production UI/Go/Agent/SQL optimization was tested. Renderer Long Task API has unknown stack attribution. Physical Windows not tested.',
  }
}
if (require.main === module) {
  const [before, after, output] = process.argv.slice(2)
  if (!before || !after || !output) throw new Error('usage: node gallery-desktop-cold-observer-compare.cjs before.json after.json comparison.json')
  const result = compare(before, after)
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log('GALLERY_DESKTOP_COLD_OBSERVER_AB ' + JSON.stringify(result))
  if (!result.observerCandidateSafe) {
    throw new Error('New observer benchmark materially slowed real first HTTP or first image')
  }
}
module.exports = { compare, inspect }
