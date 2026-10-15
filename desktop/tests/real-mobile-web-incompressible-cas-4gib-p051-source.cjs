'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const launcher=read('desktop/scripts/large-transfer-real-web-cas-main.cjs')
const runner=read('desktop/scripts/real-web-cas-transfer-runner.cjs')
const browser=read('web/src/LargeTransferPerformanceHarness.tsx')
const verifier=read('web/src/realCasIncompressibleReadback.ts')
const workflow=read('.github/workflows/real-mobile-web-cas-incompressible-4gib-p051.yml')
const docs=['docs/performance-test-registry.md','docs/performance-platform-coverage.md','docs/file-explorer-performance.md'].map(read)

test('P051 actual Chromium 390px document and breakpoint are directly observed, not inferred from outer window',()=>{
  for(const marker of [
    "XD_REAL_WEB_CAS_MOBILE_VIEWPORT === '1'",
    'width: mobileWebViewport ? 390 : 1280',
    'height: mobileWebViewport ? 844 : 800',
    'document.documentElement.clientWidth',
    "matchMedia('(max-width: 899.95px)').matches",
    'mobileViewportEvidence.innerWidth < 360',
    'mobileViewportEvidence.documentWidth > 390',
    "surface: mobileWebViewport ? 'mobile-web-chromium-390px' : 'web'",
  ])assert(launcher.includes(marker),marker)
  for(const marker of ['result.mobileViewportEvidence',
    "assert.equal(result.surface,'mobile-web-chromium-390px')",
    'viewport.mobileBreakpoint===true','viewport.documentWidth<=390',
    "platformMode:mobileWebViewport?'mobile-web-chromium-390px':'wide-web-chromium'"])
    assert(runner.includes(marker),marker)
})

test('P051 retains original real 4GiB high entropy source, n3 Gin+PG+CAS, 512 signed PUT and full OPFS bytes',()=>{
  assert(workflow.includes("github.head_ref == 'perf/mobile-web-incompressible-cas-4gib-p051-20261016'"))
  for(const marker of [
    "XD_REAL_WEB_CAS_MOBILE_VIEWPORT: '1'",
    "XD_REAL_CAS_INCOMPRESSIBLE_PERF: '1'",
    "XD_REAL_CAS_SIZE_GIB: '4'",
    'github.event.pull_request.head.sha',
    'VITE_XDRIVE_LARGE_TRANSFER_PERF=1',
    'xvfb-run -a','s.mobileWebViewport===true',
    's.bytesPerDirection===4294967296',
    'x.nativeServer.put_count===512',
    'x.download.downloadDeterministicVerifiedBytes===4294967296',
    'sourceHashes.size===3','actions/upload-artifact@v4',
  ])assert(workflow.includes(marker),marker)
  assert(!workflow.includes('XD_PWA_FULL_OPFS_READBACK'))
  assert(runner.includes('const trials = fullPwaReadback ? 1 : 3'))
  assert(runner.includes('assert(free>=required'))
  assert(launcher.includes('fs.fsyncSync(fd)') && launcher.includes("createCipheriv('aes-256-ctr'"))
  assert(browser.includes('xDriveVerifyDeterministicHighEntropyOPFS'))
  assert(verifier.includes('maxChunk = 1024 * 1024'))
})

test('P051 registered as distinct platform, not Android/iOS/installed PWA acceptance',()=>{
  for(const doc of docs)assert(doc.includes('P051') && doc.includes('Not measured'))
  const matrix=docs[1]
  for(const col of ['Native Desktop','Wide Web','Mobile Web','Android installed PWA','iOS installed PWA'])
    assert(matrix.includes(col),col)
})
