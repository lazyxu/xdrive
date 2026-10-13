'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs=require('node:fs'), path=require('node:path')
const root=path.resolve(__dirname,'../..'), read=p=>fs.readFileSync(path.join(root,p),'utf8')
const script=read('desktop/scripts/file-explorer-real-physical-100k-main.cjs')
const go=read('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const jpeg=read('internal/api/file_explorer_real_physical_jpeg_100k_performance_test.go')
const wf=read('.github/workflows/file-explorer-mobile-physical-jpeg-100k.yml')
test('P039 uses real 390px shared Mobile Web FileExplorer with the already accepted 100k physical JPEG CAS fixture',()=>{
 for(const token of ['XD_FILEEXPLORER_MOBILE_PHYSICAL_100K_PERF','mobileMode ? 390 : 1440',
 'document.documentElement.clientWidth',"matchMedia('(max-width: 899px)')",
 'requiredDecoded = mobileMode ? 4 : 6','fresh.length<requiredDecoded',
 'firstRequiredDecodedMs','minRequiredDecodedPerViewport:requiredDecoded',
 'p50GridFirstRequiredMs','p50DetailsFirstRequiredMs',
 "const views = ['grid','details']", '0,0.25,0.50,0.75,0.95'])
  assert(script.includes(token), token)
 assert(go.includes('seedFileExplorerDistinctPhysicalJPEG100K'))
 assert(jpeg.includes('jpeg.Decode(bytes.NewReader(decoded))'))
})
test('P039 is branch-scoped and never claims actual iOS/Android/PWA hardware',()=>{
 assert(wf.includes("github.head_ref == 'perf/file-explorer-mobile-physical-jpeg-100k-p039-20261012'"))
 assert(wf.includes("XD_FILEEXPLORER_MOBILE_PHYSICAL_100K_PERF: '1'"))
 assert(script.includes('NOT full Mobile Web App Frame or actual iOS Safari/Android Chrome hardware'))
 assert(read('docs/performance-test-registry.md').includes('| P039 |'))
 assert(read('docs/file-explorer-performance.md').includes('P039 / M002-c'))
})
