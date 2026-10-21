'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {DIRECTIONS, NUMERIC_FIELDS, quantiles, summarizeP0C2} = require('../scripts/pwa-p0c2-navigation-metrics.cjs')
const sha = '0123456789abcdef0123456789abcdef01234567'
function samples() {
  const result = []
  for (let session = 1; session <= 3; session++) {
    for (let cycle = 1; cycle <= 3; cycle++) {
      for (const [index, direction] of DIRECTIONS.entries()) {
        result.push({
          session, cycle, direction,
          visible_ms: 100 + ((session - 1) * 3 + cycle - 1) * 8 + index,
          layout_shift_raw: (session + cycle + index) / 1000,
          layout_shift_web_vitals: (session + cycle + index) / 2000,
          fixture_api_calls: 2 + index, header_height_px: 52,
          main_reused: true, route_committed: true, content_ready: true,
          private_token: 'should-never-be-serialized',
          url: 'https://secret.invalid/path?token=test'
        })
      }
    }
  }
  return result
}
test('P0-C2 n9 percentile interpolation is deterministic', () => {
 assert.deepEqual(quantiles([9,1,7,3,5,2,8,6,4]), {p50:5,p95:8.6,min:1,max:9})
 assert.throws(() => quantiles([1,2,3]))
 assert.throws(() => quantiles([1,2,3,4,5,6,7,8,Infinity]))
})
test('three true independent browser sessions, three paired navigations, numeric-only summary', () => {
 const r=summarizeP0C2(samples(),sha,'155.0.8059.84')
 assert.equal(r.independent_browser_sessions,3)
 assert.equal(r.transitions_per_direction,9)
 assert.equal(r.physical_ios,false)
 assert.equal(r.authenticated_go_backend,false)
 assert.equal(r.production_optimization_after,null)
 assert.equal(r.metrics['files-to-gallery'].visible_ms.p50,132)
 assert.equal(r.samples.length,18)
 assert.deepEqual(Object.keys(r.samples[0]), ['session','cycle','direction',
   'route_committed','content_ready','main_reused', ...NUMERIC_FIELDS])
 assert(!JSON.stringify(r).includes('secret.invalid'))
 assert(!JSON.stringify(r).includes('should-never-be-serialized'))
})
test('missing source samples, fake accepted state, nonfinite metric, duplicate or missing Header are RED', () => {
 assert.throws(() => summarizeP0C2(samples().slice(1),sha,'155.0'))
 const wrong=samples();wrong[0].content_ready=false
 assert.throws(() => summarizeP0C2(wrong,sha,'155.0'))
 const nonfinite=samples();nonfinite[0].visible_ms=NaN
 assert.throws(() => summarizeP0C2(nonfinite,sha,'155.0'))
 const duplicate=samples();duplicate[0]={...duplicate[1]}
 assert.throws(() => summarizeP0C2(duplicate,sha,'155.0'))
 const noHeader=samples();noHeader[0].header_height_px=0
 assert.throws(() => summarizeP0C2(noHeader,sha,'155.0'))
 assert.throws(() => summarizeP0C2(samples(),'oldSHA','155.0'))
})
test('original real browser runner implements direct Files Gallery navigation and explicit layout shift observer', () => {
 const src=fs.readFileSync(path.resolve(__dirname,'../scripts/mobile-web-app-browser.cjs'),'utf8')
 assert.match(src,/XD_PWA_P0C2_NAV_BEFORE/)
 assert.match(src,/runP0C2NavigationBefore/)
 assert.match(src,/navigateWorkspace\('图库', 'gallery'\)/)
 assert.match(src,/navigateWorkspace\('文件', 'files'\)/)
 assert.match(src,/data-mobile-files-item/)
 assert.match(src,/data-xdrive-media-tile/)
 assert.match(src,/layout-shift/)
 assert.match(src,/PWA_P0C2_NAVIGATION_CURRENT/)
})
