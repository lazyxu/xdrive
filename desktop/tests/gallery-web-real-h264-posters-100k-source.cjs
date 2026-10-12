'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=x=>fs.readFileSync(path.join(root,x),'utf8')
test('video poster opt-in extends actual production Web Gallery without altering default',()=>{
  const src=read('web/src/GalleryRealColdPerformanceHarness.tsx')
  const tags=['xdriveGalleryRealH264Poster','loadPreviewURL','saveVideoPoster',
    '/api/v1/files/','/preview-ticket','/api/v1/media/items/','/video-poster',
    "ticket.kind !== 'video'","poster.type !== 'image/jpeg'",
    "response.status !== 204","videoPosterStats.signedTickets++",
    "videoPosterStats.posterPuts++","videoPosterStats.warmPosterGets++",
    "videoNodeByLogicalIndex"]
  for(const tag of tags) assert.ok(src.includes(tag),'missing actual Web video-to-CAS evidence '+tag)
  assert.match(src,/\.\.\.\(physicalGalleryH264PosterBenchmark \? \{/)
})
test('real Gallery virtual Grid, physical CAS, H264 canvas cold PUT and warm reopen checked',()=>{
  const src=read('desktop/scripts/gallery-web-real-h264-posters-100k.cjs')
  for(const tag of ['fractions=[0,.25,.5,.75,.95]','perViewDeadlineMs=25000',
    'XD_GALLERY_WEB_PHYSICAL_MIXED_VIEWPORT_100K_PERF',
    'data-xdrive-media-gallery-virtual-grid','data-xdrive-media-tile',
    'videoNodeByLogicalIndex','savedPosterNodeIDs',
    'x.decode()','requestAnimationFrame','viewed.size>=10',
    'warmPosterGets>=2','posterPuts>=10','signedTickets>=10',
    'physical_sources','physical_bytes','physical_verified']){
    assert.ok(src.includes(tag),'missing authentic Web virtual Grid/capture assurance '+tag)
  }
  const workflow=read('.github/workflows/gallery-web-real-h264-posters-100k.yml')
  assert.ok(workflow.includes('github.event.pull_request.head.sha'))
  assert.ok(workflow.includes('VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1'))
  assert.ok(workflow.includes('go test -c -o desktop/gallery-h264-web-go/api.test'))
  assert.ok(workflow.includes('node --test desktop/tests/gallery-web-real-h264-posters-100k-source.cjs'))
})
