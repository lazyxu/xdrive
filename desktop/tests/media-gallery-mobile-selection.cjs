const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

const repo = path.resolve(__dirname, '../..')
const filename = path.join(repo, 'ui/shared/src/mui/MediaGallerySelectionToolbar.tsx')
const source = fs.readFileSync(filename, 'utf8')
let compactViewport = true
const mui = {
  Box: 'box', Button: 'button', CircularProgress: 'spinner',
  Dialog: 'dialog', Drawer: 'drawer', Menu: 'menu', List: 'list', ListItemButton: 'listitem',
  DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  MenuItem: 'menuitem', Paper: 'paper', Stack: 'stack',
  TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => compactViewport,
}
const bindings = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': mui,
  './ConfirmDialog': { XDriveConfirmDialog: 'confirm' },
  './DialogContent': { XDriveDialogContent: 'dialog-content' },
  './DialogTitle': { XDriveDialogTitle: 'dialog-title', xDriveDialogPaperProps: {} },
  './MediaGalleryUtils': {
    xDriveMediaGalleryErrorMessage: (error) => error instanceof Error ? error.message : String(error),
  },
  './useMobilePanelViewport': { useXDriveMobilePanelViewport: () => null },
}
const output = ts.transpileModule(source, {
  fileName: filename, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const mod = { exports: {} }
const stubRequire = (name) => {
  if (Object.prototype.hasOwnProperty.call(bindings, name)) return bindings[name]
  if (name.startsWith('@mui/icons-material/')) return 'icon'
  throw new Error('Unexpected dependency: ' + name)
}
new Function('exports', 'module', 'require', output)(mod.exports, mod, stubRequire)
const { XDriveMediaGallerySelectionToolbar: Toolbar } = mod.exports

const albums = [
  { id: 'manual-a', name: '旅行照片', kind: 'manual', item_count: 9, revision: 1 },
  { id: 'smart-a', name: '最近拍摄', kind: 'smart', item_count: 32, revision: 1 },
  { id: 'manual-b', name: '家人', kind: 'manual', item_count: 6, revision: 1 },
]
const props = (overrides = {}) => ({
  selectedCount: 3, allFavorite: false, albums,
  onClear: () => {},
  onFavorite: async () => {},
  onAddToAlbum: async () => {},
  onAddTags: async () => {},
  onDownload: async () => {},
  onDelete: async () => {},
  ...overrides,
})
const button = (root, label) => {
  const matches = root.findAll((el) => el.type === 'button' && el.props.children === label)
  assert.equal(matches.length, 1, 'expected one button: ' + label)
  return matches[0]
}
const menuAction = (root, label) => {
  const found = root.findAll((n) => n.type === 'menuitem' && n.props.children === label)
  assert.equal(found.length, 1, 'expected menu action: ' + label)
  return found[0]
}
const moreButton = (root) => {
  const found = root.findAll((n) => n.type === 'iconbutton' &&
    n.props['data-xdrive-gallery-selection-more'])
  assert.equal(found.length, 1)
  return found[0]
}
const openMore = async (view) => {
  await act(async () => { moreButton(view.root).props.onClick({ currentTarget: { id: 'more' } }) })
  assert.equal(view.root.findAll((n) => n.type === 'menu')[0].props.open, true)
}
const albumRows = (root) => root.findAll((node) => node.type === 'listitem')
const drawer = (root) => {
  const found = root.findAll((node) => node.type === 'drawer')
  assert.equal(found.length, 1)
  return found[0]
}
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('real compact selection toolbar pins count and opens a manual-only album chooser', async () => {
  let called = []
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Toolbar, props({
      onAddToAlbum: async (album) => { called.push(album.id) },
    })))
  })
  assert.equal(menuAction(view.root, '加入相册').props.disabled, false)
  await openMore(view)
  await act(async () => { menuAction(view.root, '加入相册').props.onClick() })
  assert.equal(drawer(view.root).props.open, true)
  assert.deepEqual(albumRows(view.root).map((el) => el.props.children[0].props.children), ['旅行照片', '家人'])
  await act(async () => { albumRows(view.root)[1].props.onClick() })
  await act(async () => {
    button(view.root, '添加到相册').props.onClick()
    await settle()
  })
  assert.deepEqual(called, ['manual-b'])
  assert.equal(drawer(view.root).props.open, false)
  await act(async () => { view.unmount() })
})

test('failed album assignment is visible and selection changes cannot silently submit a different selection', async () => {
  let requested = 0
  let view
  const action = async () => {
    requested += 1
    throw new Error('相册权限已变化')
  }
  await act(async () => { view = renderer.create(React.createElement(Toolbar, props({ onAddToAlbum: action }))) })
  await openMore(view)
  await act(async () => { menuAction(view.root, '加入相册').props.onClick() })
  await act(async () => { albumRows(view.root)[0].props.onClick() })
  await act(async () => {
    button(view.root, '添加到相册').props.onClick()
    await settle()
  })
  assert.equal(requested, 1)
  assert.equal(drawer(view.root).props.open, true)
  assert.ok(view.root.findAll((node) =>
    node.type === 'typography' && node.props.role === 'alert' &&
    String(node.props.children).includes('相册权限已变化')).length > 0)
  await act(async () => {
    view.update(React.createElement(Toolbar, props({
      selectedCount: 4, onAddToAlbum: action,
    })))
  })
  assert.equal(button(view.root, '添加到相册').props.disabled, true)
  await act(async () => { button(drawer(view.root), '取消').props.onClick() })
  assert.equal(drawer(view.root).props.open, false)
  assert.equal(requested, 1)
  await act(async () => { view.unmount() })
})

test('same selected count with changed media identity cannot submit a stale album selection', async () => {
  const selectionA = { ids: [1, 2, 3] }
  const selectionB = { ids: [4, 5, 6] }
  let requests = 0
  const action = async () => { requests += 1 }
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Toolbar, props({
      selectedCount: 3, selectionIdentity: selectionA, onAddToAlbum: action,
    })))
  })
  await openMore(view)
  await act(async () => { menuAction(view.root, '加入相册').props.onClick() })
  await act(async () => { albumRows(view.root)[0].props.onClick() })
  await act(async () => {
    view.update(React.createElement(Toolbar, props({
      selectedCount: 3, selectionIdentity: selectionB, onAddToAlbum: action,
    })))
  })
  assert.equal(button(view.root, '添加到相册').props.disabled, true)
  await act(async () => {
    button(view.root, '添加到相册').props.onClick()
    await settle()
  })
  assert.equal(requests, 0)
  await act(async () => { view.unmount() })
})

test('mobile album chooser explains when no manual albums exist', async () => {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(Toolbar, props({
      albums: [albums[1]],
    })))
  })
  assert.equal(menuAction(view.root, '加入相册').props.disabled, false)
  await openMore(view)
  await act(async () => { menuAction(view.root, '加入相册').props.onClick() })
  assert.equal(drawer(view.root).props.open, true)
  assert.equal(albumRows(view.root).length, 0)
  assert.ok(view.root.findAll((node) => node.type === 'typography' &&
    String(node.props.children).includes('暂无手动相册')).length > 0)
  assert.equal(button(view.root, '添加到相册').props.disabled, true)
  await act(async () => { view.unmount() })
})

test('compact selection stays inside Gallery and has direct 44px actions rather than a global bar', () => {
  assert.match(source, /data-xdrive-gallery-selection-toolbar/)
  assert.match(source, /flexWrap=\{compactViewport \? 'nowrap' : 'wrap'\}/)
  assert.match(source, /overflowX: 'hidden'/)
  assert.match(source, /data-xdrive-gallery-selection-more/)
  assert.match(source, /minHeight: 44/)
  assert.match(source, /data-xdrive-gallery-album-picker/)
  assert.match(source, /role="status"/)
  assert.doesNotMatch(source, /position:\s*'fixed'/)
})


test('P1-3a compact selection preserves primary actions and routes secondary actions through More', async () => {
  const calls = []
  let view
  await act(async () => { view = renderer.create(React.createElement(Toolbar, props({
    selectionIdentity: 'selection-A',
    onDownload: async () => { calls.push('download') },
    onCreateCollage: () => calls.push('collage'),
    onCreateMovie: () => calls.push('movie'),
  }))) })
  button(view.root, '收藏')
  button(view.root, '删除')
  assert.equal(view.root.findAll(n => n.type === 'button' && n.props.children === '下载').length, 0)
  assert.equal(moreButton(view.root).props.sx.width, 44)
  await openMore(view)
  assert.deepEqual(view.root.findAll(n => n.type === 'menuitem')
    .map(n => n.props.children).filter(n => typeof n === 'string'),
  ['加入相册', '标签', '下载', '拼图', '自动电影'])
  await act(async () => { menuAction(view.root, '下载').props.onClick(); await settle() })
  assert.deepEqual(calls, ['download'])
  assert.equal(view.root.findAll(n => n.type === 'menu')[0].props.open, false)
  await openMore(view)
  await act(async () => { menuAction(view.root, '拼图').props.onClick() })
  await openMore(view)
  await act(async () => { menuAction(view.root, '自动电影').props.onClick() })
  assert.deepEqual(calls, ['download','collage','movie'])
  await openMore(view)
  await act(async () => { view.update(React.createElement(Toolbar, props({
    selectionIdentity: 'selection-B',
  }))) })
  assert.equal(view.root.findAll(n => n.type === 'menu')[0].props.open, false)
  await act(async () => { view.unmount() })
})

test('P1-3a 899-to-900-to-899 crossover dismisses More; wide controls remain direct', async () => {
  let view
  const options = () => props({ onCreateCollage: () => {}, onCreateMovie: () => {} })
  try {
    await act(async () => { view = renderer.create(React.createElement(Toolbar, options())) })
    await openMore(view)
    compactViewport = false
    await act(async () => { view.update(React.createElement(Toolbar, options())) })
    assert.equal(view.root.findAll(n => n.type === 'menu')[0].props.open, false)
    assert.equal(view.root.findAll(n => n.props['data-xdrive-gallery-selection-more']).length, 0)
    for (const label of ['下载','标签','拼图','自动电影']) button(view.root, label)
    assert.ok(view.root.findAll(n => n.type === 'textfield' && n.props.label === '添加到相册').length)
    compactViewport = true
    await act(async () => { view.update(React.createElement(Toolbar, options())) })
    assert.equal(view.root.findAll(n => n.type === 'menu')[0].props.open, false)
  } finally {
    compactViewport = true
    if (view) await act(async () => { view.unmount() })
  }
})

test('P1-3a More respects capability, zero selection and Trash-only actions', async () => {
  let view
  await act(async () => { view = renderer.create(React.createElement(Toolbar, props({
    onAddToAlbum: undefined, onAddTags: undefined, onDownload: undefined,
  }))) })
  assert.equal(view.root.findAll(n => n.props['data-xdrive-gallery-selection-more']).length, 0)
  await act(async () => { view.update(React.createElement(Toolbar, props({ selectedCount: 0 }))) })
  assert.equal(moreButton(view.root).props.disabled, true)
  await act(async () => { view.update(React.createElement(Toolbar, props({
    onRestore: async () => {}, onPermanentDelete: async () => {},
  }))) })
  button(view.root, '恢复')
  button(view.root, '永久删除')
  assert.equal(view.root.findAll(n => n.props['data-xdrive-gallery-selection-more']).length, 0)
  await act(async () => { view.unmount() })
})
