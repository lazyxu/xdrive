'use strict'
const fs = require('node:fs')
const path = require('node:path')

const median = values => {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('invalid or missing actual timing sample')
  }
  const sorted = [...values].sort((a,b)=>a-b)
  return sorted[Math.floor(sorted.length / 2)]
}
function summarize(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report.n !== 3 || report.samples?.length !== 3)
    throw new Error('real fresh Electron/Agent 100k fixture requires exactly three samples: ' + file)
  const rows = report.samples.map(sample => {
    if (!sample.realProductionDesktop || sample.logicalItems !== 100000 ||
        sample.physicalNodes !== 115000 || sample.liveAssets !== 15000 ||
        sample.renderer?.decodedImages < 12 || sample.renderer?.mountedTiles >= 1000)
      throw new Error('not a real 100k/115k/Live Electron/Agent decoded-image sample')
    const first = sample.firstRangeTimings?.find(row => row.result === 'ok')
    if (!first || !Number.isFinite(first.http_ms) ||
        !Number.isFinite(first.agent_ready_ms) ||
        !Number.isFinite(first.total_ms) ||
        !Number.isFinite(sample.renderer?.firstImageTwoRAFMs))
      throw new Error('genuine first Range Agent/HTTP stage record missing')
    return { agent: first.agent_ready_ms, http: first.http_ms,
      total: first.total_ms, paint: sample.renderer.firstImageTwoRAFMs,
      first12: sample.renderer.first12DecodedTwoRAFMs }
  })
  return { file: path.basename(file), n: rows.length, rows,
    medianAgentMs: median(rows.map(x=>x.agent)),
    medianHttpMs: median(rows.map(x=>x.http)),
    medianFirstPaintMs: median(rows.map(x=>x.paint)),
    medianFirst12Ms: median(rows.map(x=>x.first12)) }
}
function compare(beforeFile, afterFile) {
  const before = summarize(beforeFile), after = summarize(afterFile)
  const ratioHttp = after.medianHttpMs / before.medianHttpMs
  const ratioFirstPaint = after.medianFirstPaintMs / before.medianFirstPaintMs
  return {
    kind: 'same-GitHub-runner-independent-100k-fixtures-baseline-vs-candidate',
    nPerArm: 3, before, after,
    ratioHttp, ratioFirstPaint,
    elapsedReductionHttpPct: (1 - ratioHttp) * 100,
    elapsedReductionPaintPct: (1 - ratioFirstPaint) * 100,
    // 15% is a predeclared materiality threshold, not a statistical guarantee.
    materialHttpImprovement: ratioHttp <= 0.85,
    materialPaintImprovement: ratioFirstPaint <= 0.85,
  }
}
if (require.main === module) {
  const [baseline, candidate, output] = process.argv.slice(2)
  if (!baseline || !candidate || !output)
    throw new Error('usage: node gallery-desktop-first-load-compare.cjs baseline.json candidate.json result.json')
  const result = compare(baseline, candidate)
  fs.writeFileSync(output, JSON.stringify(result, null, 2)+'\n')
  console.log('GALLERY_DESKTOP_FIRST_LOAD_AB ' + JSON.stringify(result))
  if (!result.materialHttpImprovement || !result.materialPaintImprovement) {
    console.error('No accepted 15% material reduction in BOTH genuine HTTP and first paint')
    process.exitCode = 1
  }
}
module.exports = { compare, summarize }
