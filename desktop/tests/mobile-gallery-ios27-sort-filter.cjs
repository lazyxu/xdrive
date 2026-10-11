const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const chromePath = 'ui/shared/src/mui/MobileGalleryChrome.tsx'
const compiled = ts.transpileModule(read(chromePath), {
  fileName: chromePath,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const mui = Object.fromEntries([
  'Autocomplete', 'Box', 'Button', 'Drawer', 'IconButton', 'Menu',
  'MenuItem', 'Slider', 'Stack', 'TextField', 'Typography',
].map(name => [name, name.toLowerCase()]))
const modules = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  '@mui/icons-material/ArrowBackRounded': 'icon',
  '@mui/icons-material/MoreHorizRounded': 'icon',
  '@mui/icons-material/SearchRounded': 'icon',
  '@mui/icons-material/SortRounded': 'icon',
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
  '../media-timezone': { xDriveMediaTimeZoneChoices: () => [] },
}
const loaded = { exports: {} }
new Function('exports', 'module', 'require', compiled)(
  loaded.exports, loaded, name => {
    if (!(name in modules)) throw Error('Unexpected module ' + name)
    return modules[name]
  },
)
const Chrome = loaded.exports.XDriveMobileGalleryChrome
const baseProps = {
  primaryTab: 'library', onPrimaryTabChange: () => {}, collectionTitle: '照片',
  canGoBack: false, showCollection: true, selectionMode: false,
  onToggleSelection: () => {}, sortBy: 'captured', sortDir: 'desc',
  canSort: true, onSort: () => {}, showTimeScale: true,
  timeScale: 'all', onTimeScale: () => {},
  timeZone: 'Asia/Shanghai', aspectMode: 'crop', onAspectModeChange: () => {},
  density: 3, densityMin: 2, densityMax: 10, densityStep: 1,
  onDensityChange: () => {},
}
const byData = (view, key) => view.root.findAll(x => x.props?.[key] !== undefined)
const sortMenu = view => view.root.findAll(x => x.type === 'menu'
  && x.props['aria-label'] === '图库排序和筛选')[0]
const searchDrawer = view => view.root.findAll(x => x.type === 'drawer'
  && x.props.anchor === 'bottom')[0]
test('P0-3g unified menu retains all four sorts and original shared filter form', async () => {
  const sorts = []
  const sharedFilter = React.createElement('section', { 'data-form': 'existing-filter' })
  let view
  try {
    await act(async () => { view = renderer.create(React.createElement(Chrome, {
      ...baseProps, filterContent: sharedFilter,
      onSort: (by, dir) => sorts.push([by, dir]),
    })) })
    const trigger = () => byData(view, 'data-xdrive-mobile-gallery-sort-filter')[0]
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-sort-filter').length, 1)
    assert.equal(view.root.findAll(x => x.props?.['aria-label'] === '图库排序').length, 0)
    assert.equal(view.root.findAll(x => x.props?.['aria-label'] === '图库筛选').length, 0)
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-select').length, 1)
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-more').length, 1)
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-primary-tabs').length, 1)
    await act(async () => { trigger().props.onClick({ currentTarget: {} }) })
    assert.equal(sortMenu(view).props.open, true)
    assert.equal(trigger().props['aria-expanded'], true)
    const options = sortMenu(view).findAll(x => x.type === 'menuitem'
      && typeof x.props.selected === 'boolean')
    assert.equal(options.length, 4)
    await act(async () => { options[3].props.onClick() })
    assert.deepEqual(sorts, [['added', 'desc']])
    assert.equal(sortMenu(view).props.open, false)
    await act(async () => { trigger().props.onClick({ currentTarget: {} }) })
    const filter = byData(view, 'data-xdrive-mobile-gallery-filter')[0]
    assert.equal(filter.type, 'menuitem')
    assert.equal(filter.props.disabled, false)
    await act(async () => { filter.props.onClick() })
    assert.equal(sortMenu(view).props.open, false)
    assert.equal(searchDrawer(view).props.open, true)
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-filter-panel')[0]
      .props.children, sharedFilter)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
test('P0-3g unavailable filter is disabled without removing sorting', async () => {
  let view
  try {
    await act(async () => { view = renderer.create(React.createElement(Chrome, baseProps)) })
    await act(async () => {
      byData(view, 'data-xdrive-mobile-gallery-sort-filter')[0].props.onClick({ currentTarget: {} })
    })
    assert.equal(sortMenu(view).props.open, true)
    assert.equal(byData(view, 'data-xdrive-mobile-gallery-filter')[0].props.disabled, true)
    assert.equal(sortMenu(view).findAll(x => x.type === 'menuitem'
      && typeof x.props.selected === 'boolean').length, 4)
    assert.equal(searchDrawer(view).props.open, false)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
test('P0-3g preserves one shared Gallery VirtualCollection and 52px App Header', () => {
  const chrome = read(chromePath), page = read('ui/shared/src/mui/MediaGallery.tsx')
  const app = read('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(chrome, /data-xdrive-mobile-gallery-sort-filter/)
  assert.doesNotMatch(chrome, /FilterAltOutlinedIcon/)
  assert.match(page, /useXDriveVirtualCollection/)
  assert.match(page, /<MediaVirtualTileGrid/)
  assert.match(page, /<MediaVirtualTimeline/)
  assert.match(app, /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.doesNotMatch(chrome, /listItemRange\(|new.*DataSource|fetch\(/)
})
