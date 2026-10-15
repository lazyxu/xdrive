'use strict'
const test=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'), path=require('node:path')
const root=path.resolve(__dirname,'../..'), read=p=>fs.readFileSync(path.join(root,p),'utf8')
const script=read('desktop/scripts/file-explorer-real-physical-100k-main.cjs')
const go=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const web=read('web/src/FileExplorerRealScrollPerformanceHarness.tsx')
const wf=read('.github/workflows/file-explorer-mobile-mixed-p049.yml')
test('P049 authentic 390px mounted shared Web Files 100k logical / 115k distinct real mixed JPEG H264 Live original CAS',()=>{
  for(const token of [
    'XD_FILEEXPLORER_MOBILE_MIXED_100K_PERF',
    'TestGalleryRealWebColdFixture100K',
    'XD_GALLERY_DESKTOP_FILES_MIXED_PHYSICAL_100K_PERF',
    'info.physical_nodes,115000','info.physical_sources,115000',
    'info.live_photo_groups,15000','info.physical_verified,12',
    "fraction===0?'liveMotion'","fraction===0.25?'liveStill'",
    "fraction===0.95?'video':'photo'",'state.decodedKinds?.[expectedKind]',
    'm.visibleKinds[m.expectedKind]>=m.requiredDecoded',
    "if(mixedMobileMode&&view==='grid')",
    'end.server_errors===0','memoryBudgetBytes','maxFirstSixMs',
    'mobileMode,mixedMobileMode,cssViewportWidth:mobileMode?390:1440',
    "['grid','details']",'0,0.25,0.50,0.75,0.95',
  ]) assert(script.includes(token),'missing real mixed P049 source: '+token)
  assert(go.includes('gallerySeedRealPhysicalMixed100K'))
  assert(go.includes('"folder_id":          folder.ID'))
  assert(web.includes('mixed100k'))
  for (const token of [
    "'/api/v1/files/' + item.id + '/preview-ticket'",
    "new Blob([original], { type: 'video/mp4' })",
    "video.addEventListener('loadeddata'",
    "ctx.drawImage(video",
    "'Content-Type': 'image/jpeg'",
    "method: 'PUT'",
    "mixedPosterStats.posterPuts++",
    "URL.revokeObjectURL(url)",
  ]) assert(web.includes(token), 'P049 must decode actual signed original and persist JPEG poster: ' + token)
  for(const token of ["mixedMobileMode?20000:40000","frameCount>=4&&posterPutCount>=4&&posterReadbackCount>=4",
    "posterStats:window.__xdriveFileExplorerMixedPosterStats"])
    assert(script.includes(token), 'P049 must measure real bounded viewport: '+token)
  assert(web.includes('XDriveFileExplorer')&&web.includes('virtualCollection={virtualCollection}'))
  assert(web.includes("node.name.startsWith('live-motion-')"))
  assert(web.includes('rangeAbortRef.current?.abort()'))
  assert(wf.includes("github.head_ref == 'perf/file-explorer-mobile-mixed-100k-p049-20261015'"))
})
test('P049 original-current-only first measurement does not claim true phones, installed PWA or Race',()=>{
  assert(script.includes('NOT Live Motion playback'))
  assert(script.includes('actual iOS/Android phone or OS installed PWA'))
  assert(read('docs/performance-test-registry.md').includes('P049 / M002-d'))
  assert(read('docs/file-explorer-performance.md').includes('P049 / M002-d'))
  assert(read('docs/performance-platform-coverage.md').includes('P049 / M002-d'))
  assert(!wf.includes('go test -race'))
})
