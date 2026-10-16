'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '../..')
const src = p => fs.readFileSync(path.join(repo,p), 'utf8')
const go = src('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const web = src('desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs')
const ci = src('.github/workflows/file-explorer-wide-physical-100k-go-cancel-p054.yml')
const registry = src('docs/performance-test-registry.md')
const matrix = src('docs/performance-platform-coverage.md')
const spec = src('docs/file-explorer-performance.md')

test('P054 reuses 100k truly distinct JPEG physical CAS fixture and preserves P052/P053',()=>{
  assert(go.includes('db.AutoMigrate(&meta.LocalPushQuotaHold{}, &meta.FileVersion{}'), 'P054 fixture must migrate production owner quota-hold table before /me/quota')
  for(const flag of [
    'XD_FILEEXPLORER_WIDE_PHYSICAL_GO_CANCEL_100K_PERF',
    'if widePhysicalCancelMode {',
    'physicalCancelMode = true',
    'seedFileExplorerDistinctPhysicalJPEG100K(t, db, store, logicalCount)',
    'distinctPhysicalImages = logicalCount',
    'if physicalCancelMode && r.Method == http.MethodGet && probe.matches',
    'if physicalMode && r.Method == http.MethodGet &&',
    '"physical_source_bytes": physicalSourceBytes',
    'newGalleryRealWebScrollCancelProbe(firstIDs)',
    'distinctPhysicalImages := 16'
  ]) assert(go.includes(flag), 'real Go physical CAS/cancel path missing: '+flag)
  assert(go.indexOf('if physicalCancelMode && r.Method == http.MethodGet && probe.matches') <
         go.indexOf('if physicalMode && r.Method == http.MethodGet &&'),
    'Go slow first-viewport watcher must intercept genuine CAS-backed signed JPEG thumbnail before generic physical counter')
})

test('P054 real Wide Web shared Files Grid/Details + AbortSignal reaches native Go at real 1440px',()=>{
  for(const s of [
    "process.env.XD_FILEEXPLORER_WIDE_PHYSICAL_GO_CANCEL_100K_PERF === '1'",
    "mobileCancelMode ? 390 : 1440",
    "if (widePhysicalCancelMode) assert(!mobileCancelMode",
    "scroll.clientWidth >= 1360 && scroll.clientWidth <= 1440",
    "!scroll.narrowBreakpoint",
    "resourceProbeMode = mobileCancelMode || widePhysicalCancelMode",
    "physicalCancelMode ? '&xdriveFileExplorerPhysical100k=1' : ''",
    "scrollMountedFileExplorer",
    "host.dispatchEvent(new Event('scroll'))",
    "current.started === 6 && current.active === 6",
    "current.first_chunks === 6 && current.emitted_bytes === 1536",
    "/__perf/viewport-cancel-mark",
    "after.context_done - started.context_done",
    "after.cancelled - started.cancelled",
    "after.emitted_bytes - started.emitted_bytes",
    "go.worstContextNotificationMs > 160",
    "physicalJPEGOriginals: physicalCancelMode ? 100000 : 16",
    "row.physicalCASSourceBytes >= 50000000",
    "resource.goRssGrowthBytes",
    "resource.rendererRssGrowthBytes",
    "s.totalActualGoContexts!==36"
  ]) assert((s.startsWith('s.')? ci : web).includes(s), 'wide platform/Go contract missing: '+s)
  assert(!web.includes("TaskCenter.cancel") && !web.includes("cancelTransfer("))
})

test('P054 source-exact n3 Grid/Details CI, frozen budget and six distinct platform columns',()=>{
  assert(ci.includes("- name: 'P054 original CURRENT: 1440px wide Web real 100k distinct CAS Grid Details n3 Go Context Done'"), 'step title with colon must be quoted YAML for a valid GitHub Actions workflow')
  for(const s of [
    "github.head_ref == 'perf/file-explorer-wide-physical-jpeg-100k-go-cancel-p054-20261016'",
    "github.event.pull_request.head.sha",
    "XD_FILEEXPLORER_WIDE_PHYSICAL_GO_CANCEL_100K_PERF: '1'",
    "postgres:17-alpine",
    "VITE_XDRIVE_FILE_EXPLORER_REAL_SCROLL_PERF=1",
    "xvfb-run -a",
    "source.txt",
    "s.sampleCount!==6",
    "s.physicalOriginalsPerFixture!==100000",
    "s.maxGoRssGrowthBytes>134217728",
    "s.totalStaleBodyBytes!==0",
    "actions/upload-artifact@v4",
  ]) assert(ci.includes(s), 'wide-only native CI insufficient: '+s)
  for(const d of [registry,matrix,spec]) assert(d.includes('P054') && d.includes('Not measured'))
  for(const platform of ['Native Desktop','Wide Web','Mobile Web','Desktop installed PWA',
    'Android installed PWA','iOS installed PWA'])
    assert(matrix.includes(platform), 'missing six-platform reporting: '+platform)
  assert(web.includes("physicalCancelMode ? 100000 : 16"))
  assert(!web.includes('/api/v1/background-tasks/') && !web.includes('cancelUpload('))
})
