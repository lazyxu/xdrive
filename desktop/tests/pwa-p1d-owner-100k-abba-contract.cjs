'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const run=read('desktop/scripts/pwa-p1d-summarize-abba.cjs')
const workflow=read('.github/workflows/pwa-p1d-owner-100k-abba.yml')
test('P1D genuine original frozen A/B releases and same Go/Owner workload',()=>{
 for(const phrase of [
  '84ef0076506b958001369bb173f221418bf4833a',
  '7515c421412666893e4b0519e4b5869d988bf8e1',
  'go.worstContextNotificationMs','go.wastedBytesAfterScroll',
  "row.scroll.kind==='same-document-app-route'",
  'row.logicalAssets,100000','row.physicalNodes,115000',
  'row.go.contextDone===row.streamCount','row.go.stillActiveAt160ms,0'
 ])assert(run.includes(phrase),phrase)
 for(const phrase of [
  'cmp before/desktop/scripts/gallery-mobile-web-go-cancel-100k-main.cjs',
  'cmp before/internal/api/gallery_real_web_cold_performance_integration_test.go',
  'postgres:17-alpine','go test -c','XD_PWA_P0C2_SPA_BEFORE',
  'xvfb-run -a','node probe/desktop/scripts/pwa-p1d-summarize-abba.cjs'
 ])assert(workflow.includes(phrase),phrase)
})
test('ABBA reverse order prevents one-direction speedup claims',()=>{
 for(const s of [
  "run_release before a1","run_release after b1",
  "run_release after b2","run_release before a2",
  "order:'A-B-B-A'","causalConclusion:'NOT_ESTABLISHED'",
  'deltaAB:orderAB','deltaBA:orderBA',
  'firstViewportPhysicalJPEGOnly:true','productionOptimizationImplemented:false',
  'physicalIOS:false','measuredFullStartup:false'
 ])assert((run+'\n'+workflow).includes(s),s)
 assert(!run.includes('performanceImprovement:true'))
})
test('one exact-head opt-in source workflow and sanitized metrics only',()=>{
 for(const s of [
  'github.event.pull_request.head.sha',
  'test/pwa-p1d-owner-100k-abba-20261023',
  'node --test desktop/tests/pwa-p1d-owner-100k-abba-contract.cjs',
  'pwa-p1d-abba-results/paired.json',
  'actions/upload-artifact@v4'
 ])assert(workflow.includes(s),s)
 assert(!/continue-on-error:|workflow_dispatch:/.test(workflow))
 assert(!workflow.includes('native-gin-'))
 assert(!workflow.includes('path: before/desktop/pwa-p0c2-spa-go-results/'))
})
