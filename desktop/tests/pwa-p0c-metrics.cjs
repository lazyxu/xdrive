'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { quantiles, aggregateP0C, METRICS } = require('../scripts/pwa-p0c-metrics.cjs')
const sample = (i, controlled) => ({
  worker_controlled: controlled, ready_ms: 100 + i, fcp_ms: 20 + i,
  dom_content_loaded_ms: 18 + i, load_ms: 24 + i,
  resource_requests: 10 + i, transfer_bytes_estimate: 1200 + i,
  cls: i / 1000,
})
const nine = () => Array.from({ length: 9 }, (_, i) => ({
  first: sample(i, false), warm: sample(i + 10, true), offline: sample(i + 20, true),
  secret: 'should-never-be-serialized',
}))
test('finite interpolated percentiles preserve 9 real samples', () => {
  assert.deepEqual(quantiles([9, 1, 7, 3, 5, 2, 8, 6, 4]),
    { p50: 5, p95: 8.6, min: 1, max: 9 })
  assert.throws(() => quantiles([1, 2, 3, 4]))
  assert.throws(() => quantiles([1, 2, 3, 4, Infinity]))
  assert.throws(() => quantiles([1, 2, 3, 4, -2]))
})
test('only numerical synthetic measurements survive; no URL or token', () => {
  const data = nine()
  data[0].first.url = 'https://private.invalid/path?token=unsafe'
  data[0].first.auth_token = 'unsafe'
  const report = aggregateP0C(data)
  assert.equal(report.sample_count, 9)
  assert.equal(report.physical_ios, false)
  assert.equal(report.actual_100k, false)
  assert.equal(report.performance_improvement_claimed, false)
  assert.equal(report.metrics.first.ready_ms.p50, 104)
  assert.equal(report.samples.length, 9)
  assert.deepEqual(Object.keys(report.samples[0].first),
    ['worker_controlled', ...METRICS])
  assert(!JSON.stringify(report).includes('unsafe'))
  assert(!JSON.stringify(report).includes('private.invalid'))
})
test('missing FCP, non-finite data, uncontrolled offline and sample-count shortcuts are RED', () => {
  assert.throws(() => aggregateP0C(nine().slice(0, 8)))
  const noPaint = nine(); noPaint[1].warm.fcp_ms = null
  assert.throws(() => aggregateP0C(noPaint))
  const nan = nine(); nan[1].offline.cls = NaN
  assert.throws(() => aggregateP0C(nan))
  const uncontrolled = nine(); uncontrolled[0].offline.worker_controlled = false
  assert.throws(() => aggregateP0C(uncontrolled))
})

test('real offline timing waits for actual PaintTiming rather than treating visible DOM as FCP', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const browserSource = fs.readFileSync(path.resolve(__dirname, '../scripts/pwa-browser-install-offline.cjs'), 'utf8')
  assert.match(browserSource, /const observedReadyMs = await page\.evaluate\(\(\) => performance\.now\(\)\)/)
  assert.match(browserSource, /await page\.waitForFunction\(\(\) => performance\.getEntriesByType\('paint'\)/)
  assert.match(browserSource, /return page\.evaluate\(readyMs =>/)
  assert.match(browserSource, /}, observedReadyMs\)/)
})
