'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const driver = fs.readFileSync(path.join(root, 'desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/p072-mounted-hidden-go-100k.yml'), 'utf8')
const go = fs.readFileSync(path.join(root, 'internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go'), 'utf8')
test('P072 uses a real 100k physically allocated Share JPEG source and real Go Request.Context.Done', () => {
  for (const x of ['const count = 100000','fileExplorerPhysicalJPEG(i)',
    'thumbnail_cancelled_go','thumbnail_active_held','thumbnail_stale_body_bytes',
    '<-w.request.Context().Done()']) assert(go.includes(x), 'source missing: '+x)
  for (const x of ["XD_SH_P072_MOUNTED_HIDDEN_GO","win.hide()",
    'backgroundThrottling: mountedHidden',
    "if (!mountedHidden) {",
    'P072_ACTUAL_HIDDEN_VISIBILITY_DIAGNOSTIC',
    "cause = 'mounted-hidden-visibilitychange'",
    'document.hidden && document.visibilityState',
    'window.__p072RecordedDoc === document',
    'window.__p072RecordedScroll ===','sameScrollHost',
    "document.addEventListener('visibilitychange'",
    "window.addEventListener('pagehide'",
    'v.visibilitychangeEvents >= 1 && v.pagehideEvents === 0',
    'v.beforeunloadEvents === 0',
    'visibilitychange_events:mountedHidden?hiddenLifecycle?.visibilitychangeEvents',
    'mounted_hidden_verified:mountedHidden?mountedHiddenVerified',
    'window_hidden_during_cancel:mountedHidden?!win.isVisible()',
    'if (!pairedNextPage && sample === 1)',
    "cause = 'real-window-pagehide'","cause = 'bounded-next-page'",
    'thumbnail_stale_body_bytes','go_cancel_max_ms<=160']) {
    assert(driver.includes(x), 'P072 may not drop original and real hidden checks: '+x)
  }
  assert(!driver.includes('mockFetch(') && !driver.includes('route.fulfill('))
})
test('P072 CI keeps original 160 ms, 100k physical, Go, page, and clean HTTP budgets', () => {
  for (const x of ["perf/p072-real-mounted-hidden-go-100k-20261022",
    "XD_SH_P072_MOUNTED_HIDDEN_GO: '1'","XD_SH_P021_UNIFIED_CORE: '1'",
    "XD_SH_P018_REAL_CACHED_THUMBNAIL: '1'","postgres:17-alpine",
    'npm --prefix web run build','node --test desktop/tests/sh-p072-mounted-hidden-go-source.cjs',
    'data.original_jpeg_cas!==100000','data.sessions.length!==6',
    'data.http_counts.thumbnail_cancelled_go!==6',
    'data.http_counts.thumbnail_active_held!==0',
    'data.http_counts.thumbnail_stale_body_bytes!==0',
    'x.go_cancel_max_ms>160','mounted-hidden-visibilitychange',
    'Go_Context_Done','upload-artifact@v4']) {
    assert(workflow.includes(x), 'P072 workload or budget changed: '+x)
  }
})
