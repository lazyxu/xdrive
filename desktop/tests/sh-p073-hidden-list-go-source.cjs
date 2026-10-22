'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const go = fs.readFileSync(path.join(root, 'internal/api/sh_p005_browser_physical_jpeg_share_100k_linux_test.go'), 'utf8')
const driver = fs.readFileSync(path.join(root, 'desktop/scripts/sh-p005-browser-physical-jpeg-share-100k.cjs'), 'utf8')
const share = fs.readFileSync(path.join(root, 'web/src/PublicShare.tsx'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/p073-mounted-hidden-share-list-go-100k.yml'), 'utf8')
test('P073 only holds real authenticated next Share cursor on genuine 100k physical CAS', () => {
  for(const token of ['const count = 100000','fileExplorerPhysicalJPEG(i)',
    'listHiddenCancel := os.Getenv("XD_SH_P073_REAL_LIST_GO") == "1"',
    'listHoldArmed.CompareAndSwap(true, false)',
    'router.ServeHTTP(&shP018HeldBodyWriter{',
    '<-w.request.Context().Done()','list_cancelled_go','list_held_starts',
    'list_active_held','list_stale_body_bytes']) {
    assert(go.includes(token),'cannot fake Go original Share handler: '+token)
  }
  assert(share.includes('pendingPage.current?.abort()'))
  assert(share.includes('api.publicShareChildren(token, password, parentID, pageCursor, signal)'))
  assert(!driver.includes('route.fulfill(')&&!driver.includes('mockFetch('))
})
test('P073 requires six actual hidden mounted list requests to Go within 160ms', () => {
  for(const token of ['XD_SH_P073_REAL_LIST_GO',
    'probeRealMountedSharePageListCancel','/__perf/arm-list-hold',
    "await click(win,'下一页')",'list_held_starts >= number',
    '/__perf/mark-list-hide','win.hide()','document.hidden',
    '__p073Doc','__p073Scroll','x.pagehide_events===0',
    'x.beforeunload_events===0','x.go_cancel_max_ms<=160',
    "x.cause==='mounted-hidden-share-cursor-page'",
    'result.sessions.length===6','P073_SHARE_CURSOR_HIDDEN_GO_CURRENT']) {
    assert(driver.includes(token),'missing real mounted hidden Go proof: '+token)
  }
  for(const token of ['XD_SH_P073_REAL_LIST_GO:', 'postgres:17-alpine',
    'npm --prefix web run build',
    'data.original_jpeg_cas!==100000','data.http_counts.list_cancelled_go!==6',
    'data.http_counts.list_active_held!==0','data.http_counts.list_stale_body_bytes!==0',
    'x.go_cancel_max_ms>160','upload-artifact@v4']) {
    assert(workflow.includes(token),'CI gate weakened: '+token)
  }
})
