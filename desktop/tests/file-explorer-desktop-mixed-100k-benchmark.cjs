'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const go = read('internal/api/gallery_real_web_cold_performance_integration_test.go')
const source = read('internal/api/gallery_physical_mixed_first_visible_100k_performance_test.go')
const runner = read('desktop/scripts/file-explorer-desktop-mixed-100k-runner.cjs')
const electron = read('desktop/scripts/file-explorer-desktop-mixed-100k-electron-main.cjs')
const workflow = read('.github/workflows/file-explorer-desktop-mixed-100k-performance.yml')
test('P038 production Gin/CAS fixture reuses 115k physical sources and Desktop boot without new production route', () => {
  for (const phrase of ['XD_GALLERY_DESKTOP_FILES_MIXED_PHYSICAL_100K_PERF',
    'gallerySeedRealPhysicalMixed100K', 'fileExplorerPhysicalCapacityStore',
    'meta.FileOperation{}', 'meta.NodeChange{}', '/api/v1/me/quota'])
    assert(go.includes(phrase), 'missing Go native fixture contract: ' + phrase)
  for (const phrase of ['fileExplorerH264PhysicalContainer', 'fileExplorerPhysicalJPEG',
    'report.PhysicalSources != mediaGalleryFirstOpenPhysical',
    'counts.MotionPairs != mediaGalleryFirstOpenLivePhotos'])
    assert(source.includes(phrase), 'missing existing original-CAS verification: ' + phrase)
  for (const phrase of ['TestGalleryRealWebColdFixture100K', 'ready.physical_nodes, 115000',
    'ready.logical_assets, 100000', 'ready.physical_sources, 115000',
    'ready.live_photo_groups, 15000', 'ready.physical_verified, 12',
    'new AgentIPCClient(discover)', 'XD_GALLERY_DESKTOP_FILES_MIXED_PHYSICAL_100K_PERF'])
    assert(runner.includes(phrase), 'missing real native runner input: ' + phrase)
})
test('P038 actual Electron FileExplorer Grid/Details exercises five type-specific decoded windows', () => {
  for (const phrase of ["require('../dist/main/index.cjs')", 'browser-window-created',
    '100k Browser Cold Gallery', '115000 个项目', 'data-xdrive-file-explorer-scroll-host',
    'fractions = [0, .25, .5, .75, .95]', 'fraction === .95', "'liveMotion'",
    "'liveStill'", 'current.decodedKinds[expectedKind] < minimumDecoded',
    'current.visibleKinds[expectedKind] < minimumDecoded',
    'x.firstExpectedDecodedMs <= 20000', 'growth <= 268435456',
    'result.nonCanceled5xx === 0', 'result.http5xxTotal === result.http5xxCanceled',
    'result.maxGoConcurrent <= 6'])
    assert(electron.includes(phrase), 'missing mounted decoded viewport contract: ' + phrase)
  assert(!electron.includes('physicalDistinctJPEGCAS: 100000'), 'not homogeneous JPEG 100k')
  const probe = read('internal/api/file_explorer_real_physical_jpeg_100k_performance_test.go')
  for (const phrase of ['http_5xx_total', 'http_5xx_canceled',
    'TestFileExplorerPhysicalProbeCanceled5xxAttribution',
    'p.http5xxTotal.Add(1)', 'p.http5xxCanceled.Add(1)', 'p.serverErrors.Add(1)'])
    assert(probe.includes(phrase), 'probe must preserve raw 5xx and cancellation attribution: ' + phrase)
})
test('P038 only runs in its exact CI branch; registry/canonical pending status is explicit', () => {
  assert(workflow.includes("github.head_ref == 'perf/file-explorer-desktop-mixed-100k-p038-20261012'"))
  assert(workflow.includes('file-explorer-desktop-mixed-100k-runner.cjs'))
  assert(read('docs/performance-test-registry.md').includes('| P038 |'))
  assert(read('docs/file-explorer-performance.md').includes('P038 / M002-b1'))
})
