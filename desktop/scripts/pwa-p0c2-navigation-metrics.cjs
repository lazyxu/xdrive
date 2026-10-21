'use strict'
const assert = require('node:assert/strict')
const DIRECTIONS = ['files-to-gallery', 'gallery-to-files']
const NUMERIC_FIELDS = ['visible_ms', 'layout_shift_raw', 'layout_shift_web_vitals', 'fixture_api_calls', 'header_height_px']
function quantiles(values) {
  assert(Array.isArray(values) && values.length === 9, 'nine actual transitions required')
  const sorted = [...values].sort((a, b) => a - b)
  for (const value of sorted) assert(Number.isFinite(value) && value >= 0, 'all samples finite and non-negative')
  const percentile = q => {
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos), hi = Math.ceil(pos)
    return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)).toFixed(3))
  }
  return {p50:percentile(0.5),p95:percentile(0.95),min:Number(sorted[0].toFixed(3)),max:Number(sorted[sorted.length-1].toFixed(3))}
}
function summarizeP0C2(samples, sourceSha, browserVersion) {
  assert(Array.isArray(samples) && samples.length === 18, 'three independent browser sessions times six route transitions')
  const seen = new Set(), records = []
  for (const entry of samples) {
    assert(Number.isInteger(entry?.session) && entry.session >= 1 && entry.session <= 3)
    assert(Number.isInteger(entry?.cycle) && entry.cycle >= 1 && entry.cycle <= 3)
    assert(DIRECTIONS.includes(entry.direction), 'unexpected navigation direction')
    const id = [entry.session,entry.cycle,entry.direction].join(':')
    assert(!seen.has(id), 'duplicate session/cycle/direction')
    seen.add(id)
    assert(entry.route_committed === true && entry.content_ready === true, 'accepted content required')
    const clean = {session:entry.session,cycle:entry.cycle,direction:entry.direction,
      route_committed:true,content_ready:true,main_reused:entry.main_reused===true}
    for (const field of NUMERIC_FIELDS) {
      assert(typeof entry[field] === 'number' && Number.isFinite(entry[field]) && entry[field] >= 0, field+' must be a measured number')
      clean[field] = Number(entry[field].toFixed(3))
    }
    assert(clean.visible_ms > 0 && clean.visible_ms < 120000, 'actual bounded route timing required')
    assert(clean.header_height_px >= 50 && clean.header_height_px <= 64, '52px App Header not visible')
    assert(clean.layout_shift_web_vitals <= clean.layout_shift_raw + 1e-6)
    records.push(clean)
  }
  assert(typeof sourceSha === 'string' && /^[0-9a-f]{40}$/.test(sourceSha), 'exact SHA required')
  assert(typeof browserVersion === 'string' && /^\d+\./.test(browserVersion), 'real browser version required')
  const grouped = {}
  for (const direction of DIRECTIONS) {
    const arr = records.filter(s => s.direction === direction)
    assert(arr.length === 9 && new Set(arr.map(s => s.session)).size === 3)
    grouped[direction] = Object.fromEntries(NUMERIC_FIELDS.map(field => [field,quantiles(arr.map(x => x[field]))]))
    grouped[direction].same_main_count = arr.filter(x => x.main_reused).length
  }
  return {schema:'xdrive-pwa-p0c2-bounded-browser-navigation-before-v1',source_commit_sha:sourceSha,
    browser_version:browserVersion,viewport_px:{width:390,height:844},
    independent_browser_sessions:3,transitions_per_direction:9,
    physical_ios:false,actual_100k:false,authenticated_go_backend:false,installed_pwa:false,
    production_optimization_after:null,speedup_claim:null,
    scope:'Built real Mobile Web Files/Gallery React DOM, actual Chromium actions and STRICT BOUNDED API fixtures; NOT live Gin/Pg17 or Go ctx.cancel',
    metrics:grouped,samples:records}
}
module.exports = {DIRECTIONS,NUMERIC_FIELDS,quantiles,summarizeP0C2}
