const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Real shared Web/Desktop AlbumOrganizer: all state/effects/event handlers
// come from the production TSX, with controlled Server Promise completion.
const root = path.resolve(__dirname, '../..')
const read = pathname => fs.readFileSync(path.join(root, pathname), 'utf8')
const compile = (pathname, jsx = false) => ts.transpileModule(read(pathname), {
  fileName: path.join(root, pathname),
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
    esModuleInterop: true,
  },
}).outputText
function loadSource(pathname, deps, jsx = false) {
  const module = { exports: {} }
  new Function('exports', 'module', 'require', compile(pathname, jsx))(
    module.exports, module, name => {
      if (!Object.hasOwn(deps, name)) throw Error('unexpected import: ' + name)
      return deps[name]
    },
  )
  return module.exports
}
const preferences = loadSource('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts', {})
const folders = loadSource('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts', {})
const tags = Object.fromEntries([
  'Alert', 'Box', 'Breadcrumbs', 'Button', 'CircularProgress',
  'Dialog', 'DialogActions', 'DialogContent', 'DialogTitle',
  'IconButton', 'MenuItem', 'Paper', 'Stack', 'TextField',
  'Tooltip', 'Typography',
].map(name => [name, name.toLowerCase()]))
const icons = new Proxy({}, {
  get: (_, name) => String(name),
})
const component = loadSource('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material': icons,
  './MediaGalleryPreviewMedia': { XDriveMediaAsyncThumbnail: 'thumbnail' },
  './MediaGalleryAlbumOrganization': preferences,
  './MediaGalleryAlbumFolderModel': folders,
}, true).XDriveMediaGalleryAlbumOrganizer

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i=0; i<12; i++) await Promise.resolve() }
const folder = (name, id=7) => ({ id, parent_id: 0, name, revision: 1 })
const hasFolder = (view, id) => view.root.findAll(
  el => el.props['data-xdrive-gallery-album-folder'] === id,
).length > 0
function button(view, label) {
  const result = view.root.findAll(el => el.type === 'button' && el.props.children === label)[0]
  assert.ok(result, 'missing production button: ' + label)
  return result
}
const props = folderActions => ({
  albums: [], accountScope: 'web:race-test', folderActions,
  loadThumbnail: async () => null,
})
async function mount(folderActions) {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(component, props(folderActions)))
    await flush()
  })
  return view
}
async function createFolder(view, name) {
  await act(async () => { button(view, '新建相册文件夹').props.onClick(); await flush() })
  const field = view.root.findAll(el => el.type === 'textfield' &&
    el.props.label === '文件夹名称')[0]
  assert.ok(field, 'the real create folder dialog must offer a name field')
  await act(async () => { field.props.onChange({ target: { value: name } }); await flush() })
  await act(async () => { button(view, '确认').props.onClick(); await flush() })
}

test('Gallery album folders: stale initial list cannot erase a successfully created folder', async () => {
  const older = deferred(), createCalls = []
  const actions = {
    list: () => older.promise,
    create: async (name, parentID) => {
      createCalls.push([name, parentID])
      return folder(name)
    },
  }
  const view = await mount(actions)
  try {
    await createFolder(view, '旅行新建')
    assert.deepEqual(createCalls, [['旅行新建', 0]],
      'original dialog must make one authorized Server create call')
    assert.equal(hasFolder(view, 7), true, 'create result must appear immediately')
    await act(async () => { older.resolve([]); await flush() })
    assert.equal(hasFolder(view, 7), true,
      'an earlier empty Server list may not remove the newly committed folder')
  } finally {
    older.resolve([])
    await act(async () => { view.unmount() })
  }
})

test('Gallery album folders: obsolete list error cannot replace successful create feedback', async () => {
  const older = deferred()
  const actions = {
    list: () => older.promise,
    create: async name => folder(name),
  }
  const view = await mount(actions)
  try {
    await createFolder(view, '已创建')
    assert.equal(hasFolder(view, 7), true)
    await act(async () => {
      older.reject(new Error('obsolete pre-create list error'))
      await flush()
    })
    assert.equal(view.root.findAll(el => el.type === 'alert' &&
      el.props.role === 'alert' &&
      String(el.props.children).includes('obsolete pre-create list error')).length, 0,
      'a pre-mutation list failure may not surface a new error after a successful create')
    assert.equal(hasFolder(view, 7), true)
  } finally {
    older.resolve([])
    await act(async () => { view.unmount() })
  }
})

test('Gallery album folders: normal initial list and later create still show both folders', async () => {
  let reads=0
  const view = await mount({
    list: async () => { reads++; return [folder('原有文件夹', 4)] },
    create: async name => folder(name),
  })
  try {
    assert.equal(reads, 1)
    assert.equal(hasFolder(view, 4), true)
    await createFolder(view, '新文件夹')
    assert.equal(hasFolder(view, 4), true)
    assert.equal(hasFolder(view, 7), true)
  } finally {
    await act(async () => { view.unmount() })
  }
})
