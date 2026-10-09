const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer
const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const sourcePath = 'ui/shared/src/mui/MobileGalleryChrome.tsx'
const compiled = ts.transpileModule(read(sourcePath), {
  fileName: path.join(root, sourcePath),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  },
}).outputText
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': Object.fromEntries([
    'Autocomplete','Box','Button','Drawer','IconButton','Menu','MenuItem',
    'Slider','Stack','TextField','Typography',
  ].map(x => [x, x.toLowerCase()])),
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  './MediaGalleryNavigation': {
    XDriveMediaGalleryNavigation: 'gallery-navigation',
  },
  '../media-timezone': { xDriveMediaTimeZoneChoices: () => ['UTC', 'Asia/Singapore'] },
}
for (const name of [
  '@mui/icons-material/ArrowBackRounded',
  '@mui/icons-material/FilterAltOutlined',
  '@mui/icons-material/MoreHorizRounded',
  '@mui/icons-material/SearchRounded',
  '@mui/icons-material/SortRounded',
]) mocks[name] = 'icon'
const moduleUnderTest = { exports: {} }
new Function('exports','module','require',compiled)(
  moduleUnderTest.exports, moduleUnderTest,
  name => {
    if (!(name in mocks)) throw Error('Unexpected import: ' + name)
    return mocks[name]
  },
)
const MobileChrome = moduleUnderTest.exports.XDriveMobileGalleryChrome
const props = (overrides = {}) => ({
  section: 'library',
  collectionTitle: '所有照片',
  canGoBack: true,
  onGoBack: () => {},
  showCollection: true,
  selectionMode: false,
  onToggleSelection: () => {},
  sortBy: 'captured',
  sortDir: 'asc',
  onSort: () => {},
  filterContent: 'REUSED_GALLERY_FILTERS',
  timeScale: 'all',
  onTimeScale: () => {},
  timeZone: 'Asia/Singapore',
  aspectMode: 'crop',
  onAspectModeChange: () => {},
  density: 124,
  densityMin: 80,
  densityMax: 240,
  densityStep: 8,
  onDensityChange: () => {},
  ...overrides,
})
const find = (view, key) => view.root.findAll(x =>
  x.props && x.props[key] !== undefined,
)[0]
const button = (view, label) => view.root.findAll(x =>
  ['button','iconbutton'].includes(x.type) && x.props['aria-label'] === label,
)[0]

test('P0-A mobile gallery has its own four actions and three bottom groups, not another app switch', async () => {
  let view
  await act(async () => { view = renderer.create(React.createElement(MobileChrome, props())) })
  assert.ok(find(view, 'data-xdrive-mobile-gallery-actions'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-bottom'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-select'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-sort'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-filter'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-more'))
  for (const scale of ['year', 'month', 'day', 'all']) {
    assert.ok(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-scale'] === scale).length)
  }
  assert.ok(find(view, 'data-xdrive-mobile-gallery-category'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-search'))
  assert.doesNotMatch(read(sourcePath), /<XDriveMobileAppHeader|onOpenApps\s*=/)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-app-header']).length, 0)
  await act(async () => { view.unmount() })
})

test('P0-A Gallery parent Back, selection, category and sorting call distinct controls', async () => {
  let backs = 0, selected = 0, category = '', sort = [], timeScale = ''
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      onGoBack: () => { backs++ },
      onToggleSelection: () => { selected++ },
      onSectionChange: value => { category = value },
      onSort: (by, dir) => { sort.push([by,dir]) },
      onTimeScale: scale => { timeScale = scale },
    })))
  })
  await act(async () => { button(view,'图库内部返回上一级').props.onClick() })
  assert.equal(backs, 1)
  await act(async () => { find(view,'data-xdrive-mobile-gallery-select').props.onClick() })
  assert.equal(selected, 1)
  await act(async () => { find(view,'data-xdrive-mobile-gallery-category').props.onClick() })
  const nav = view.root.findAll(x => x.type === 'gallery-navigation')[0]
  assert.equal(nav.props.layout,'drawer')
  await act(async () => { nav.props.onChange('albums') })
  assert.equal(category,'albums')
  await act(async () => { find(view,'data-xdrive-mobile-gallery-sort').props.onClick({ currentTarget: {} }) })
  const option = view.root.findAll(x => x.type === 'menuitem' && x.props.children === '加入时间 · 最新在前')[0]
  await act(async () => { option.props.onClick() })
  assert.deepEqual(sort,[['added','desc']])
  const scale = view.root.findAll(x => x.props['data-xdrive-mobile-gallery-scale'] === 'month')[0]
  await act(async () => { scale.props.onClick() })
  assert.equal(timeScale,'month')
  await act(async () => { view.unmount() })
})

test('P0-A selecting media hides browsing bottom dock, not the global app header', async () => {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({ selectionMode: true })))
  })
  assert.equal(view.root.findAll(x => x.props['data-xdrive-mobile-gallery-bottom']).length,0)
  assert.ok(find(view,'data-xdrive-mobile-gallery-actions'))
  await act(async () => { view.unmount() })
})

test('P0-A no duplicate inline toolbar and filters become embedded in mobile sheet', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const filter = read('ui/shared/src/mui/MediaGalleryFilters.tsx')
  const navigation = read('ui/shared/src/mui/MediaGalleryNavigation.tsx')
  const selection = read('ui/shared/src/mui/MediaGallerySelectionToolbar.tsx')
  assert.match(gallery, /<XDriveMobileGalleryChrome/)
  assert.match(gallery, /data-xdrive-gallery-header/)
  assert.match(gallery, /data-xdrive-gallery-toolbar/)
  assert.ok((gallery.match(/sx=\{\{ display: compactGallery \? 'none' : 'flex' \}\}/g) || []).length >= 3,
    'mobile Gallery hides its desktop header, toolbar and feedback strip')
  assert.match(gallery, /mobileEmbedded=\{mobileWebChrome\}/)
  assert.match(gallery, /const compactGallery = useMediaQuery\([^\n]+ && mobileWebChrome/)
  assert.match(read('web/src/App.tsx'), /<XDriveMediaGalleryPage[\s\S]*?mobileWebChrome/)
  assert.match(filter, /mobileEmbedded && compactViewport/)
  assert.match(navigation, /layout === 'drawer'/)
  assert.match(selection, /position: compactViewport && mobileBottomDock \? 'fixed' : 'sticky'/)
  const appHeader = read('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(appHeader, /data-xdrive-mobile-app-header/)
  assert.ok(appHeader.includes("minHeight: 'calc(52px + env(safe-area-inset-top))'"))
})
