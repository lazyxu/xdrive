'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const script=read('desktop/scripts/gallery-web-real-h264-posters-100k.cjs')
const workflow=read('.github/workflows/gallery-mobile-web-h264-posters-100k.yml')
const registry=read('docs/performance-test-registry.md')
const coverage=read('docs/performance-platform-coverage.md')
const canonical=read('docs/gallery-performance.md')

test('P041 authentic 390px Gallery H264 video poster benchmark uses real production VirtualGrid, CAS and physical 100k source',()=>{
  for(const s of [
    "XD_GALLERY_MOBILE_H264_POSTERS_100K_PERF",
    "mobileVideoMode?390:1440",
    "mobileVideoMode?844:900",
    "matchMedia('(max-width:899.95px)')",
    "document.documentElement.clientWidth",
    "minimumNewVideoPosters=mobileVideoMode?1:2",
    "requiredUniquePosters=mobileVideoMode?5:10",
    "data-xdrive-media-gallery-virtual-grid",
    "data-xdrive-media-tile",
    "photo",
    "physical_sources",
    "physical_bytes",
    "physical_verified",
    "posterPutBytes",
    "signedTickets",
    "coldPosterMisses",
    "warmPosterGets",
    "verifiedSelectedPosterIDs",
    "GALLERY_MOBILE_H264_100K_SUMMARY",
    "perViewDeadlineMs=25000",
    "maxMemGrowth=256*1024*1024",
    "rows.length===3&&all.length===15",
  ]) assert.ok(script.includes(s),'missing genuine P041 video + responsive viewport contract: '+s)
})
test('P041 native CI is branch-only and does not declare a simulated phone to be OS-installed PWA',()=>{
  for(const s of [
    "github.head_ref == 'perf/gallery-mobile-web-h264-posters-100k-p041-20261013'",
    "github.event.pull_request.head.sha",
    "XD_GALLERY_MOBILE_H264_POSTERS_100K_PERF: '1'",
    "VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1",
    "go test -c -o desktop/gallery-h264-web-go/api.test",
    "node --test desktop/tests/gallery-web-real-h264-posters-100k-source.cjs desktop/tests/gallery-mobile-web-h264-posters-100k-source.cjs",
    "xvfb-run -a",
    "actions/upload-artifact@v4",
  ]) assert.ok(workflow.includes(s),'missing source exact opt-in native CI contract: '+s)
  for(const doc of [registry,coverage,canonical]) assert.ok(doc.includes('P041'))
  assert.ok(script.includes('not physical phone/installed PWA'))
  assert.ok(coverage.includes('Not measured'))
})

test('P041 remains bounded while choosing genuinely visible narrow H264 tiles; warm probe revisits the same real scroll scope',()=>{
  for(const token of [
    "visibleVideoIndices",
    "nudgeMobileVideoScroll",
    "seekMobileRealVideoTile",
    "attempt<=10",
    "host.dispatchEvent(new Event('scroll'))",
    "perViewDeadlineMs-(performance.now()-began)",
    "restoreMobileGalleryScrollTop",
    "firstCapturedScrollTop",
    "selectedNodeIDs:selected.map(x=>x.nodeID)",
  ]) assert.ok(script.includes(token),'P041 invalid narrow source targeting: '+token)
})
