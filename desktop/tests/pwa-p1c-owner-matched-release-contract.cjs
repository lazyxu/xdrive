'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const cli=read('desktop/scripts/pwa-p1c-summarize-paired.cjs')
const ci=read('.github/workflows/pwa-p1c-owner-matched-100k.yml')
const docs=read('docs/pwa-p1c-owner-100k-paired.md')
test('P1C pins contiguous immutable web releases and identical real Go benchmark sources',()=>{
 for(const token of ['84ef0076506b958001369bb173f221418bf4833a',
   '7515c421412666893e4b0519e4b5869d988bf8e1',
   'cmp before/desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs after/',
   'cmp before/internal/api/gallery_real_web_cold_performance_integration_test.go after/',
   'go test -c','postgres:17-alpine','XD_PWA_P0C2_SPA_BEFORE'])
  assert(ci.includes(token),token)
 assert(ci.includes('One native Electron'))
})
test('P1C genuine 100k Owner metrics and unchanged 160ms handler cancellation',()=>{
 for(const token of ['summary.passed&&summary.spaMode','summary.mobileCancelMode',
  'row.logicalAssets===100000','row.physicalNodes===115000',
  'row.go.contextDone===row.streamCount','row.go.canceled===row.streamCount',
  'row.go.stillActiveAt160ms===0','row.go.wastedBytesAfterScroll===0',
  'row.go.worstContextNotificationMs<=160',
  'goPeakRSSGrowthP50MiB','rendererCPUDeltaP50Ms',
  "distinctPhysical100k:false","measuredAppStartup:false"])
 assert(cli.includes(token),token)
})
test('P1C original Web/Desktop and private data boundaries, same Runner n3 per release',()=>{
 for(const token of ['npm --prefix before/web run build','npm --prefix after/web run build',
  'xvfb-run','node probe/desktop/scripts/pwa-p1c-summarize-paired.cjs',
  'after/desktop/node_modules/.bin/electron','--no-sandbox','XD_GALLERY_MOBILE_NATIVE_GO_BINARY',
  'node --test desktop/tests/pwa-p1c-owner-matched-release-contract.cjs',
  'github.event.pull_request.head.sha'])assert(ci.includes(token),token)
 assert(!ci.includes('continue-on-error:'))
 assert(!ci.includes('workflow_dispatch:'))
 for(const token of ['100k logical','115k metadata','4–6','NOT full','NOT RUN','Go Context.Done'])
   assert(docs.includes(token),token)
 assert(!cli.includes('route.fulfill('))
});
