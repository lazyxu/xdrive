const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const entry = read('desktop/scripts/file-explorer-desktop-physical-100k-electron-main.cjs')
const runner = read('desktop/scripts/file-explorer-desktop-physical-100k-runner.cjs')
const workflow = read('.github/workflows/file-explorer-desktop-physical-jpeg-100k-performance.yml')
const goFixture = read('internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go')
const goJPEG = read('internal/api/file_explorer_real_physical_jpeg_100k_performance_test.go')
const productionFiles = read('desktop/src/renderer/DesktopFileExplorer.tsx')
const productionAgent = read('desktop/src/main/agent_client.cts')
const registry = read('docs/performance-test-registry.md')
const canonical = read('docs/file-explorer-performance.md')

test('P035/M002-a uses the real production Desktop Main, preload and FileExplorer virtual DOM', () => {
  for (const phrase of [
    "require('../dist/main/index.cjs')",
    "browser-window-created",
    "nav[aria-label=",
    "xdrive.desktop.files.view_mode",
    "100k Images",
    "new MouseEvent('dblclick'",
    "data-xdrive-file-explorer-scroll-host",
    "data-xdrive-file-explorer-item-visual",
    "img.complete && img.naturalWidth",
    "fractions = [0, .25, .5, .75, .95]",
    "productionDesktop: true",
    "physicalDistinctJPEGCAS: 100000",
  ]) assert.ok(entry.includes(phrase), 'authentic Desktop viewport contract missing: ' + phrase)
  assert.ok(productionFiles.includes('window.xdriveDesktop.agent.getMediaThumbnail('))
  assert.ok(productionAgent.includes('cloudChildrenRange('))
})

test('existing fixture actually stores 100k unique decodable physical JPEG source CAS objects', () => {
  for (const phrase of [
    'XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF',
    'seedFileExplorerDistinctPhysicalJPEG100K',
    'physical_source_bytes',
    'file_explorer_real_scroll_variants',
    '/api/v1/media/items/',
  ]) assert.ok(goFixture.includes(phrase), 'physical fixture path missing: ' + phrase)
  assert.ok(goJPEG.includes('jpeg.Decode(bytes.NewReader(decoded))'))
  assert.ok(goJPEG.includes('if len(seen) != count'))
  assert.ok(goJPEG.includes('store.Put(context.Background(), key, bytes.NewReader(data))'))
  assert.ok(runner.includes('ready.physical_images, 100000'))
  assert.ok(runner.includes('new AgentIPCClient(discover)'))
  assert.ok(runner.includes("username: 'file-explorer-real-scroll-perf'"))
})

test('original CURRENT threshold and process resource gates are frozen before native execution', () => {
  for (const phrase of [
    'x.firstSixDecodedMs <= 20000',
    'growth <= 268435456',
    'result.maxGoConcurrent <= 6',
    'rows.length === 5',
    'goThumbnailRequests > 0',
  ]) assert.ok(entry.includes(phrase), 'original viewport budget missing: ' + phrase)
  for (const phrase of [
    'sample <= 3',
    "['grid', 'details']",
    'agentRssGrowthBytes <= 268435456',
    'goRssGrowthBytes <= 268435456',
    'XD_FILEEXPLORER_DESKTOP_PHYSICAL_100K_PERF',
    "status: 'CURRENT baseline only, no production optimization, AFTER=N/A'",
  ]) assert.ok(runner.includes(phrase), 'native 3-sample correctness/memory budget missing: ' + phrase)
  assert.ok(workflow.includes("github.head_ref == 'perf/file-explorer-desktop-physical-jpeg-100k-20261012'"))
  assert.ok(workflow.includes('go build -o "$XD_FILEEXPLORER_DESKTOP_AGENT_BINARY" ./cmd/xdrive-agent'))
  assert.ok(registry.includes('| P035 |'))
  assert.ok(registry.includes('M002-a'))
  assert.ok(canonical.includes('P035 / M002-a'))
})

test('bench is native and opt-in rather than a required global CI or a mocked FileExplorer', () => {
  assert.ok(workflow.includes('pull_request:'))
  assert.ok(workflow.includes('ref: ${{ github.event.pull_request.head.sha }}'))
  assert.ok(workflow.includes('xvfb-run'))
  assert.ok(workflow.includes('postgres:17-alpine'))
  assert.ok(workflow.includes('go test -c -o "$XD_FILEEXPLORER_DESKTOP_API_BINARY"'))
  assert.ok(workflow.includes('node desktop/scripts/file-explorer-desktop-physical-100k-runner.cjs'))
  assert.equal(entry.includes('jest.mock'), false)
  assert.equal(entry.includes('MockAgent'), false)
})


test('P035 physical Desktop fixture migrates all observed shell dependencies and diagnoses real navigation failures', () => {
  for (const model of [
    'meta.Source{}', 'meta.NodeChange{}', 'meta.FileRecentAccess{}',
    'meta.FileFavorite{}', 'meta.FileQuickAccess{}', 'meta.FileOperation{}',
    'meta.FileVersion{}', 'meta.FileSavedSearch{}', 'meta.FileTag{}',
    'meta.PhotoIntelligenceReanalyzeIntent{}', 'meta.UploadSession{}',
    'meta.BackgroundOwnerCancellation{}', 'meta.SyncRun{}',
    'meta.ArchivePrepareRun{}',
  ]) assert.ok(goFixture.includes(model), 'native Desktop fixture model omitted: ' + model)
  assert.ok(entry.includes('FILEEXPLORER_DESKTOP_PHYSICAL_100K_NAV_DIAGNOSTIC'))
  assert.ok(entry.includes('fileExplorerMounted:'))
  assert.ok(goFixture.includes('type fileExplorerPhysicalCapacityStore struct'))
  assert.ok(goFixture.includes('s.local.Capacity(ctx)'))
  assert.ok(goFixture.includes('Store: serverStore'))
  for (const route of ['/api/v1/me/quota', '/api/v1/background-tasks/active-summary',
    '/api/v1/background-tasks/page?limit=10']) {
    assert.ok(goFixture.includes(route), 'native Desktop shell prerequisite missing: ' + route)
  }
})

test('native wide Desktop mode gate matches the actual shared FileExplorer labels, not compact Web 网格', () => {
  const sharedExplorer = read('ui/shared/src/mui/FileExplorer.tsx')
  assert.ok(sharedExplorer.includes("`图标 · ${fileExplorerGridSizeStatusLabel[viewPreferences.gridSize]}`"))
  assert.ok(sharedExplorer.includes("`详细信息 · ${viewPreferences.detailsDensity === 'compact' ? '紧凑' : '标准'}`"))
  assert.ok(entry.includes("const expectMode = view === 'grid' ? '当前视图：图标 · ' : '当前视图：详细信息 · '"))
  assert.ok(entry.includes('state.viewText.startsWith(expectMode)'))
  assert.equal(entry.includes("view === 'grid' ? '网格' : '详细信息'"), false)
});

test('P035 switches each real Desktop Grid/Details session via the production view menu', () => {
  const sharedExplorer = read('ui/shared/src/mui/FileExplorer.tsx')
  assert.ok(sharedExplorer.includes('data-xdrive-file-explorer-command-bar'))
  assert.ok(sharedExplorer.includes('aria-haspopup="menu"'))
  assert.ok(sharedExplorer.includes('chooseDetailsDensity('))
  assert.ok(sharedExplorer.includes('chooseGridSize('))
  assert.ok(entry.includes('function openLayoutMenu()'))
  assert.ok(entry.includes("bar?.querySelectorAll('button[aria-haspopup=\"menu\"]')"))
  assert.ok(entry.includes("node.textContent?.trim() === '视图'"))
  assert.ok(entry.includes("mode === 'details' ? '详细信息' : '中图标'"))
  assert.ok(entry.includes("document.querySelectorAll('[role=\"menuitem\"]')"))
  assert.ok(entry.includes("execute(win, openLayoutMenu)"))
  assert.ok(entry.includes("execute(win, selectLayoutFromMenu, view)"))
  assert.ok(entry.includes('state.viewText.startsWith(expectMode)'))
})
