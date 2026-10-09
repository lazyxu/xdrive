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
const mui = {
  Box: 'box', Button: 'button', CircularProgress: 'spinner',
  Dialog: 'dialog', Drawer: 'drawer', List: 'list', ListItemButton: 'listitem',
  DialogActions: 'dialog-actions', IconButton: 'iconbutton',
  MenuItem: 'menuitem', Paper: 'paper', Stack: 'stack',
  TextField: 'textfield', Typography: 'typography',
  useMediaQuery: () => true,
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
  assert.equal(button(view.root, '加入相册').props.disabled, false)
  await act(async () => { button(view.root, '加入相册').props.onClick() })
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
  await act(async () => { button(view.root, '加入相册').props.onClick() })
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
  await act(async () => { button(view.root, '加入相册').props.onClick() })
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
  assert.equal(button(view.root, '加入相册').props.disabled, false)
  await act(async () => { button(view.root, '加入相册').props.onClick() })
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
  assert.match(source, /overflowX: 'auto'/)
  assert.match(source, /minHeight: 44/)
  assert.match(source, /data-xdrive-gallery-album-picker/)
  assert.match(source, /role="status"/)
  assert.doesNotMatch(source, /position:\s*'fixed'/)
})
