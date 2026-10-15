'use strict'
const test=require('node:test'), assert=require('node:assert/strict')
const fs=require('node:fs'), path=require('node:path')
const root=path.resolve(__dirname,'../..'), read=p=>fs.readFileSync(path.join(root,p),'utf8')
const driver=read('desktop/scripts/file-explorer-wide-mixed-100k-main.cjs')
const go=read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const sharedWeb=read('web/src/FileExplorerRealScrollPerformanceHarness.tsx')
const workflow=read('.github/workflows/file-explorer-wide-mixed-p050.yml')
test('P050 runs original shared wide Web FileExplorer against 100k logical and 115k distinct real JPEG H264 Live CAS',()=>{
  for(const token of [
    "XD_FILEEXPLORER_WIDE_MIXED_100K_PERF === '1'",
    "const mobileMode = false","const requiredDecoded = 6",
    "TestGalleryRealWebColdFixture100K",
    "XD_GALLERY_DESKTOP_FILES_MIXED_PHYSICAL_100K_PERF",
    "info.physical_nodes,115000","info.physical_sources,115000",
    "info.live_photo_groups,15000","info.physical_verified,12",
    "const views = ['grid','details']","0,0.25,0.50,0.75,0.95",
    "fraction===0?'liveMotion'","fraction===0.25?'liveStill'",
    "fraction===0.95?'video':'photo'",
    "state.decodedKinds?.[expectedKind]",
    "m.visibleKinds[m.expectedKind]>=m.requiredDecoded",
    "m.viewportWidth>=1400&&m.viewportWidth<=1440",
    "const maxFirstSixMs = 20000","const memoryBudgetBytes = 256*1024*1024",
    "end.max_active<=6","end.server_errors===0",
    "if(wideMixedMode&&view==='grid')",
    "frameCount>=4&&posterPutCount>=4&&posterReadbackCount>=4",
    "mobileMode,wideMixedMode,cssViewportWidth:1440",
    "wideMixedMode,cssViewportWidth:1440",
    "nonCanceled5xx",
  ])assert(driver.includes(token), 'P050 missing authentic native contract: '+token)
  assert(go.includes('gallerySeedRealPhysicalMixed100K'))
  assert(go.includes('"folder_id":          folder.ID'))
  assert(sharedWeb.includes('XDriveFileExplorer'))
  assert(sharedWeb.includes('virtualCollection={virtualCollection}'))
  assert(sharedWeb.includes('xdriveFileExplorerMixed100k'))
  assert(sharedWeb.includes("'Content-Type': 'image/jpeg'"))
  assert(sharedWeb.includes("video.addEventListener('loadeddata'"))
  assert(sharedWeb.includes("ctx.drawImage(video"))
  assert(sharedWeb.includes('rangeAbortRef.current?.abort()'))
})
test('P050 isolates own branch and preserves original P049/P039/Durable Task and Race scopes',()=>{
  assert(workflow.includes("github.head_ref == 'perf/file-explorer-wide-mixed-100k-p050-20261015'"))
  assert(workflow.includes("s.cssViewportWidth!==1440"))
  assert(workflow.includes("s.mobileMode||!s.wideMixedMode"))
  assert(!workflow.includes('go test -race'))
  assert(driver.includes('not OS-installed Chrome/Edge PWA or actual iOS/Android hardware'))
  assert(read('desktop/scripts/file-explorer-real-physical-100k-main.cjs')
    .includes('XD_FILEEXPLORER_MOBILE_MIXED_100K_PERF'))
  assert(read('docs/performance-test-registry.md').includes('P050 / M002-e'))
  assert(read('docs/file-explorer-performance.md').includes('P050 / M002-e'))
  assert(read('docs/performance-platform-coverage.md').includes('P050 / M002-e'))
})
