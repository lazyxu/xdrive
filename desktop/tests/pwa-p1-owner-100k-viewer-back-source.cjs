'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.join(__dirname,'../..')
const read=filename=>fs.readFileSync(path.join(root,filename),'utf8')
const script=read('desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs')
const workflow=read('.github/workflows/pwa-p1-owner-100k-viewer-back.yml')
test('P1 real Owner 100k Gallery Viewer Back uses signed CAS, native pointer, restored anchor and original P0C2 safety',()=>{
  for(const needle of [
    'XD_PWA_P1_100K_VIEWER_BACK',
    'p1VisiblePhotoTile','p1DecodedOriginal','p1ReturnedToCaller',
    "sendActualPointer(win,entry)","sendActualPointer(win,back)",
    "image.decode()".replace('image','img'),
    '[data-xdrive-image-phase="original"]',
    'saved.document!==document.documentElement',
    'host!==saved.host','grid!==saved.grid',
    'p1ViewerBack = p1Mode ? await p1MeasureRealViewerBack(win) : null',
    'row.go.worstContextNotificationMs <= 160',
    'notMeasured:',
  ])assert.ok(script.includes(needle),'missing original bounded P1 gate: '+needle)
  assert.ok(!script.includes('context.route(')&&!script.includes('route.fulfill('))
})
test('P1 opt-in native Go/Gin/PG17 390px n3 workflow preserves all prior P0C2 gates',()=>{
  for(const needle of [
    'postgres:17-alpine',"XD_PWA_P0C2_SPA_BEFORE: '1'",
    "XD_PWA_P1_100K_VIEWER_BACK: '1'",
    "github.head_ref == 'test/pwa-p1-100k-owner-viewer-back-20261025'",
    'go test -c -o','xvfb-run',
    'p1OriginalDecodedP50Ms','pwa-p0c2b2-real-spa-go-source.cjs'
  ])assert.ok(workflow.includes(needle),'missing opt-in CI gate: '+needle)
  assert.ok(!workflow.includes('skipWaiting'))
})
