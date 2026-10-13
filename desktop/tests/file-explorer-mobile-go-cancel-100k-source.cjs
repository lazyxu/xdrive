'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const script = read('desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs')
const go = read('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const workflow = read('.github/workflows/file-explorer-mobile-go-cancel-100k.yml')
const registry = read('docs/performance-test-registry.md')
const matrix = read('docs/performance-platform-coverage.md')
const report = read('docs/file-explorer-performance.md')

test('P040 actually drives shared 390px Files virtual scroll into six native Gin Context Done requests', () => {
  for (const source of [
    'XD_FILEEXPLORER_MOBILE_GO_CANCEL_100K_PERF',
    'mobileCancelMode ? 390 : 1440',
    'mobileCancelMode ? 844 : 900',
    "matchMedia('(max-width: 899px)')",
    "document.documentElement.clientWidth",
    'scroll.clientWidth >= 375 && scroll.clientWidth <= 390',
    "data-xdrive-file-explorer-scroll-host",
    "host.dispatchEvent(new Event('scroll'))",
    'TestFileExplorerRealWebScrollCancelFixture100K',
    'current.started === 6 && current.active === 6',
    'current.first_chunks === 6 && current.emitted_bytes === 1536',
    '/__perf/viewport-cancel-mark',
    '/__perf/viewport-cancel-stats',
    'after.context_done - started.context_done',
    'after.cancelled - started.cancelled',
    'after.emitted_bytes - started.emitted_bytes',
    'go.worstContextNotificationMs > 160',
    'row.healthy.total === 100000',
    'resource.rendererRssGrowthBytes',
    'resource.goRssGrowthBytes',
    'FILEEXPLORER_MOBILE_WEB_GO_CANCEL_100K_SUMMARY',
  ]) assert(script.includes(source),'P040 missing real UI/Go cancellation measurement: '+source)
  assert(go.includes('"server_pid": os.Getpid()'))
  assert(go.includes('newGalleryRealWebScrollCancelProbe(firstIDs)'))
  assert(go.includes('distinctPhysicalImages := 16'))
})

test('P040 separate platform dimension is NOT an iOS or Android installed PWA claim', () => {
  for (const part of [
    "github.head_ref == 'perf/file-explorer-mobile-go-cancel-100k-p040-20261013'",
    'github.event.pull_request.head.sha',
    "XD_FILEEXPLORER_MOBILE_GO_CANCEL_100K_PERF: '1'",
    'postgres:17-alpine', 'VITE_XDRIVE_FILE_EXPLORER_REAL_SCROLL_PERF=1',
    'xvfb-run -a', 'node --test desktop/tests/file-explorer-mobile-go-cancel-100k-source.cjs',
    'actions/upload-artifact@v4',
  ]) assert(workflow.includes(part),'P040 source-exact CI gate missing: '+part)
  for(const doc of [registry,matrix,report]) assert(doc.includes('P040'))
  assert(script.includes('not full Mobile App Frame, real iOS/Android device, installed PWA'))
  assert(report.includes('BEFORE') && report.includes('AFTER'))
})

test('P040 viewport abort never mutates persistent upload/download/sync/delete owner', () => {
  assert(script.includes("'/api/v1/nodes/' + config.folder_id +"))
  assert(!script.includes('cancelTransfer('))
  assert(!script.includes('cancelUpload('))
  assert(!script.includes('/api/v1/background-tasks/') && !script.includes('TaskCenter.cancel'))
  assert(matrix.includes('Task Center') || matrix.includes('持久任务'))
})
