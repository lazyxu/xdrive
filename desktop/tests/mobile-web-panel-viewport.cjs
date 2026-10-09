const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8')
const filename = 'ui/shared/src/mui/useMobilePanelViewport.ts'
const javascript = ts.transpileModule(read(filename), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', 'require', javascript)(mod.exports, mod, () => ({}))
const { xDriveMobilePanelViewportMetrics: metrics } = mod.exports

test('visual viewport geometry respects keyboard covering the bottom of a mobile layout', () => {
  assert.deepEqual(metrics(800, null), { top: 0, height: 800, bottom: 0 })
  assert.deepEqual(metrics(800, { height: 300, offsetTop: 0 }), { top: 0, height: 300, bottom: 500 })
  assert.deepEqual(metrics(800, { height: 350, offsetTop: 40 }), { top: 40, height: 350, bottom: 410 })
  assert.deepEqual(metrics(400, { height: 200, offsetTop: 70 }), { top: 70, height: 200, bottom: 130 })
})

test('invalid or inconsistent visual geometry cannot create negative panel height', () => {
  assert.deepEqual(metrics(600, { height: NaN, offsetTop: NaN }), { top: 0, height: 600, bottom: 0 })
  assert.deepEqual(metrics(600, { height: 1500, offsetTop: -50 }), { top: 0, height: 600, bottom: 0 })
  assert.deepEqual(metrics(600, { height: 100, offsetTop: 1000 }), { top: 600, height: 0, bottom: 0 })
  assert.deepEqual(metrics(-10, null), { top: 0, height: 0, bottom: 0 })
})

test('a mobile panel observes and tears down visualViewport resize/scroll without modifying document viewport', () => {
  const source = read(filename)
  assert.match(source, /viewport\?\.addEventListener\('resize', update\)/)
  assert.match(source, /viewport\?\.addEventListener\('scroll', update\)/)
  assert.match(source, /viewport\?\.removeEventListener\('resize', update\)/)
  assert.match(source, /viewport\?\.removeEventListener\('scroll', update\)/)
  assert.doesNotMatch(source, /document\.documentElement\.style\s*=/)
  assert.doesNotMatch(source, /window\.scrollTo\(/)
})

test('Files/Gallery compact filter and navigation panels honor visible viewport and keep actions reachable', () => {
  const fileFilters = read('ui/shared/src/mui/FileExplorerSearchFilters.tsx')
  const explorer = read('ui/shared/src/mui/FileExplorer.tsx')
  const gallery = read('ui/shared/src/mui/MediaGalleryFilters.tsx')
  assert.match(fileFilters, /useXDriveMobilePanelViewport\(compactViewport && panelOpen\)/)
  assert.match(fileFilters, /panelViewport\.bottom/)
  assert.match(fileFilters, /data-xdrive-file-explorer-search-filters/)
  assert.match(explorer, /useXDriveMobilePanelViewport\(compactViewport && navigationDrawerOpen\)/)
  assert.match(explorer, /navigationViewport\.top/)
  assert.match(explorer, /data-xdrive-file-explorer-touch-navigation-drawer/)
  assert.match(gallery, /data-xdrive-gallery-mobile-filters/)
  assert.match(gallery, /data-xdrive-gallery-recent-search/, 'M11 must retain existing G05 recent search')
  assert.match(gallery, /compactScrollable=\{mobile\}/)
  assert.match(gallery, /position: 'sticky', bottom: 0/)
  assert.match(gallery, /overflowY: 'auto'/)
  assert.match(gallery, /aria-label="关闭图库筛选"/)
  assert.match(gallery, /triggerRef\.current\?\.focus\(\)/)
})
