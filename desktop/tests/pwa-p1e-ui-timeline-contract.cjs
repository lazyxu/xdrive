'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8')
const source=read('desktop/scripts/pwa-p1e-ui-timeline.cjs')
const summary=read('desktop/scripts/pwa-p1e-ui-timeline-summary.cjs')
const workflow=read('.github/workflows/pwa-p1e-owner-navigation-timeline.yml')
test('P1E observes genuine native click and Gallery unmount without fake route',()=>{
 for(const key of ["XD_PWA_P1E_CLICK_TIMELINE","sendActualPointer(win, targetFiles)",
 "document.addEventListener('click'","new MutationObserver",
 "p1eBrowserClickToGalleryUnmountMs","p1eBrowserClickToFilesMountedMs",
 "p1eTimingClock='browser-performance-now'","after.max_cancel_us / 1000"])
  assert(source.includes(key),key)
 for(const k of ['route.fulfill(','context.route(','location.hash =','#/app/files?xdriveSynthetic'])
  assert(!source.includes(k))
})
test('P1E outcome is honest ABBA native 100k and independent clocks',()=>{
 for(const key of ['84ef0076506b958001369bb173f221418bf4833a',
 '7515c421412666893e4b0519e4b5869d988bf8e1',
 "order:'A-B-B-A'","causalConclusion:'NOT_ESTABLISHED'",
 'browserClockNotAlignedWithServerClock:true','physicalIOS:false',
 "actualOwnerGo:true",'goContextDoneMax<=160'])
  assert(summary.includes(key),key)
})
test('P1E opt-in source-exact CI uses real Go, PG17, Chromium A-B-B-A',()=>{
 for(const key of ['postgres:17-alpine',
 'XD_PWA_P1E_CLICK_TIMELINE:','XD_PWA_P0C2_SPA_BEFORE:',
 'node --check probe/desktop/scripts/pwa-p1e-ui-timeline.cjs',
 'node --test desktop/tests/pwa-p1e-ui-timeline-contract.cjs',
 'electron','xvfb-run','run_release before a1','run_release after b1',
 'run_release after b2','run_release before a2',
 'github.event.pull_request.head.sha','actions/upload-artifact@v4'])
  assert(workflow.includes(key),key)
 assert(!workflow.includes('continue-on-error:'))
 assert(!workflow.includes('workflow_dispatch:'))
 assert(!workflow.includes('path: after/desktop/pwa-p0c2-spa-go-results/native-go-'))
})
