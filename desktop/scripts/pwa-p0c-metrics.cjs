'use strict'
// P0-C0: numerical-only aggregation; no page URLs, cookies or resource names.
const assert = require('node:assert/strict')
const METRICS = Object.freeze([
  'ready_ms', 'fcp_ms', 'dom_content_loaded_ms', 'load_ms',
  'resource_requests', 'transfer_bytes_estimate', 'cls',
])
const PHASES = Object.freeze(['first', 'warm', 'offline'])
function quantiles(numbers) {
  assert(Array.isArray(numbers) && numbers.length >= 5, 'at least 5 independent samples required')
  for (const number of numbers) assert(Number.isFinite(number) && number >= 0, 'invalid metric sample')
  const sorted = [...numbers].sort((a, b) => a - b)
  const at = q => {
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)).toFixed(3))
  }
  return { p50: at(0.5), p95: at(0.95), min: Number(sorted[0].toFixed(3)),
    max: Number(sorted[sorted.length - 1].toFixed(3)) }
}
function aggregateP0C(samples) {
  assert(Array.isArray(samples) && samples.length === 9, 'P0-C0 requires 9 isolated Chrome contexts')
  const summary = {}
  const safeSamples = []
  for (const phase of PHASES) summary[phase] = {}
  for (const record of samples) {
    const safeRecord = {}
    for (const phase of PHASES) {
      const source = record?.[phase]
      assert(source && source.worker_controlled === (phase !== 'first' ? true : source.worker_controlled),
        'warm and offline navigation must have a real Service Worker controller')
      const safe = { worker_controlled: Boolean(source.worker_controlled) }
      for (const key of METRICS) {
        const value = source[key]
        assert(Number.isFinite(value) && value >= 0, phase + '.' + key + ' must be a finite non-negative measurement')
        if (key === 'fcp_ms') assert(value > 0, 'actual first-contentful-paint entry is required')
        safe[key] = Number(value.toFixed(3))
      }
      safeRecord[phase] = safe
    }
    safeSamples.push(safeRecord)
  }
  for (const phase of PHASES) {
    for (const key of METRICS) summary[phase][key] = quantiles(safeSamples.map(s => s[phase][key]))
  }
  return {
    schema: 'xdrive-pwa-p0c-chromium-startup-baseline-v1',
    sample_count: safeSamples.length,
    viewport_px: { width: 390, height: 844 },
    device: 'headless Chromium Android-UA mobile emulation, not iOS Safari',
    physical_ios: false,
    actual_100k: false,
    user_data: false,
    performance_improvement_claimed: false,
    transfer_bytes_note: 'PerformanceResourceTiming.transferSize estimate; not wire bytes or server load',
    metrics: summary,
    samples: safeSamples,
  }
}
module.exports = { METRICS, PHASES, quantiles, aggregateP0C }
