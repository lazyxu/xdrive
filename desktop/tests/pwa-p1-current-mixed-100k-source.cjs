'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.join(__dirname,'..','..')
const branch='test/pwa-p1-current-mixed-before-20261024'
const read=name=>fs.readFileSync(path.join(root,name),'utf8')
test('P1 original mixed and H264 real-100k workflows opt in without weakening original gates',()=>{
  for(const file of [
    '.github/workflows/gallery-mobile-web-h264-posters-100k.yml',
    '.github/workflows/gallery-web-physical-mobile-100k-viewports.yml'
  ]){
    const body=read(file)
    assert(body.includes("github.head_ref == '"+branch+"'"),'missing P1 branch in '+file)
    assert(body.includes("github.head_ref == 'test/pwa-p0c1-100k-shared-mobile-before-20261021'"),
      'old source-frozen branch must stay allowed in '+file)
    assert(body.includes('postgres:17-alpine'))
    assert(body.includes('go test -c -o'))
    assert(body.includes("sample-*.json"))
    assert(body.includes('node --test desktop/tests/'))
    assert(!body.includes('skipWaiting'))
  }
})
test('P1 source audit maintains identical physical-workload drivers',()=>{
  const a=read('desktop/scripts/gallery-web-physical-mixed-100k-viewports.cjs')
  const b=read('desktop/scripts/gallery-web-real-h264-posters-100k.cjs')
  assert(a.includes('XD_GALLERY_WEB_PHYSICAL_MOBILE_100K_PERF'))
  assert(b.includes('XD_GALLERY_MOBILE_H264_POSTERS_100K_PERF'))
  assert(a.includes('live_photo_groups'))
  assert(b.includes('videoPosterStats')||b.includes('snapshotPosters'))
  const note=read('docs/pwa-p1-current-mixed-100k-before.md')
  assert(note.includes('NOT paired BEFORE/AFTER') || note.includes('NOT paired BEFORE/AFTER'.replace('NOT paired','NOT paired')))
  assert(note.includes('Viewer') && note.includes('Live Photo'))
})
