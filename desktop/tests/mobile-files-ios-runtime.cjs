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
  const mod = { exports: {} }
  new Function('module', 'exports', compile('web/src/mobileFilesState.ts'))(mod, mod.exports)
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
const material = new Proxy({}, { get: (_, name) => String(name) })
const ui = {
  XDriveFileExplorerAvailabilityBadge: 'availability-badge',
  XDriveFileExplorerItemIcon: 'file-icon',
  XDriveFileExplorerThumbnail: 'file-thumbnail',
  XDriveFileExplorerThumbnailProvider: 'thumbnail-provider',
  XDriveFilePropertiesDialog: 'properties-dialog',
  XDriveMediaDetailsInspector: 'media-inspector',
  xDriveFileSupportsThumbnail: name => /\.(?:png|jpg|jpeg|livp|mov|mp4)$/i.test(name),
  xDriveFileExplorerMarkThumbnailScrollActivity() {},
  xDriveFileKind: name => /\.(?:png|jpg|livp)$/i.test(name) ? 'image' : 'file',
  xDriveFileTypeLabel: name => name.includes('.') ? '文件' : '文件夹',
  xDriveCreateFileExplorerGroupLayout: grouped.xDriveCreateFileExplorerGroupLayout,
  xDriveFileExplorerVisibleGroupSegments: grouped.xDriveFileExplorerVisibleGroupSegments,
}
const dragCalls = []
const imports = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': material,
  '@xdrive/ui/mui': ui,
  '../../ui/shared/src': {
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

