'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const patch=read('desktop/scripts/pwa-p1e-patch-route-variant.cjs')
const summary=read('desktop/scripts/pwa-p1e-summarize-tsst.cjs')
const workflow=read('.github/workflows/pwa-p1e-route-transition-tsst.yml')
const source=read('web/src/webAppRuntime.ts')
test('P1E only a disposable exact two-call sync-route variant; HEAD source remains intact',()=>{
 for(const item of ['7515c421412666893e4b0519e4b5869d988bf8e1',
  '7a3131ed7a2b44a7fbe407ee4a79079a3bb54749',
  "sourceGitBlob:EXPECTED_GIT_BLOB","targetCall='startTransition(() => setRoute(next))'",
  "assert.equal(input.split(targetCall).length-1,2)",
  "assert.equal(command(['diff','--name-only']),'web/src/webAppRuntime.ts')",
  "productionSourceModified:false"])
  assert(patch.includes(item),item)
 assert(source.includes('startTransition(() => setRoute(next))'))
 assert(!patch.includes('git reset --hard'))
})
test('P1E actual owner 100k/115k n3 T-S-S-T Go cancellation and CPU/RSS, no causality claim',()=>{
 for(const item of ["order:'T-S-S-T'","causalConclusion:'NOT_ESTABLISHED'",
  'row.logicalAssets,100000','row.physicalNodes,115000',
  'row.go.contextDone===row.streamCount','row.go.wastedBytesAfterScroll',
  'row.go.stillActiveAt160ms,0','variant-fingerprint.json',
  'result.testOnlyTransitionVariant=true','result.productionOptimizationImplemented=false'])
  assert(summary.includes(item),item)
 for(const item of ['run_release with-transition t1','run_release without-transition s1',
  'run_release without-transition s2','run_release with-transition t2',
  'postgres:17-alpine','go test -c','xvfb-run -a',
  'desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs',
  'desktop/scripts/pwa-p1e-summarize-tsst.cjs'])
  assert(workflow.includes(item),item)
})
test('P1E exact HEAD test-only CI has GUI and privacy gates but no product edits',()=>{
 for(const item of ['github.event.pull_request.head.sha','test/pwa-p1e-route-transition-attribution-20261023',
  'desktop/tests/pwa-p1e-route-transition-contract.cjs',
  'desktop/scripts/mobile-web-app-browser.cjs',
  'gallery-ios27-chrome','gallery-ios27-viewer','XD_PWA_P0C2_NAV_BEFORE=1',
  'independent_browser_sessions','transitions_per_direction','s.source_commit_sha',
  'pwa-p1e-viewer/results.json','actions/upload-artifact@v4',
  'XDRIVE_PLAYWRIGHT_MODULE=', 'XDRIVE_BROWSER_EXECUTABLE=',
  'playwright-core@1.56.1','Native Chromium is required'])
  assert(workflow.includes(item),item)
 assert(!/workflow_dispatch:|continue-on-error:/.test(workflow))
 assert(!workflow.includes('path: with-transition/desktop/pwa-p0c2-spa-go-results/'))
 assert(!workflow.includes('path: without-transition/desktop/pwa-p0c2-spa-go-results/'))
})
