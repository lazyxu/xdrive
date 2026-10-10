const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const root = path.resolve(__dirname, '../..')

function compile(relative, jsx = false) {
  const name = path.join(root, relative)
  return ts.transpileModule(fs.readFileSync(name, 'utf8'), {
    fileName: name,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined, esModuleInterop: true,
    },
  }).outputText
}
function loadState() {
  const virtual = { exports: {} }
  new Function('module', 'exports', compile('ui/shared/src/mui/FileExplorerVirtualSurface.ts'))(
    virtual, virtual.exports,
  )
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile('web/src/mobileFilesState.ts'))(
    mod, mod.exports, name => {
      if (name === '../../ui/shared/src/mui/FileExplorerVirtualSurface') return virtual.exports
      throw Error('Unexpected Mobile window dependency: ' + name)
    },
  )
  return mod.exports
}
const state = loadState()
function loadGrouping() {
  const source = { exports: {} }
  new Function('module', 'exports', compile('ui/shared/src/file-explorer-grouping.ts'))(
    source, source.exports,
  )
  const layout = { exports: {} }
  new Function('module', 'exports', 'require', compile('ui/shared/src/mui/FileExplorerGroupingLayout.ts'))(
    layout, layout.exports, name => {
      if (name === '../file-explorer-grouping') return source.exports
      throw Error('Unexpected grouping dependency: ' + name)
    },
  )
  return layout.exports
}
const grouped = loadGrouping()
const inline = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', compile('ui/shared/src/file-explorer-inline.ts'))(
    mod, mod.exports,
  )
  return mod.exports
})()
const propertiesHook = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile('ui/shared/src/mui/FileExplorerPropertiesController.ts'))(
    mod, mod.exports, name => {
      if (name === 'react') return React
      throw Error('Unexpected properties hook dependency: ' + name)
    },
  )
  return mod.exports.useXDriveFileExplorerPropertiesController
})()
const material = new Proxy({}, { get: (_, name) => String(name) })
const ui = {
  XDriveFileExplorerAvailabilityBadge: 'availability-badge',
  XDriveFileExplorerItemIcon: 'file-icon',
  XDriveFileExplorerThumbnail: 'file-thumbnail',
  XDriveFileExplorerThumbnailProvider: 'thumbnail-provider',
  XDriveFilePropertiesDialog: 'properties-dialog',
  useXDriveFileExplorerPropertiesController: propertiesHook,
  XDriveMediaDetailsInspector: 'media-inspector',
  xDriveFileSupportsThumbnail: name => /\.(?:png|jpg|jpeg|livp|mov|mp4)$/i.test(name),
  xDriveFileExplorerMarkThumbnailScrollActivity() {},
  xDriveFileKind: name => /\.(?:png|jpg|livp)$/i.test(name) ? 'image' : 'file',
  xDriveFileTypeLabel: name => name.includes('.') ? '文件' : '文件夹',
  xDriveCreateFileExplorerGroupLayout: grouped.xDriveCreateFileExplorerGroupLayout,
  xDriveFileExplorerVisibleGroupSegments: grouped.xDriveFileExplorerVisibleGroupSegments,
  xDriveFileExplorerReadExternalDrop: async transfer => transfer.read
    ? transfer.read()
    : transfer.payload ?? {
      files: Array.from(transfer.files).map(file => ({ file, relativePath: file.name })),
      directories: [],
    },
}
const dragCalls = []
const imports = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': material,
  '@xdrive/ui/mui': ui,
  '../../ui/shared/src': {
    ...inline,
    XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE: 200,
    formatBytes: n => n + ' B',
    xDriveFileExplorerDragAutoScrollDelta: () => 0,
    xDriveFileKind: name => /\.(?:png|jpg|livp)$/i.test(name) ? 'image' : 'file',
  },
  '../../ui/shared/src/mui/usePointerDrag': {
    useXDrivePointerDrag: () => ({
      active: false,
      begin: (...args) => { dragCalls.push(['begin', ...args]); return true },
      cancel: () => { dragCalls.push(['cancel']) },
    }),
  },
  './mobileFilesState': state,
}
const MobileFiles = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compile('web/src/MobileFiles.tsx', true))(
    mod, mod.exports, name => {
      if (Object.hasOwn(imports, name)) return imports[name]
      if (name.startsWith('@mui/icons-material/')) return { __esModule: true, default: name.split('/').at(-1) }
      throw Error('Unexpected import: ' + name)
    },
  )
  return mod.exports.default
})()
function storage() {
  const values = new Map()
  return {
    values,
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    setTimeout, clearTimeout,
  }
}
function defaults(extra = {}) {
  return {
    lifecycleKey: 'ios-files-userA',
    items: [
      { id: 2, name: '照片文件夹', kind: 'dir', revision: 1 },
      { id: 3, name: '说明.txt', kind: 'file', revision: 1, size: 120 },
    ],
    crumbs: [{ id: 1, name: '我的文件' }],
    loading: false,
    trashActive: false,
    onOpenTrash() {}, onCloseTrash() {}, onBrowseRoot() {},
    onGoUp() {}, onCrumbClick() {},
    onRestoreFolder: async () => {},
    onOpenItem: async () => {},
    onOpenError: error => { throw error },
    recentItems: [{ id: 2, kind: 'dir', name: '照片文件夹' }],
    favorites: [{ id: 3, kind: 'file', name: '说明.txt' }],
    quickAccess: [],
    savedSearches: [], tags: [],
    onOpenRecent: async () => true, onOpenFavorite: async () => true,
    onOpenQuickAccess: async () => true, onOpenSavedSearch() {}, onOpenTag() {},
    onManageTags() {},
    searchValue: '', onSearchValueChange() {}, onSearch() {}, onClearSearch() {},
    searchActive: false,
    sort: { key: 'name', direction: 'asc' }, onSortChange() {},
    viewMode: 'details', onViewModeChange() {},
    onCreateFolder() {}, onUpload() {}, onUploadFolder() {},
    onRefresh() {}, onRefreshRecent() {}, onRefreshFavorites() {},
    canPaste: false, onPaste() {},
    onRename: async () => {}, onCopy() {}, onCut() {}, onMove() {},
    onCopyTo() {}, onDownload() {}, onDelete() {},
    onDropToFolder() {}, onDropToCrumb() {},
    getItemMenuItems: () => [], loadThumbnail: async () => null,
    loadMediaItem: async () => null, loadNodeLocation: async () => ({}),
    onShowInFolder() {},
    ...extra,
  }
}
function find(tree, key, value) {
  const matches = tree.root.findAll(node => node.props?.[key] === value)
  assert.equal(matches.length, 1, 'expected one ' + key + '=' + value + ', found ' + matches.length)
  return matches[0]
}
function count(tree, key) {
  return tree.root.findAll(node => Object.hasOwn(node.props ?? {}, key)).length
}
function textOf(value) {
  if (value == null || typeof value === 'boolean') return ''
  if (Array.isArray(value)) return value.map(textOf).join('')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return textOf(value.props?.children)
}
async function withView(action, { saved, props } = {}) {
  const previous = global.window
  const win = storage()
  global.window = win
  if (saved) win.localStorage.setItem('xdrive.mobile.files.v1:ios-files-userA', state.mobileFilesEncodeState(saved))
  let view
  let current = defaults(props)
  try {
    await act(async () => { view = Renderer.create(React.createElement(MobileFiles, current)) })
    await action({
      view, window: win,
      get props() { return current },
      async update(next) {
        current = { ...current, ...next }
        await act(async () => { view.update(React.createElement(MobileFiles, current)) })
      },
    })
  } finally {
    if (view) await act(async () => { view.unmount() })
    global.window = previous
  }
}

test('mounted iOS Files opens Browse home then switches Recent/Favorites in-app', async () => {
  await withView(async h => {
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'browse').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    const persisted = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(persisted.section, 'browse')
    assert.equal(persisted.folderID, null)
  })
})

test('mounted Files returns from a direct child to cloud root, then Browse home', async () => {
  let up = 0
  await withView(async h => {
    const clickBack = async () => {
      const buttons = h.view.root.findAll(node => node.props?.onClick && node.props.children === '返回')
      assert.equal(buttons.length, 1)
      await act(async () => { buttons[0].props.onClick() })
    }
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    await clickBack()
    assert.equal(up, 1, 'direct child must invoke the existing folder-Up controller')
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }] })
    await clickBack()
    assert.equal(up, 1, 'the cloud root must return to Browse home, not exit the App')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
  }, { props: {
    requestedDirectoryID: 2,
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    onGoUp: () => { up += 1 },
  } })
})

test('mounted all-files Search from Browse home clears back to the home without a new API', async () => {
  const searches = []
  await withView(async h => {
    const search = h.view.root.findAll(node => node.props?.['aria-label'] === '搜索全部文件')
    assert.equal(search.length, 1)
    await act(async () => { search[0].props.onKeyDown({ key: 'Enter', preventDefault() {} }) })
    assert.deepEqual(searches, ['report'])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    await h.update({
      searchActive: true,
      searchSummary: { query: 'report', conditions: [], resultCount: 0, onClear() {} },
    })
    const clears = h.view.root.findAll(node => node.props?.onClick && node.props.children === '清除')
    assert.equal(clears.length, 1)
    await act(async () => { clears[0].props.onClick() })
    await h.update({ searchActive: false, searchSummary: undefined })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
  }, { props: { searchValue: 'report', onSearch: q => { searches.push(q) } } })
})

test('restored folder calls exactly one authorized navigation and does not expose stale account state', async () => {
  const opened = []
  await withView(async h => {
    assert.deepEqual(opened, [42])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    assert.equal(h.window.values.get('xdrive.mobile.files.v1:other-account'), undefined)
  }, { saved: { section: 'browse', folderID: 42, scrollTop: 688, view: 'grid' },
    props: {
      onRestoreFolder: async id => { opened.push(id) },
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '旧位置' }],
    },
  })
})

test('Favorite and Recent expose contextual actions without per-row overlay buttons', async () => {
  const unfavorited = []
  const cleared = []
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const row = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onContextMenu &&
      !node.props?.['data-mobile-files-item'])
      .find(node => textOf(node.props.children).includes('说明.txt'))
    assert.ok(row, 'Favorites row must have its own long-press/context affordance')
    await act(async () => { row.props.onContextMenu({ preventDefault() {}, clientX: 60, clientY: 80 }) })
    const cancel = h.view.root.findAll(node => node.props?.children === '取消收藏')
    assert.equal(cancel.length, 1)
    await act(async () => { cancel[0].props.onClick() })
    assert.deepEqual(unfavorited, [3])

    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const more = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')
    assert.equal(more.length, 1)
    await act(async () => { more[0].props.onClick({ currentTarget: {} }) })
    const clearAction = h.view.root.findAll(node => node.props?.children === '清空最近记录')
    assert.equal(clearAction.length, 1)
    await act(async () => { clearAction[0].props.onClick() })
    const confirm = h.view.root.findAll(node => node.props?.children === '清空记录')
    assert.equal(confirm.length, 1)
    await act(async () => { confirm[0].props.onClick() })
    assert.deepEqual(cleared, ['cleared'])
  }, { props: {
    onUnfavorite: async id => { unfavorited.push(id) },
    onClearRecent: async () => { cleared.push('cleared') },
  } })
})

test('selection remains until explicit Done even when a Web action rejects', async () => {
  const copied = []
  await withView(async h => {
    // Enter the cloud root from Browse home.
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' &&
      node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(rootLocation)
    await act(async () => { rootLocation.props.onClick() })
    const more = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')
    await act(async () => { more[0].props.onClick({ currentTarget: {} }) })
    const selectMenu = h.view.root.findAll(node => node.props?.children === '选择')
    assert.equal(selectMenu.length, 1)
    await act(async () => { selectMenu[0].props.onClick() })
    assert.equal(h.view.root.findAll(node => node.props?.['aria-label'] === '复制已选').length, 1)
    const rows = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
    assert.ok(rows.length >= 2)
    await act(async () => { rows[0].props.onClick() })
    const copy = h.view.root.findAll(node => node.props?.['aria-label'] === '复制已选')
    await act(async () => { copy[0].props.onClick() })
    assert.deepEqual(copied, [2])
    assert.equal(h.view.root.findAll(node => node.props?.['aria-label'] === '复制已选').length, 1,
      'selection must remain after the attempted action')
  }, { props: {
    onCopy: values => { copied.push(...values.map(item => item.id)) },
  } })
})

test('touch-native context menus do not open early; keyboard ContextMenu opens the same file menu', async () => {
  await withView(async h => {
    const entry = h.view.root.findAll(node => node.props?.role === 'button' &&
      node.props?.onClick && textOf(node.props.children).includes('云端文件'))[0]
    assert.ok(entry)
    await act(async () => { entry.props.onClick() })
    const file = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    assert.ok(file)

    await act(async () => { file.props.onContextMenu({
      preventDefault() {}, clientX: 80, clientY: 120, nativeEvent: { pointerType: 'touch' },
    }) })
    const itemMenus = () => h.view.root.findAll(node =>
      node.type === 'Menu' && node.props?.anchorReference === 'anchorPosition')
    assert.equal(itemMenus().filter(node => node.props.open).length, 0,
      'native iOS/Android long press may not mount a Portal beneath the finger')

    await act(async () => { file.props.onKeyDown({
      key: 'ContextMenu', preventDefault() {}, currentTarget: {
        getBoundingClientRect: () => ({ left: 20, top: 30 }),
      },
    }) })
    const opened = itemMenus().filter(node => node.props.open)
    assert.equal(opened.length, 1)
    assert.deepEqual(opened[0].props.anchorPosition, { left: 34, top: 58 })
  })
})

test('a new explicit directory deep link overrides the old Browse location and resets its scroll', async () => {
  await withView(async h => {
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    await h.update({
      requestedDirectoryID: 42,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '新的共享目录' }],
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    const value = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(value.folderID, 42)
    assert.equal(value.scrollTop, 0)
    assert.equal(value.section, 'browse')
  })
})

test('Refresh uses the active Recent/Favorites controller, not a stale folder request', async () => {
  const called = []
  await withView(async h => {
    const refresh = async () => {
      const button = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')
      assert.equal(button.length, 1)
      await act(async () => { button[0].props.onClick({ currentTarget: {} }) })
      const actions = h.view.root.findAll(node => node.props?.children === '刷新' && node.props?.onClick)
      assert.equal(actions.length, 1)
      await act(async () => { actions[0].props.onClick() })
    }
    await refresh()
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await refresh()
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    await refresh()
    assert.deepEqual(called, ['directory', 'recent', 'favorites'])
  }, { props: {
    onRefresh: () => called.push('directory'),
    onRefreshRecent: () => called.push('recent'),
    onRefreshFavorites: () => called.push('favorites'),
  } })
})

test('Trash folder tap cannot navigate into a deleted folder or persist it as Browse', async () => {
  let opened = 0
  await withView(async h => {
    const rows = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
    assert.ok(rows.length > 0)
    await act(async () => { rows[0].props.onClick() })
    assert.equal(opened, 0, 'ordinary Trash tap must never invoke Open resolver')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0, 'Trash remains visible')
    const saved = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, null, 'a deleted directory is not a restorable Browse location')
  }, { props: {
    trashActive: true,
    onOpenItem: () => { opened += 1; return false },
  } })
})

test('reopening Files prioritizes the last Browse directory over the old Recent/Favorites tab', async () => {
  const opened = []
  await withView(async h => {
    assert.deepEqual(opened, [42])
    assert.equal(find(h.view, 'data-mobile-files-section', 'browse').props['aria-current'], 'page')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    const persisted = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(persisted.section, 'browse')
    assert.equal(persisted.folderID, 42)
    assert.equal(persisted.scrollTop, 688)
  }, {
    saved: { section: 'favorites', folderID: 42, scrollTop: 688, view: 'details' },
    props: {
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '照片备份' }],
      onRestoreFolder: async id => { opened.push(id) },
    },
  })
})

test('mounted Mobile Files projects Server-backed group headers in list and grid without local regrouping', async () => {
  const entries = [
    { id: 2, name: '照片备份', kind: 'dir', revision: 1 },
    { id: 3, name: '说明.txt', kind: 'file', revision: 1, size: 256 },
  ]
  const requests = []
  const source = {
    itemCount: entries.length,
    loadedItems: new Map(entries.map((item, index) => [index, item])),
    itemAt: index => entries[index],
    onRangeChange: (start, end) => requests.push([start, end]),
    groups: [
      { key: 'folder', start_index: 0, item_count: 1 },
      { key: 'ext:txt', start_index: 1, item_count: 1 },
    ],
  }
  await withView(async h => {
    const headers = () => h.view.root.findAll(
      node => Object.hasOwn(node.props ?? {}, 'data-xdrive-mobile-files-group-header'),
    )
    assert.equal(count(h.view, 'data-xdrive-mobile-files-grouped'), 1)
    assert.deepEqual(headers().map(node => node.props['data-xdrive-mobile-files-group-header']), ['folder', 'ext:txt'])
    assert.deepEqual(headers().map(node => node.children.join('')), ['文件夹', 'TXT'])
    assert.deepEqual(requests.at(-1), [0, 1])
    await h.update({ grouping: { groupBy: 'none', foldersFirst: true } })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-grouped'), 0)
    assert.equal(headers().length, 0)
  }, { props: {
    requestedDirectoryID: 1,
    items: entries,
    virtualCollection: source,
    grouping: { groupBy: 'type', foldersFirst: true },
  } })
})

test('100k grouped positions keep viewport work bounded while crossing a group boundary', () => {
  const layout = grouped.xDriveCreateFileExplorerGroupLayout({
    groups: [
      { key: 'folder', start_index: 0, item_count: 50000 },
      { key: 'ext:jpg', start_index: 50000, item_count: 50000 },
    ],
    groupBy: 'type', itemCount: 100000, rowHeight: 68,
    groupHeaderHeight: 30, groupGap: 6,
  })
  assert.ok(layout)
  const segments = grouped.xDriveFileExplorerVisibleGroupSegments(
    layout, 50000 * 68 + 30, 844, 68 * 4,
  )
  assert.ok(segments.length >= 1)
  const projected = segments.reduce((sum, segment) => sum + segment.endIndex - segment.startIndex, 0)
  assert.ok(projected > 0 && projected <= 28, 'only viewport rows and overscan may mount')
  assert.ok(segments.some(segment => segment.group.key === 'ext:jpg'))
  assert.equal(layout.itemCount, 100000)
})

test('Browse home uses distinct location symbols while real folders remain blue', async () => {
  await withView(async h => {
    for (const icon of ['CloudRounded', 'DeleteOutlineRounded', 'ManageSearchRounded', 'LabelRounded']) {
      assert.equal(h.view.root.findAll(node => node.type === icon).length, 1, icon)
    }
    assert.equal(count(h.view, 'data-xdrive-mobile-folder-icon') > 0, false,
      'special locations must not impersonate normal folders')
  }, { props: {
    savedSearches: [{ id: 18, name: '照片搜索' }],
    tags: [{ id: 19, name: '重要' }],
  } })
})

test('Recent and Favorites mount shared real thumbnail cells and dispatch contextual file actions', async () => {
  const actions = []
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const recentThumbnail = h.view.root.findAll(node => node.type === 'file-thumbnail' && node.props?.item?.id === 15)
    assert.equal(recentThumbnail.length, 1)
    assert.equal(recentThumbnail[0].props.eligible, true)
    assert.equal(recentThumbnail[0].props.item.revision, 4)
    assert.equal(recentThumbnail[0].props.item.updatedAt, '2026-10-09T08:00:00Z')

    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const favoriteThumbnail = h.view.root.findAll(node => node.type === 'file-thumbnail' && node.props?.item?.id === 15)
    assert.equal(favoriteThumbnail.length, 1)
    assert.equal(favoriteThumbnail[0].props.eligible, true)
    const row = h.view.root.findAll(node => node.props?.role === 'button' && node.props.onContextMenu)
      .find(node => textOf(node.props.children).includes('photo.jpg'))
    assert.ok(row)
    await act(async () => { row.props.onContextMenu({ preventDefault() {}, clientX: 60, clientY: 80 }) })
    for (const action of ['copy', 'download', 'share']) {
      await act(async () => { find(h.view, 'data-mobile-files-collection-action', action).props.onClick() })
      if (action !== 'share') {
        await act(async () => { row.props.onContextMenu({ preventDefault() {}, clientX: 60, clientY: 80 }) })
      }
    }
    assert.deepEqual(actions, ['copy', 'download', 'share'])
  }, { props: {
    recentItems: [{ id: 15, name: 'photo.jpg', kind: 'file', revision: 4, updatedAt: '2026-10-09T08:00:00Z' }],
    favorites: [{ id: 15, name: 'photo.jpg', kind: 'file', revision: 4 }],
    onCollectionAction: async (entry, action) => {
      assert.equal(entry.id, 15)
      actions.push(action)
    },
  } })
})

test('Selection replaces the category rail and restores it on Finish', async () => {
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(rootLocation)
    await act(async () => { rootLocation.props.onClick() })
    await act(async () => {
      const more = find(h.view, 'aria-label', '文件操作菜单')
      more.props.onClick({ currentTarget: {} })
    })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props.onClick)
    assert.equal(select.length, 1)
    await act(async () => { select[0].props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 1)
    assert.equal(count(h.view, 'data-mobile-files-section'), 0, 'category rail must be replaced, not stacked')
    assert.equal(find(h.view, 'aria-label', '下载已选').props.disabled, true)
    const file = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    await act(async () => { file.props.onClick() })
    assert.equal(file.props['aria-pressed'], true)
    assert.equal(find(h.view, 'aria-label', '下载已选').props.disabled, false)
    const finish = h.view.root.findAll(node => node.props?.children === '完成' && node.props.onClick)
    assert.equal(finish.length, 1)
    await act(async () => { finish[0].props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 0)
    assert.equal(count(h.view, 'data-mobile-files-section'), 3)
  })
})

test('Mobile Files status shows server sort direction and local view without changing sort query', async () => {
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    assert.match(textOf(find(h.view, 'data-mobile-files-arrangement-status', true).props.children), /名称 ↑ · 列表/)
    await h.update({ sort: { key: 'size', direction: 'desc' } })
    assert.match(textOf(find(h.view, 'data-mobile-files-arrangement-status', true).props.children), /大小 ↓ · 列表/)
  })
})


test('Browse home folds are account-local and editing reorders server-owned pinned/smart entries', async () => {
  const reorders = []
  await withView(async h => {
    const quick = find(h.view, 'data-mobile-files-home-section', 'quick')
    assert.equal(quick.props['aria-expanded'], true)
    await act(async () => { quick.props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-home-section', 'quick').props['aria-expanded'], false)
    assert.match(h.window.values.get('xdrive.mobile.files.sections.v1:ios-files-userA'), /"quick":false/)
    await act(async () => { find(h.view, 'data-mobile-files-home-section', 'quick').props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-home-section', 'quick').props['aria-expanded'], true)

    await act(async () => {
      find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} })
    })
    const edit = h.view.root.findAll(node => node.props?.children === '整理浏览首页' && node.props?.onClick)
    assert.equal(edit.length, 1)
    await act(async () => { edit[0].props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-home-edit-item'), 4)
    assert.equal(h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单').length, 0)
    await act(async () => { find(h.view, 'aria-label', '下移 已固定 A').props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '下移 智能 A').props.onClick() })
    assert.deepEqual(reorders, [
      { kind: 'quick', ids: [3, 2] },
      { kind: 'saved', ids: [18, 17] },
    ])
    const done = h.view.root.findAll(node => node.props?.children === '完成' && node.props?.onClick)
    assert.equal(done.length, 1)
    await act(async () => { done[0].props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-home-edit-item'), 0)
    assert.equal(h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单').length, 1)
  }, { props: {
    quickAccess: [{ id: 2, name: '已固定 A', kind: 'dir' }, { id: 3, name: '已固定 B', kind: 'dir' }],
    savedSearches: [{ id: 17, name: '智能 A' }, { id: 18, name: '智能 B' }],
    tags: [{ id: 17, name: '红色标签' }], // Shares an ID with a saved search; UI keys must be type-scoped.
    onReorderQuickAccess: async ids => { reorders.push({ kind: 'quick', ids }); return true },
    onReorderSavedSearches: async ids => { reorders.push({ kind: 'saved', ids }) },
  } })
})


test('native file sharing prepares exact bytes before a second synchronous user gesture', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  const shares = []
  const file = { name: 'photo.jpg', size: 3, type: 'image/jpeg' }
  Object.defineProperty(global, 'navigator', {
    configurable: true, value: {
      canShare: ({ files }) => files.length === 1 && files[0] === file,
      share: (payload) => { shares.push(payload); return Promise.resolve() },
    },
  })
  let resolve, requestSignal
  const pending = new Promise(r => { resolve = r })
  try {
    await withView(async h => {
      await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
      const row = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onContextMenu)
        .find(node => textOf(node.props.children).includes('photo.jpg'))
      assert.ok(row)
      await act(async () => {
        row.props.onContextMenu({ preventDefault() {}, clientX: 80, clientY: 100 })
      })
      const entry = find(h.view, 'data-mobile-files-native-share-entry', 'collection')
      await act(async () => { entry.props.onClick() })
      assert.equal(find(h.view, 'data-mobile-files-native-share-confirm', true).props.disabled, true)
      assert.equal(shares.length, 0, 'preparing bytes cannot invoke OS share without a second tap')
      assert.equal(requestSignal?.aborted, false)

      await act(async () => { resolve(file); await pending })
      const confirm = find(h.view, 'data-mobile-files-native-share-confirm', true)
      assert.equal(confirm.props.disabled, false)
      await act(async () => { confirm.props.onClick() })
      assert.equal(shares.length, 1)
      assert.deepEqual(shares[0].files, [file])
      assert.equal(shares[0].title, file.name)
    }, {
      props: {
        favorites: [{ id: 15, name: 'photo.jpg', kind: 'file', revision: 4 }],
        onPrepareNativeShareFile: (_entry, signal) => { requestSignal = signal; return pending },
      },
    })
  } finally {
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator)
    else delete global.navigator
  }
})

test('closing system share during preparation cancels its byte-fetch request', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  Object.defineProperty(global, 'navigator', {
    configurable: true, value: { canShare: () => true, share: () => Promise.resolve() },
  })
  let signal
  try {
    await withView(async h => {
      await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
      const row = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onContextMenu)
        .find(node => textOf(node.props.children).includes('photo.jpg'))
      assert.ok(row)
      await act(async () => { row.props.onContextMenu({ preventDefault() {}, clientX: 50, clientY: 100 }) })
      await act(async () => { find(h.view, 'data-mobile-files-native-share-entry', 'collection').props.onClick() })
      assert.equal(signal?.aborted, false)
      const dialog = h.view.root.findAll(node => node.type === 'Dialog' &&
        textOf(node.props.children).includes('系统分享文件'))[0]
      assert.ok(dialog)
      await act(async () => { dialog.props.onClose() })
      assert.equal(signal?.aborted, true)
      assert.equal(dialog.props.open, false)
    }, {
      props: {
        favorites: [{ id: 15, name: 'photo.jpg', kind: 'file' }],
        onPrepareNativeShareFile: (_entry, requestSignal) => {
          signal = requestSignal
          return new Promise(() => {})
        },
      },
    })
  } finally {
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator)
    else delete global.navigator
  }
})

test('F-iOS-01A: one visible large heading collapses into the compact title while scroll owner stays mounted', async () => {
  await withView(async h => {
    const nav = find(h.view, 'data-mobile-files-navigation-bar', true)
    assert.equal(nav.props.sx.minHeight, 52)
    assert.equal(count(h.view, 'data-mobile-files-large-title'), 1)
    assert.equal(find(h.view, 'data-mobile-files-compact-title', true).props['aria-hidden'], true)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
    assert.equal(find(h.view, 'data-mobile-files-group', 'locations').props.sx.borderRadius, '13px')
    const scrollHost = find(h.view, 'data-xdrive-mobile-files-scroll', true)
    await act(async () => { scrollHost.props.onScroll({ currentTarget: { scrollTop: 75 } }) })
    assert.equal(find(h.view, 'data-mobile-files-compact-title', true).props['aria-hidden'], false)
    assert.equal(count(h.view, 'data-mobile-files-large-title'), 1, 'scroll does not remount title or file controller')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
    await act(async () => { scrollHost.props.onScroll({ currentTarget: { scrollTop: 0 } }) })
    assert.equal(find(h.view, 'data-mobile-files-compact-title', true).props['aria-hidden'], true)
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-group'), 1, 'one group shell for ordinary list')
    assert.equal(find(h.view, 'data-mobile-files-group', 'directory').props.sx.overflow, 'hidden')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  })
})

test('F-iOS-01A: Mobile context menu respects shared icons, separators and destructive group', async () => {
  const dispatched = []
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    const item = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    await act(async () => { item.props.onContextMenu({
      preventDefault() {}, clientX: 40, clientY: 90, nativeEvent: { pointerType: 'mouse' },
    }) })
    const open = find(h.view, 'data-mobile-files-context-action', 'open')
    const erase = find(h.view, 'data-mobile-files-context-action', 'delete')
    assert.equal(open.findAll(node => node.type === 'ListItemIcon').length, 1)
    assert.equal(erase.props.sx.color, 'error.main')
    assert.equal(count(h.view, 'data-mobile-files-context-separator'), 2,
      'edit and destructive operations have distinct dividers')
    const share = find(h.view, 'data-mobile-files-context-action', 'share')
    assert.match(textOf(share.props.children), /分享链接/)
    await act(async () => { open.props.onClick() })
    assert.deepEqual(dispatched, ['open'])
  }, { props: {
    getItemMenuItems: () => [
      { id: 'open', label: '打开', icon: React.createElement('action-icon', { name: 'open' }),
        onSelect: () => dispatched.push('open') },
      { id: 'share', label: '分享', icon: React.createElement('action-icon', { name: 'share' }),
        onSelect: () => dispatched.push('share') },
      { id: 'delete', label: '删除', danger: true, icon: React.createElement('action-icon', { name: 'delete' }),
        onSelect: () => dispatched.push('delete') },
    ],
  } })
})

test('F-PARITY-01A: Mobile folder Properties show Server-recursive counts and provenance, abort on close', async () => {
  const requests = []
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    const folder = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    await act(async () => { folder.props.onContextMenu({
      preventDefault() {}, clientX: 40, clientY: 90, nativeEvent: { pointerType: 'mouse' },
    }) })
    // The mocked Menu renders closed menu children too: select the actual
    // item-context Properties control, not hidden selected-items Properties.
    assert.equal(find(h.view, 'data-mobile-files-batch-properties', true).props.disabled, true)
    const propertiesAction = find(h.view, 'data-mobile-files-item-properties', true)
    await act(async () => { propertiesAction.props.onClick() })
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0].items, [2])
    const dialog = h.view.root.findAll(node => node.type === 'properties-dialog')[0]
    assert.equal(dialog.props.open, true)
    const fields = Object.fromEntries(dialog.props.properties.map(p => [p.label, p.value]))
    assert.equal(fields['大小'], '5120 B')
    assert.equal(fields['内容'], '2 个文件 · 1 个文件夹')
    assert.equal(fields['来源'], '照片来源 (yike)')
    assert.equal(fields['Revision'], 1)
    await act(async () => { dialog.props.onClose() })
    assert.equal(requests[0].signal.aborted, true)
  }, { props: {
    loadPropertiesStats: async (items, signal) => {
      requests.push({ items: items.map(item => item.id), signal })
      return { selected_count: 1, effective_root_count: 1, total_bytes: 5120,
        file_count: 2, folder_count: 1, sources: [{ id: 7, name: '照片来源', kind: 'yike' }] }
    },
  } })
})

test('F-iOS27-02: rounded Files-internal bottom navigator retains same scroll owner and safe-area protection', async () => {
  await withView(async h => {
    const bars = h.view.root.findAll(node => node.props?.component === 'nav' && node.props?.['aria-label'] === '文件分类')
    assert.equal(bars.length, 1)
    assert.equal(bars[0].props.sx.borderRadius, '999px')
    assert.match(bars[0].props.sx.backdropFilter, /blur/)
    assert.match(bars[0].props.sx.mb, /safe-area-inset-bottom/)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  })
})

test('F-PARITY-02: mobile More uses shared undo/redo and workspace history callbacks', async () => {
  const calls = []
  await withView(async h => {
    const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(root)
    await act(async () => { root.props.onClick() })
    for (const [label, value] of [
      ['撤销', 'undo'], ['重做', 'redo'],
      ['后退（浏览历史）', 'back'], ['前进（浏览历史）', 'forward'],
    ]) {
      const more = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')[0]
      assert.ok(more)
      await act(async () => { more.props.onClick({ currentTarget: {} }) })
      const menu = h.view.root.findAll(node => node.type === 'MenuItem' && node.props?.children === label)[0]
      assert.ok(menu, 'missing Mobile action: ' + label)
      assert.equal(menu.props.disabled, false)
      await act(async () => { menu.props.onClick() })
      assert.equal(calls.at(-1), value)
    }
    assert.deepEqual(calls, ['undo', 'redo', 'back', 'forward'])
  }, { props: {
    canUndo: true, onUndo: () => calls.push('undo'),
    canRedo: true, onRedo: () => calls.push('redo'),
    canHistoryBack: true, onHistoryBack: () => calls.push('back'),
    canHistoryForward: true, onHistoryForward: () => calls.push('forward'),
  } })
})

test('F-PARITY-02: Mobile file context invokes the existing Copy Paths adapter on immutable IDs', async () => {
  const ids = []
  await withView(async h => {
    const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(root)
    await act(async () => { root.props.onClick() })
    const item = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    assert.ok(item)
    await act(async () => { item.props.onContextMenu({
      preventDefault() {}, clientX: 40, clientY: 90, nativeEvent: { pointerType: 'mouse' },
    }) })
    const path = find(h.view, 'data-mobile-files-copy-path', true)
    await act(async () => { path.props.onClick() })
    assert.deepEqual(ids, [[2]])
  }, { props: { onCopyPaths: items => ids.push(items.map(item => item.id)) } })
})

test('F-PARITY-03: Browse Edit makes saved-rule Rename and Delete reachable without opening files', async () => {
  const renamed = []
  let deleteAttempts = 0
  const removedFiles = []
  await withView(async h => {
    const more = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')[0]
    await act(async () => { more.props.onClick({ currentTarget: {} }) })
    const edit = h.view.root.findAll(node => node.type === 'MenuItem' && node.props?.children === '整理浏览首页')[0]
    assert.ok(edit)
    await act(async () => { edit.props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-home-edit-item'), 1)
    const options = () => find(h.view, 'data-mobile-files-saved-options', 17)
    await act(async () => { options().props.onClick({ currentTarget: {} }) })
    const rename = h.view.root.findAll(node => node.type === 'MenuItem' && node.props?.children === '重命名智能文件夹')[0]
    assert.ok(rename)
    await act(async () => { rename.props.onClick() })
    assert.deepEqual(renamed, [17])
    await act(async () => { options().props.onClick({ currentTarget: {} }) })
    const deleteAction = h.view.root.findAll(node => node.type === 'MenuItem' && node.props?.children === '删除智能文件夹')[0]
    assert.ok(deleteAction)
    await act(async () => { deleteAction.props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-saved-delete', true).props.open, true)
    const button = () => find(h.view, 'data-mobile-files-saved-delete-confirm', true)
    await act(async () => {
      button().props.onClick()
      button().props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(deleteAttempts, 1, 'two same-tick confirmation clicks submit one authoritative mutation')
    assert.equal(find(h.view, 'data-mobile-files-saved-delete', true).props.open, true,
      'failed deletion retains rule and retryable confirmation')
    assert.match(h.view.root.findAll(node => node.props?.role === 'alert').map(node => textOf(node.props.children)).join(' '),
      /拒绝删除规则/)
    await act(async () => { button().props.onClick(); await Promise.resolve(); await Promise.resolve() })
    assert.equal(deleteAttempts, 2)
    assert.equal(find(h.view, 'data-mobile-files-saved-delete', true).props.open, false)
    assert.deepEqual(removedFiles, [], 'deleting saved Search may never remove matching files')
  }, { props: {
    savedSearches: [{ id: 17, name: '照片规则', subtitle: '图片' }],
    onRenameSavedSearch: id => renamed.push(id),
    onReplaceSavedSearch: () => {},
    onDeleteSavedSearch: async id => {
      assert.equal(id, 17)
      deleteAttempts += 1
      if (deleteAttempts === 1) throw new Error('拒绝删除规则')
    },
    onDelete: values => removedFiles.push(...values.map(item => item.id)),
  } })
})

test('F-PARITY-03: active all-files Search can explicitly choose and replace a saved rule', async () => {
  const replaced = []
  await withView(async h => {
    await h.update({ searchActive: true, canReplaceSavedSearch: true })
    const more = h.view.root.findAll(node => node.props?.['aria-label'] === '文件操作菜单')[0]
    await act(async () => { more.props.onClick({ currentTarget: {} }) })
    const replace = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '更新已有智能文件夹…')[0]
    assert.ok(replace)
    await act(async () => { replace.props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-saved-replace', true).props.open, true)
    const confirm = () => find(h.view, 'data-mobile-files-saved-replace-confirm', true)
    assert.equal(confirm().props.disabled, true, 'must choose a target before overwriting rules')
    await act(async () => { find(h.view, 'data-mobile-files-saved-replace-target', 29).props.onClick() })
    assert.equal(confirm().props.disabled, false)
    await act(async () => { confirm().props.onClick() })
    assert.deepEqual(replaced, [29])
    assert.equal(find(h.view, 'data-mobile-files-saved-replace', true).props.open, false)
  }, { props: {
    savedSearches: [{ id: 29, name: '共享的照片查询' }],
    onReplaceSavedSearch: id => replaced.push(id),
  } })
})

test('F-PARITY-03: an organization read failure is retryable, not a fake empty list', async () => {
  let retries = 0
  await withView(async h => {
    const error = find(h.view, 'data-mobile-files-organization-error', true)
    assert.equal(error.props.role, 'alert')
    assert.match(textOf(error.props.children), /加载智能文件夹失败/)
    const retry = h.view.root.findAll(node => node.props?.children === '重试' && node.props?.onClick)[0]
    assert.ok(retry)
    await act(async () => { retry.props.onClick() })
    assert.equal(retries, 1)
  }, { props: {
    savedSearches: [], tags: [], organizationError: '加载智能文件夹失败',
    onRetryOrganization: () => { retries += 1 },
  } })
})

test('F-PARITY-04: Space and context Quick Look use Web route callback, Enter keeps Open', async () => {
  const quick = []
  const opened = []
  await withView(async h => {
    const home = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(home)
    await act(async () => { home.props.onClick() })
    const file = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      .find(node => node.props['aria-label'] === '说明.txt')
    assert.ok(file)
    await act(async () => { file.props.onKeyDown({ key: ' ', preventDefault() {} }) })
    assert.deepEqual(quick, [3], 'Space must launch the already routed Preview')
    assert.deepEqual(opened, [], 'Space must not invoke ordinary Open')
    await act(async () => { file.props.onKeyDown({ key: 'Enter', preventDefault() {} }) })
    assert.deepEqual(opened, [3], 'Enter keeps regular Web file Open')
    await act(async () => { file.props.onContextMenu({
      preventDefault() {}, clientX: 35, clientY: 80, nativeEvent: { pointerType: 'mouse' },
    }) })
    const preview = find(h.view, 'data-mobile-files-quick-look', true)
    await act(async () => { preview.props.onClick() })
    assert.deepEqual(quick, [3, 3])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onOpenItem: async item => { opened.push(item.id) },
    onQuickLookItem: item => { quick.push(item.id) },
  } })
})

test('F-PARITY-04: browser-tab action survives Mobile menu but internal file tabs do not', async () => {
  const calls = []
  await withView(async h => {
    const home = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { home.props.onClick() })
    const file = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      .find(node => node.props['aria-label'] === '说明.txt')
    assert.ok(file)
    await act(async () => { file.props.onContextMenu({
      preventDefault() {}, clientX: 35, clientY: 80, nativeEvent: { pointerType: 'mouse' },
    }) })
    assert.equal(count(h.view, 'data-mobile-files-context-action') > 0, true)
    assert.equal(h.view.root.findAll(node => node.props?.['data-mobile-files-context-action'] === 'open-new-tab').length, 0)
    const browserAction = find(h.view, 'data-mobile-files-context-action', 'open-browser-tab')
    await act(async () => { browserAction.props.onClick() })
    assert.deepEqual(calls, ['browser'])
  }, { props: { getItemMenuItems: () => [
    { id: 'open-new-tab', label: '在新文件标签页打开', onSelect: () => calls.push('internal') },
    { id: 'open-browser-tab', label: '在新浏览器标签页打开', onSelect: () => calls.push('browser') },
  ] } })
})

test('F-PARITY-05: Mobile path dialog preloads authoritative workspace path and submits it once', async () => {
  const paths = []
  const search = []
  await withView(async h => {
    const more = find(h.view, 'aria-label', '文件操作菜单')
    await act(async () => { more.props.onClick({ currentTarget: {} }) })
    const action = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '前往文件夹路径…')[0]
    assert.ok(action)
    await act(async () => { action.props.onClick() })
    const dialog = find(h.view, 'data-mobile-files-go-to-path', true)
    assert.equal(dialog.props.open, true)
    const field = h.view.root.findAll(node => node.type === 'TextField' &&
      node.props?.['aria-label'] === '文件夹路径')[0]
    assert.ok(field)
    assert.equal(field.props.value, '我的文件/旧目录')
    await act(async () => { field.props.onChange({ target: { value: ' 我的文件/新目录 ' } }) })
    const form = h.view.root.findAll(node => node.type === 'Box' &&
      node.props?.component === 'form' && node.props?.onSubmit)[0]
    assert.ok(form)
    await act(async () => { form.props.onSubmit({ preventDefault() {} }) })
    assert.deepEqual(paths, ['我的文件/新目录'])
    assert.deepEqual(search, [], 'typed path must not be converted into a fake global Search query')
    assert.equal(find(h.view, 'data-mobile-files-go-to-path', true).props.open, false)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1, 'navigation does not remount scroll owner')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0, 'path submission reveals Browse, not Home')
  }, { props: {
    pathValue: '我的文件/旧目录',
    onPathSubmit: value => paths.push(value),
    onSearch: value => search.push(value),
  } })
})

test('F-PARITY-05: empty path cannot navigate and Trash never exposes the operation', async () => {
  const calls = []
  await withView(async h => {
    const more = find(h.view, 'aria-label', '文件操作菜单')
    await act(async () => { more.props.onClick({ currentTarget: {} }) })
    const action = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '前往文件夹路径…')[0]
    assert.ok(action)
    await act(async () => { action.props.onClick() })
    const field = h.view.root.findAll(node => node.type === 'TextField' &&
      node.props?.['aria-label'] === '文件夹路径')[0]
    await act(async () => { field.props.onChange({ target: { value: '    ' } }) })
    assert.equal(find(h.view, 'data-mobile-files-go-to-path-submit', true).props.disabled, true)
    const form = h.view.root.findAll(node => node.type === 'Box' &&
      node.props?.component === 'form' && node.props?.onSubmit)[0]
    await act(async () => { form.props.onSubmit({ preventDefault() {} }) })
    assert.deepEqual(calls, [])
    assert.equal(find(h.view, 'data-mobile-files-go-to-path', true).props.open, true)
    await h.update({ trashActive: true })
    assert.equal(find(h.view, 'data-mobile-files-go-to-path', true).props.open, false)
    const actions = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '前往文件夹路径…')
    assert.equal(actions.length, 0)
  }, { props: {
    pathValue: '我的文件',
    onPathSubmit: value => calls.push(value),
  } })
})

test('F-PARITY-06: external files drop only once into the existing Browse root', async () => {
  const calls = []
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(location)
    await act(async () => { location.props.onClick() })
    const host = find(h.view, 'data-xdrive-mobile-files-scroll', true)
    const file = { name: 'incoming.txt' }
    const transfer = { types: ['Files'], files: [file], items: [] }
    let prevented = 0
    await act(async () => {
      host.props.onDragOver({ dataTransfer: transfer, preventDefault() { prevented++ } })
      host.props.onDrop({ dataTransfer: transfer, preventDefault() { prevented++ } })
      await Promise.resolve()
      await Promise.resolve()
    })
    assert.equal(prevented, 2)
    assert.deepEqual(calls, [{ ids: ['incoming.txt'], parent: undefined }])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onExternalFilesDrop: async (files, target) => {
      calls.push({ ids: files.map(file => file.name), parent: target?.id })
    },
  } })
})

test('F-PARITY-06: folder and ancestor drop do not also upload to Browse background', async () => {
  const calls = []
  await withView(async h => {
    const folder = find(h.view, 'data-mobile-files-folder-id', '2')
    const payload = { files: [{ file: { name: 'child.txt' }, relativePath: 'Tree/child.txt' }], directories: ['Tree'] }
    const transfer = { types: ['Files'], files: [], items: [], payload }
    let stopped = 0
    await act(async () => {
      folder.props.onDrop({ dataTransfer: transfer, preventDefault() {}, stopPropagation() { stopped++ } })
      await Promise.resolve(); await Promise.resolve()
    })
    assert.equal(stopped, 1)
    assert.deepEqual(calls, [{ kind: 'folder', target: 2, directories: ['Tree'] }])
    const rootCrumb = find(h.view, 'data-mobile-files-crumb-id', '1')
    await act(async () => {
      rootCrumb.props.onDrop({
        dataTransfer: { types: ['Files'], files: [{ name: 'drop.txt' }], items: [] },
        preventDefault() {}, stopPropagation() { stopped++ },
      })
      await Promise.resolve(); await Promise.resolve()
    })
    assert.equal(stopped, 2)
    assert.deepEqual(calls[1], { kind: 'crumb', target: 1, files: ['drop.txt'] })
    assert.equal(calls.length, 2, 'no bubbled duplicate parent upload')
  }, { props: {
    requestedDirectoryID: 2,
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    onExternalFilesDrop: async () => calls.push({ kind: 'wrong-background' }),
    onExternalFolderDrop: async (payload, target) =>
      calls.push({ kind: 'folder', target: target?.id, directories: payload.directories }),
    onExternalFilesDropToCrumb: async (files, crumb) =>
      calls.push({ kind: 'crumb', target: crumb.id, files: files.map(file => file.name) }),
  } })
})

test('F-PARITY-06: stale directory reads never upload to a later account; Trash rejects external uploads', async () => {
  const uploads = []
  let finishRead
  const deferred = new Promise(resolve => { finishRead = resolve })
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    const host = find(h.view, 'data-xdrive-mobile-files-scroll', true)
    await act(async () => {
      host.props.onDrop({ dataTransfer: {
        types: ['Files'], items: [], files: [],
        read: () => deferred,
      }, preventDefault() {} })
      await Promise.resolve()
    })
    await h.update({ lifecycleKey: 'ios-files-userB' })
    await act(async () => {
      finishRead({ files: [{ file: { name: 'old.txt' }, relativePath: 'old.txt' }], directories: [] })
      await Promise.resolve(); await Promise.resolve()
    })
    assert.deepEqual(uploads, [], 'outdated account cannot receive an earlier file drop')
    await h.update({ trashActive: true })
    let prevented = 0
    await act(async () => {
      host.props.onDrop({ dataTransfer: { types: ['Files'], files: [{ name: 'trash.txt' }], items: [] },
        preventDefault() { prevented++ } })
      await Promise.resolve(); await Promise.resolve()
    })
    assert.equal(prevented, 1)
    assert.deepEqual(uploads, [], 'Trash never accepts a dropped external file')
  }, { props: { onExternalFilesDrop: async files => uploads.push(files.map(file => file.name)) } })
})

test('F-PARITY-07B: List disclosure is independent of row Open and uses a 44px button', async () => {
  const toggles = []
  const opens = []
  const group = { groupBy: 'none', foldersFirst: true }
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    const arrow = find(h.view, 'data-mobile-files-folder-disclosure', '2')
    assert.equal(arrow.props['aria-expanded'], false)
    assert.equal(arrow.props.sx.width, 44)
    assert.equal(arrow.props.sx.height, 44)
    let stopped = 0
    await act(async () => { arrow.props.onClick({ stopPropagation() { stopped++ } }) })
    assert.equal(stopped, 1)
    assert.deepEqual(toggles, [[2, 1, 0]])
    assert.deepEqual(opens, [], 'disclosure never navigates')
    const branch = { ownerID: 2, parentID: 1, parentIndex: 0, name: '照片文件夹',
      itemCount: 2, loading: false, error: null,
      items: new Map([[0, { id: 4, name: 'inside.txt', kind: 'file', revision: 7, size: 42 }],
        [1, { id: 5, name: 'Nested', kind: 'dir', revision: 9 }]]) }
    await h.update({ inlineBranches: [branch] })
    assert.equal(find(h.view, 'data-mobile-files-folder-disclosure', '2').props['aria-expanded'], true)
    const child = h.view.root.findAll(node => node.props?.['data-mobile-files-depth'] === 1
      && node.props?.['data-mobile-files-item'] === true).find(node =>
        node.props['aria-label'] === 'inside.txt')
    assert.ok(child, 'real projected child row must appear')
    await act(async () => { child.props.onClick() })
    assert.deepEqual(opens, [[4, 2]], 'child opens through shared owner API')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: { grouping: group,
    onToggleInlineFolder: (item, owner, index) => toggles.push([item.id, owner, index]),
    onOpenItem: (item, owner) => { opens.push([item.id, owner]); return false },
  } })
})

test('F-PARITY-07B: child error retry never navigates or starts a second API', async () => {
  const retries = []
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    const arrow = find(h.view, 'data-mobile-files-folder-disclosure', '2')
    assert.match(arrow.props['aria-label'], /重试展开/)
    await act(async () => { arrow.props.onClick({ stopPropagation() {} }) })
    assert.deepEqual(retries, [2])
  }, { props: {
    grouping: { groupBy: 'none', foldersFirst: true },
    onToggleInlineFolder() { throw Error('retry unexpectedly toggled the branch') },
    onRetryInlineFolder: id => retries.push(id),
    inlineBranches: [{ ownerID: 2, parentID: 1, parentIndex: 0,
      name: '照片文件夹', itemCount: null, items: new Map(),
      loading: false, error: '403 Forbidden' }],
  } })
})

test('F-PARITY-07B: 100k root plus 100k child renders only one shared visible window', async () => {
  const rootRange = []
  const childRange = []
  const folder = { id: 2, name: 'Large folder', kind: 'dir', revision: 3 }
  const root = { interactionKey: '100k-index', itemCount: 100000,
    loadedItems: new Map([[0, folder]]), itemAt: index => index === 0 ? folder : undefined,
    onRangeChange: (start, end) => rootRange.push([start, end]) }
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    assert.ok(count(h.view, 'data-mobile-files-placeholder') < 30)
    assert.ok(count(h.view, 'data-mobile-files-item') < 30)
    assert.ok(rootRange.length > 0)
    assert.ok(childRange.some(ranges => ranges.some(range => range.ownerID === 2)))
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    items: [folder], virtualCollection: root,
    grouping: { groupBy: 'none', foldersFirst: true },
    onToggleInlineFolder() {},
    onInlineViewport: ranges => childRange.push(ranges),
    inlineBranches: [{ ownerID: 2, parentID: 1, parentIndex: 0, name: folder.name,
      itemCount: 100000, loading: false, error: null,
      items: new Map([[0, { id: 3, name: 'visible.txt', kind: 'file', revision: 1 }]]) }],
  } })
})

test('F-PARITY-07B: Trash and Search do not expose inline folder disclosures', async () => {
  let cleared = 0
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-folder-disclosure'), 1)
    await h.update({ trashActive: true })
    assert.equal(count(h.view, 'data-mobile-files-folder-disclosure'), 0)
    await h.update({ trashActive: false, searchActive: true })
    assert.equal(count(h.view, 'data-mobile-files-folder-disclosure'), 0)
    assert.ok(cleared > 0)
  }, { props: {
    grouping: { groupBy: 'none', foldersFirst: true },
    onToggleInlineFolder() {},
    onClearInline: () => { cleared++ },
  } })
})

for (const [groupBy, firstKey, secondKey] of [
  ['type', 'folder', 'ext:txt'],
  ['modified', 'month:2026-10', 'month:2026-09'],
  ['size', 'folder', 'tiny'],
]) {
  test('F-PARITY-07C: grouped ' + groupBy +
    ' List disclosure keeps Server group labels, child IDs, one scroll host', async () => {
    const items = [
      { id: 2, name: 'Work', kind: 'dir', revision: 2 },
      { id: 5, name: 'Other', kind: 'dir', revision: 1 },
      { id: 7, name: 'a.txt', kind: 'file', revision: 3 },
      { id: 8, name: 'b.txt', kind: 'file', revision: 4 },
    ]
    const opens = []
    const ranges = []
    const source = {
      interactionKey: 'grouped-' + groupBy,
      itemCount: items.length,
      loadedItems: new Map(items.map((item, index) => [index, item])),
      itemAt: index => items[index],
      groups: [
        { key: firstKey, item_count: 2, start_index: 0 },
        { key: secondKey, item_count: 2, start_index: 2 },
      ],
      onRangeChange: (start, end) => ranges.push(['root', start, end]),
    }
    const branch = {
      ownerID: 2, parentID: 1, parentIndex: 0, name: 'Work',
      itemCount: 3, loading: false, error: null,
      items: new Map([
        [0, { id: 20, name: 'inside.txt', kind: 'file', revision: 7 }],
        [1, { id: 21, name: 'inside-2.txt', kind: 'file', revision: 8 }],
        [2, { id: 22, name: 'Nested', kind: 'dir', revision: 9 }],
      ]),
    }
    await withView(async h => {
      const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
        .find(node => textOf(node.props.children).includes('云端文件'))
      await act(async () => { location.props.onClick() })
      assert.equal(count(h.view, 'data-xdrive-mobile-files-grouped'), 1)
      assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
      assert.ok(find(h.view, 'data-xdrive-mobile-files-group-header', firstKey))
      assert.ok(find(h.view, 'data-xdrive-mobile-files-group-header', secondKey))
      assert.equal(find(h.view, 'data-mobile-files-folder-disclosure', '2').props['aria-expanded'], true)
      const nested = h.view.root.findAll(node =>
        node.props?.['data-mobile-files-depth'] === 1 &&
        node.props?.['aria-label'] === 'inside.txt')
      assert.equal(nested.length, 1, 'nested file is positioned within its real parent group')
      await act(async () => nested[0].props.onClick())
      assert.deepEqual(opens, [[20, 2]], 'shared Open receives authoritative child owner')
      assert.ok(ranges.some(range => range[0] === 'child' &&
        range[1].some(x => x.ownerID === 2 && x.startIndex === 0)))
      await h.update({ inlineBranches: [] })
      assert.equal(h.view.root.findAll(node =>
        node.props?.['aria-label'] === 'inside.txt').length, 0)
      assert.equal(count(h.view, 'data-xdrive-mobile-files-grouped'), 1)
      assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    }, { props: {
      items, virtualCollection: source,
      grouping: { groupBy, foldersFirst: true },
      inlineBranches: [branch],
      onToggleInlineFolder() {},
      onInlineViewport: values => ranges.push(['child', values]),
      onOpenItem: (item, ownerID) => { opens.push([item.id, ownerID]); return false },
    } })
  })
}


test('F-PARITY-07E: mounted selected child survives 100k sparse-page eviction with original Node revision', async () => {
  const retained = []
  const actions = []
  const folder = { id: 2, name: 'Work', kind: 'dir', revision: 2 }
  const child = { id: 41, name: 'inside.txt', kind: 'file', revision: 7 }
  const rootSource = {
    interactionKey: '100k-root', itemCount: 100000,
    loadedItems: new Map([[0, folder]]),
    itemAt: index => index === 0 ? folder : undefined,
    onRangeChange() {},
  }
  const firstBranch = {
    ownerID: 2, parentID: 1, parentIndex: 0, name: 'Work',
    itemCount: 100000, loading: false, error: null,
    items: new Map([[0, child]]),
  }
  await withView(async h => {
    await act(async () => {
      find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} })
    })
    const choose = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    assert.equal(choose.length, 1)
    await act(async () => choose[0].props.onClick())
    const childRow = h.view.root.findAll(node =>
      node.props?.['data-mobile-files-depth'] === 1 &&
      String(node.props?.['aria-label'] ?? '').endsWith('inside.txt'))
    assert.equal(childRow.length, 1)
    await act(async () => childRow[0].props.onClick())
    assert.deepEqual(retained.at(-1), [[41, 7]], 'actual selection hook must notify Web with ID/revision')

    // Preserve selected state while Server's 100k child pages are evicted;
    // Mobile must not silently drop the action when its row unmounts.
    await h.update({ inlineBranches: [{ ...firstBranch, items: new Map() }] })
    assert.equal(h.view.root.findAll(node =>
      node.props?.['data-mobile-files-depth'] === 1 &&
      String(node.props?.['aria-label'] ?? '').endsWith('inside.txt')).length, 0)
    await act(async () => find(h.view, 'aria-label', '复制已选').props.onClick())
    assert.deepEqual(actions, [[[41, 7]]], 'original selection and revision survive eviction')
    assert.deepEqual(retained.at(-1), [[41, 7]])

    const finish = h.view.root.findAll(node =>
      node.props?.children === '完成' && node.props?.onClick)
    assert.equal(finish.length, 1)
    await act(async () => finish[0].props.onClick())
    assert.deepEqual(retained.at(-1), [], 'leaving Select must unpin the old Node')
    await h.update({ lifecycleKey: 'different-user' })
    assert.deepEqual(retained.at(-1), [], 'account switch may not preserve a previous selection')
  }, { props: {
    requestedDirectoryID: 1, items: [folder], virtualCollection: rootSource,
    grouping: { groupBy: 'none', foldersFirst: true },
    inlineBranches: [firstBranch], onToggleInlineFolder() {},
    onCopy: items => actions.push(items.map(item => [item.id, item.revision])),
    onSelectedItemsChange: items => retained.push(items.map(item => [item.id, item.revision])),
  } })
})


test('F-PARITY-07F: mounted Mobile Select All fetches 257 root/search Nodes through same bounded Server ranges', async () => {
  const requests = []
  const retained = []
  const makeNodes = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => ({
    id: first + i + 1000, kind: 'file', name: 'file-' + (first + i) + '.txt', revision: 7,
  }))
  const source = {
    interactionKey: '257-owner-root', itemCount: 257, loadedItems: new Map(),
    itemAt() { return undefined },
    collectRange: async (start, end) => {
      requests.push([start, end])
      return makeNodes(start, end)
    },
    onRangeChange() {},
    retainInteractionIDs() {},
  }
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    assert.equal(select.length, 1)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })
    assert.deepEqual(requests, [[0, 199], [200, 256]],
      'Mobile uses wide Web shared VirtualCollection 200-item logical chunks, not one giant fetch')
    assert.equal(retained.at(-1).length, 257, 'Mobile must not refuse 201+ logical selections')
    assert.deepEqual(retained.at(-1).slice(-1), [[1256, 7]])
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 0, 'progress clears after successful commit')
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    onSelectedItemsChange: items => retained.push(items.map(i => [i.id, i.revision])),
  } })
})

test('F-PARITY-07F: 100k Mobile Select All cancel fences an in-flight page and stops future ranges', async () => {
  let finishPage
  const requests = []
  const observed = []
  const source = {
    interactionKey: '100k-selection', itemCount: 100000, loadedItems: new Map(),
    itemAt() {},
    collectRange: (start, end) => {
      requests.push([start, end])
      return new Promise(resolve => { finishPage = resolve })
    },
    retainInteractionIDs() {}, onRangeChange() {},
  }
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })
    assert.deepEqual(requests, [[0, 199]], '100k selection cannot eagerly request the complete collection')
    const progress = find(h.view, 'data-mobile-files-select-progress', true)
    assert.match(textOf(progress.props.children), /0\s*\/\s*100000/)
    await act(async () => { find(h.view, 'data-mobile-files-select-cancel', true).props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 0)
    await act(async () => { finishPage(Array.from({ length: 200 }, (_, i) => ({
      id: i + 10, name: 'file.txt', kind: 'file', revision: 9,
    }))) })
    assert.deepEqual(requests, [[0, 199]], 'cancel must ignore old completion and never request page 2')
    assert.deepEqual(observed.at(-1), [], 'cancel preserves existing empty selection')
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    onSelectedItemsChange: items => observed.push(items.map(i => i.id)),
  } })
})

test('F-PARITY-07F: stale Select All after account switch cannot commit 100k old IDs', async () => {
  let resolveRange
  const observed = []
  const source = {
    interactionKey: '100k-old-scope', itemCount: 100000,
    loadedItems: new Map(), itemAt() {}, onRangeChange() {},
    collectRange: () => new Promise(resolve => { resolveRange = resolve }),
  }
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })
    await h.update({ lifecycleKey: 'new-account-B', virtualCollection: {
      ...source, interactionKey: '100k-new-scope',
    } })
    await act(async () => {
      resolveRange(Array.from({ length: 200 }, (_, i) => ({
        id: i + 50, name: 'old.txt', kind: 'file', revision: 8,
      })))
    })
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 0)
    assert.deepEqual(observed.at(-1), [], 'old account completion must never repopulate new account selection')
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    onSelectedItemsChange: items => observed.push(items.map(i => i.id)),
  } })
})


test('F-PARITY-07F-B: Mobile selected-action disabled states use the same Wide Web limits', async () => {
  const performed = []
  const calls = []
  const source = {
    interactionKey: '257-action-limit', itemCount: 257, loadedItems: new Map(),
    itemAt() {}, onRangeChange() {}, retainInteractionIDs() {},
    collectRange: async (start, end) => Array.from({ length: end - start + 1 }, (_, index) => ({
      id: 1000 + start + index, kind: 'file', name: 'file-' + (start + index) + '.txt', revision: 3,
    })),
  }
  const mutationActions = new Set(['copy', 'cut', 'delete', 'move-to', 'copy-to'])
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })

    assert.equal(find(h.view, 'aria-label', '复制已选').props.disabled, true)
    assert.equal(find(h.view, 'aria-label', '移动已选').props.disabled, true)
    assert.equal(find(h.view, 'aria-label', '删除已选').props.disabled, true)
    assert.equal(find(h.view, 'aria-label', '下载已选').props.disabled, false,
      '257 files are below the shared 1000-item download cap')
    assert.match(textOf(find(h.view, 'data-mobile-files-selection-limits', true).props.children), /200/)
    await act(async () => { find(h.view, 'aria-label', '复制已选').props.onClick() })
    assert.deepEqual(performed, [], 'even an invoked disabled handler cannot bypass shared validation')

    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    const menu = (text) => h.view.root.findAll(node => node.props?.children === text)[0]
    assert.equal(menu('剪切所选').props.disabled, true)
    assert.equal(menu('复制到…').props.disabled, true)
    assert.equal(menu('下载所选').props.disabled, false)
    assert.equal(menu('添加/管理标签').props.disabled, false,
      'tags retain their independent shared 500-item limit')
    assert.ok(calls.some(([action, count]) => action === 'move-to' && count === 257))
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    getSelectionActionDisabledReason: (action, _items, count) => {
      calls.push([action, count])
      return count > 200 && mutationActions.has(action) ? '单次批量操作最多 200 项' : null
    },
    onCopy: items => performed.push(['copy', items.length]),
    onMove: items => performed.push(['move', items.length]),
    onDelete: items => performed.push(['delete', items.length]),
  } })
})


test('F-PARITY-07F-B: 1001 selected Nodes disable download and tagging at their shared limits', async () => {
  const source = {
    interactionKey: '1001-action-limits', itemCount: 1001, loadedItems: new Map(),
    itemAt() {}, onRangeChange() {}, retainInteractionIDs() {},
    collectRange: async (start, end) => Array.from({ length: end - start + 1 }, (_, index) => ({
      id: 1000 + start + index, kind: 'file', name: 'file-' + (start + index) + '.txt', revision: 3,
    })),
  }
  const mutationActions = new Set(['copy', 'cut', 'delete', 'move-to', 'copy-to'])
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })
    assert.equal(find(h.view, 'aria-label', '复制已选').props.disabled, true)
    assert.equal(find(h.view, 'aria-label', '下载已选').props.disabled, true)
    const feedback = textOf(find(h.view, 'data-mobile-files-selection-limits', true).props.children)
    assert.match(feedback, /200/)
    assert.match(feedback, /1000/)
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    const tag = h.view.root.findAll(node => node.props?.children === '添加/管理标签')[0]
    assert.equal(tag.props.disabled, true)
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    getSelectionActionDisabledReason: (action, _items, count) => {
      const cap = mutationActions.has(action) ? 200 :
        action === 'download' ? 1000 : action === 'manage-tags' ? 500 : Infinity
      return count > cap ? '单次最多 ' + cap + ' 项' : null
    },
  } })
})


test('F-PARITY-07F-C: Mobile multi-item Properties reuses Server recursive stats for a folder plus a file', async () => {
  const requests = []
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => {
      const rows = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      assert.equal(rows.length, 2)
      rows[0].props.onClick()
      rows[1].props.onClick()
    })
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    const action = find(h.view, 'data-mobile-files-batch-properties', true)
    assert.equal(action.props.disabled, false)
    await act(async () => { action.props.onClick() })
    assert.equal(requests.length, 1, 'same shared stats request as wide Web, no mobile REST')
    assert.deepEqual(requests[0].ids, [2, 3], 'folder and file Server identities preserved')
    const dialog = h.view.root.findAll(node => node.type === 'properties-dialog')[0]
    assert.equal(dialog.props.open, true)
    assert.equal(dialog.props.title, '所选项目属性')
    const fields = Object.fromEntries(dialog.props.properties.map(p => [p.label, p.value]))
    assert.equal(fields['项目数'], '2 个')
    assert.equal(fields['位置'], '我的文件')
    assert.equal(fields['内容'], '3 个文件 · 2 个文件夹')
    assert.equal(fields['文件大小合计'], '5120 B')
    await act(async () => { dialog.props.onClose() })
    assert.equal(requests[0].signal.aborted, true, 'closing aborts Server stats as on wide Web')
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 1,
      'inspecting a selection does not clear it')
    assert.equal(h.view.root.findAll(node => node.props?.['aria-pressed'] === true).length, 2)
  }, { props: {
    loadPropertiesStats: async (items, signal) => {
      requests.push({ ids: items.map(item => item.id), signal })
      return { selected_count: 2, effective_root_count: 2, total_bytes: 5120,
        file_count: 3, folder_count: 2, sources: [] }
    },
  } })
})

test('F-PARITY-07F-C: Mobile file-only multi Properties compute local bytes without Server scan', async () => {
  let calls = 0
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => {
      const rows = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      rows[0].props.onClick()
      rows[1].props.onClick()
    })
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    await act(async () => { find(h.view, 'data-mobile-files-batch-properties', true).props.onClick() })
    const dialog = h.view.root.findAll(node => node.type === 'properties-dialog')[0]
    const fields = Object.fromEntries(dialog.props.properties.map(p => [p.label, p.value]))
    assert.equal(fields['项目数'], '2 个')
    assert.equal(fields['内容'], '2 个文件 · 0 个文件夹')
    assert.equal(fields['文件大小合计'], '1000 B')
    assert.equal(calls, 0, 'multi-file summary must not make unnecessary recursive API call')
  }, { props: {
    items: [
      { id: 3, name: 'one.txt', kind: 'file', revision: 1, size: 120 },
      { id: 4, name: 'two.txt', kind: 'file', revision: 2, size: 880 },
    ],
    loadPropertiesStats: async () => { calls += 1; throw Error('unexpected recursive stats') },
  } })
})

test('F-PARITY-07F-C: changing account scope closes multi Properties and aborts old request', async () => {
  let request = null
  let finish
  await withView(async h => {
    const rootLocation = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { rootLocation.props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => {
      const rows = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      rows[0].props.onClick()
      rows[1].props.onClick()
    })
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    await act(async () => { find(h.view, 'data-mobile-files-batch-properties', true).props.onClick() })
    assert.ok(request)
    assert.equal(request.signal.aborted, false)
    await h.update({ lifecycleKey: 'another-account' })
    assert.equal(request.signal.aborted, true)
    assert.equal(h.view.root.findAll(node => node.type === 'properties-dialog')[0].props.open, false)
    await act(async () => finish({ selected_count: 2, effective_root_count: 2,
      total_bytes: 9000, file_count: 9, folder_count: 1, sources: [] }))
    assert.equal(h.view.root.findAll(node => node.type === 'properties-dialog')[0].props.open, false,
      'late Server stats cannot reopen old-account properties')
  }, { props: {
    loadPropertiesStats: (items, signal) => {
      request = { ids: items.map(item => item.id), signal }
      return new Promise(resolve => { finish = resolve })
    },
  } })
})


test('F-PARITY-07F-C: sparse 257-file selection can inspect all files without loading 257 DOM rows', async () => {
  const ranges = []
  let statsCalls = 0
  const source = {
    interactionKey: '257-file-properties', itemCount: 257, loadedItems: new Map(),
    itemAt() {}, onRangeChange() {}, retainInteractionIDs() {},
    collectRange: async (start, end) => {
      ranges.push([start, end])
      return Array.from({ length: end - start + 1 }, (_, index) => ({
        id: 1000 + start + index, name: 'file-' + (start + index) + '.txt',
        kind: 'file', revision: 4, size: 2,
      }))
    },
  }
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })
    assert.deepEqual(ranges, [[0, 199], [200, 256]], 'shared 200-item Server range contract')
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    await act(async () => { find(h.view, 'data-mobile-files-batch-properties', true).props.onClick() })
    const dialog = h.view.root.findAll(node => node.type === 'properties-dialog')[0]
    const fields = Object.fromEntries(dialog.props.properties.map(p => [p.label, p.value]))
    assert.equal(fields['项目数'], '257 个')
    assert.equal(fields['文件大小合计'], '514 B')
    assert.equal(statsCalls, 0, 'file-only stats should not request a 257-file recursive scan')
    assert.ok(count(h.view, 'data-mobile-files-item') < 257,
      'inspection does not materialize the full collection as item rows')
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    loadPropertiesStats: async () => { statsCalls += 1; throw Error('unneeded stats') },
  } })
})
