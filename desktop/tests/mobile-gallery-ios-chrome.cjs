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
  primaryTab: 'library',
  onPrimaryTabChange: () => {},
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

test('iOS 27 Mobile Gallery keeps top actions and gives Library/Collections separate bottom tabs', async () => {
  let view
  await act(async () => { view = renderer.create(React.createElement(MobileChrome, props())) })
  assert.ok(find(view, 'data-xdrive-mobile-gallery-actions'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-bottom'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-primary-tabs'))
  assert.ok(find(view, 'data-xdrive-mobile-gallery-select'))
  const combined = find(view, 'data-xdrive-mobile-gallery-sort-filter')
  assert.ok(combined, 'native-style sort/filter shares a single header action')
  assert.equal(combined.props['aria-label'], '图库排序和筛选')
  assert.equal(view.root.findAll(x => x.props?.['aria-label'] === '图库筛选').length, 0)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-filter').type, 'menuitem')
  assert.ok(find(view, 'data-xdrive-mobile-gallery-more'))
  assert.deepEqual(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-tab'])
    .map(x => x.props['data-xdrive-mobile-gallery-tab']), ['library', 'collections'])
  for (const scale of ['year', 'month', 'all']) {
    assert.ok(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-scale'] === scale).length)
  }
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-scale'] === 'day').length,0)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-category']).length,0)
  assert.ok(find(view, 'data-xdrive-mobile-gallery-search'))
  assert.doesNotMatch(read(sourcePath), /<XDriveMobileAppHeader|onOpenApps\s*=/)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-app-header']).length,0)
  await act(async () => { view.unmount() })
})

test('iOS 27 Mobile Gallery tab, back, sort and scale own independent callbacks', async () => {
  let backs=0, selected=0, tab='', sort=[], timeScale=''
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      onGoBack: () => { backs++ }, onToggleSelection: () => { selected++ },
      onPrimaryTabChange: (next) => { tab=next },
      onSort: (by,dir) => { sort.push([by,dir]) },
      onTimeScale: (scale) => { timeScale=scale },
    })))
  })
  await act(async () => { button(view,'图库内部返回上一级').props.onClick() })
  assert.equal(backs,1)
  await act(async () => { find(view,'data-xdrive-mobile-gallery-select').props.onClick() })
  assert.equal(selected,1)
  const collections = view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-tab'] === 'collections')[0]
  await act(async () => { collections.props.onClick() })
  assert.equal(tab,'collections')
  await act(async () => { find(view,'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} }) })
  const option=view.root.findAll(x => x.type === 'menuitem' && x.props.children === '加入时间 · 最新在前')[0]
  await act(async () => { option.props.onClick() })
  assert.deepEqual(sort,[['added','desc']])
  await act(async () => { find(view,'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} }) })
  await act(async () => { find(view,'data-xdrive-mobile-gallery-filter').props.onClick() })
  const filterDrawer = view.root.findAll(x => x.type === 'drawer' && x.props.open)[0]
  assert.ok(filterDrawer, 'the same sort/filter menu must open existing Web filters')
  assert.equal(find(view,'data-xdrive-mobile-gallery-filter-panel').props.children, 'REUSED_GALLERY_FILTERS')
  await act(async () => { filterDrawer.props.onClose() })
  const month=view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-scale'] === 'month')[0]
  await act(async () => { month.props.onClick() })
  assert.equal(timeScale,'month')
  await act(async () => { find(view,'data-xdrive-mobile-gallery-more').props.onClick() })
  await act(async () => { find(view,'data-xdrive-mobile-gallery-day-mode').props.onClick() })
  assert.equal(timeScale,'day')
  await act(async () => { view.unmount() })
})

test('iOS 27 Search opens the shared filter without creating a second query engine', async () => {
  let searches = 0
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      primaryTab: 'collections', showCollection: false,
      onSearchRequested: () => { searches++ },
    })))
  })
  await act(async () => { find(view,'data-xdrive-mobile-gallery-search').props.onClick() })
  assert.equal(searches,1)
  assert.ok(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-tab'] === 'collections').length)
  const drawer=view.root.findAll(x => x.type === 'drawer' && x.props.open === true)
  assert.equal(drawer.length,1)
  assert.ok(find(view,'data-xdrive-mobile-gallery-filter-panel'))
  assert.match(read('ui/shared/src/mui/MediaGallery.tsx'), /if \(mobileCollectionsOverview\)/)
  assert.match(read('ui/shared/src/mui/MediaGallery.tsx'), /warmMobileCollectionsPreview\(\)/)
  await act(async () => { view.unmount() })
})

test('iOS 27 Collections overview omits Library scale/actions and selection hides bottom dock', async () => {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      primaryTab: 'collections', canGoBack: false, showCollection: false,
    })))
  })
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-time-scale']).length,0)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-select']).length,0)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-more']).length,0)
  const collections=view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-tab'] === 'collections')[0]
  assert.equal(collections.props['aria-selected'],true)
  await act(async () => { view.unmount() })
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({ selectionMode: true })))
  })
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-bottom']).length,0)
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
  assert.match(navigation, /export type MediaGallerySection/)
  assert.match(gallery, /XDriveMobileGalleryCollections/)
  assert.match(selection, /position: compactViewport && mobileBottomDock \? 'fixed' : 'sticky'/)
  const appHeader = read('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(appHeader, /data-xdrive-mobile-app-header/)
  assert.ok(appHeader.includes("minHeight: 'calc(52px + env(safe-area-inset-top))'"))
})

// iOS 27 Photos also exposes Zoom In/Zoom Out in View Options.
// These commands adjust the exact same per-scale column preference as pinch
// and the slider; mobile navigation must not introduce another query engine.
test('iOS 27 View Options zoom commands reuse the shared column change callback and bounds', async () => {
  const changed = []
  const onDensityChange = (value) => changed.push(value)
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      density: 3, densityMin: 2, densityMax: 10, densityStep: 1,
      onDensityChange,
    })))
  })
  await act(async () => { find(view, 'data-xdrive-mobile-gallery-more').props.onClick() })
  const drawer = view.root.findAll(x => x.type === 'drawer' && x.props.open === true)
  assert.equal(drawer.length, 1)
  const zoom = find(view, 'data-xdrive-mobile-gallery-view-zoom')
  assert.ok(zoom)
  const zoomIn = find(view, 'data-xdrive-mobile-gallery-zoom-in')
  const zoomOut = find(view, 'data-xdrive-mobile-gallery-zoom-out')
  assert.equal(zoomIn.type, 'button')
  assert.equal(zoomOut.type, 'button')
  assert.equal(zoomIn.props['aria-label'], '放大照片缩略图')
  assert.equal(zoomOut.props['aria-label'], '缩小照片缩略图')
  for (const control of [zoomIn, zoomOut]) {
    assert.equal(control.props.sx.minHeight, 44)
    assert.equal(control.props.disabled, false)
  }
  await act(async () => { zoomIn.props.onClick(); zoomOut.props.onClick() })
  assert.deepEqual(changed, [2, 4])

  await act(async () => {
    view.update(React.createElement(MobileChrome, props({
      density: 2, densityMin: 2, densityMax: 10, densityStep: 1,
      onDensityChange,
    })))
  })
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-in').props.disabled, true)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-out').props.disabled, false)

  await act(async () => {
    view.update(React.createElement(MobileChrome, props({
      density: 10, densityMin: 2, densityMax: 10, densityStep: 1,
      onDensityChange,
    })))
  })
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-in').props.disabled, false)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-out').props.disabled, true)
  await act(async () => { view.unmount() })
})

test('Collections overview does not expose the Library zoom controls', async () => {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(MobileChrome, props({
      primaryTab: 'collections', showCollection: false, canGoBack: false,
    })))
  })
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-view-zoom']).length, 0)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-zoom-in']).length, 0)
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-zoom-out']).length, 0)
  await act(async () => { view.unmount() })
})

test('Zoom uses the existing shared Gallery columns, not a mobile-specific media API', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(gallery, /onDensityChange=\{updateGalleryDensity\}/)
  assert.match(gallery, /minColumns=\{compactGallery \? mobileColumns : undefined\}/)
  assert.match(read(sourcePath), /Math\.max\(densityMin, density - densityStep\)/)
  assert.match(read(sourcePath), /Math\.min\(densityMax, density \+ densityStep\)/)
  assert.doesNotMatch(read(sourcePath), /<XDriveMobileAppHeader|fetch\(/)
})
