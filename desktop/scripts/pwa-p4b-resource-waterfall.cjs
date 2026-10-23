'use strict'
// Numeric-only browser-observed resource phases. Never accept/store API URLs,
// credentials, response bodies, media IDs, or browser profile metadata.
const assert = require('node:assert/strict')
const kinds = ['thumbnail', 'media-range', 'api-other']
const rounded = n => Number(n.toFixed(3))
function percentile(values, p) {
  if (!values.length) return null
  assert(values.every(x => Number.isFinite(x) && x >= 0))
  const a = [...values].sort((x, y) => x - y)
  const t = (a.length - 1) * p, lo = Math.floor(t), hi = Math.ceil(t)
  return rounded(a[lo] + (a[hi] - a[lo]) * (t - lo))
}
function summarizeBrowserApiWaterfall(scrollAt, visibleAt, records) {
  assert(Number.isFinite(scrollAt) && scrollAt >= 0)
  assert(Number.isFinite(visibleAt) && visibleAt >= scrollAt)
  assert(Array.isArray(records) && records.length <= 256, 'bounded resource timing only')
  const starts = [], dispatched = [], endings = [], ttfb = [], transfers = []
  const categoryCounts = { thumbnail: 0, 'media-range': 0, 'api-other': 0 }
  const startsByKind = Object.fromEntries(kinds.map(k => [k, []]))
  const ttfbByKind = Object.fromEntries(kinds.map(k => [k, []]))
  let preScroll = 0, late = 0, completed = 0, incomplete = 0, ttfbUnavailable = 0
  for (const r of records) {
    assert(r && kinds.includes(r.kind), 'only preclassified anonymous resource types')
    for (const k of ['startTime', 'requestStart', 'responseStart', 'responseEnd'])
      assert(typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0, 'invalid timing '+k)
    if (r.startTime < scrollAt) { preScroll++; continue }
    if (r.startTime > visibleAt) { late++; continue }
    categoryCounts[r.kind]++
    const resourceStart = r.startTime - scrollAt
    starts.push(resourceStart)
    startsByKind[r.kind].push(resourceStart)
    if (r.requestStart > 0 && r.requestStart >= scrollAt && r.requestStart <= visibleAt)
      dispatched.push(r.requestStart - scrollAt)
    if (r.responseEnd <= 0 || r.responseEnd > visibleAt || r.responseEnd < r.startTime) {
      incomplete++; continue
    }
    completed++
    endings.push(r.responseEnd - scrollAt)
    if (r.requestStart > 0 && r.responseStart >= r.requestStart) {
      ttfb.push(r.responseStart - r.requestStart)
      ttfbByKind[r.kind].push(r.responseStart - r.requestStart)
    } else ttfbUnavailable++
    if (r.responseStart > 0 && r.responseEnd >= r.responseStart)
      transfers.push(r.responseEnd - r.responseStart)
  }
  const latest = endings.length ? Math.max(...endings) : null
  const categoryTail = Object.fromEntries(kinds.map(kind => {
    const initiated = startsByKind[kind], waits = ttfbByKind[kind]
    return [kind, {
      requests: categoryCounts[kind],
      scrollToLastStartMs: initiated.length ? rounded(Math.max(...initiated)) : null,
      browserTtfbP95Ms: percentile(waits, .95),
      browserTtfbMaxMs: waits.length ? rounded(Math.max(...waits)) : null,
    }]
  }))
  return {
    apiRequestsStarted: starts.length,
    apiResponsesCompletedBeforeVisible: completed,
    preScrollRequestsExcluded: preScroll,
    afterVisibleRequestsExcluded: late,
    responsesStillInFlightAtVisible: incomplete,
    browserTtfbUnavailableCount: ttfbUnavailable,
    categoryCounts,
    categoryTail,
    scrollToLastObservedApiStartMs: starts.length ? rounded(Math.max(...starts)) : null,
    scrollToLastObservedNetworkDispatchMs: dispatched.length ? rounded(Math.max(...dispatched)) : null,
    observedApiInitiationSpreadMs: starts.length ?
      rounded(Math.max(...starts) - Math.min(...starts)) : null,
    browserTtfbP95Ms: percentile(ttfb, .95),
    browserTtfbMaxMs: ttfb.length ? rounded(Math.max(...ttfb)) : null,
    scrollToFirstObservedApiStartMs: starts.length ? rounded(Math.min(...starts)) : null,
    scrollToLastCompletedApiEndMs: latest === null ? null : rounded(latest),
    afterLastObservedApiToVisibleMs: latest === null ? null : rounded(visibleAt - scrollAt - latest),
    browserTtfbP50Ms: percentile(ttfb, 0.5),
    browserTransferP50Ms: percentile(transfers, 0.5),
  }
}
module.exports = { summarizeBrowserApiWaterfall, percentile }
