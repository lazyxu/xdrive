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
const keyboard = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', compile('ui/shared/src/file-explorer-keyboard.ts'))(
    mod, mod.exports,
  )
  return mod.exports
})()
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
const deferredLoading = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require',
    compile('ui/shared/src/mui/useDeferredLoading.ts'))(
    mod, mod.exports, name => {
      if (name === 'react') return React
      throw Error('Unexpected deferred loading dependency: ' + name)
    })
  return mod.exports
})()
const material = new Proxy({}, { get: (_, name) => String(name) })
const sharedNameDialog = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require',
    compile('ui/shared/src/mui/FileNameDialog.tsx', true))(
    mod, mod.exports, name => {
      if (name === 'react') return React
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (name === '@mui/material') return material
      if (name === './ActionButton') return { XDriveActionButton: 'Button' }
      if (name === './DialogContent') return { XDriveDialogContent: 'DialogContent' }
      if (name === './DialogTitle') return {
        XDriveDialogTitle: 'DialogTitle', xDriveDialogPaperProps: { sx: {} },
      }
      throw Error('Unexpected shared name dialog import: ' + name)
    },
  )
  return mod.exports.XDriveFileNameDialog
})()
const ui = {
  XDriveFileNameDialog: sharedNameDialog,
  XDriveStatePanel: 'state-panel',
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
const menuReasons = (() => {
  const mod = { exports: {} }
  new Function('module', 'exports', compile('ui/shared/src/mui/FileExplorerMenuReasons.ts'))(
    mod, mod.exports,
  )
  return mod.exports
})()
const imports = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': material,
  '@xdrive/ui/mui': ui,
  '../../ui/shared/src': {
    ...inline, ...keyboard,
    XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE: 200,
    formatBytes: n => n + ' B',
    xDriveFileExplorerDragAutoScrollDelta: () => 0,
    xDriveFileKind: name => /\.(?:png|jpg|livp)$/i.test(name) ? 'image' : 'file',
  },
  '../../ui/shared/src/mui/useDeferredLoading': deferredLoading,
  '../../ui/shared/src/mui/usePointerDrag': {
    useXDrivePointerDrag: () => ({
      active: false,
      begin: (...args) => { dragCalls.push(['begin', ...args]); return true },
      cancel: () => { dragCalls.push(['cancel']) },
    }),
  },
  './mobileFilesState': state,
  '../../ui/shared/src/mui/FileExplorerMenuReasons': menuReasons,
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
async function withView(action, { saved, props, createNodeMock } = {}) {
  const previous = global.window
  const win = storage()
  global.window = win
  if (saved) win.localStorage.setItem('xdrive.mobile.files.v1:ios-files-userA', state.mobileFilesEncodeState(saved))
  let view
  let current = defaults(props)
  try {
    await act(async () => { view = Renderer.create(
      React.createElement(MobileFiles, current),
      createNodeMock ? { createNodeMock } : undefined,
    ) })
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
      const buttons = h.view.root.findAll(node => node.props?.onClick && node.props['aria-label'] === '返回')
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
    assert.equal(nav.props.sx.minHeight, 56)
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


test('F-iOS27-10C: mounted Files shows genuine date/decimal size without hiding Search paths', async () => {
  const modified = new Date(2026, 1, 26, 12).toISOString()
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })

    const row = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      .find(node => node.props['aria-label'] === '报告.pdf')
    assert.ok(row, 'FileExplorer virtual row must be projected through the shared Node')
    const label = row.findAll(node => node.props?.['data-mobile-files-item-meta'] !== undefined)[0]
    assert.equal(textOf(label.props.children), '2026/2/26 - 55 KB')
    const image = row.findAll(node => node.type === 'file-thumbnail')[0]
    assert.ok(image)
    assert.equal(image.props.eligible, false, 'PDF does not invent or request an image thumbnail')
    assert.equal(image.props.fallback.props.size, 36,
      'real document fallback should fill the 44px thumbnail cell without clipping')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)

    await h.update({ items: [{
      id: 3, name: '报告.pdf', kind: 'file', revision: 1, size: 55_000,
      updatedAt: modified, secondaryLabel: '我的文件/资料/报告.pdf',
    }], searchActive: true })
    const result = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      .find(node => node.props['aria-label'] === '报告.pdf')
    assert.ok(result)
    const path = result.findAll(node => node.props?.['data-mobile-files-item-meta'] !== undefined)[0]
    assert.equal(textOf(path.props.children), '我的文件/资料/报告.pdf',
      'Search must preserve the authoritative breadcrumb instead of an invented date-only context')
  }, { props: {
    items: [
      { id: 2, name: '照片文件夹', kind: 'dir', revision: 1 },
      { id: 3, name: '报告.pdf', kind: 'file', revision: 1, size: 55_000, updatedAt: modified },
    ],
    recentItems: [{ id: 3, name: '报告.pdf', kind: 'file', revision: 1,
      size: 55_000, updatedAt: modified }],
  } })
})

test('F-iOS27-10B: native List leading disclosure and files share one 84px text baseline', async () => {
  const expanded = []
  const opened = []
  await withView(async h => {
    const location = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { location.props.onClick() })
    const row = find(h.view, 'data-mobile-files-folder-id', '2')
    const disclosure = find(h.view, 'data-mobile-files-folder-disclosure', '2')
    const thumb = row.findAll(node =>
      node.props?.['data-mobile-files-thumbnail-slot'] !== undefined)[0]
    assert.ok(thumb, 'the folder still owns one thumbnail slot')
    assert.equal(row.children[0], disclosure,
      'the genuine accessible disclosure must precede the folder thumbnail and text')
    assert.equal(disclosure.props.sx.width, 44)
    assert.equal(disclosure.props.sx.height, 44)
    assert.equal(row.props.sx.gap, 0)
    assert.equal(row.props.sx.px, 0)
    assert.equal(thumb.props.sx.width, 40)
    assert.equal(row.props.sx['&:not(:last-child)::after'].left, 84)
    const ordinary = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
      .find(node => node.props['aria-label'] === '说明.txt')
    assert.ok(ordinary)
    assert.equal(ordinary.children[0].props['data-mobile-files-leading-spacer'], true)
    assert.equal(ordinary.props.sx.gap, 0)
    assert.equal(ordinary.props.sx.px, 0)
    assert.equal(ordinary.props.sx['&:not(:last-child)::after'].left, 84)
    let stopped = 0
    await act(async () => { disclosure.props.onClick({ stopPropagation() { stopped++ } }) })
    assert.equal(stopped, 1)
    assert.deepEqual(expanded, [[2, 1, 0]])
    assert.deepEqual(opened, [], 'leading disclosure must not enter a folder')
    await act(async () => { row.props.onClick() })
    assert.deepEqual(opened, [[2, 1]], 'folder row must still open through the shared workspace')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    await act(async () => { find(h.view, 'data-mobile-files-view-option', 'grid').props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-folder-disclosure'), 0,
      'Grid may not pretend to implement inline List expansion')
  }, { props: {
    grouping: { groupBy: 'none', foldersFirst: true },
    onToggleInlineFolder: (item, owner, index) => expanded.push([item.id, owner, index]),
    onOpenItem: (item, owner) => { opened.push([item.id, owner]); return false },
  } })
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

test('P57: Mobile Files 100k sparse pages replace quiet fixed-height slots without list remount', async () => {
  const first = { id: 2, name: 'photo.jpg', kind: 'file', revision: 1 }
  const second = { id: 3, name: 'folder.txt', kind: 'file', revision: 1 }
  const visible = new Map([[0, first]])
  const page = {
    interactionKey: 'p57-100k-owner-range', itemCount: 100_000,
    loadedItems: visible, itemAt: index => visible.get(index), onRangeChange() {},
  }
  const placeholders = h => h.view.root.findAll(n =>
    Object.hasOwn(n.props ?? {}, 'data-mobile-files-placeholder'))
  await withView(async h => {
    const root = h.view.root.findAll(n => n.props?.role === 'button' && n.props?.onClick)
      .find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(root, 'real mounted Browse Home should contain the Cloud entry')
    await act(async () => { root.props.onClick() })
    const cells = placeholders(h)
    assert.ok(cells.length > 0 && cells.length < 30, 'only visible sparse window is rendered')
    for (const cell of cells) {
      assert.equal(cell.props['aria-hidden'], true)
      assert.equal(cell.props.sx.minHeight, state.MOBILE_FILES_ROW_HEIGHT)
      assert.equal(cell.props.sx.pointerEvents, 'none')
      assert.equal(textOf(cell.props.children).includes('加载中'), false,
        'a short real first-Range read must not flash a caption')
    }
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.ok(h.view.root.findAll(n => n.props?.['data-mobile-files-item'] === true)
      .some(n => n.props['aria-label'] === 'photo.jpg'))
    visible.set(1, second)
    await h.update({ virtualCollection: { ...page, loadedItems: new Map(visible) } })
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(placeholders(h).length, cells.length - 1,
      'one authorized sparse item replaces one reserved row')
    assert.ok(h.view.root.findAll(n => n.props?.['data-mobile-files-item'] === true)
      .some(n => n.props['aria-label'] === 'folder.txt'))
  }, { props: { items: [first], virtualCollection: page,
    grouping: { groupBy: 'none', foldersFirst: true } } })
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
  let selectSignal
  const requests = []
  const observed = []
  const source = {
    interactionKey: '100k-selection', itemCount: 100000, loadedItems: new Map(),
    itemAt() {},
    collectRange: (start, end, signal) => {
      requests.push([start, end])
      selectSignal = signal
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
    assert.equal(selectSignal?.aborted, true, 'Mobile cancel must reach the shared request signal immediately')
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
    const menu = id => find(h.view, 'data-mobile-files-selection-action', id)
    assert.equal(menu('cut').props.disabled, true)
    assert.equal(menu('copy-to').props.disabled, true)
    assert.match(menu('cut').props.title, /200/)
    assert.match(menu('cut').props['aria-label'], /200/)
    assert.match(textOf(menu('cut').props.children), /不可用.*200/)
    assert.match(textOf(menu('copy-to').props.children), /不可用.*200/)
    await act(async () => { menu('cut').props.onClick() })
    assert.deepEqual(performed, [], 'disabled direct callbacks must not mutate')
    assert.equal(menu('download').props.disabled, false)
    assert.doesNotMatch(textOf(menu('download').props.children), /不可用/)
    assert.equal(menu('manage-tags').props.disabled, false,
      'tags retain their independent shared 500-item limit')
    assert.deepEqual(find(h.view, 'data-mobile-files-selection-menu', true).props.slotProps.list,
      { disabledItemsFocusable: true })
    assert.equal(find(h.view, 'data-mobile-files-selection-menu', true).props.slotProps.paper.sx.maxHeight,
      'min(70dvh, 560px)', 'expanded disabled reasons must remain scrollable in short landscape windows')
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
    const tag = find(h.view, 'data-mobile-files-selection-action', 'manage-tags')
    const download = find(h.view, 'data-mobile-files-selection-action', 'download')
    assert.equal(tag.props.disabled, true)
    assert.equal(download.props.disabled, true)
    assert.match(tag.props['aria-label'], /500/)
    assert.match(download.props['aria-label'], /1000/)
    assert.match(textOf(tag.props.children), /不可用.*500/)
    assert.match(textOf(download.props.children), /不可用.*1000/)
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    getSelectionActionDisabledReason: (action, _items, count) => {
      const cap = mutationActions.has(action) ? 200 :
        action === 'download' ? 1000 : action === 'manage-tags' ? 500 : Infinity
      return count > cap ? '单次最多 ' + cap + ' 项' : null
    },
  } })
})


test('U03: actual mounted 100k full Select All commits atomically and explains every bulk limit', async () => {
  const requests = []
  const accepted = []
  const attempted = []
  const source = {
    interactionKey: 'u03-full-100k-logical-select', itemCount: 100_000, loadedItems: new Map(),
    itemAt() { return undefined },
    onRangeChange() {},
    retainInteractionIDs() {},
    collectRange: async (start, end, signal) => {
      assert.equal(signal?.aborted, false, 'in-scope page should not be aborted')
      assert.ok(end >= start && end - start < 200, 'each real collection request is at most 200 items')
      requests.push([start, end])
      return Array.from({ length: end - start + 1 }, (_, index) => ({
        id: 1000 + start + index, kind: 'file',
        name: '100k-' + (start + index) + '.txt', revision: 9,
      }))
    },
  }
  const limits = action => action === 'download' ? 1000 :
    action === 'manage-tags' ? 500 : 200
  await withView(async h => {
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.props?.children === '选择' && node.props?.onClick)
    assert.equal(select.length, 1)
    await act(async () => { select[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-select-all', true).props.onClick() })

    assert.equal(requests.length, 500, '100k must request exactly 500 bounded 200-item chunks')
    assert.deepEqual(requests[0], [0, 199])
    assert.deepEqual(requests[499], [99_800, 99_999])
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 0, 'progress clears only after atomic success')
    assert.deepEqual(accepted.at(-1), { count: 100_000, first: [1000, 9], last: [100999, 9] },
      'all 100k original Node IDs and revisions must commit together, not just a viewport sample')

    for (const action of ['复制已选', '移动已选', '下载已选', '删除已选']) {
      assert.equal(find(h.view, 'aria-label', action).props.disabled, true, action + ' must remain guarded')
    }
    const feedback = textOf(find(h.view, 'data-mobile-files-selection-limits', true).props.children)
    assert.match(feedback, /200/, 'mutation limit displayed after large logical selection')
    assert.match(feedback, /1000/, 'download limit displayed after large logical selection')
    await act(async () => {
      find(h.view, 'aria-label', '复制已选').props.onClick()
      find(h.view, 'aria-label', '下载已选').props.onClick()
    })
    assert.deepEqual(attempted, [], 'a direct disabled callback invocation must not bypass shared limits')
    await act(async () => { find(h.view, 'aria-label', '更多已选操作').props.onClick({ currentTarget: {} }) })
    for (const [action, bound] of [['cut', 200], ['copy-to', 200], ['download', 1000], ['manage-tags', 500]]) {
      const item = find(h.view, 'data-mobile-files-selection-action', action)
      assert.equal(item.props.disabled, true, action)
      assert.match(item.props['aria-label'], new RegExp(String(bound)), action + ' must announce precise limit')
      assert.match(textOf(item.props.children), /不可用/, action + ' must show visible reason')
    }
    const done = h.view.root.findAll(node => node.props?.children === '完成' && node.props?.onClick)
    assert.equal(done.length, 1)
    await act(async () => { done[0].props.onClick() })
    assert.equal(accepted.at(-1)?.count, 0, 'leaving selection drops every selected identity')
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    onSelectedItemsChange: items => accepted.push({
      count: items.length,
      first: items[0] ? [items[0].id, items[0].revision] : undefined,
      last: items.at(-1) ? [items.at(-1).id, items.at(-1).revision] : undefined,
    }),
    getSelectionActionDisabledReason: (action, _items, count) =>
      count > limits(action) ? '单次操作最多 ' + limits(action) + ' 项' : null,
    onCopy: items => attempted.push(['copy', items.length]),
    onMove: items => attempted.push(['move', items.length]),
    onDelete: items => attempted.push(['delete', items.length]),
    onDownload: items => attempted.push(['download', items.length]),
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


test('F-iOS27-08A: More exposes explicit iOS Files Icons/List radio choices without forking wide Web state', async () => {
  const sorts = []
  const wideViews = []
  await withView(async h => {
    assert.equal(count(h.view, 'data-mobile-files-view-option'), 0,
      'Browse home has no directory view switch')
    const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { root.props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const icons = find(h.view, 'data-mobile-files-view-option', 'grid')
    const list = find(h.view, 'data-mobile-files-view-option', 'details')
    assert.equal(icons.props.role, 'menuitemradio')
    assert.equal(list.props.role, 'menuitemradio')
    assert.equal(icons.props['aria-checked'], false)
    assert.equal(list.props['aria-checked'], true)
    assert.equal(list.props.selected, true)
    assert.equal(icons.props.sx.minHeight, 44)
    assert.equal(list.props.sx.minHeight, 44)
    assert.equal(count(h.view, 'data-mobile-files-view-group'), 2,
      'More keeps Files view choices in an independent native-like group')
    assert.equal(h.view.root.findAll(node => node.props?.children === '切换到图标' ||
      node.props?.children === '切换到列表').length, 0)
    await act(async () => { icons.props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-view-option', 'grid').props['aria-checked'], true)
    assert.equal(find(h.view, 'data-mobile-files-view-option', 'details').props['aria-checked'], false)
    assert.match(textOf(find(h.view, 'data-mobile-files-arrangement-status', true).props.children),
      /名称 ↑ · 图标/)
    assert.match(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'), /"view":"grid"/)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    await act(async () => { find(h.view, 'data-mobile-files-view-option', 'details').props.onClick() })
    assert.equal(find(h.view, 'data-mobile-files-view-option', 'details').props.selected, true)
    assert.match(textOf(find(h.view, 'data-mobile-files-arrangement-status', true).props.children),
      /名称 ↑ · 列表/)
    assert.match(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'), /"view":"details"/)
    assert.deepEqual(sorts, [], 'Mobile view is presentation only; Server sort did not change')
    assert.deepEqual(wideViews, [], 'switching Mobile view must not overwrite wide Web Columns preference')
  }, { props: {
    onSortChange: next => sorts.push(next),
    onViewModeChange: next => wideViews.push(next),
  } })
})

test('F-iOS27-08A: native-like More keeps real backed sort/group actions and touch targets', async () => {
  const changes = []
  const groupChanges = []
  await withView(async h => {
    const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    await act(async () => { root.props.onClick() })
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const arrange = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '排序与分组')
    assert.equal(arrange.length, 1)
    assert.equal(arrange[0].props.sx.minHeight, 44)
    await act(async () => { arrange[0].props.onClick() })
    const bySize = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '大小')[0]
    assert.ok(bySize)
    assert.equal(bySize.props.sx.minHeight, 44)
    await act(async () => { bySize.props.onClick() })
    assert.deepEqual(changes, [{ key: 'size', direction: 'asc' }])
    const group = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '按类型分组')[0]
    assert.ok(group)
    assert.equal(group.props.sx.minHeight, 44)
    await act(async () => { group.props.onClick() })
    assert.deepEqual(groupChanges, [{ groupBy: 'type', foldersFirst: true }])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onSortChange: value => changes.push(value),
    grouping: { groupBy: 'none', foldersFirst: true },
    onGroupingChange: value => groupChanges.push(value),
  } })
})


test('F-iOS27-08B: Recent/Favorites 68px row geometry matches the shared virtual viewport and file-name dividers', async () => {
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const recent = find(h.view, 'data-mobile-files-collection-row', 'recent')
    assert.equal(recent.props.sx.minHeight, state.MOBILE_FILES_ROW_HEIGHT)
    assert.equal(recent.props.sx['&:not(:last-child)::after'].left, 84)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const favorite = find(h.view, 'data-mobile-files-collection-row', 'favorites')
    assert.equal(favorite.props.sx.minHeight, state.MOBILE_FILES_ROW_HEIGHT)
    assert.equal(favorite.props.sx['&:not(:last-child)::after'].left, 84)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'browse').props.onClick() })
    const cloud = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(cloud)
    await act(async () => { cloud.props.onClick() })
    let item = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    assert.ok(item)
    assert.equal(item.props.sx.minHeight, state.MOBILE_FILES_ROW_HEIGHT)
    assert.equal(item.props.sx['&:not(:last-child)::after'].left, 84)
    await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
    const select = h.view.root.findAll(node => node.type === 'MenuItem' && node.props?.children === '选择')[0]
    assert.ok(select)
    await act(async () => { select.props.onClick() })
    item = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)[0]
    assert.equal(item.props.sx['&:not(:last-child)::after'].left, 120,
      '28px native gutter plus the selected circle adds exactly its true 36px slot')
    assert.equal(item.props.sx['&:not(:last-child)::after'].left -
      state.mobileFilesRowTextInset(false), 36,
      'selection must preserve the existing 68px virtual row and only move the divider')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  })
})

test('F-iOS27-08B: collection ContextMenu and Shift+F10 open same 44px native menu without opening the file', async () => {
  const actions = []
  const opens = []
  let prevented = 0
  await withView(async h => {
    // Browse-home locations do not expose an invented collection context.
    assert.equal(h.view.root.findAll(node => node.props?.['data-mobile-files-collection-row'] !== undefined).length, 0)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const recent = find(h.view, 'data-mobile-files-collection-row', 'recent')
    assert.equal(recent.props['aria-keyshortcuts'], 'Shift+F10')
    const rect = { getBoundingClientRect: () => ({ left: 30, top: 60 }) }
    await act(async () => { recent.props.onKeyDown({
      key: 'ContextMenu', target: rect, currentTarget: rect, shiftKey: false,
      preventDefault() { prevented += 1 },
    }) })
    let menu = find(h.view, 'data-mobile-files-collection-menu', true)
    assert.equal(menu.props.open, true)
    assert.deepEqual(menu.props.anchorPosition, { left: 44, top: 88 })
    assert.deepEqual(opens, [], 'opening a keyboard menu does not dispatch File Open')
    for (const option of menu.findAll(node => node.type === 'MenuItem')) {
      assert.equal(option.props.sx.minHeight, 44)
    }
    const download = menu.findAll(node => node.props?.['data-mobile-files-collection-action'] === 'download')[0]
    assert.ok(download)
    await act(async () => { download.props.onClick() })
    assert.deepEqual(actions, [{ id: 2, action: 'download' }])
    assert.equal(find(h.view, 'data-mobile-files-collection-menu', true).props.open, false)

    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const favorite = find(h.view, 'data-mobile-files-collection-row', 'favorites')
    await act(async () => { favorite.props.onKeyDown({
      key: 'F10', shiftKey: true, target: rect, currentTarget: rect,
      preventDefault() { prevented += 1 },
    }) })
    menu = find(h.view, 'data-mobile-files-collection-menu', true)
    assert.equal(menu.props.open, true)
    const unfavorite = menu.findAll(node => node.props?.children === '取消收藏')[0]
    assert.ok(unfavorite)
    await act(async () => { unfavorite.props.onClick() })
    assert.deepEqual(actions.at(-1), { id: 3, action: 'unfavorite' })

    await act(async () => { favorite.props.onKeyDown({
      key: 'ContextMenu', shiftKey: false, target: {}, currentTarget: rect,
      preventDefault() { throw Error('nested edit control must retain keyboard ownership') },
    }) })
    assert.equal(find(h.view, 'data-mobile-files-collection-menu', true).props.open, false)
    await act(async () => { favorite.props.onKeyDown({
      key: 'Enter', shiftKey: false, target: rect, currentTarget: rect,
      preventDefault() { prevented += 1 },
    }) })
    assert.deepEqual(opens, ['favorite:3'], 'ordinary Enter still invokes original backed activation')
    assert.equal(prevented, 3)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onOpenRecent: async id => { opens.push('recent:' + id); return false },
    onOpenFavorite: async id => { opens.push('favorite:' + id); return true },
    onCollectionAction: async (entry, action) => { actions.push({ id: entry.id, action }) },
    onUnfavorite: async id => { actions.push({ id, action: 'unfavorite' }) },
  } })
})


async function openMobileRename(h, name = '说明.txt') {
  const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
    .find(node => textOf(node.props.children).includes('云端文件'))
  assert.ok(root)
  await act(async () => { root.props.onClick() })
  const file = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
    .find(node => node.props?.['aria-label'] === name)
  assert.ok(file, 'expected backed Mobile Files item: ' + name)
  await act(async () => { file.props.onContextMenu({
    preventDefault() {}, clientX: 48, clientY: 90,
    nativeEvent: { pointerType: 'mouse' },
  }) })
  await act(async () => { find(h.view, 'data-mobile-files-item-rename', true).props.onClick() })
  const dialog = () => find(h.view, 'aria-label', '重命名')
  assert.equal(dialog().props.open, true)
  return dialog
}

async function submitMobileRename(h) {
  const dialog = find(h.view, 'aria-label', '重命名')
  const form = dialog.findAll(node => node.type === 'Box' && node.props?.component === 'form')[0]
  assert.ok(form, 'shared name Dialog owns the one form submission')
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} })
    await Promise.resolve()
    await Promise.resolve()
  })
}

test('F-iOS27-08C: Mobile rename reuses actual wide-Web shared dialog for 403 denial, inline error and exact-revision retry', async () => {
  const attempts = []
  await withView(async h => {
    const dialog = await openMobileRename(h)
    const input = () => dialog().findAll(node => node.type === 'TextField' && node.props?.label === '名称')[0]
    assert.equal(input().props.value, '说明.txt')
    await act(async () => { input().props.onChange({ target: { value: '新名字.txt' } }) })
    await submitMobileRename(h)
    assert.equal(dialog().props.open, true, '403 from real Web adapter keeps dialog open')
    assert.equal(input().props.value, '新名字.txt', 'rejected draft is not discarded')
    assert.equal(input().props.error, true)
    assert.match(input().props.helperText, /403.*禁止重命名/)
    assert.deepEqual(attempts, [{ id: 3, revision: 1, name: '新名字.txt' }])
    await submitMobileRename(h)
    assert.equal(dialog().props.open, false, 'authorized retry closes the same dialog')
    assert.deepEqual(attempts, [
      { id: 3, revision: 1, name: '新名字.txt' },
      { id: 3, revision: 1, name: '新名字.txt' },
    ])
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onRename: async (item, name) => {
      attempts.push({ id: item.id, revision: item.revision, name })
      if (attempts.length === 1) throw new Error('403 禁止重命名')
    },
  } })
})

test('F-iOS27-08C: shared 255 UTF-8 byte rule blocks invalid Mobile rename before Server action and clears error on edit', async () => {
  const mutations = []
  await withView(async h => {
    const dialog = await openMobileRename(h)
    const input = () => dialog().findAll(node => node.type === 'TextField' && node.props?.label === '名称')[0]
    const oversized = '相'.repeat(86) // 258 UTF-8 bytes
    await act(async () => { input().props.onChange({ target: { value: oversized } }) })
    await submitMobileRename(h)
    assert.equal(mutations.length, 0, 'invalid name must never reach Web/Server')
    assert.equal(dialog().props.open, true)
    assert.equal(input().props.value, oversized)
    assert.match(input().props.helperText, /255.*UTF-8/)
    await act(async () => { input().props.onChange({ target: { value: '短名称.txt' } }) })
    assert.equal(input().props.error, false, 'typing clears previous validation error')
    await submitMobileRename(h)
    assert.deepEqual(mutations, [{ id: 3, revision: 1, name: '短名称.txt' }])
    assert.equal(dialog().props.open, false)
  }, { props: {
    onRename: async (item, name) => { mutations.push({ id: item.id, revision: item.revision, name }) },
  } })
})

test('F-iOS27-08C: Mobile rename closes on account scope switch and old denied completion cannot change next dialog', async () => {
  let rejectOld
  const pending = new Promise((resolve, reject) => { rejectOld = reject })
  let calls = 0
  await withView(async h => {
    const dialog = await openMobileRename(h)
    const input = () => dialog().findAll(node => node.type === 'TextField' && node.props?.label === '名称')[0]
    await act(async () => { input().props.onChange({ target: { value: '旧账户改名.txt' } }) })
    const form = dialog().findAll(node => node.type === 'Box' && node.props?.component === 'form')[0]
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); await Promise.resolve() })
    assert.equal(calls, 1)
    assert.equal(input().props.disabled, true, 'pending Server write owns the name form')
    await h.update({ lifecycleKey: 'ios-files-userB' })
    assert.equal(dialog().props.open, false, 'old-owner rename must close')
    await act(async () => { rejectOld(new Error('旧账户 403')); await Promise.resolve(); await Promise.resolve() })
    assert.equal(dialog().props.open, false)
    assert.equal(input().props.error, false, 'late rejection cannot re-open an owner-scoped dialog')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    onRename: async () => { calls += 1; await pending },
  } })
})


async function openFios09Context(h, name = '说明.txt') {
  if (count(h.view, 'data-xdrive-mobile-files-home')) {
    const root = h.view.root.findAll(node => node.props?.role === 'button' && node.props?.onClick)
      .find(node => textOf(node.props.children).includes('云端文件'))
    assert.ok(root, 'the real Browse location must open the shared Web workspace')
    await act(async () => { root.props.onClick() })
  }
  const row = h.view.root.findAll(node => node.props?.['data-mobile-files-item'] !== undefined)
    .find(node => node.props?.['aria-label'] === name)
  assert.ok(row, 'expected an authenticated Mobile item: ' + name)
  await act(async () => {
    row.props.onContextMenu({
      preventDefault() {}, clientX: 48, clientY: 90,
      nativeEvent: { pointerType: 'mouse' },
    })
  })
  return row
}

test('F-iOS27-09A: direct held file Cut/Copy/Move/Copy-To use exactly one shared Web Node identity and revision', async () => {
  const called = []
  const checked = []
  await withView(async h => {
    for (const action of ['copy', 'cut', 'move-to', 'copy-to']) {
      await openFios09Context(h)
      const item = find(h.view, 'data-mobile-files-context-selection-action', action)
      assert.equal(item.props.disabled, false)
      assert.equal(item.props.sx.minHeight, 44, 'native iOS context target is at least 44px')
      await act(async () => { item.props.onClick() })
      const actual = called.at(-1)
      assert.deepEqual(actual, {
        action, items: [{ id: 3, revision: 1, name: '说明.txt', kind: 'file' }],
      })
      const opened = h.view.root.findAll(node =>
        node.type === 'Menu' && node.props?.anchorReference === 'anchorPosition' && node.props?.open)
      assert.equal(opened.length, 0, 'command closes the same owner-scoped context menu')
    }
    assert.deepEqual(checked.filter(x => ['copy', 'cut', 'move-to', 'copy-to'].includes(x.action))
      .map(x => [x.action, x.count, x.items.map(i => [i.id, i.revision])]).slice(0, 4),
      [['cut', 1, [[3, 1]]], ['copy', 1, [[3, 1]]],
        ['move-to', 1, [[3, 1]]], ['copy-to', 1, [[3, 1]]]],
      'render-time disabled state must call the exact shared wide-Web eligibility contract')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1)
  }, { props: {
    getSelectionActionDisabledReason: (action, items, count) => {
      checked.push({ action, items, count })
      return null
    },
    onCut: items => called.push({ action: 'cut', items: items.map(i => ({ id: i.id, revision: i.revision, name: i.name, kind: i.kind })) }),
    onCopy: items => called.push({ action: 'copy', items: items.map(i => ({ id: i.id, revision: i.revision, name: i.name, kind: i.kind })) }),
    onMove: items => called.push({ action: 'move-to', items: items.map(i => ({ id: i.id, revision: i.revision, name: i.name, kind: i.kind })) }),
    onCopyTo: items => called.push({ action: 'copy-to', items: items.map(i => ({ id: i.id, revision: i.revision, name: i.name, kind: i.kind })) }),
  } })
})

test('F-iOS27-09A: held folder Copy/Move uses same exact Node ID/revision, never a truncated virtual selection', async () => {
  const observed = []
  await withView(async h => {
    await openFios09Context(h, '照片文件夹')
    const copy = find(h.view, 'data-mobile-files-context-selection-action', 'copy')
    await act(async () => { copy.props.onClick() })
    await openFios09Context(h, '照片文件夹')
    const move = find(h.view, 'data-mobile-files-context-selection-action', 'move-to')
    await act(async () => { move.props.onClick() })
    assert.deepEqual(observed, [
      ['copy', 2, 1, 'dir'], ['move-to', 2, 1, 'dir'],
    ])
  }, { props: {
    onCopy: items => observed.push(['copy', items[0].id, items[0].revision, items[0].kind]),
    onMove: items => observed.push(['move-to', items[0].id, items[0].revision, items[0].kind]),
  } })
})

test('F-iOS27-09A: direct file actions honor and recheck shared forbidden/unknown metadata states', async () => {
  const operations = []
  const disabled = new Set(['cut', 'move-to', 'copy-to'])
  const reasons = []
  await withView(async h => {
    await openFios09Context(h)
    for (const action of disabled) {
      const item = find(h.view, 'data-mobile-files-context-selection-action', action)
      assert.equal(item.props.disabled, true, action + ' must be disabled by the shared Web validator')
      assert.equal(item.props.title, '原始 Node/Revision 暂不可用')
      const label = ({ cut: '剪切', 'move-to': '移动到…', 'copy-to': '复制到…' })[action]
      assert.equal(item.props['aria-label'], label + '：原始 Node/Revision 暂不可用',
        'VoiceOver receives one clear action label plus one real disabled reason')
      assert.match(textOf(item.props.children), /不可用：原始 Node\/Revision 暂不可用/,
        'the same reason must remain readable on a touch screen')
      // Force an otherwise disabled callback to ensure the guard also blocks
      // programmatic invocation while a native Portal state is stale.
      await act(async () => { item.props.onClick() })
    }
    assert.deepEqual(operations, [], 'denied actions must never submit even when called directly')
    assert.ok(reasons.some(x => x.action === 'cut' && x.count === 1 && x.id === 3))
    assert.ok(reasons.some(x => x.action === 'move-to' && x.revision === 1))
    const copy = find(h.view, 'data-mobile-files-context-selection-action', 'copy')
    assert.equal(copy.props.disabled, false)
    await act(async () => { copy.props.onClick() })
    assert.deepEqual(operations, [['copy', 3, 1]], 'permitted Copy delegates to the Web controller')
  }, { props: {
    getSelectionActionDisabledReason: (action, items, count) => {
      reasons.push({ action, count, id: items[0]?.id, revision: items[0]?.revision })
      return disabled.has(action) ? '原始 Node/Revision 暂不可用' : null
    },
    onCut: items => operations.push(['cut', items[0].id, items[0].revision]),
    onCopy: items => operations.push(['copy', items[0].id, items[0].revision]),
    onMove: items => operations.push(['move-to', items[0].id, items[0].revision]),
    onCopyTo: items => operations.push(['copy-to', items[0].id, items[0].revision]),
  } })
})

test('F-iOS27-09A: Trash exposes no ordinary file Cut/Copy/Move/Copy-To menu entries', async () => {
  let invoked = 0
  await withView(async h => {
    await openFios09Context(h)
    assert.equal(h.view.root.findAll(n => n.props?.['data-mobile-files-context-selection-action']).length, 0)
    assert.equal(invoked, 0)
  }, { props: {
    trashActive: true,
    onCut: () => { invoked++ },
    onCopy: () => { invoked++ },
    onMove: () => { invoked++ },
    onCopyTo: () => { invoked++ },
  } })
})

test('F-iOS27-09A: shared context command replaces duplicate menu ids rather than showing two Copy actions', async () => {
  await withView(async h => {
    await openFios09Context(h)
    assert.equal(h.view.root.findAll(n => n.props?.['data-mobile-files-context-selection-action'] === 'copy').length, 0,
      'the shared Web context adapter already owns this command')
    const copies = h.view.root.findAll(n => n.type === 'MenuItem' && textOf(n.props?.children) === '复制')
    assert.equal(copies.length, 1)
  }, { props: {
    getItemMenuItems: () => [{
      id: 'copy', label: '复制', onSelect() {}, disabled: false,
    }],
  } })
})

test('F-iOS27-09A: Wide/Web/Mobile share operation eligibility and no Mobile-specific REST transport', () => {
  const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
  assert.match(mobile, /getSelectionActionDisabledReason\?\.\(action, \[item\], 1\)/)
  assert.match(web, /getSelectionActionDisabledReason=\{getSelectionActionDisabledReason\}/)
  assert.match(shared, /selectionActionDisabledReason\('cut', selection, contextSelectionCount\)/)
  assert.match(shared, /selectionActionDisabledReason\('copy', selection, contextSelectionCount\)/)
  assert.match(mobile, /data-mobile-files-context-selection-action=\{option\.action\}/)
  assert.ok(!mobile.includes('fetch('))
  assert.equal(mobile.includes('new XDriveApi('), false)
})


function iosFilesKeyEvent(key, modifiers = {}) {
  const counters = { prevented: 0, stopped: 0 }
  const event = {
    key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    repeat: false, nativeEvent: { isComposing: false },
    target: { isContentEditable: false, closest: () => null },
    preventDefault() { counters.prevented++ },
    stopPropagation() { counters.stopped++ },
    ...modifiers,
  }
  return { event, counters }
}

async function fireMobileFilesShortcut(h, key, modifiers = {}) {
  const { event, counters } = iosFilesKeyEvent(key, modifiers)
  await act(async () => {
    find(h.view, 'data-xdrive-mobile-files', true).props.onKeyDown(event)
    await Promise.resolve()
    await Promise.resolve()
  })
  return counters
}

test('F-iOS27-09B: shared keyboard interpreter selects the full Mobile directory then copies and cuts intact identities', async () => {
  const calls = []
  await withView(async h => {
    const select = await fireMobileFilesShortcut(h, 'a', { ctrlKey: true })
    assert.equal(select.prevented, 1)
    assert.equal(find(h.view, 'aria-label', '复制已选').props.disabled, false)
    const copy = await fireMobileFilesShortcut(h, 'c', { ctrlKey: true })
    assert.equal(copy.prevented, 1)
    const cut = await fireMobileFilesShortcut(h, 'x', { metaKey: true })
    assert.equal(cut.prevented, 1)
    assert.deepEqual(calls, [
      { action: 'copy', keys: [[2, 1], [3, 1]] },
      { action: 'cut', keys: [[2, 1], [3, 1]] },
    ])
    assert.equal(find(h.view, 'aria-label', '复制已选').props.disabled, false,
      'clipboard commands must retain the full virtual selection')
    const esc = await fireMobileFilesShortcut(h, 'Escape')
    assert.equal(esc.prevented, 1)
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 0)
  }, { props: {
    requestedDirectoryID: 1,
    onCopy: items => calls.push({ action: 'copy', keys: items.map(i => [i.id, i.revision]) }),
    onCut: items => calls.push({ action: 'cut', keys: items.map(i => [i.id, i.revision]) }),
  } })
})

test('F-iOS27-09B: external keyboard Copy/Cut/Delete on a focused file use its exact Node revision', async () => {
  const calls = []
  await withView(async h => {
    const row = find(h.view, 'aria-label', '说明.txt')
    for (const [key, opts, name] of [
      ['c', { ctrlKey: true }, 'copy'],
      ['x', { ctrlKey: true }, 'cut'],
      ['Delete', {}, 'delete'],
    ]) {
      const { event, counters } = iosFilesKeyEvent(key, opts)
      await act(async () => { row.props.onKeyDown(event) })
      assert.equal(counters.prevented, 1)
      assert.equal(counters.stopped, 1, 'one focused row owns its shortcut')
      assert.equal(calls.at(-1).action, name)
    }
    assert.deepEqual(calls.map(x => [x.action, x.items.map(i => [i.id, i.revision, i.kind])]), [
      ['copy', [[3, 1, 'file']]],
      ['cut', [[3, 1, 'file']]],
      ['delete', [[3, 1, 'file']]],
    ])
  }, { props: {
    requestedDirectoryID: 1,
    onCopy: items => calls.push({ action: 'copy', items }),
    onCut: items => calls.push({ action: 'cut', items }),
    onDelete: items => calls.push({ action: 'delete', items }),
  } })
})

test('F-iOS27-09B: paste, undo and redo shortcuts delegate to the existing Web controller', async () => {
  const calls = []
  await withView(async h => {
    assert.equal((await fireMobileFilesShortcut(h, 'v', { ctrlKey: true })).prevented, 1)
    assert.equal((await fireMobileFilesShortcut(h, 'z', { ctrlKey: true })).prevented, 1)
    assert.equal((await fireMobileFilesShortcut(h, 'z', { ctrlKey: true, shiftKey: true })).prevented, 1)
    assert.deepEqual(calls, [['paste', undefined], ['undo'], ['redo']])
    await h.update({ canPaste: false, canUndo: false, canRedo: false })
    assert.equal((await fireMobileFilesShortcut(h, 'v', { ctrlKey: true })).prevented, 0)
    assert.equal((await fireMobileFilesShortcut(h, 'z', { ctrlKey: true })).prevented, 0)
    assert.equal(calls.length, 3)
    await h.update({ trashActive: true, canPaste: true, canUndo: true, canRedo: true })
    assert.equal((await fireMobileFilesShortcut(h, 'v', { ctrlKey: true })).prevented, 0)
    assert.equal(calls.length, 3)
  }, { props: {
    requestedDirectoryID: 1, canPaste: true, canUndo: true, canRedo: true,
    onPaste: operation => calls.push(['paste', operation]),
    onUndo: () => calls.push(['undo']),
    onRedo: () => calls.push(['redo']),
  } })
})

test('F-iOS27-09B: iPad Cmd+Option+V keeps the shared move-paste override', async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { platform: 'iPad', userAgent: 'Mozilla/5.0 iPad iOS 27' },
  })
  const modes = []
  try {
    await withView(async h => {
      assert.equal((await fireMobileFilesShortcut(h, 'v', { metaKey: true, altKey: true })).prevented, 1)
      assert.equal((await fireMobileFilesShortcut(h, 'v', { metaKey: true })).prevented, 1)
      assert.deepEqual(modes, ['move', undefined])
    }, { props: {
      requestedDirectoryID: 1, canPaste: true,
      onPaste: mode => modes.push(mode),
    } })
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator)
    else delete globalThis.navigator
  }
})

test('F-iOS27-09B: text input, contenteditable, dialog and composition own their native keyboard events', async () => {
  const calls = []
  await withView(async h => {
    for (const target of [
      { closest: selector => selector.includes('input') ? {} : null },
      { closest: () => null, isContentEditable: true },
      { closest: selector => selector.includes('[role="dialog"]') ? {} : null },
      { closest: selector => selector.includes('[role="menu"]') ? {} : null },
    ]) {
      assert.equal((await fireMobileFilesShortcut(h, 'a', { ctrlKey: true, target })).prevented, 0)
      assert.equal((await fireMobileFilesShortcut(h, 'v', { ctrlKey: true, target })).prevented, 0)
    }
    assert.equal((await fireMobileFilesShortcut(h, 'v', {
      ctrlKey: true, nativeEvent: { isComposing: true },
    })).prevented, 0)
    assert.equal((await fireMobileFilesShortcut(h, 'v', { ctrlKey: true, repeat: true })).prevented, 0)
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 0)
    assert.deepEqual(calls, [])
  }, { props: {
    requestedDirectoryID: 1, canPaste: true, onPaste: mode => calls.push(mode),
  } })
})

test('F-iOS27-09B: shared eligibility rejects keyboard Copy, Cut and Delete, even on a selected full directory', async () => {
  const calls = []
  await withView(async h => {
    await fireMobileFilesShortcut(h, 'a', { ctrlKey: true })
    assert.equal((await fireMobileFilesShortcut(h, 'c', { ctrlKey: true })).prevented, 1)
    assert.equal((await fireMobileFilesShortcut(h, 'x', { metaKey: true })).prevented, 1)
    assert.equal((await fireMobileFilesShortcut(h, 'Delete')).prevented, 1)
    assert.deepEqual(calls, [])
  }, { props: {
    requestedDirectoryID: 1,
    getSelectionActionDisabledReason: () => 'Node/Revision 已失效',
    onCopy: items => calls.push(['copy', items.length]),
    onCut: items => calls.push(['cut', items.length]),
    onDelete: items => calls.push(['delete', items.length]),
  } })
})

test('F-iOS27-09B: Escape aborts a 100k sparse Select All request without committing old IDs', async () => {
  let resolveRange, captured
  const snapshots = []
  const source = {
    interactionKey: 'keyboard-cancel-100k', itemCount: 100000,
    loadedItems: new Map(), itemAt: () => undefined, onRangeChange() {},
    retainInteractionIDs() {},
    collectRange: (_start, _end, signal) => {
      captured = signal
      return new Promise(resolve => { resolveRange = resolve })
    },
  }
  await withView(async h => {
    assert.equal((await fireMobileFilesShortcut(h, 'a', { metaKey: true })).prevented, 1)
    assert.ok(captured instanceof AbortSignal)
    assert.equal(captured.aborted, false)
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 1)
    assert.equal((await fireMobileFilesShortcut(h, 'Escape')).prevented, 1)
    assert.equal(captured.aborted, true)
    await act(async () => {
      resolveRange(Array.from({ length: 200 }, (_, i) => ({
        id: 1000 + i, name: 'old.txt', revision: 3, kind: 'file',
      })))
      await Promise.resolve()
    })
    assert.equal(count(h.view, 'data-mobile-files-select-progress'), 0)
    assert.deepEqual(snapshots.at(-1), [])
  }, { props: {
    requestedDirectoryID: 1, items: [], virtualCollection: source,
    onSelectedItemsChange: items => snapshots.push(items.map(i => i.id)),
  } })
})

test('F-iOS27-09B: wide/Mobile keyboards share parser, and Web forwards the same paste override', () => {
  const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  const wide = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
  assert.match(mobile, /xDriveFileExplorerKeyboardCommand\(event, filesKeyboardProfile\)/)
  assert.match(mobile, /xDriveFileExplorerKeyboardProfileFromPlatform\(/)
  assert.match(wide, /xDriveFileExplorerKeyboardCommand\(/)
  assert.match(mobile, /data-xdrive-mobile-files onKeyDown=\{handleFilesKeyboard\}/)
  assert.match(mobile, /props\.onPaste\(command === 'paste-move' \? 'move' : undefined\)/)
  assert.match(web, /onPaste=\{operationOverride => \{ void pasteClipboard\(operationOverride\) \}\}/)
  assert.equal(mobile.includes('new XDriveApi('), false)
  assert.equal(mobile.includes('fetch('), false)
})


test('F-iOS27-09D: Mobile rename respects wide-Web busy gating, including an already-open shared dialog', async () => {
  const writes = []
  await withView(async h => {
    await openFios09Context(h)
    const rename = () => find(h.view, 'data-mobile-files-item-rename', true)
    const dialog = () => find(h.view, 'aria-label', '重命名')
    assert.equal(rename().props.disabled, true, 'busy Web operation must disable the Mobile held menu')
    await act(async () => { rename().props.onClick() })
    assert.equal(dialog().props.open, false, 'direct callbacks cannot bypass the shared busy gate')

    await h.update({ renameDisabled: false })
    await openFios09Context(h)
    await act(async () => { rename().props.onClick() })
    assert.equal(dialog().props.open, true)
    const input = () => dialog().findAll(node => node.type === 'TextField' && node.props?.label === '名称')[0]
    await act(async () => { input().props.onChange({ target: { value: '新名称.txt' } }) })
    await h.update({ renameDisabled: true })
    await submitMobileRename(h)
    assert.deepEqual(writes, [], 'became-busy dialog must not send an additional Server mutation')
    assert.equal(dialog().props.open, true)
    assert.equal(input().props.value, '新名称.txt', 'busy refusal keeps the original user draft')
    assert.match(input().props.helperText, /文件操作进行中/)

    await h.update({ renameDisabled: false })
    await submitMobileRename(h)
    assert.deepEqual(writes, [{ id: 3, revision: 1, name: '新名称.txt' }])
    assert.equal(dialog().props.open, false)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1,
      'busy/ready transition must not create a second FileExplorer virtual scroll owner')
  }, { props: {
    renameDisabled: true,
    onRename: async (item, name) => {
      writes.push({ id: item.id, revision: item.revision, name })
    },
  } })
})

test('F-iOS27-09D: Web and Mobile use the identical rename availability condition and Server controller', () => {
  const mobile = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/WebFileExplorer.tsx'), 'utf8')
  const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileExplorer.tsx'), 'utf8')
  assert.ok(web.includes('renameDisabled={trashActive || fileOperationBusy}'), 'both layouts must share the wide busy gate')
  assert.ok(web.includes('onRename={renameItem}'), 'same Node/revision rename controller')
  assert.ok(mobile.includes('disabled={Boolean(props.renameDisabled)}'))
  assert.ok(mobile.includes('if (props.trashActive || props.renameDisabled) return'))
  assert.ok(mobile.includes('if (props.renameDisabled || props.trashActive) {'))
  assert.ok(mobile.includes('await props.onRename(renaming, name)'))
  assert.ok(shared.includes('disabled: renameDisabled || renameSubmitting'), 'wide Web keeps its original gate')
  assert.ok(!mobile.includes('api.rename('), 'Mobile must not introduce a separate REST rename client')
})


test('F-iOS27-09E: all Mobile Files menus enforce a 44px MUI paper-level touch minimum', async () => {
  await withView(async h => {
    const menus = h.view.root.findAll(node => node.type === 'Menu')
    assert.equal(menus.length, 7, 'seven distinct Mobile Files menus must have one touch contract')
    for (const menu of menus) {
      assert.deepEqual(menu.props?.slotProps?.paper?.sx?.['& .MuiMenuItem-root'],
        { minHeight: 44 }, 'Menu paper missing its 44px sm-breakpoint override')
    }
    for (const key of [
      'data-mobile-files-location-menu', 'data-mobile-files-selection-menu', 'data-mobile-files-more-menu',
      'data-mobile-files-saved-search-menu', 'data-mobile-files-arrange-menu',
      'data-mobile-files-collection-menu',
    ]) {
      assert.equal(menus.filter(menu => Object.hasOwn(menu.props ?? {}, key)).length, 1,
        'expected one accessible Mobile Menu surface: ' + key)
    }
    assert.equal(count(h.view, 'data-xdrive-mobile-files-scroll'), 1,
      'menus must not create a second virtual scroll owner')
  })
})

test('F-iOS27-10D: folder title opens ancestors without a second heading or path row', async () => {
  const jumps = []
  await withView(async h => {
    assert.equal(count(h.view, 'data-mobile-files-large-title'), 0,
      'entered folders must not create a second oversized title')
    assert.equal(count(h.view, 'data-mobile-files-location-path'), 0,
      'a recursive full-path row must never consume file-list height')
    const compact = find(h.view, 'data-mobile-files-compact-title', true)
    assert.equal(compact.props['aria-hidden'], false)
    assert.equal(textOf(compact.props.children), '照片文件夹')
    const back = find(h.view, 'aria-label', '返回')
    assert.equal(back.props.sx.width, 48)
    assert.equal(back.props.sx.height, 48)
    const list = find(h.view, 'data-mobile-files-group', 'directory')
    assert.equal(list.props.sx.mx, 0)
    assert.equal(list.props.sx.borderRadius, 0)
    assert.equal(find(h.view, 'data-mobile-files-arrangement-status', true).props.sx.display, 'none')
    const rail = h.view.root.findAll(node => node.props?.['data-mobile-files-section'])
      .map(node => node.props['data-mobile-files-section'])
    assert.deepEqual(rail, ['recent', 'favorites', 'browse'])

    const trigger = find(h.view, 'data-mobile-files-location-trigger', true)
    assert.equal(trigger.props.sx.minHeight, 44)
    assert.equal(trigger.props['aria-haspopup'], 'menu')
    await act(async () => { trigger.props.onClick({ currentTarget: {} }) })
    assert.equal(find(h.view, 'data-mobile-files-location-menu', true).props.open, true)
    assert.equal(count(h.view, 'data-mobile-files-crumb-id'), 2)
    const parent = find(h.view, 'data-mobile-files-crumb-id', '1')
    assert.equal(typeof parent.props.onDrop, 'function',
      'ancestor external-drop target must not disappear with the path row')
    await act(async () => { parent.props.onClick() })
    assert.deepEqual(jumps, [0], 'ancestor selection must delegate to shared Web navigation')
    assert.equal(find(h.view, 'data-mobile-files-location-menu', true).props.open, false)
    assert.equal(count(h.view, 'data-mobile-files-location-path'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)

    await h.update({ searchActive: true })
    assert.equal(count(h.view, 'data-mobile-files-location-trigger'), 0,
      'global Search must not expose unrelated folder navigation')
    await h.update({ searchActive: false, trashActive: true })
    assert.equal(count(h.view, 'data-mobile-files-location-trigger'), 0,
      'Trash must not expose writable ancestor navigation')
  }, { props: {
    requestedDirectoryID: 2,
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    onCrumbClick: index => jumps.push(index),
  } })
})




test('P29 ordinary directory navigation never shows the redundant loading chip, even after 230ms', async () => {
  await withView(async h => {
    const status = () => find(h.view, 'data-mobile-files-arrangement-status', true)
    const originalRows=count(h.view,'data-mobile-files-item')
    assert.ok(originalRows>0,'original accepted directory has real file rows')
    await h.update({loading:true, requestedDirectoryID:42})
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230))})
    assert.equal(status().props.sx.display,'none',
      'a normal folder transition should not display unrelated loading text')
    assert.equal(count(h.view,'data-mobile-files-item'),originalRows)
    assert.equal(count(h.view,'data-xdrive-file-explorer-scroll-host'),1)
    assert.equal(state.mobileFilesDecodeState(h.window.values.get(
      'xdrive.mobile.files.v1:ios-files-userA')).folderID,1)
    await h.update({loading:false})
    assert.equal(status().props.sx.display,'none')
  },{props:{requestedDirectoryID:1,crumbs:[{id:1,name:'我的文件'}]}})
})

test('P29 pending navigation from settled empty folder keeps its truthful empty state', async()=>{
  await withView(async h=>{
    const panel=()=>{
      const nodes=h.view.root.findAll(n=>n.type==='state-panel')
      assert.equal(nodes.length,1)
      return nodes[0]
    }
    assert.equal(panel().props.loading,false)
    assert.equal(panel().props.message,'此文件夹为空')
    await h.update({requestedDirectoryID:42,loading:true})
    assert.equal(panel().props.loading,false,
      'an accepted empty folder may not flash a new cold-loading spinner')
    assert.equal(panel().props.message,'此文件夹为空')
  },{saved:{section:'browse',folderID:1,scrollTop:0,view:'details'},
    props:{items:[],loading:false,requestedDirectoryID:1,
      virtualCollection: { itemCount: 0, interactionKey: 'accepted-counted-zero',
      loadedItems: new Map(), itemAt: () => undefined,
      onRangeChange() {}, groups: [] },
      crumbs:[{id:1,name:'我的文件'}]}})
})

test('P29 sustained Search reports real network progress only after 300ms',async()=>{
  await withView(async h=>{
    const status=()=>find(h.view,'data-mobile-files-arrangement-status',true)
    await h.update({loading:true})
    assert.equal(status().props.sx.display,'none')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,220))})
    assert.equal(status().props.sx.display,'none',
      'a short Search request must not paint an intermediate progress chip')
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,150))})
    assert.equal(status().props.sx.display,'block',
      'a sustained Search request remains user-visible after 300ms')
    await h.update({loading:false})
    assert.equal(status().props.sx.display,'none')
  },{props:{searchActive:true,requestedDirectoryID:1,
    searchSummary:{query:'photo',resultCount:2,loading:false},
    crumbs:[{id:1,name:'我的文件'}]}})
})

test('P26/P29: ordinary folder status never flashes while Search keeps delayed network feedback', async () => {
  // The mounted actual MobileFiles component has an accepted nonempty folder.
  // A fast navigator may set loading=true then false before any user-relevant
  // change. That must not paint or announce a transient arrangement badge.
  await withView(async h => {
    const badge = () => find(h.view, 'data-mobile-files-arrangement-status', true)
    assert.equal(badge().props.sx.display, 'none')
    await h.update({ loading: true })
    assert.equal(badge().props.sx.display, 'none',
      'first loading render must not flash a badge over accepted file rows')
    await h.update({ loading: false })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)) })
    assert.equal(badge().props.sx.display, 'none',
      'a completed short navigation must not show a stale timer badge')
    await h.update({ loading: true })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 210)) })
    assert.equal(badge().props.sx.display, 'none',
      'even a long ordinary folder navigation retains the accepted rows without a badge')
    assert.equal(badge().props.sx.position, 'absolute',
      'delayed status must never alter the indexed file-row geometry')
    await h.update({ loading: false })
    assert.equal(badge().props.sx.display, 'none',
      'successful commit removes the badge synchronously')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: { requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }] } })
})

test('Mobile Files search geometry remains stable while scrolling and loading ranges', async () => {
  await withView(async h => {
    const search = find(h.view, 'data-mobile-files-search-region', true)
    assert.equal(search.props.sx.position, 'relative',
      'a scrollTop-driven sticky max-height change caused old/native viewport bounce')
    for (const animated of ['maxHeight', 'opacity', 'transition']) {
      assert.equal(search.props.sx[animated], undefined,
        'normal-flow search must never animate row geometry: ' + animated)
    }
    const host = find(h.view, 'data-xdrive-file-explorer-scroll-host', true)
    assert.equal(host.props.sx.overflowAnchor, 'none',
      'virtual collection, not UA scroll anchoring, must own the visible range')
    await h.update({ loading: true })
    const status = find(h.view, 'data-mobile-files-arrangement-status', true)
    assert.equal(status.props.sx.position, 'absolute',
      'range loading status may not push any of the virtual rows downward')
    assert.equal(status.props.sx.display, 'none',
      'transient arrangement chip is suppressed on the initial fast-loading frame')
    await h.update({ loading: false })
    assert.equal(find(h.view, 'data-mobile-files-arrangement-status', true).props.sx.display, 'none')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
  } })
})

test('Mobile Files does not reset the old directory before asynchronous child navigation commits', async () => {
  let resolveNavigate
  const navigation = new Promise(resolve => { resolveNavigate = resolve })
  await withView(async h => {
    const folder = find(h.view, 'data-mobile-files-folder-id', '2')
    await act(async () => { folder.props.onClick() })
    await h.update({ loading: true })
    let saved = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 1,
      'a pending folder request must not reassign the visible folder or its scroll')
    await act(async () => { resolveNavigate(true); await navigation })
    saved = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 1,
      'an async folder Promise callback must not reset an old virtual viewport')
    await h.update({
      loading: false,
      items: [{ id: 4, name: '子目录.txt', kind: 'file', revision: 1 }],
      crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    })
    saved = state.mobileFilesDecodeState(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 2, 'new authoritative crumbs publish the committed navigation')
    assert.equal(saved.scrollTop, 0, 'committed child directory owns a fresh top scroll')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }],
    onOpenItem: () => navigation,
  } })
})

test('Mobile parent and ancestor navigation preserve the old folder until shared contents commit', async () => {
  let up = 0
  const ancestors = []
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved().folderID, 2)
    await act(async () => { find(h.view, 'aria-label', '返回').props.onClick() })
    assert.equal(up, 1)
    assert.equal(saved().folderID, 2, 'Back pending: do not persist the unconfirmed parent')
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }] })
    assert.equal(saved().folderID, 1, 'Back committed: reset only once after the shared range')
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }] })
    await act(async () => {
      find(h.view, 'data-mobile-files-location-trigger', true).props.onClick({ currentTarget: {} })
    })
    await act(async () => { find(h.view, 'data-mobile-files-crumb-id', '1').props.onClick() })
    assert.deepEqual(ancestors, [0])
    assert.equal(saved().folderID, 2, 'ancestor pending: retain the old folder')
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }] })
    assert.equal(saved().folderID, 1, 'ancestor commits through the existing controller')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 2,
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    onGoUp: () => { up += 1 },
    onCrumbClick: index => ancestors.push(index),
  } })
})

test('saved Mobile Browse resume must preserve the old 688px anchor instead of new-navigation zero', async () => {
  await withView(async h => {
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 42)
    assert.equal(saved.scrollTop, 688)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    saved: { section: 'browse', folderID: 42, scrollTop: 688, view: 'details' },
    props: {
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '旧位置' }],
      onRestoreFolder: async () => {},
    },
  })
})


test('P2: pending URL folder deep link keeps the old Browse rows and persisted folder until first range commits', async () => {
  await withView(async h => {
    const stored = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(stored().folderID, 1)
    const previousFolderMarkers = count(h.view, 'data-mobile-files-folder-id')
    assert.ok(previousFolderMarkers > 0, 'the original folder still has visible entries')
    await h.update({ requestedDirectoryID: 42, loading: true })
    assert.equal(stored().folderID, 1,
      'a URL ticket cannot pre-persist an unverified directory ID')
    assert.equal(stored().scrollTop, 0,
      'a pending different-folder request cannot reset Browse position')
    assert.equal(count(h.view, 'data-mobile-files-folder-id'), previousFolderMarkers,
      'pending navigation must retain all originally mounted folder markers')
    await h.update({ loading: false })
    assert.equal(stored().folderID, 1,
      'failed/aborted deep link must not poison the last accessible folder')
    await h.update({
      loading: false,
      items: [{ id: 95, name: '完成.txt', kind: 'file', revision: 1 }],
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '已授权目标文件夹' }],
    })
    assert.equal(stored().folderID, 42,
      'the authoritative committed range/crumbs may then publish the new folder')
    assert.equal(stored().scrollTop, 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }],
  } })
})

test('P2: deep link from Recent waits for folder commit before switching rail presentation', async () => {
  await withView(async h => {
    const stored = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await h.update({ requestedDirectoryID: 42, loading: true })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'old rail must not turn into a half-loaded folder before authorization')
    assert.equal(stored().folderID, 1)
    await h.update({
      loading: false,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '已授权目标文件夹' }],
      items: [{ id: 95, name: '完成.txt', kind: 'file', revision: 1 }],
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-mobile-files-group'), 1)
    assert.equal(stored().folderID, 42)
    assert.equal(stored().section, 'browse')
  }, { props: {
    requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }],
  } })
})

test('P2: same-directory explicit URL can reveal Browse Home without a second Server lookup', async () => {
  await withView(async h => {
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    await h.update({ requestedDirectoryID: 1 })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    const persisted = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(persisted.folderID, 1)
    assert.equal(persisted.section, 'browse')
  }, { props: { crumbs: [{ id: 1, name: '我的文件' }] } })
})


test('P3: Go-to-Path pending or failed lookup must retain the visible folder and saved scroll', async () => {
  const requested = []
  const initial = { section: 'browse', folderID: 42, scrollTop: 688, view: 'details' }
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved().folderID, 42)
    assert.equal(saved().scrollTop, 688)
    await act(async () => {
      find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} })
    })
    const entry = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '前往文件夹路径…')[0]
    assert.ok(entry)
    await act(async () => { entry.props.onClick() })
    const input = find(h.view, 'aria-label', '文件夹路径')
    await act(async () => {
      input.props.onChange({ target: { value: '我的文件/不存在的目录' } })
    })
    const form = h.view.root.findAll(node => node.type === 'Box' &&
      node.props?.component === 'form' && node.props?.onSubmit)[0]
    assert.ok(form)
    await act(async () => { form.props.onSubmit({ preventDefault() {} }) })
    assert.deepEqual(requested, ['我的文件/不存在的目录'])
    assert.equal(saved().folderID, 42, 'pending path cannot overwrite the original folder')
    assert.equal(saved().scrollTop, 688, 'pending path cannot snap the original folder to top')
    await h.update({ loading: true })
    assert.equal(saved().scrollTop, 688)
    await h.update({ loading: false })
    assert.equal(saved().scrollTop, 688, 'failed lookup preserves the saved anchor')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    saved: initial,
    props: {
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '当前文件夹' }],
      onRestoreFolder: async () => {},
      onPathSubmit: path => { requested.push(path) },
    },
  })
})

test('P3: Go-to-Path from Recent keeps the old rail until destination directory commits', async () => {
  const requested = []
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await act(async () => {
      find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} })
    })
    const entry = h.view.root.findAll(node => node.type === 'MenuItem' &&
      node.props?.children === '前往文件夹路径…')[0]
    await act(async () => { entry.props.onClick() })
    await act(async () => {
      find(h.view, 'aria-label', '文件夹路径').props.onChange({
        target: { value: '我的文件/子目录' },
      })
    })
    const form = h.view.root.findAll(node => node.type === 'Box' &&
      node.props?.component === 'form' && node.props?.onSubmit)[0]
    await act(async () => { form.props.onSubmit({ preventDefault() {} }) })
    assert.deepEqual(requested, ['我的文件/子目录'])
    assert.equal(saved().section, 'recent', 'unverified path must not reveal the Browse rail')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await h.update({
      loading: false,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 77, name: '已授权子目录' }],
      items: [{ id: 99, name: '完成.txt', kind: 'file', revision: 1 }],
    })
    assert.equal(saved().section, 'browse', 'successful committed directory reveals Browse')
    assert.equal(saved().folderID, 77)
    assert.equal(saved().scrollTop, 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    props: {
      requestedDirectoryID: 1,
      crumbs: [{ id: 1, name: '我的文件' }],
      onPathSubmit: path => { requested.push(path) },
    },
  })
})

// The sparse row window is the observable scroll-state oracle in the mounted
// original component. A compact navigation title stays visible in both states
// and therefore cannot prove viewport restoration.
const p10Rows = Array.from({ length: 96 }, (_, index) => ({
  id: 10000 + index, name: `scroll-${index}.txt`, kind: 'file', revision: 1,
}))

test('P10: already committed same-route Mobile Files remount retains its stored scroll anchor', async () => {
  await withView(async h => {
    const labels = h.view.root.findAll(node =>
      Object.hasOwn(node.props ?? {}, 'data-mobile-files-item'))
      .map(node => node.props['aria-label'])
    assert.ok(labels.length > 0, 'the real virtual row window is mounted')
    assert.ok(!labels.includes('scroll-0.txt'),
      'a same-route remount must not render the first row when its saved anchor is deep down')
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 1)
    assert.equal(saved.scrollTop, 1888)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    saved: { section: 'browse', folderID: 1, scrollTop: 1888, view: 'details' },
    props: { requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
      items: p10Rows },
  })
})

test('P10: different already committed URL starts at row zero and clears the old saved anchor', async () => {
  await withView(async h => {
    const labels = h.view.root.findAll(node =>
      Object.hasOwn(node.props ?? {}, 'data-mobile-files-item'))
      .map(node => node.props['aria-label'])
    assert.ok(labels.includes('scroll-0.txt'),
      'a different authorized route must start its virtual rows at index zero')
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.folderID, 1)
    assert.equal(saved.scrollTop, 0,
      'new target ID and zero offset must be committed in the same storage snapshot')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    saved: { section: 'browse', folderID: 42, scrollTop: 1888, view: 'details' },
    props: { requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
      items: p10Rows },
  })
})

test('U02 Mobile responsive remount seeds selected identity and does not clear it in mount effects', async () => {
  const selected = { id: 3, name: '说明.txt', kind: 'file', revision: 1, size: 120 }
  const retained = []
  await withView(async h => {
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 1)
    const row = find(h.view, 'aria-label', '已选，说明.txt')
    assert.equal(row.props['aria-pressed'], true)
    assert.deepEqual(retained.at(-1), [[3, 1]], 'mount must notify shared Web owner of unchanged identity')
    await act(async () => { row.props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-selection-toolbar'), 1)
    assert.deepEqual(retained.at(-1), [], 'user may deselect after the remount')
  }, { saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { requestedDirectoryID: 1, initialSelectedItems: [selected],
      onSelectedItemsChange: items => retained.push(items.map(item => [item.id, item.revision])) },
  })
})

test('U08: Mobile Files uses shared StatePanel for authorized empty folder, Trash and zero Search', async () => {
  const statePanel = h => {
    const matches = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(matches.length, 1, 'one shared visual state owner, no duplicated spinner or empty copy')
    return matches[0]
  }
  await withView(async h => {
    const root = h.view.root.findAll(n => n.props?.role === 'button' && n.props?.onClick)
      .find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(root, 'Browse Home must expose actual cloud root')
    await act(async () => { root.props.onClick() })
    assert.equal(statePanel(h).props.message, '此文件夹为空')
    assert.equal(statePanel(h).props.loading, false)
  }, { props: { items: [],
    virtualCollection: { itemCount: 0, interactionKey: 'accepted-counted-zero',
      loadedItems: new Map(), itemAt: () => undefined,
      onRangeChange() {}, groups: [] } } })
  await withView(async h => {
    assert.equal(statePanel(h).props.message, '最近删除为空')
    assert.equal(statePanel(h).props.loading, false)
  }, { props: { items: [], trashActive: true } })
  await withView(async h => {
    assert.equal(statePanel(h).props.message, '未找到匹配的文件或文件夹')
    assert.equal(statePanel(h).props.loading, false)
  }, { props: { items: [], searchActive: true,
    searchSummary: { query: 'not-found', resultCount: 0, loading: false } } })
})

test('U08: unanswered Search, error and cold load do not flash a fake empty folder', async () => {
  const panel = h => {
    const found = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(found.length, 1)
    return found[0]
  }
  const initiallyQuietThenLoading = async (h, message) => {
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'an uncommitted first Range must not mount a spinner on the first frame')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    assert.equal(panel(h).props.loading, true)
    assert.equal(panel(h).props.message, message)
  }
  await withView(async h => {
    await initiallyQuietThenLoading(h, '正在查询…')
  }, { props: { items: [], searchActive: true, loading: false,
    searchSummary: { query: 'pending', resultCount: null, loading: false } } })
  await withView(async h => {
    assert.equal(panel(h).props.loading, false)
    assert.equal(panel(h).props.message, '搜索失败，请重试')
    const warnings = h.view.root.findAll(n => n.props?.role === 'alert')
    assert.ok(warnings.some(n => textOf(n.props.children).includes('503')),
      'Server error and existing retry entry remain visible immediately')
  }, { props: { items: [], searchActive: true, loading: false,
    searchSummary: { query: 'denied', resultCount: null, loading: false,
      error: '503 服务暂不可用', onRetry() {} } } })
  await withView(async h => {
    await initiallyQuietThenLoading(h, '正在查询…')
  }, { props: { items: [], searchActive: true, loading: true,
    searchSummary: { query: 'loading', resultCount: 0, loading: true } } })
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-cold-read-slot', true)
    assert.equal(slot().props['aria-busy'], true)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'even a slow unaccepted Folder Range must not insert a navigation spinner')
    assert.equal(slot().props.sx.minHeight, 180)
  }, { saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { items: [], loading: true,
      crumbs: [{ id: 1, name: '我的文件' }] } })
})

test('P61: Mobile Search never mounts an in-flow intermediate loading row or collapses accepted zero', async () => {
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-zero-state', true)
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(slot().props.sx.display, 'grid')
    assert.equal(slot().props['aria-busy'], true)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'first Search frame must reserve space but display no temporary message')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)) })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 330)) })
    assert.equal(slot().props.sx.minHeight, 180, 'sustained feedback stays inside identical geometry')
    const sustained = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(sustained.length, 1)
    assert.equal(sustained[0].props.loading, true)
    assert.equal(sustained[0].props.message, '正在查询…')
    await h.update({
      loading: false,
      searchSummary: { query: 'empty', resultCount: 0, loading: false },
    })
    assert.equal(slot().props.sx.minHeight, 180,
      'verified zero must not collapse the former pending slot')
    assert.equal(slot().props['aria-busy'], undefined)
    const accepted = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].props.loading, false)
    assert.equal(accepted[0].props.message, '未找到匹配的文件或文件夹')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 325)) })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel')[0].props.loading, false,
      'old generation cannot resurrect network progress after COUNT commits')
  }, { props: { items: [], searchActive: true, loading: true,
    searchSummary: { query: 'empty', resultCount: null, loading: true } } })

  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-zero-state', true)
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await h.update({ loading: false, items: [
      { id: 91, name: 'real-search-result.jpg', kind: 'file', revision: 1 },
    ], searchSummary: { query: 'quick', resultCount: 1, loading: false } })
    assert.equal(count(h.view, 'data-mobile-files-zero-state'), 0)
    assert.ok(h.view.root.findAll(n => n.props?.['data-mobile-files-item'] === true)
      .some(n => n.props['aria-label'] === 'real-search-result.jpg'))
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 335)) })
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'fast Search cannot show a late loading caption')
  }, { props: { items: [], searchActive: true, loading: true,
    searchSummary: { query: 'quick', resultCount: null, loading: true } } })
})

test('P61: mobile Cold Folder, Trash and Search use a height-stable authorized empty/error slot', async () => {
  const empty = { itemCount: 0, interactionKey: 'p61-counted-empty',
    loadedItems: new Map(), itemAt: () => undefined,
    onRangeChange() {}, groups: [] }
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-zero-state', true)
    assert.equal(slot().props.sx.minHeight, 180)
    await h.update({ loading: false })
    assert.equal(slot().props.sx.minHeight, 180)
    await h.update({ virtualCollection: empty })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel')[0].props.message, '此文件夹为空')
  }, { saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { items: [], loading: true, requestedDirectoryID: 1,
      crumbs: [{ id: 1, name: '我的文件' }] } })
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-zero-state', true)
    assert.equal(slot().props.sx.minHeight, 180)
    await h.update({ loading: false, trashReadState: 'error' })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(count(h.view, 'data-mobile-files-trash-read-error'), 1)
    await h.update({ loading: false, trashReadState: 'ready' })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel')[0].props.message, '最近删除为空')
  }, { props: { items: [], trashActive: true, trashReadState: 'unverified', loading: true } })
})

test('P59: cold Mobile Files folder reserves the same quiet 180px slot before/after 300ms', async () => {
  const pending = { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' }
  const realCountedZero = { itemCount: 0, interactionKey: 'p59-authorized-empty',
    loadedItems: new Map(), itemAt: () => undefined,
    onRangeChange() {}, groups: [] }
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-cold-read-slot', true)
    assert.equal(slot().props.sx.minHeight, 180, 'first paint already owns the fixed 180px footprint')
    assert.equal(slot().props.sx.display, 'grid')
    assert.equal(slot().props['aria-busy'], true, 'real network pending is exposed immediately')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)) })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'fast cold GET may not flash a loading caption')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 330)) })
    assert.equal(slot().props.sx.minHeight, 180,
      'slow GET must reuse the exact same footprint, not insert a new row')
    const slow = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(slow.length, 0, 'even a sustained cold folder GET stays quiet')
    await h.update({ loading: false })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(slot().props['aria-busy'], undefined)
    const denied = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(denied.length, 1)
    assert.equal(denied[0].props.loading, false)
    assert.equal(denied[0].props.message,
      '文件夹内容尚未确认，请刷新页面后重试。',
      'unverified failure must never advertise a false empty')
    await h.update({ virtualCollection: realCountedZero })
    assert.equal(h.view.root.findAll(n => n.props?.['data-mobile-files-cold-read-slot'] === true).length, 0)
    const accepted = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(accepted.length, 1)
    assert.equal(accepted[0].props.message, '此文件夹为空')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { saved: pending, props: { items: [], loading: true, requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }] } })

  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-cold-read-slot', true)
    assert.equal(slot().props.sx.minHeight, 180)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    await h.update({ loading: false, items: [
      { id: 9, name: 'arrived.txt', kind: 'file', revision: 1 },
    ], virtualCollection: { ...realCountedZero, itemCount: 1,
      interactionKey: 'p59-authorized-file',
      itemAt: index => index === 0 ? { id: 9, name: 'arrived.txt', kind: 'file', revision: 1 } : undefined } })
    assert.equal(h.view.root.findAll(n => n.props?.['data-mobile-files-cold-read-slot'] === true).length, 0)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.ok(h.view.root.findAll(n => n.props?.['data-mobile-files-item'] === true)
      .some(n => n.props['aria-label'] === 'arrived.txt'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 310)) })
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'a completed quick GET must not show old delayed feedback')
  }, { saved: pending, props: { items: [], loading: true, requestedDirectoryID: 1,
    crumbs: [{ id: 1, name: '我的文件' }] } })
})

test('P75: a cold directory before its first request never flashes a false error', async () => {
  const countedZero = { itemCount: 0, interactionKey: 'p75-verified-empty',
    loadedItems: new Map(), itemAt: () => undefined, onRangeChange() {}, groups: [] }
  const panels = h => h.view.root.findAll(n => n.type === 'state-panel')
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-cold-read-slot', true)
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(slot().props['aria-busy'], true,
      'unrequested current-Owner folder is semantically unresolved, not failed')
    assert.equal(panels(h).length, 0, 'initial loading=false must not show a false terminal error')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    assert.equal(panels(h).length, 0, 'a delayed network start never inserts an intermediate error/loading frame')
    await h.update({ loading: true })
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(panels(h).length, 0, 'the real pending GET shares the same silent geometry')
    await h.update({ loading: false })
    assert.equal(slot().props['aria-busy'], undefined)
    assert.equal(panels(h)[0]?.props.message,
      '文件夹内容尚未确认，请刷新页面后重试。',
      'a real pending→terminal failure still reports the existing recovery guidance')
    await h.update({ sort: { key: 'size', direction: 'asc' } })
    assert.equal(slot().props['aria-busy'], true,
      'the prior arrangement error must not leak into a new query key')
    assert.equal(panels(h).length, 0)
    await h.update({ loading: true })
    assert.equal(panels(h).length, 0)
    await h.update({ loading: false, virtualCollection: countedZero })
    assert.equal(panels(h)[0]?.props.message, '此文件夹为空',
      'only accepted counted Server zero may show the empty folder')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, {
    saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { items: [], loading: false, requestedDirectoryID: 1,
      crumbs: [{ id: 1, name: '我的文件' }] },
  })
})

test('Mobile Files failed cold first Range cannot claim an authoritative empty folder', async () => {
  const panels = h => h.view.root.findAll(n => n.type === 'state-panel')
  await withView(async h => {
    assert.equal(panels(h).length, 0, 'pending cold read stays quiet initially')
    await h.update({ loading: false })
    assert.equal(panels(h).length, 1)
    assert.equal(panels(h)[0].props.loading, false)
    assert.equal(panels(h)[0].props.message,
      '文件夹内容尚未确认，请刷新页面后重试。')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) })
    assert.equal(panels(h)[0].props.loading, false,
      'failed first range cannot resurrect a delayed loading indicator')
    await h.update({ virtualCollection: { itemCount: 0, interactionKey: 'accepted-counted-zero',
      loadedItems: new Map(), itemAt: () => undefined,
      onRangeChange() {}, groups: [] } })
    assert.equal(panels(h).length, 1)
    assert.equal(panels(h)[0].props.message, '此文件夹为空',
      'only accepted counted zero may display the true empty state')
  }, { saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { items: [], loading: true, requestedDirectoryID: 1,
      crumbs: [{ id: 1, name: '我的文件' }] } })
})

test('Quiet Search: sub-300ms network completion never mounts a loading state', async () => {
  await withView(async h => {
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    await h.update({ loading: false,
      searchSummary: { query: 'quick', resultCount: 0, loading: false } })
    const panels = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(panels.length, 1)
    assert.equal(panels[0].props.message, '未找到匹配的文件或文件夹')
    assert.equal(panels[0].props.loading, false)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)) })
    assert.equal(h.view.root.findAll(n => n.props?.role === 'progressbar').length, 0,
      'a cancelled deferred loading timer cannot insert a late spinner')
  }, { props: { items: [], searchActive: true, loading: true,
    searchSummary: { query: 'quick', resultCount: null, loading: true } } })
})

test('U08: reuse the existing StatePanel and keep one virtual-range owner and shared Search API', () => {
  const code = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  assert(code.includes('XDriveStatePanel variant="plain" loading={zeroStateLoading} message={zeroStateMessage}'))
  assert(code.includes('data-mobile-files-zero-state'))
  assert(!code.includes('这里还没有文件'))
  assert(!code.includes('api.search('), 'Mobile must continue using shared Web Search transport')
  assert(!code.includes('searchRange('), 'Mobile must not issue separate Server search ranges')
})

test('M07: Recent and Favorites restore independent virtual scroll anchors across rail switches', async () => {
  const recentItems = Array.from({ length: 240 }, (_, i) => ({
    id: 1000 + i, name: 'recent-' + String(i).padStart(3, '0') + '.txt', kind: 'file', revision: 1,
  }))
  const favorites = Array.from({ length: 240 }, (_, i) => ({
    id: 2000 + i, name: 'favorite-' + String(i).padStart(3, '0') + '.txt', kind: 'file', revision: 1,
  }))
  const section = (h, name) => find(h.view, 'data-mobile-files-section', name)
  // Recent/Favorites render collection rows, not directory item rows.
  // Assert actual mounted virtual titles to avoid empty-array false passes.
  const rows = h => h.view.root.findAll(n =>
    Object.hasOwn(n.props ?? {}, 'data-mobile-files-collection-title'))
    .map(n => n.props.title).filter(Boolean)
  const navigate = async (h, name) => {
    await act(async () => { section(h, name).props.onClick() })
  }
  const scroll = async (h, top) => {
    const host = find(h.view, 'data-xdrive-mobile-files-scroll', true)
    await act(async () => { host.props.onScroll({ currentTarget: { scrollTop: top } }) })
  }
  await withView(async h => {
    await navigate(h, 'recent')
    const recentInitial = rows(h)
    await scroll(h, 1700)
    const recentScrolled = rows(h)
    assert.notDeepEqual(recentScrolled, recentInitial, 'Recent must be truly virtualized at a different row')
    await navigate(h, 'favorites')
    const favoritesInitial = rows(h)
    await scroll(h, 3000)
    const favoritesScrolled = rows(h)
    assert.notDeepEqual(favoritesScrolled, favoritesInitial)
    await navigate(h, 'recent')
    assert.deepEqual(rows(h), recentScrolled, 'Recent restores its own logical row after Favorites')
    await navigate(h, 'favorites')
    assert.deepEqual(rows(h), favoritesScrolled, 'Favorites restores its own logical row after Recent')
    await navigate(h, 'browse')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.recentScrollTop, 1700)
    assert.equal(saved.favoritesScrollTop, 3000)
    assert.equal(saved.folderID, null, 'rail scrolling must not create or change a Browse folder')
    assert.equal(saved.scrollTop, 0, 'rail offsets must not replace the Browse directory anchor')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: { recentItems, favorites } })
})

test('M07: legacy state, cold relaunch and new account keep rail anchors isolated and bounded', async () => {
  assert.deepEqual(state.mobileFilesDecodeState(
    state.mobileFilesEncodeState({ section: 'browse', folderID: 42, scrollTop: 688, view: 'details' })),
  { section: 'browse', folderID: 42, scrollTop: 688, view: 'details' },
  'old files state must remain compatible')
  const encoded = state.mobileFilesEncodeState({
    section: 'browse', folderID: 42, scrollTop: 688,
    recentScrollTop: 1700, favoritesScrollTop: 3000, view: 'details',
  })
  const decoded = state.mobileFilesDecodeState(encoded)
  assert.equal(decoded.recentScrollTop, 1700)
  assert.equal(decoded.favoritesScrollTop, 3000)
  assert.equal(decoded.scrollTop, 688)
  const invalid = state.mobileFilesDecodeState(JSON.stringify({
    section: 'browse', folderID: 42, scrollTop: 688,
    recentScrollTop: Number.POSITIVE_INFINITY, favoritesScrollTop: -500,
  }))
  assert.equal(invalid.recentScrollTop, undefined)
  assert.equal(invalid.favoritesScrollTop, 0)
  const many = Array.from({ length: 240 }, (_, i) =>
    ({ id: 3000 + i, name: 'recent-' + i, kind: 'file', revision: 1 }))
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const rootRows = h.view.root.findAll(n =>
      Object.hasOwn(n.props ?? {}, 'data-mobile-files-collection-title'))
    assert.ok(rootRows.length > 0 && rootRows.length < 45,
      'saved position must mount real bounded collection rows, not all 240')
  }, { saved: { section: 'browse', folderID: null, scrollTop: 0, view: 'details',
    recentScrollTop: 1700, favoritesScrollTop: 3000 },
    props: { recentItems: many } })
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.recentScrollTop, undefined, 'new window/account without saved state starts fresh')
  }, { props: { recentItems: many } })
})

test('U09 first-red: 100k Mobile List→Grid→List keeps the same visible logical file', async () => {
  const anchorIndex = 54_321
  const rowName = (i) => 'u09-' + i + '.txt'
  for (const groupedMode of [false, true]) {
    const groups = groupedMode ? [
      { key: 'ext:jpg', start_index: 0, item_count: 48_000 },
      { key: 'ext:txt', start_index: 48_000, item_count: 52_000 },
    ] : []
    const originalGroupLayout = groupedMode ? grouped.xDriveCreateFileExplorerGroupLayout({
      groups, groupBy: 'type', itemCount: 100_000, rowHeight: state.MOBILE_FILES_ROW_HEIGHT,
      groupHeaderHeight: 30, groupGap: 6,
    }) : null
    const firstTop = groupedMode
      ? grouped.xDriveFileExplorerGroupedItemTop(originalGroupLayout, anchorIndex) + 23
      : anchorIndex * state.MOBILE_FILES_ROW_HEIGHT + 23
    let admitted = 0
    const virtualCollection = {
      interactionKey: 'U09-100k:' + groupedMode,
      itemCount: 100_000,
      groups,
      itemAt(index) {
        admitted += 1
        return { id: 200_000 + index, name: rowName(index), kind: 'file', revision: 1, size: index }
      },
      onRangeChange() {},
    }
    await withView(async h => {
      const labels = () => h.view.root.findAll(node =>
        Object.hasOwn(node.props ?? {}, 'data-mobile-files-item'))
        .map(node => node.props['aria-label'])
      const saved = () => state.mobileFilesDecodeState(
        h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
      assert(labels().some(label => label === rowName(anchorIndex)), 'precondition: real sparse List row at 54,321 is mounted')
      assert(!labels().includes(rowName(0)), 'deep scroll must not already render the first file')
      await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
      await act(async () => { find(h.view, 'data-mobile-files-view-option', 'grid').props.onClick() })
      assert.equal(saved().view, 'grid')
      assert(labels().includes(rowName(anchorIndex)),
        'same logical Node must stay in the Grid virtual viewport, not snap to row zero')
      assert(saved().scrollTop > 0, 'persisted Browse position must be translated to Grid rows')
      assert.equal(saved().folderID, 1)
      assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
      await act(async () => { find(h.view, 'aria-label', '文件操作菜单').props.onClick({ currentTarget: {} }) })
      await act(async () => { find(h.view, 'data-mobile-files-view-option', 'details').props.onClick() })
      assert(labels().includes(rowName(anchorIndex)), 'return to List must keep the original logical row')
      assert.equal(saved().view, 'details')
      assert(saved().scrollTop > 0)
      assert.equal(saved().folderID, 1)
    }, {
      saved: { section: 'browse', folderID: 1, scrollTop: firstTop, view: 'details' },
      props: {
        requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
        virtualCollection,
        grouping: groupedMode ? { groupBy: 'type', foldersFirst: true } : undefined,
      },
    })
    assert(admitted < 2000, 'no materialization of 100k entries or extra Server transport')
  }
})


test('U09-D2c2 mounted Mobile List restores only the verified 100k current Node after an accepted sort', async () => {
  const before = { id: 42, revision: 7, name: 'original.pdf', kind: 'file' }
  const old = {
    interactionKey: 'old-name:1', itemCount: 100000,
    loadedItems: new Map([[0, before]]), itemAt: index => index === 0 ? before : undefined,
    groups: [], onRangeChange() {},
  }
  const next = {
    interactionKey: 'new-size:2', itemCount: 100000,
    loadedItems: new Map(), itemAt: () => undefined,
    groups: [], onRangeChange() {},
  }
  const scrollHost = { scrollTop: 0, clientWidth: 390, clientHeight: 750 }
  let acknowledge
  const acknowledged = new Promise(resolve => { acknowledge = resolve })
  const lookup = []
  const changes = []
  await withView(async h => {
    const sortItem = h.view.root.findAll(n => n.type === 'MenuItem' &&
      textOf(n.props.children) === '大小' && typeof n.props.onClick === 'function')
    assert.equal(sortItem.length, 1)
    await act(async () => { sortItem[0].props.onClick() })
    assert.equal(lookup.length, 0, 'never look up a guessed new ordinal before authorized first Range')
    await h.update({ sort: { key: 'size', direction: 'asc' }, virtualCollection: next })
    await act(async () => { acknowledge(true); await acknowledged })
    assert.equal(lookup.length, 1)
    assert.equal(lookup[0][0], 1)
    assert.equal(lookup[0][1], 42)
    assert.equal(lookup[0][2], 7)
    assert.equal(lookup[0][3], 100000)
    assert.deepEqual(lookup[0][4], { key: 'size', direction: 'asc' })
    assert.equal(lookup[0][6].aborted, false)
    assert.equal(scrollHost.scrollTop, 54321 * state.MOBILE_FILES_ROW_HEIGHT)
    const persisted = state.mobileFilesDecodeState(
      h.window.localStorage.getItem('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(persisted.scrollTop, scrollHost.scrollTop)
    assert.deepEqual(changes, [{ key: 'size', direction: 'asc' }])
  }, {
    saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: {
      crumbs: [{ id: 1, name: '我的文件' }], virtualCollection: old,
      grouping: { groupBy: 'none', foldersFirst: true },
      onSortChange: value => { changes.push(value); return acknowledged },
      locateVerifiedCurrentChild: async (...args) => {
        lookup.push(args)
        return { index: 54321, item: before }
      },
    },
    createNodeMock: element => element.props?.['data-xdrive-mobile-files-scroll'] !== undefined
      ? scrollHost : null,
  })
})

test('U09-D2c2 denied sort or unverified identity never reanchors Mobile scroll', async () => {
  const before = { id: 42, revision: 7, name: 'a.pdf', kind: 'file' }
  const source = key => ({
    interactionKey: key, itemCount: 100000,
    loadedItems: new Map([[0, before]]), itemAt: index => index === 0 ? before : undefined,
    groups: [], onRangeChange() {},
  })
  const host = { scrollTop: 0, clientWidth: 390, clientHeight: 700 }
  let allowed = false
  let calls = 0
  await withView(async h => {
    const click = async () => {
      const sortItem = h.view.root.findAll(n => n.type === 'MenuItem' &&
        textOf(n.props.children) === '大小' && typeof n.props.onClick === 'function')
      assert.equal(sortItem.length, 1)
      await act(async () => { sortItem[0].props.onClick() })
    }
    await click()
    await h.update({ sort: { key: 'size', direction: 'asc' }, virtualCollection: source('changed') })
    assert.equal(calls, 0, 'denied first Range forbids a follow-on child lookup')
    allowed = true
    await h.update({ sort: { key: 'name', direction: 'asc' }, virtualCollection: source('fresh') })
    await click()
    await h.update({ sort: { key: 'size', direction: 'asc' }, virtualCollection: source('fresh-target') })
    assert.equal(calls, 1)
    assert.equal(host.scrollTop, 0, 'a result with a changed Revision cannot restore the old position')
  }, {
    saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: {
      crumbs: [{ id: 1, name: '我的文件' }], virtualCollection: source('old'),
      grouping: { groupBy: 'none', foldersFirst: true },
      onSortChange: () => Promise.resolve(allowed),
      locateVerifiedCurrentChild: async () => {
        calls += 1
        return { index: 54321, item: { ...before, revision: 8 } }
      },
    },
    createNodeMock: element => element.props?.['data-xdrive-mobile-files-scroll'] !== undefined
      ? host : null,
  })
})

test('mounted Mobile Browse Home keeps organization rows stable through quick and sustained reads', async () => {
  await withView(async h => {
    const slot = () => find(h.view, 'data-mobile-files-organization-loading', true)
    const ringCount = () => slot().findAll(n => n.type === 'CircularProgress').length
    const organized = () => find(h.view, 'data-mobile-files-home-section', 'organization')
    const oldLabels = () => textOf(organized().props.children)
    const before = oldLabels()
    assert.ok(before.includes('整理'))
    assert.equal(ringCount(), 0)
    await h.update({ organizationLoading: true })
    assert.equal(find(h.view, 'data-xdrive-mobile-files-home', true).props['aria-busy'], true)
    assert.equal(slot().props['aria-hidden'], 'true')
    assert.equal(ringCount(), 0, 'first pending frame is quiet')
    assert.equal(oldLabels(), before, 'accepted organized entries remain mounted')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)) })
    assert.equal(ringCount(), 0, 'fast reads never flash a ring')
    await h.update({ organizationLoading: false })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)) })
    assert.equal(ringCount(), 0, 'finished request cannot leave stale delayed progress')

    await h.update({ organizationLoading: true })
    assert.equal(ringCount(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 335)) })
    assert.equal(ringCount(), 0, 'even a sustained organization refresh never inserts an intermediate ring')
    assert.equal(oldLabels(), before, 'the same real organization button stays in place')
    await h.update({ organizationLoading: false })
    assert.equal(ringCount(), 0, 'status disappears without removing or shifting the slot')
    assert.equal(count(h.view, 'data-mobile-files-organization-loading'), 1)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
  }, { props: {
    organizationLoading: false,
    savedSearches: [{ id: 60, name: '近期文档' }],
    tags: [{ id: 61, name: '重要标签' }],
  } })
})


test('Mobile Recent and Favorites require a confirmed zero; a failed read offers retry', async () => {
  let recentRetries = 0
  let favoriteRetries = 0
  await withView(async h => {
    const list = () => find(h.view, 'data-xdrive-mobile-files-collection', true)
    const labels = () => textOf(list().props.children)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-collection-first-read'), 1)
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 0)
    assert.equal(labels().includes('暂无最近打开的项目'), false)
    assert.equal(find(h.view, 'data-mobile-files-collection-state', true).props['aria-busy'], true)
    await h.update({ recentReadState: 'error', recentLoading: false })
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 1)
    assert.equal(labels().includes('暂无最近打开的项目'), false)
    const error = find(h.view, 'data-mobile-files-collection-error', true)
    const retry = error.findAll(n => typeof n.props?.onClick === 'function')
    assert.equal(retry.length, 1)
    await act(async () => { retry[0].props.onClick() })
    assert.equal(recentRetries, 1)
    await h.update({ recentReadState: 'error', recentLoading: true })
    assert.equal(count(h.view, 'data-mobile-files-collection-first-read'), 1)
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 0)
    await h.update({ recentReadState: 'ready', recentLoading: false })
    assert.equal(count(h.view, 'data-mobile-files-collection-first-read'), 0)
    assert.equal(labels().includes('暂无最近打开的项目'), true)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    assert.equal(count(h.view, 'data-mobile-files-collection-first-read'), 1)
    assert.equal(labels().includes('暂无收藏的文件'), false)
    await h.update({ favoritesReadState: 'error', favoritesLoading: false })
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 1)
    const favoriteError = find(h.view, 'data-mobile-files-collection-error', true)
    await act(async () => {
      favoriteError.findAll(n => typeof n.props?.onClick === 'function')[0].props.onClick()
    })
    assert.equal(favoriteRetries, 1)
    await h.update({ favoritesReadState: 'ready', favoritesLoading: false })
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 0)
    assert.equal(labels().includes('暂无收藏的文件'), true)
  }, { props: {
    recentItems: [], favorites: [],
    recentReadState: 'unverified', recentLoading: true,
    favoritesReadState: 'unverified', favoritesLoading: true,
    onRefreshRecent: () => { recentRetries++ },
    onRefreshFavorites: () => { favoriteRetries++ },
  } })
})

test('P46 Browse Home root navigation keeps the last home until an authorized first range commits', async () => {
  const acceptedRoot = { itemCount: 0, interactionKey: 'P46-authorized-root',
    loadedItems: new Map(), itemAt: () => undefined, onRangeChange() {}, groups: [] }
  const olderChild = { ...acceptedRoot, interactionKey: 'P46-confirmed-child' }
  let dispatched = 0
  await withView(async h => {
    const cloudRow = () => h.view.root.findAll(n => n.props?.role === 'button' &&
      typeof n.props?.onClick === 'function').find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(cloudRow())
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    const savedBefore = h.window.values.get('xdrive.mobile.files.v1:ios-files-userA')
    await act(async () => { cloudRow().props.onClick() })
    assert.equal(dispatched, 1, 'the existing owner GET must be issued immediately')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1,
      'pending root may not replace Browse Home with old child rows')
    assert.equal(h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'), savedBefore,
      'a tap may not commit the new persisted directory')
    await h.update({ loading: true })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    // Accepted crumbs without a completed counted Range still cannot commit.
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }] })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    await h.update({ loading: false, virtualCollection: acceptedRoot, items: [] })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(state.mobileFilesDecodeState(h.window.values.get(
      'xdrive.mobile.files.v1:ios-files-userA')).folderID, 1)
  }, { props: {
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    virtualCollection: olderChild, loading: false,
    onBrowseRoot: () => { dispatched++ },
  } })
})

test('P46 failed or superseded Home root intents never expose a wrong folder or reset scroll', async () => {
  let attempts = 0
  await withView(async h => {
    const cloudRow = h.view.root.findAll(n => n.props?.role === 'button' &&
      typeof n.props?.onClick === 'function').find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(cloudRow)
    await act(async () => { cloudRow.props.onClick() })
    assert.equal(attempts, 1)
    await h.update({ loading: false })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1,
      'failed or stalled root never leaves Browse Home')
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    await h.update({ crumbs: [{ id: 1, name: '我的文件' }],
      virtualCollection: { itemCount: 0, interactionKey: 'P46-late-root',
        loadedItems: new Map(), itemAt: () => undefined, onRangeChange() {}, groups: [] } })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'a late result after a newer Recent tap must not steal navigation')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
  }, { props: {
    crumbs: [{ id: 1, name: '我的文件' }, { id: 2, name: '照片文件夹' }],
    virtualCollection: { itemCount: 1, interactionKey: 'P46-confirmed-child',
      loadedItems: new Map(), itemAt: () => undefined, onRangeChange() {}, groups: [] },
    onBrowseRoot: () => { attempts++ },
  } })
})


test('P46 accepted nonvirtual root items reopen immediately without a false pending transition', async () => {
  let dispatches = 0
  await withView(async h => {
    const root = h.view.root.findAll(n => n.props?.role === 'button' && n.props?.onClick)
      .find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(root)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1)
    await act(async () => { root.props.onClick() })
    assert.equal(dispatches, 1)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    assert.ok(h.view.root.findAll(n => n.props?.['data-mobile-files-item'] !== undefined).length >= 2,
      'already accepted synchronous root rows must not be hidden')
  }, { props: { onBrowseRoot: () => { dispatches++ } } })
})


test('P47 Mobile Trash never claims empty before accepted GET; failed reads offer retry and refresh retains zero', async () => {
  let reloads = 0
  await withView(async h => {
    assert.equal(count(h.view, 'data-mobile-files-zero-state'), 1)
    assert.equal(count(h.view, 'data-mobile-files-trash-first-read'), 1)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'first unverified frame must not advertise a real empty Trash')
    await h.update({ loading: true })
    assert.equal(count(h.view, 'data-mobile-files-trash-first-read'), 1)
    assert.equal(find(h.view, 'data-mobile-files-trash-first-read', true).props['aria-busy'], true)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0,
      'short Trash GET is visually quiet')
    await h.update({ loading: false, trashReadState: 'error' })
    const error = find(h.view, 'data-mobile-files-trash-read-error', true)
    assert.equal(error.props.role, 'alert')
    assert.equal(count(h.view, 'data-mobile-files-trash-first-read'), 0)
    assert.equal(h.view.root.findAll(n => n.type === 'state-panel').length, 0)
    const retry = error.findAll(n => typeof n.props?.onClick === 'function')
    assert.equal(retry.length, 1)
    await act(async () => { retry[0].props.onClick() })
    assert.equal(reloads, 1)
    await h.update({ loading: true })
    assert.equal(count(h.view, 'data-mobile-files-trash-read-error'), 0,
      'retry in flight must not show a stale error row')
    assert.equal(count(h.view, 'data-mobile-files-trash-first-read'), 1)
    await h.update({ loading: false, trashReadState: 'ready' })
    const verified = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(verified.length, 1)
    assert.equal(verified[0].props.message, '最近删除为空')
    await h.update({ loading: true })
    const kept = h.view.root.findAll(n => n.type === 'state-panel')
    assert.equal(kept.length, 1)
    assert.equal(kept[0].props.message, '最近删除为空',
      'a confirmed zero must remain visible during a same-Owner refresh')
    assert.equal(kept[0].props.loading, false)
  }, { props: { items: [], trashActive: true, trashReadState: 'unverified',
    loading: false, onRefresh: () => { reloads += 1 } } })
})


test('M07: global Search exits to original Recent/Favorites virtual rail position', async () => {
  const recentItems = Array.from({ length: 240 }, (_, i) => ({
    id: 4000 + i, name: 'recent-search-' + i, kind: 'file', revision: 1,
  }))
  const favorites = Array.from({ length: 240 }, (_, i) => ({
    id: 5000 + i, name: 'favorite-search-' + i, kind: 'file', revision: 1,
  }))
  const sent = []
  const rows = h => h.view.root.findAll(n =>
    Object.hasOwn(n.props ?? {}, 'data-mobile-files-collection-title'))
    .map(n => n.props.title).filter(Boolean)
  const navigate = async (h, name) => {
    await act(async () => { find(h.view, 'data-mobile-files-section', name).props.onClick() })
  }
  const scroll = async (h, top) => {
    const host = find(h.view, 'data-xdrive-mobile-files-scroll', true)
    await act(async () => { host.props.onScroll({ currentTarget: { scrollTop: top } }) })
  }
  await withView(async h => {
    for (const [origin, top] of [['recent', 1700], ['favorites', 3000]]) {
      await navigate(h, origin)
      await scroll(h, top)
      const expected = rows(h)
      assert.ok(expected.length > 0, 'source rail must mount real virtual rows')
      const input = h.view.root.findAll(n => n.props?.['aria-label'] === '搜索全部文件')
      assert.equal(input.length, 1)
      await act(async () => { input[0].props.onKeyDown({ key: 'Enter', preventDefault() {} }) })
      assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0,
        'a global Search intentionally uses the existing Browse results surface')
      const pendingState = state.mobileFilesDecodeState(
        h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
      assert.equal(pendingState.folderID, null,
        'Search intent before the owner confirms results must not commit a false Browse folder')
      await h.update({ searchActive: true,
        searchSummary: { query: 'report', conditions: [], resultCount: 0, onClear() {} } })
      const clear = h.view.root.findAll(n => n.props?.onClick && n.props.children === '清除')
      assert.equal(clear.length, 1)
      await act(async () => { clear[0].props.onClick() })
      assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
        'clear should restore rail even before the owning Web search prop settles')
      await h.update({ searchActive: false, searchSummary: undefined })
      assert.equal(find(h.view, 'data-mobile-files-section', origin).props['aria-current'], 'page')
      assert.deepEqual(rows(h), expected, 'global Search must not overwrite collection virtual anchor')
    }
    assert.deepEqual(sent, ['report', 'report'])
    const saved = state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    assert.equal(saved.recentScrollTop, 1700)
    assert.equal(saved.favoritesScrollTop, 3000)
    assert.equal(saved.folderID, null, 'Search never persists a rail as a cloud folder')
  }, { props: { searchValue: 'report', recentItems, favorites,
    onSearch: query => { sent.push(query) } } })
})

test('M07: switching rail while an active Search clears does not bounce to Browse', async () => {
  let clears = 0
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    // The shared Web owner can activate an authenticated Search from outside
    // this particular Search Enter handler.
    await h.update({ searchActive: true,
      searchSummary: { query: 'report', conditions: [], resultCount: 0, onClear() {} } })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(clears, 1)
    assert.equal(find(h.view, 'data-mobile-files-section', 'recent').props['aria-current'], 'page')
    await h.update({ searchActive: false, searchSummary: undefined })
    assert.equal(find(h.view, 'data-mobile-files-section', 'recent').props['aria-current'], 'page',
      'the previous Search effect cannot steal an explicit newer rail intent')
  }, { props: { onClearSearch: () => { clears++ } } })
})

test('M07: Search return state is current-account-only and does not add a second query API', () => {
  const source = fs.readFileSync(path.join(root, 'web/src/MobileFiles.tsx'), 'utf8')
  for (const token of [
    "const searchReturnSectionRef = useRef<MobileFilesSection>('browse')",
    "searchReturnSectionRef.current = 'browse'",
    "searchClearPendingRef.current = false",
    "searchClearPendingRef.current = true",
    "globalSearchPresentationRef.current = true",
    "globalSearchPresentationRef.current = false",
    "globalSearchPresentationRef.current ||",
    "collectionScrollRef.current[returnSection]",
    "persist({ section: returnSection })",
  ]) assert.ok(source.includes(token), token)
  assert.doesNotMatch(source, /api\.search\(|fetch\(/,
    'the only global Search transport must remain the existing Web owner')
})


test('P52 Mobile inline folder disclosure keeps chevron and 44px hit target through quick and sustained child GET', async () => {
  const toggles = []
  const opens = []
  const pendingBranch = {
    ownerID: 2, parentID: 1, parentIndex: 0, name: '照片文件夹',
    itemCount: null, items: new Map(), loading: true, error: null,
  }
  const acceptedBranch = { ...pendingBranch, loading: false, itemCount: 0 }
  await withView(async h => {
    const location = h.view.root.findAll(n => n.props?.role === 'button' && n.props?.onClick)
      .find(n => textOf(n.props.children).includes('云端文件'))
    assert.ok(location)
    await act(async () => { location.props.onClick() })
    const arrow = () => find(h.view, 'data-mobile-files-folder-disclosure', '2')
    const progress = () => find(h.view, 'data-mobile-files-folder-disclosure-progress', true)
    const chevrons = () => arrow().findAll(n => n.type === 'ArrowBackIosNewRounded').length
    const rings = () => progress().findAll(n => n.type === 'CircularProgress').length
    assert.equal(arrow().props.sx.width, 44)
    assert.equal(arrow().props.sx.height, 44)
    assert.equal(chevrons(), 1)
    assert.equal(rings(), 0)
    await h.update({ inlineBranches: [pendingBranch] })
    assert.equal(arrow().props['aria-expanded'], true)
    assert.equal(arrow().props['aria-busy'], true)
    assert.equal(arrow().props.disabled, undefined,
      'the 44px collapse hit target must remain available during network reads')
    assert.equal(progress().props.sx.pointerEvents, 'none')
    assert.equal(chevrons(), 1, 'the actual chevron must not be replaced on the first pending frame')
    assert.equal(rings(), 0, 'the network progress ring must not appear immediately')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    assert.equal(rings(), 0, 'a 40ms child GET never flashes its spinner')
    await h.update({ inlineBranches: [acceptedBranch] })
    assert.equal(rings(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 325)) })
    assert.equal(rings(), 0, 'a completed fast read never leaves a stale delayed ring')
    assert.equal(chevrons(), 1)
    await h.update({ inlineBranches: [pendingBranch] })
    assert.equal(rings(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 335)) })
    assert.equal(rings(), 0, 'even a sustained child Range keeps the disclosure visually quiet')
    assert.equal(chevrons(), 1, 'the same expanded chevron remains while busy')
    assert.equal(arrow().props['aria-busy'], true)
    let stopped = 0
    await act(async () => { arrow().props.onClick({ stopPropagation() { stopped++ } }) })
    assert.equal(stopped, 1)
    assert.deepEqual(toggles, [[2, 1, 0]],
      'second tap still reaches original shared inline store to collapse and abort its GET')
    assert.deepEqual(opens, [], 'disclosure must never open a folder on row activation')
    await h.update({ inlineBranches: [] })
    assert.equal(arrow().props['aria-expanded'], false)
    assert.equal(arrow().props['aria-busy'], false)
    assert.equal(rings(), 0)
    assert.equal(chevrons(), 1)
    assert.equal(find(h.view, 'data-xdrive-mobile-files-scroll', true).props.sx.minHeight, 0)
  }, { props: {
    grouping: { groupBy: 'none', foldersFirst: true },
    onToggleInlineFolder: (item, owner, index) => toggles.push([item.id, owner, index]),
    onOpenItem: (item, owner) => { opens.push([item.id, owner]); return false },
  } })
})

test('P53 mounted Mobile Recent/Favorites idle-unverified first read never spins without network', async () => {
  await withView(async h => {
    const row = () => find(h.view, 'data-mobile-files-collection-first-read', true)
    const ringCount = () => row().findAll(n => n.type === 'CircularProgress').length
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(ringCount(), 0)
    assert.equal(find(h.view, 'data-mobile-files-collection-state', true).props['aria-busy'], undefined,
      'unverified but idle is not a running authenticated network request')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 345)) })
    assert.equal(ringCount(), 0, 'an idle unverified collection must remain quiet even after 300ms')
    await h.update({ recentLoading: true })
    assert.equal(row().props['aria-hidden'], 'true')
    assert.equal(find(h.view, 'data-mobile-files-collection-state', true).props['aria-busy'], true)
    assert.equal(ringCount(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)) })
    assert.equal(ringCount(), 0, 'fast current request never flashes its spinner')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 325)) })
    assert.equal(ringCount(), 0, 'even sustained Recent requests remain silent inside the 180px fixed slot')
    await h.update({ recentLoading: false })
    assert.equal(ringCount(), 0, 'a settled request removes only decorative progress')
    await h.update({ recentReadState: 'error' })
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 1,
      'a true failure still exposes the explicit retryable error')
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    assert.equal(ringCount(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 335)) })
    assert.equal(ringCount(), 0, 'idle unverified Favorites must not spin either')
    await h.update({ favoritesLoading: true })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 330)) })
    assert.equal(ringCount(), 0, 'even sustained Favorites requests remain visually silent while busy')
    await h.update({ favoritesLoading: false })
    assert.equal(ringCount(), 0)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
  }, { props: {
    recentItems: [], favorites: [],
    recentReadState: 'unverified', recentLoading: false,
    favoritesReadState: 'unverified', favoritesLoading: false,
  } })
})


test('P56 Mobile Search summary never flashes in-flow query copy or shifts result metadata', async () => {
  let retries = 0
  let cleared = 0
  await withView(async h => {
    const summary = () => find(h.view, 'data-mobile-files-search-summary', true)
    const countSlot = () => find(h.view, 'data-mobile-files-search-count-slot', true)
    const meta = () => textOf(countSlot().props.children)
    assert.equal(count(h.view, 'data-mobile-files-search-summary'), 1)
    assert.equal(meta(), '结果待确认', 'pending count is not fake zero or an instant loading phrase')
    assert.equal(summary().props['aria-busy'], true)
    assert.equal(summary().props.sx.minHeight, 44)
    assert.equal(summary().props.sx.minWidth, 0)
    assert.equal(countSlot().props.component, 'span')
    assert.equal(countSlot().props.sx.minWidth, '12ch')
    assert.equal(countSlot().props.sx.whiteSpace, 'nowrap')
    const oldTree = h.view.root.findAll(n=>n.props?.['data-xdrive-mobile-files-scroll'] !== undefined)
    assert.equal(oldTree.length, 1)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    assert.equal(meta(), '结果待确认')
    assert.equal(count(h.view, 'data-mobile-files-search-summary'), 1)
    await h.update({ searchSummary: { query: 'needle', resultCount: 240, loading: false } })
    assert.equal(meta(), '240 个结果')
    assert.equal(summary().props['aria-busy'], undefined)
    assert.equal(countSlot().props.sx.minWidth, '12ch')
    await h.update({ searchSummary: {
      query: 'needle', resultCount: null, loading: false,
      error: '503 后端暂不可用', onRetry: () => { retries += 1 },
    } })
    assert.equal(meta(), '搜索未完成', 'failed count never claims zero')
    assert.equal(summary().props['aria-busy'], undefined)
    assert.ok(h.view.root.findAll(n => n.props?.role === 'alert').some(n =>
      textOf(n.props.children).includes('503')))
    const retry = h.view.root.findAll(n => n.props?.onClick &&
      textOf(n.props.children) === '重试')[0]
    assert.ok(retry)
    await act(async () => { retry.props.onClick() })
    assert.equal(retries, 1)
    const clear = summary().findAll(n => n.props?.onClick && textOf(n.props.children) === '清除')
    assert.equal(clear.length, 1)
    assert.equal(clear[0].props.sx.minHeight, 44)
    await act(async () => { clear[0].props.onClick() })
    assert.equal(cleared, 1)
  }, { props: {
    searchActive: true, items: [], loading: true, searchValue: 'needle',
    searchSummary: { query: 'needle', resultCount: null, loading: true },
    onClearSearch: () => { cleared += 1 },
  } })
})


function p69CountedDirectory(id, label = 'accepted.txt') {
  const item = { id: id * 10 + 1, name: label, kind: 'file', revision: 1 }
  return {
    itemCount: 1, interactionKey: 'p69-authoritative:' + id,
    loadedItems: new Map([[0, item]]), itemAt: index => index === 0 ? item : undefined,
    onRangeChange() {}, groups: [],
  }
}
function p69ClickHomeFolder(view, label) {
  const title = view.root.findAll(node =>
    Object.hasOwn(node.props ?? {}, 'data-mobile-files-collection-title') &&
    node.props.children === label)[0]
  assert.ok(title, 'missing original Browse Home row: ' + label)
  let node = title
  while (node && node.props.role !== 'button') node = node.parent
  assert.ok(node?.props.onClick, 'same original row must own the click')
  node.props.onClick()
}
test('P69: Recent folder Promise completion is not a counted directory commit', async () => {
  let resolveOpen
  const activation = new Promise(resolve => { resolveOpen = resolve })
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    await h.update({ loading: true })
    await act(async () => { resolveOpen(true); await activation })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'completion can precede the React commit; keep the accepted Recent rail')
    assert.equal(saved().folderID, 1, 'do not pre-persist an unverified destination')
    await h.update({
      loading: false,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '相册文件夹' }],
      items: [{ id: 421, name: 'verified.txt', kind: 'file', revision: 1 }],
      virtualCollection: p69CountedDirectory(42, 'verified.txt'),
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(saved().folderID, 42)
    assert.equal(saved().section, 'browse')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 42, kind: 'dir', name: '相册文件夹' }],
    onOpenRecent: () => activation,
  } })
})
test('P69: a late successful Recent callback cannot reset the committed scroll twice', async () => {
  let resolveOpen
  const activation = new Promise(resolve => { resolveOpen = resolve })
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    await h.update({
      loading: false,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '已授权' }],
      virtualCollection: p69CountedDirectory(42),
    })
    assert.equal(saved().folderID, 42)
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    await act(async () => {
      find(h.view, 'data-xdrive-file-explorer-scroll-host', true)
        .props.onScroll({ currentTarget: { scrollTop: 286 } })
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 230)) })
    assert.equal(saved().scrollTop, 286)
    await act(async () => { resolveOpen(true); await activation })
    assert.equal(saved().scrollTop, 286,
      'late Promise must not call beginBrowse after the first pre-paint commit')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 42, kind: 'dir', name: '已授权' }],
    onOpenRecent: () => activation,
  } })
})
test('P69: Quick Access rejected and successful folder activations never expose unverified contents', async () => {
  let resolveOpen
  const denied = new Promise(resolve => { resolveOpen = resolve })
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { p69ClickHomeFolder(h.view, '快捷相册') })
    await h.update({ loading: true })
    await act(async () => { resolveOpen(false); await denied })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1,
      'a failed shortcut keeps Browse Home visible')
    assert.notEqual(saved().folderID, 77)
    await h.update({ loading: false, onOpenQuickAccess: async () => true })
    await act(async () => { p69ClickHomeFolder(h.view, '快捷相册') })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 1,
      'a quick successful Promise does not reveal the old folder below a new title')
    await h.update({
      crumbs: [{ id: 1, name: '我的文件' }, { id: 77, name: '快捷相册' }],
      items: [{ id: 771, name: 'new.txt', kind: 'file', revision: 1 }],
      virtualCollection: p69CountedDirectory(77, 'new.txt'),
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-home'), 0)
    assert.equal(saved().folderID, 77)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    crumbs: [{ id: 1, name: '我的文件' }],
    quickAccess: [{ id: 77, name: '快捷相册', kind: 'dir' }],
    onOpenQuickAccess: () => denied,
  } })
})
test('P69: a superseding rail tap defeats an older Recent directory receipt', async () => {
  let resolveOpen
  const activation = new Promise(resolve => { resolveOpen = resolve })
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    await h.update({
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '旧请求' }],
      virtualCollection: p69CountedDirectory(42),
      loading: false,
    })
    await act(async () => { resolveOpen(true); await activation })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    assert.equal(find(h.view, 'data-mobile-files-section', 'favorites').props['aria-current'], 'page')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 42, kind: 'dir', name: '旧请求' }],
    onOpenRecent: () => activation,
  } })
})

test('P69: keyboard collection Open waits for authorized counted first Range', async () => {
  let resolveOpen
  const pending = new Promise(resolve => { resolveOpen = resolve })
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    const recent = find(h.view, 'data-mobile-files-collection-row', 'recent')
    const rect = { getBoundingClientRect: () => ({ left: 30, top: 60 }) }
    await act(async () => { recent.props.onKeyDown({
      key: 'ContextMenu', target: rect, currentTarget: rect,
      shiftKey: false, preventDefault() {},
    }) })
    const menu = find(h.view, 'data-mobile-files-collection-menu', true)
    const open = menu.findAll(node => node.type === 'MenuItem' && node.props?.children === '打开')
    assert.equal(open.length, 1)
    await act(async () => { open[0].props.onClick() })
    await h.update({ loading: true })
    await act(async () => { resolveOpen(true); await pending })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'menu acceptance cannot expose old rows under an unverified folder')
    assert.notEqual(saved().folderID, 42)
    await h.update({
      loading: false,
      crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '获准文件夹' }],
      items: [{ id: 421, name: 'verified.txt', kind: 'file', revision: 1 }],
      virtualCollection: p69CountedDirectory(42),
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(saved().folderID, 42)
    assert.equal(saved().section, 'browse')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 42, kind: 'dir', name: '获准文件夹' }],
    onOpenRecent: () => pending,
  } })
})

test('P69: long-press Favorite menu folder rejection stays on old rail', async () => {
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const favorite = find(h.view, 'data-mobile-files-collection-row', 'favorites')
    await act(async () => { favorite.props.onContextMenu({
      preventDefault() {}, clientX: 55, clientY: 90,
    }) })
    const menu = find(h.view, 'data-mobile-files-collection-menu', true)
    const open = menu.findAll(node => node.type === 'MenuItem' && node.props?.children === '打开')
    assert.equal(open.length, 1)
    await act(async () => { open[0].props.onClick(); await Promise.resolve() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    assert.equal(find(h.view, 'data-mobile-files-section', 'favorites').props['aria-current'], 'page')
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    favorites: [{ id: 77, kind: 'dir', name: '拒绝的收藏文件夹' }],
    onOpenFavorite: async () => false,
  } })
})


test('P69: collection Show in Folder waits for the true parent Range, not location Promise', async () => {
  let finishNavigation
  const navigation = new Promise(resolve => { finishNavigation = resolve })
  await withView(async h => {
    const saved = () => state.mobileFilesDecodeState(
      h.window.values.get('xdrive.mobile.files.v1:ios-files-userA'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const row = find(h.view, 'data-mobile-files-collection-row', 'favorites')
    await act(async () => { row.props.onContextMenu({
      preventDefault() {}, clientX: 55, clientY: 90,
    }) })
    const menu = find(h.view, 'data-mobile-files-collection-menu', true)
    const show = menu.findAll(node =>
      node.type === 'MenuItem' && node.props?.children === '显示所在文件夹')
    assert.equal(show.length, 1)
    await act(async () => { show[0].props.onClick(); await Promise.resolve() })
    await h.update({ loading: true })
    await act(async () => { finishNavigation(true); await navigation })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'authoritative parent has not committed; keep original Favorites rail')
    assert.notEqual(saved().folderID, 42)
    await h.update({
      loading: false, crumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '实际位置' }],
      items: [{ id: 421, name: '真实文件.txt', kind: 'file', revision: 1 }],
      virtualCollection: p69CountedDirectory(42),
    })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
    assert.equal(saved().folderID, 42)
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    favorites: [{ id: 3, kind: 'file', name: '真实文件.txt' }],
    loadNodeLocation: async () => ({ node_id: 3, parent_id: 42,
      breadcrumbs: [{ id: 1, name: '我的文件' }, { id: 42, name: '实际位置' }] }),
    onShowInFolder: () => navigation,
  } })
})

test('P69: stale Show in Folder location lookup cannot navigate after a newer rail tap', async () => {
  let resolveLocation
  const lookup = new Promise(resolve => { resolveLocation = resolve })
  const navigation = []
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    const row = find(h.view, 'data-mobile-files-collection-row', 'favorites')
    await act(async () => { row.props.onContextMenu({
      preventDefault() {}, clientX: 60, clientY: 95,
    }) })
    const menu = find(h.view, 'data-mobile-files-collection-menu', true)
    const show = menu.findAll(node =>
      node.type === 'MenuItem' && node.props?.children === '显示所在文件夹')
    assert.equal(show.length, 1)
    await act(async () => { show[0].props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { resolveLocation({ node_id: 3, parent_id: 42 }); await lookup })
    assert.deepEqual(navigation, [], 'new rail wins: no stale parent navigation')
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1)
    assert.equal(find(h.view, 'data-mobile-files-section', 'recent').props['aria-current'], 'page')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    favorites: [{ id: 3, kind: 'file', name: '真实文件.txt' }],
    loadNodeLocation: () => lookup,
    onShowInFolder: location => { navigation.push(location); return true },
  } })
})

test('P69: re-entering an already accepted directory still requires a successful activation', async () => {
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'a rejected same-folder activation cannot reveal Browse')
    await h.update({ onOpenRecent: async () => true })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 0)
    assert.equal(count(h.view, 'data-xdrive-file-explorer-scroll-host'), 1)
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 1, kind: 'dir', name: '我的文件' }],
    onOpenRecent: async () => false,
  } })
})

test('P69: same-directory refresh never commits a pending unaccepted Recent activation', async () => {
  let finish
  const activation = new Promise(resolve => { finish = resolve })
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    await h.update({ loading: true })
    await h.update({ loading: false })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'a coincidental background refresh must not approve the unresolved activation')
    await act(async () => { finish(false); await activation })
    assert.equal(count(h.view, 'data-xdrive-mobile-files-collection'), 1,
      'rejected same-directory activation remains in the old rail')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 1, kind: 'dir', name: '我的文件' }],
    onOpenRecent: () => activation,
  } })
})
test('P69: a superseded rejected directory Promise does not show an old-error toast', async () => {
  let rejectOpen
  const activation = new Promise((_, reject) => { rejectOpen = reject })
  const errors = []
  await withView(async h => {
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-collection-row', 'recent').props.onClick() })
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    await act(async () => { rejectOpen(new Error('stale old navigation')); await activation.catch(() => {}) })
    assert.equal(errors.length, 0, 'the newer rail owns errors, not stale navigation callbacks')
    assert.equal(find(h.view, 'data-mobile-files-section', 'favorites').props['aria-current'], 'page')
  }, { props: {
    requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }],
    virtualCollection: p69CountedDirectory(1),
    recentItems: [{ id: 42, kind: 'dir', name: '旧请求' }],
    onOpenRecent: () => activation,
    onOpenError: error => errors.push(error.message),
  } })
})


test('P74 Mobile Recent/Favorites keep an honest 180px first-read slot with no 300ms status ring', async () => {
  await withView(async h => {
    const firstRead = () => find(h.view, 'data-mobile-files-collection-first-read', true)
    const panel = () => find(h.view, 'data-mobile-files-collection-state', true)
    const rings = () => panel().findAll(n => n.type === 'CircularProgress').length
    await act(async () => { find(h.view, 'data-mobile-files-section', 'recent').props.onClick() })
    assert.equal(panel().props.sx.minHeight, 180)
    assert.equal(panel().props['aria-busy'], true)
    assert.equal(firstRead().props['aria-hidden'], 'true')
    assert.equal(rings(), 0)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(panel().props.sx.minHeight, 180)
    assert.equal(rings(), 0, 'a sustained real Owner request must not create a navigational spinner')
    await h.update({ recentLoading: false, recentReadState: 'ready' })
    assert.equal(count(h.view, 'data-mobile-files-collection-first-read'), 0)
    assert.equal(panel().props.sx.minHeight, 180)
    assert.ok(textOf(panel().props.children).includes('暂无最近打开的项目'))
    await act(async () => { find(h.view, 'data-mobile-files-section', 'favorites').props.onClick() })
    assert.equal(panel().props['aria-busy'], true)
    assert.equal(firstRead().props['aria-hidden'], 'true')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 365)) })
    assert.equal(panel().props.sx.minHeight, 180)
    assert.equal(rings(), 0, 'Favorites also has no intermediate timer-inserted spinner')
    await h.update({ favoritesLoading: false, favoritesReadState: 'error' })
    assert.equal(count(h.view, 'data-mobile-files-collection-error'), 1)
    assert.equal(panel().props.sx.minHeight, 180)
  }, { props: {
    recentItems: [], favorites: [], recentLoading: true, favoritesLoading: true,
    recentReadState: 'unverified', favoritesReadState: 'unverified',
  } })
})


test('P75: unrelated file operation busy cannot certify that a cold directory GET failed', async () => {
  await withView(async h => {
    const panel = () => h.view.root.findAll(n => n.type === 'state-panel')
    const slot = () => find(h.view, 'data-mobile-files-cold-read-slot', true)
    assert.equal(slot().props.sx.minHeight, 180)
    assert.equal(panel().length, 0)
    await h.update({ loading: true, directoryLoading: false })
    assert.equal(panel().length, 0, 'composite FileOperation pending must keep current directory unverified')
    await h.update({ loading: false, directoryLoading: false })
    assert.equal(panel().length, 0,
      'operation completion must not show a false directory failure')
    assert.equal(slot().props['aria-busy'], true)
    await h.update({ loading: true, directoryLoading: true })
    assert.equal(panel().length, 0)
    await h.update({ loading: false, directoryLoading: false })
    assert.equal(panel()[0]?.props.message,
      '文件夹内容尚未确认，请刷新页面后重试。',
      'only a real directory GET lifecycle may authorize its terminal failure')
  }, {
    saved: { section: 'browse', folderID: 1, scrollTop: 0, view: 'details' },
    props: { items: [], loading: false, directoryLoading: false,
      requestedDirectoryID: 1, crumbs: [{ id: 1, name: '我的文件' }] },
  })
})
