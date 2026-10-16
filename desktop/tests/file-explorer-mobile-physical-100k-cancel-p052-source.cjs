'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const sourceGo = read('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const sourceWeb = read('desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs')
const workflow = read('.github/workflows/file-explorer-mobile-physical-100k-go-cancel-p052.yml')
const registry = read('docs/performance-test-registry.md')
const coverage = read('docs/performance-platform-coverage.md')
const spec = read('docs/file-explorer-performance.md')

test('P052 seeds all 100k SHA-distinct REAL persisted CAS originals, unlike P040 16 files',()=>{
  for(const flag of ['XD_FILEEXPLORER_MOBILE_PHYSICAL_GO_CANCEL_100K_PERF',
    'distinctPhysicalImages = logicalCount',
    'seedFileExplorerDistinctPhysicalJPEG100K(t, db, store, logicalCount)',
    'physicalSourceBytes',
    '"physical_cancel_mode": physicalCancelMode'])
    assert(sourceGo.includes(flag),flag)
  assert(sourceGo.includes('physicalMode := os.Getenv("XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF") == "1" || physicalCancelMode'))
  assert(sourceGo.includes('physicalCancelMode && r.Method == http.MethodGet && probe.matches'))
  const cancelRoute=sourceGo.indexOf('if physicalCancelMode && r.Method == http.MethodGet && probe.matches')
  const physicalRoute=sourceGo.indexOf('if physicalMode && r.Method == http.MethodGet &&')
  assert(cancelRoute>=0 && physicalRoute>cancelRoute,'test-only slow cancellation HTTP writer must intercept watched real physical JPEGs before generic physical counter')
})

test('P052 uses actually mounted 390px Web Files DOM, 6 true HTTP contexts and 160ms Go cancellation',()=>{
  assert(sourceWeb.includes("process.env.XD_FILEEXPLORER_MOBILE_PHYSICAL_GO_CANCEL_100K_PERF === '1'"))
  assert(sourceWeb.includes("physicalCancelMode ? '&xdriveFileExplorerPhysical100k=1' : ''"),
    'P052 must select 100k physical Web fixture while P040 retains its 16-original default')
  for(const s of ['mobileCancelMode ? 390 : 1440',
    'scrollMountedFileExplorer',"host.dispatchEvent(new Event('scroll'))",
    'scroll.clientWidth >= 375 && scroll.clientWidth <= 390',
    'current.started === 6 && current.active === 6',
    'current.first_chunks === 6 && current.emitted_bytes === 1536',
    '/__perf/viewport-cancel-mark',
    'after.context_done - started.context_done',
    'after.cancelled - started.cancelled',
    'after.emitted_bytes - started.emitted_bytes',
    'go.worstContextNotificationMs > 160',
    'physicalJPEGOriginals: physicalCancelMode ? 100000 : 16',
    'row.physicalCASSourceBytes >= 50000000',
    'resource.goRssGrowthBytes',
    'resource.rendererRssGrowthBytes'])assert(sourceWeb.includes(s),s)
  assert(sourceGo.includes('newGalleryRealWebScrollCancelProbe(firstIDs)'))
})

test('P052 accepts only real n3 Grid/Details physical JPEG results and preserves P040',()=>{
  assert(workflow.includes("github.head_ref == 'perf/mobile-physical-jpeg-100k-go-cancel-p052-20261016'"))
  assert(workflow.includes("XD_FILEEXPLORER_MOBILE_PHYSICAL_GO_CANCEL_100K_PERF: '1'"))
  for(const text of ['postgres:17-alpine','github.event.pull_request.head.sha',
    'VITE_XDRIVE_FILE_EXPLORER_REAL_SCROLL_PERF=1',
    'xvfb-run -a','source.txt',
    's.physicalOriginalsPerFixture!==100000',
    's.sampleCount!==6','actions/upload-artifact@v4',
    'desktop/tests/file-explorer-mobile-go-cancel-100k-source.cjs'])
    assert(workflow.includes(text),text)
  for(const doc of [registry,coverage,spec])
    assert(doc.includes('P052') && doc.includes('Not measured'))
  assert(sourceWeb.includes('physicalCancelMode ? 100000 : 16'))
  assert(sourceGo.includes('distinctPhysicalImages := 16'))
  assert(!sourceWeb.includes('TaskCenter.cancel') && !sourceWeb.includes('cancelTransfer('))
})
