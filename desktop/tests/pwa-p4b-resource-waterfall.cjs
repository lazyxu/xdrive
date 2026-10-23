'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const {summarizeBrowserApiWaterfall}=require('../scripts/pwa-p4b-resource-waterfall.cjs')
const source=fs.readFileSync(path.join(root,'desktop/scripts/pwa-p4a-100k-phase-attribution.cjs'),'utf8')
const workflow=fs.readFileSync(path.join(root,'.github/workflows/pwa-p4b-resource-waterfall.yml'),'utf8')
test('separates scroll, browser TTFB and response transfer without identifiers',()=>{
 const result=summarizeBrowserApiWaterfall(100,300,[
  {kind:'thumbnail',startTime:120,requestStart:125,responseStart:165,responseEnd:200},
  {kind:'media-range',startTime:140,requestStart:150,responseStart:210,responseEnd:250},
  {kind:'api-other',startTime:50,requestStart:55,responseStart:60,responseEnd:70},
  {kind:'api-other',startTime:310,requestStart:320,responseStart:330,responseEnd:340},
 ])
 assert.equal(result.apiRequestsStarted,2)
 assert.equal(result.apiResponsesCompletedBeforeVisible,2)
 assert.equal(result.scrollToFirstObservedApiStartMs,20)
 assert.equal(result.scrollToLastCompletedApiEndMs,150)
 assert.equal(result.afterLastObservedApiToVisibleMs,50)
 assert.equal(result.browserTtfbP50Ms,50)
 assert.equal(result.browserTransferP50Ms,37.5)
 assert.equal(result.scrollToLastObservedApiStartMs,40)
 assert.equal(result.scrollToLastObservedNetworkDispatchMs,50)
 assert.equal(result.observedApiInitiationSpreadMs,20)
 assert.equal(result.browserTtfbP95Ms,59)
 assert.equal(result.browserTtfbMaxMs,60)
 assert.deepEqual(result.categoryTail.thumbnail,
   {requests:1,scrollToLastStartMs:20,browserTtfbP95Ms:40,browserTtfbMaxMs:40})
 assert.deepEqual(result.categoryTail['media-range'],
   {requests:1,scrollToLastStartMs:40,browserTtfbP95Ms:60,browserTtfbMaxMs:60})
 assert.equal(result.preScrollRequestsExcluded,1)
 assert.equal(result.afterVisibleRequestsExcluded,1)
 assert.deepEqual(result.categoryCounts,{thumbnail:1,'media-range':1,'api-other':0})
 assert(!JSON.stringify(result).includes('/api/'))
})
test('unavailable browser timing fields stay null, never fabricated zero',()=>{
 const a=summarizeBrowserApiWaterfall(10,20,[{kind:'thumbnail',startTime:12,requestStart:0,responseStart:0,responseEnd:18}])
 assert.equal(a.browserTtfbP50Ms,null)
 assert.equal(a.browserTtfbP95Ms,null)
 assert.equal(a.browserTtfbMaxMs,null)
 assert.equal(a.scrollToLastObservedNetworkDispatchMs,null)
 assert.equal(a.categoryTail.thumbnail.browserTtfbMaxMs,null)
 assert.equal(a.browserTransferP50Ms,null)
 assert.equal(a.browserTtfbUnavailableCount,1)
})
test('bounded memory and malformed resource categories fail closed',()=>{
 assert.throws(()=>summarizeBrowserApiWaterfall(10,20,Array.from({length:257},()=>({}))),/bounded/)
 assert.throws(()=>summarizeBrowserApiWaterfall(10,20,[{kind:'api-other',startTime:12,requestStart:-1,responseStart:3,responseEnd:14}]),/timing/)
 assert.throws(()=>summarizeBrowserApiWaterfall(10,20,[{kind:'secret/path',startTime:12,requestStart:12,responseStart:13,responseEnd:14}]),/preclassified/)
})
test('reuses original P4A genuine Go/PG17/CAS Chromium fixture, all private URLs anonymized',()=>{
 for(const s of [
  "XD_PWA_P4B_RESOURCE_WATERFALL",
  "TestGalleryRealWebColdFixture100K",
  "await exited(pidA)",
  "await exited(pidB)",
  "performance.clearResourceTimings()",
  "new URL(t.name).pathname",
  "anonymousResourcePhases",
  "summarizeBrowserApiWaterfall(scrollAt,phase.visibleAt",
  "resourceWaterfallMeasurement",
  "medianViewportTtfbP95Ms",
  "latestThumbnailStartP50Ms",
  "timelineViews.length===12",
  "privateCacheUnchanged:true,optimizationImplemented:false",
 ]) assert(source.includes(s),s)
 assert(!source.includes("window.sessionStorage.setItem("))
 assert(!source.includes("caches.open('/api/"))
 for(const s of ["test/pwa-p4b-resource-waterfall-20261023","postgres:17-alpine",
   "XD_PWA_P4B_RESOURCE_WATERFALL", "node --test desktop/tests/pwa-p4b-resource-waterfall.cjs",
   "pwa-p4a-100k-phase-attribution.cjs","node-version: '22'","go-version: '1.25.x'",
   "github.event.pull_request.head.sha","node --check desktop/scripts/pwa-p4b-resource-waterfall.cjs"])
 assert(workflow.includes(s),s)
 assert(!workflow.includes("continue-on-error:"))
})
