'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const run=read('desktop/scripts/pwa-p4a-100k-phase-attribution.cjs')
const workflow=read('.github/workflows/pwa-p4a-100k-phase-attribution.yml')
const fixture=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const previous=read('desktop/scripts/pwa-p2a2-real-chromium-restart.cjs')

test('P4A retains real 100k/115k Go/PG17/CAS and separate native Chrome PID BEFORE',()=>{
 for(const key of [
  "TestGalleryRealWebColdFixture100K",
  "XD_GALLERY_REAL_WEB_COLD_PERF:'1'",
  'XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF',
  'launchPersistentContext(profile',
  'browserPid(profile)',
  'await exited(pidA)',
  'await exited(pidB)',
  'assert.notEqual(pidA,pidB',
  "logical_assets,100000",
  "physical_nodes,115000",
  "physical_sources,115000",
  "physical-thumbnail-stats",
  'firstHTTP:delta(beforeA,afterA)',
  'restartedHTTP:delta(beforeB,afterB)',
  'goRSSGrowthBytes:growth',
  'maxActive:afterB.max_active',
  'n:3,pairs:9',
  'privatePersistentCache:false',
  'optimizationImplemented:false',
  'samples,after:null'
 ]) assert(run.includes(key),'physical Chrome/Go BEFORE invariant '+key)
 for(const key of ['gallerySeedRealPhysicalMixed100K','physicalProbe.serve(w, r, router)','"physical_sources"'])
  assert(fixture.includes(key),'fixture changed '+key)
 assert(!run.includes('indexedDB.open'))
 assert(!run.includes('skipWaiting('))
 assert(!run.includes('new BrowserWindow'))
 assert(!run.includes('window.location.reload'))
 assert(previous.includes('await exited(pidA)'))
})

test('real Chrome CDP CPU metrics and same-origin ResourceTiming are observations not additive wall time',()=>{
 for(const key of [
  "ctx.newCDPSession(page)",
  "perfCDP.send('Performance.enable')",
  "perfCDP.send('Performance.getMetrics')",
  "'ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration'",
  "'JSHeapUsedSize'",
  "performance.clearResourceTimings()",
  "performance.getEntriesByType('resource')",
  "new URL(t.name).pathname.startsWith('/api/')",
  'phaseAttribution:{scriptP50:',
  'apiResourcesObserved',
  'apiResourceWindowMs',
  'observedResourceNote:',
  'cpuNote:'
 ]) assert(run.includes(key),key)
 assert(run.includes('does not isolate network wait or TCP wire bytes'))
 assert(run.includes('categories overlap and are NOT additive wall-clock partition'))
 assert(!run.includes('performanceImprovement:true'))
 assert(run.includes('optimizationImplemented:false'))
})

test('post-visibility decode awaits and two rAF tail are never called complete decoding/paint',()=>{
 for(const key of [
  'img',
  'Promise.all(imgs.map(i=>i.decode()))',
  'requestAnimationFrame(()=>requestAnimationFrame',
  'lateDecodeAwaitMs:',
  'postDecodeTwoRafMs:',
  'postVisibilityDecodeAwaitP50:',
  'postDecodeTwoRafP50:',
  'decodeNote:',
  'rafNote:',
  'excludes earlier image-decoding work',
  'not rasterization or GPU paint duration'
 ])assert(run.includes(key),key)
 assert(run.includes('img?.complete&&img.naturalWidth>0'))
 assert(run.includes("startsWith('blob:')"))
 assert(run.includes('view.mounted<1000'))
})

test('source-exact CI reports 3 independent repeats and real public-only Browser/Go',()=>{
 for(const key of [
  "test/pwa-p4a-100k-phase-attribution-20261022",
  'postgres:17-alpine',
  'node-version: \'22\'',
  'go-version: \'1.25.x\'',
  'playwright-core@1.56.1',
  'go test -c -o desktop/gallery-physical-web-go/api.test ./internal/api',
  'node --test desktop/tests/pwa-p4a-phase-attribution-contract.cjs',
  'node desktop/scripts/pwa-p4a-100k-phase-attribution.cjs',
  'XD_PWA_P4A_BEFORE',
  'XD_PWA_P4A_RESULTS',
  'x.n!==3','x.pairs!==9',
  'x.optimizationImplemented',
  'github.event.pull_request.head.sha',
  'pwa-p4a-real-100k-phase-attribution-before-n3',
 ])assert(workflow.includes(key),key)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('private-go-'))
 assert(!workflow.includes('browser-profile'))
 assert(!workflow.includes('production-jwt'))
})
