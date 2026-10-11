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
  canSort: true,
  onSort: () => {},
  filterContent: 'REUSED_GALLERY_FILTERS',
  showTimeScale: true,
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
  const timeDock = find(view, 'data-xdrive-mobile-gallery-time-scale')
  assert.ok(timeDock)
  assert.equal(timeDock.props.sx.position, 'fixed', 'native Years/Months/All is not a top sticky toolbar')
  assert.equal(timeDock.props.sx.bottom, 'calc(64px + env(safe-area-inset-bottom, 0px))')
  assert.equal(timeDock.props.sx.minHeight, 52)
  assert.equal(timeDock.props.sx.zIndex, 7)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-bottom').props.sx.bottom, 0)
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

test('P1-1b mobile Sort/Filter and Search request canonical Server facets once on each opening', async () => {
  const events = []
  const firstOpen = () => events.push('facets-first')
  const nextOpen = () => events.push('facets-next')
  const make = onFilterOpen => React.createElement(MobileChrome, props({ onFilterOpen }))
  let view
  try {
    await act(async () => { view = renderer.create(make(firstOpen)) })
    assert.deepEqual(events, [], 'facets are lazy and never requested on initial mount')
    await act(async () => {
      find(view, 'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} })
    })
    assert.deepEqual(events, [], 'opening Sort & Filter alone must not fetch advanced facets')
    await act(async () => { find(view, 'data-xdrive-mobile-gallery-filter').props.onClick() })
    assert.deepEqual(events, ['facets-first'])
    assert.equal(view.root.findAll(x => x.type === 'drawer' && x.props.open).length, 1)
    assert.equal(find(view, 'data-xdrive-mobile-gallery-filter-panel').props.children,
      'REUSED_GALLERY_FILTERS')

    // The owning Page replaces its callback when draft/scope changes.
    // The open sheet must not issue a network request per changed keystroke.
    await act(async () => { view.update(make(nextOpen)) })
    assert.deepEqual(events, ['facets-first'])
    await act(async () => {
      view.root.findAll(x => x.type === 'drawer' && x.props.open)[0].props.onClose()
    })
    assert.deepEqual(events, ['facets-first'])
    await act(async () => { find(view, 'data-xdrive-mobile-gallery-search').props.onClick() })
    assert.deepEqual(events, ['facets-first', 'facets-next'])
    assert.equal(view.root.findAll(x => x.type === 'drawer' && x.props.open).length, 1)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})

test('P1-1b Collections Search resolves shared library scope before fetching facets', async () => {
  const events = []
  let view
  try {
    await act(async () => {
      view = renderer.create(React.createElement(MobileChrome, props({
        primaryTab: 'collections', canGoBack: false, showCollection: false,
        onSearchRequested: () => { events.push('switch-to-library') },
        onFilterOpen: () => { events.push('facets-from-current-scope') },
      })))
    })
    await act(async () => { find(view, 'data-xdrive-mobile-gallery-search').props.onClick() })
    assert.deepEqual(events, ['switch-to-library', 'facets-from-current-scope'],
      'facet read must happen after Search has asked the shared Page to change scope')
    assert.equal(view.root.findAll(x => x.type === 'drawer' && x.props.open).length, 1)
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
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
  const openOptions = async () => {
    await act(async () => {
      find(view, 'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} })
    })
    await act(async () => { find(view, 'data-xdrive-mobile-gallery-display-options').props.onClick() })
    assert.equal(view.root.findAll(x => x.type === 'menu'
      && x.props['aria-label'] === '图库显示选项' && x.props.open === true).length, 1)
  }
  await openOptions()
  const zoomIn = find(view, 'data-xdrive-mobile-gallery-zoom-in')
  const zoomOut = find(view, 'data-xdrive-mobile-gallery-zoom-out')
  assert.equal(zoomIn.type, 'menuitem')
  assert.equal(zoomOut.type, 'menuitem')
  assert.equal(zoomIn.props['aria-label'], '放大照片缩略图')
  assert.equal(zoomOut.props['aria-label'], '缩小照片缩略图')
  for (const control of [zoomIn, zoomOut]) {
    assert.equal(control.props.sx.minHeight, 44)
    assert.equal(control.props.disabled, false)
  }
  await act(async () => { zoomIn.props.onClick() })
  await openOptions()
  await act(async () => { find(view, 'data-xdrive-mobile-gallery-zoom-out').props.onClick() })
  assert.deepEqual(changed, [2, 4])

  await act(async () => {
    view.update(React.createElement(MobileChrome, props({
      density: 2, densityMin: 2, densityMax: 10, densityStep: 1,
      onDensityChange,
    })))
  })
  await openOptions()
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-in').props.disabled, true)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-zoom-out').props.disabled, false)
  await act(async () => {
    view.root.findAll(x => x.type === 'menu' && x.props.open === true)[0].props.onClose()
  })

  await act(async () => {
    view.update(React.createElement(MobileChrome, props({
      density: 10, densityMin: 2, densityMax: 10, densityStep: 1,
      onDensityChange,
    })))
  })
  await openOptions()
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
  assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-display-options']).length, 0)
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


test('P0-3h iOS 27 View Options shares aspect callbacks and Back returns to sort/filter', async () => {
  const changed = []
  let view
  try {
    await act(async () => {
      view = renderer.create(React.createElement(MobileChrome, props({
        aspectMode: 'crop', onAspectModeChange: value => changed.push(value),
      })))
    })
    const openOptions = async () => {
      await act(async () => {
        find(view,'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} })
      })
      await act(async () => { find(view,'data-xdrive-mobile-gallery-display-options').props.onClick() })
    }
    await openOptions()
    const crop = find(view,'data-xdrive-mobile-gallery-aspect-crop')
    const contain = find(view,'data-xdrive-mobile-gallery-aspect-contain')
    assert.equal(crop.type,'menuitem')
    assert.equal(crop.props.selected,true)
    assert.equal(contain.props.selected,false)
    assert.equal(crop.props.sx.minHeight,44)
    assert.equal(contain.props.sx.minHeight,44)
    assert.match(String(contain.props.children),/方形网格/,
      'square contain must not impersonate native variable-aspect grid')
    await act(async () => { contain.props.onClick() })
    assert.deepEqual(changed,['contain'])
    assert.equal(view.root.findAll(x => x.type === 'menu' && x.props.open).length,0)
    await openOptions()
    await act(async () => { find(view,'data-xdrive-mobile-gallery-view-back').props.onClick() })
    assert.equal(view.root.findAll(x => x.type === 'menu' &&
      x.props['aria-label'] === '图库排序和筛选' && x.props.open).length,1)
    await act(async () => { find(view,'data-xdrive-mobile-gallery-filter').props.onClick() })
    assert.equal(view.root.findAll(x => x.type === 'drawer' && x.props.open).length,1)
    assert.equal(find(view,'data-xdrive-mobile-gallery-filter-panel').props.children,'REUSED_GALLERY_FILTERS')
  } finally {
    if(view) await act(async () => { view.unmount() })
  }
})


test('P0-3h Collections transition removes stale Library View Options before another section loads', async () => {
  let view
  try {
    await act(async () => { view = renderer.create(React.createElement(MobileChrome, props())) })
    await act(async () => {
      find(view,'data-xdrive-mobile-gallery-sort-filter').props.onClick({currentTarget:{}})
    })
    await act(async () => { find(view,'data-xdrive-mobile-gallery-display-options').props.onClick() })
    assert.ok(find(view,'data-xdrive-mobile-gallery-zoom-in'))
    await act(async () => {
      view.update(React.createElement(MobileChrome, props({
        primaryTab:'collections',showCollection:false,canGoBack:false,
      })))
    })
    assert.equal(view.root.findAll(x => x.type === 'menu' && x.props.open).length,0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-display-options']).length,0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-zoom-in']).length,0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-aspect-contain']).length,0)
  } finally {
    if(view) await act(async () => { view.unmount() })
  }
})


test('P0-3i floating library scale remains one shared view controller across tab and selection changes', async () => {
  const scales = []
  const make = overrides => React.createElement(MobileChrome, props({
    canGoBack: false,
    onTimeScale: next => scales.push(next),
    ...overrides,
  }))
  let view
  try {
    await act(async () => { view = renderer.create(make({primaryTab:'library',showCollection:true})) })
    const scalesIn = () => view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-scale'] !== undefined)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-time-scale']).length,1)
    assert.deepEqual(scalesIn().map(x => x.props['data-xdrive-mobile-gallery-scale']), ['year','month','all'])
    assert.deepEqual(scalesIn().map(x => x.props.sx.minHeight), [44,44,44])
    await act(async () => {
      for (const option of scalesIn()) option.props.onClick()
    })
    assert.deepEqual(scales, ['year','month','all'],
      'the floating buttons must still invoke exactly the existing Gallery onTimeScale')
    await act(async () => {
      view.update(make({primaryTab:'collections',showCollection:false}))
    })
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-time-scale']).length,0,
      'Collections overview must not retain orphaned library time controls')
    await act(async () => {
      view.update(make({primaryTab:'library',showCollection:true,selectionMode:true}))
    })
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-time-scale']).length,0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-bottom']).length,0,
      'selection owns its own toolbar without being covered by library chrome')
    await act(async () => {
      view.update(make({primaryTab:'library',showCollection:true,selectionMode:false,timeScale:'month'}))
    })
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-time-scale']).length,1)
    assert.equal(scalesIn().filter(x => x.props['aria-pressed'] === true)[0]?.props['data-xdrive-mobile-gallery-scale'],'month')
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})

test('P1-1a Collections overview exposes only authorized shared upload through its 44px More entry', async () => {
  let uploadCalls = 0
  const sharedUpload = React.createElement('button', {
    'data-xdrive-gallery-upload': true,
    onClick: () => { uploadCalls++ },
  }, '上传照片或视频')
  const render = (enabled) => React.createElement(MobileChrome, props({
    primaryTab: 'collections', showCollection: false, canGoBack: false,
    showOverviewActions: enabled,
    currentDateLabel: '2026-10',
    onTimeZoneChange: () => {},
    onFoldDuplicatesChange: () => {},
    extraActions: enabled ? sharedUpload : undefined,
  }))
  let view
  try {
    await act(async () => { view = renderer.create(render(true)) })
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-select']).length, 0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-sort-filter']).length, 0)
    const more = find(view, 'data-xdrive-mobile-gallery-more')
    assert.ok(more, 'a valid Wide Web Gallery action must be reachable from Collections')
    assert.equal(more.props.sx.minHeight, 44)
    assert.equal(more.props.sx.minWidth, 44)
    assert.equal(more.props['aria-haspopup'], 'dialog')
    await act(async () => { more.props.onClick() })
    const openDrawers = () => view.root.findAll(x => x.type === 'drawer' && x.props.open)
    assert.equal(openDrawers().length, 1)
    assert.equal(view.root.findAll(x => x.type === 'slider').length, 0,
      'Collections must not show Library thumbnail density')
    assert.equal(view.root.findAll(x => x.type === 'autocomplete').length, 0,
      'Collections must not show Library timeline timezone')
    assert.equal(view.root.findAll(x => x.type === 'button' &&
      x.props?.children === '折叠重复副本').length, 0,
      'Collections must not show Library duplicate-fold commands')
    const upload = find(view, 'data-xdrive-gallery-upload')
    assert.ok(upload, 'More must reuse the exact shared upload control')
    await act(async () => { upload.props.onClick() })
    assert.equal(uploadCalls, 1, 'no second mobile upload handler is allowed')

    // Permissions or account changes revoke the entry and dismiss its stale
    // sheet instead of leaving an invisible live mutation UI mounted.
    await act(async () => { view.update(render(false)) })
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-mobile-gallery-more']).length, 0)
    assert.equal(view.root.findAll(x => x.props?.['data-xdrive-gallery-upload']).length, 0)
    assert.equal(openDrawers().length, 0)

    await act(async () => { view.update(React.createElement(MobileChrome, props())) })
    assert.ok(find(view, 'data-xdrive-mobile-gallery-more'),
      'Library More remains available independently of overview upload permissions')
  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})

test('P0-3i bottom time controls add safe scroll clearance without forking Web range or App Frame', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const chrome = read(sourcePath)
  const appHeader = read('ui/shared/src/mui/MobileAppHeader.tsx')
  assert.match(gallery, /!mobileCollectionsOverview && section === 'library' && showPhotoCollection/)
  assert.match(gallery, /calc\(140px \+ env\(safe-area-inset-bottom, 0px\)\)/)
  assert.match(chrome, /bottom: 'calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\)'/)
  assert.equal((chrome.match(/data-xdrive-mobile-gallery-time-scale/g) || []).length,1)
  assert.match(gallery, /useXDriveVirtualCollection/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(appHeader, /calc\(52px \+ env\(safe-area-inset-top\)\)/)
  assert.doesNotMatch(chrome, /listItemRange\(|fetch\(|new.*DataSource/)
})


test('P1-1c Mobile does not offer inert sorting or timeline controls in unsupported scopes', async () => {
  const dispatched = []
  const scopedProps = props({
    canSort: false,
    showTimeScale: false,
    onSort: (...args) => dispatched.push(['sort', ...args]),
    onTimeScale: (value) => dispatched.push(['time', value]),
    currentDateLabel: '2026 年 10 月',
    canReturnToPosition: true,
    onReturnToPosition: () => dispatched.push(['return']),
    jumpGroups: [{ key: '2026', label: '2026 年' }, { key: '2025', label: '2025 年' }],
    onJumpGroup: (value) => dispatched.push(['jump', value]),
    onJumpDay: (value) => dispatched.push(['day', value]),
  })
  let view
  await act(async () => { view = renderer.create(React.createElement(MobileChrome, scopedProps)) })
  assert.equal(find(view, 'data-xdrive-mobile-gallery-time-scale'), undefined)
  assert.equal(find(view, 'data-xdrive-mobile-gallery-sort-filter').props['aria-label'], '图库筛选和显示选项')
  await act(async () => {
    find(view, 'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} })
  })
  const availableSortItems = () => view.root.findAll(x => x.type === 'menuitem' &&
    typeof x.props.children === 'string' && /^(拍摄时间|加入时间) · /.test(x.props.children))
  assert.equal(availableSortItems().length, 0, 'no inert Sort action in Trash/search/unsupported scope')
  assert.ok(find(view, 'data-xdrive-mobile-gallery-filter'), 'real shared filter remains available')
  await act(async () => { find(view, 'data-xdrive-mobile-gallery-display-options').props.onClick() })
  assert.ok(find(view, 'data-xdrive-mobile-gallery-aspect-crop'), 'display options remain real')
  await act(async () => {
    view.root.findAll(x => x.type === 'menu' && x.props.open)[0].props.onClose()
    find(view, 'data-xdrive-mobile-gallery-more').props.onClick()
  })
  assert.equal(find(view, 'data-xdrive-mobile-gallery-day-mode'), undefined)
  assert.equal(view.root.findAll(x => x.type === 'textfield' &&
    ['跳转年月', '跳转日期'].includes(x.props.label)).length, 0)
  assert.equal(view.root.findAll(x => x.type === 'button' && x.props.children === '返回刚才位置').length, 0)
  assert.deepEqual(dispatched, [], 'scope-limited mobile controls must not dispatch shared state changes')
  await act(async () => {
    view.update(React.createElement(MobileChrome, props({ canSort: true, showTimeScale: true })))
  })
  assert.ok(find(view, 'data-xdrive-mobile-gallery-time-scale'))
  await act(async () => { find(view, 'data-xdrive-mobile-gallery-sort-filter').props.onClick({ currentTarget: {} }) })
  assert.equal(availableSortItems().length, 4, 'authorized Web sort modes remain available on mobile')
  await act(async () => { view.unmount() })
})
