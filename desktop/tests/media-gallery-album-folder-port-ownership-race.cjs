const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')
const { act } = renderer

// Test real shared Gallery album-organizer React handlers and effects. Only
// presentation and the asynchronous Server/Agent Port are faked.
const root = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
function compile(relative, jsx = false) {
  return ts.transpileModule(read(relative), {
    fileName: path.join(root, relative),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
      esModuleInterop: true,
    },
  }).outputText
}
function load(relative, imports, jsx = false) {
  const result = { exports: {} }
  new Function('exports', 'module', 'require', compile(relative, jsx))(
    result.exports, result, name => {
      if (!Object.hasOwn(imports, name)) throw Error('unexpected import: ' + name)
      return imports[name]
    },
  )
  return result.exports
}
const organization = load('ui/shared/src/mui/MediaGalleryAlbumOrganization.ts', {})
const folderModel = load('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts', {})
const tags = Object.fromEntries([
  'Alert', 'Box', 'Breadcrumbs', 'Button', 'CircularProgress',
  'Dialog', 'DialogActions', 'DialogContent', 'DialogTitle',
  'IconButton', 'MenuItem', 'Paper', 'Stack', 'TextField',
  'Tooltip', 'Typography',
].map(name => [name, name.toLowerCase()]))
const component = load('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx', {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': tags,
  '@mui/icons-material': new Proxy({}, { get: (_, name) => String(name) }),
  './MediaGalleryPreviewMedia': { XDriveMediaAsyncThumbnail: 'thumbnail' },
  './MediaGalleryAlbumOrganization': organization,
  './MediaGalleryAlbumFolderModel': folderModel,
}, true).XDriveMediaGalleryAlbumOrganizer

function pending() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i=0; i<10; i++) await Promise.resolve() }
const folder = (name, revision=1, id=7) => ({
  id, parent_id: 0, name, revision,
})
const props = actions => ({
  albums: [], accountScope: 'web:same-owner', folderActions: actions,
  loadThumbnail: async () => null,
})
const hasName = (view, name) => view.root.findAll(
  el => el.type === 'typography' && el.props.children === name,
).length > 0
const hasFolderID = (view, id) => view.root.findAll(
  el => el.props['data-xdrive-gallery-album-folder'] === id,
).length > 0
function findButton(view, label) {
  const node = view.root.findAll(el => el.type === 'button' && el.props.children === label)[0]
  assert.ok(node, 'missing real button: ' + label)
  return node
}
async function mount(actions) {
  let view
  await act(async () => {
    view = renderer.create(React.createElement(component, props(actions)))
    await flush()
  })
  return view
}
async function beginRename(view, oldName, newName) {
  const rename = view.root.findAll(el => el.type === 'iconbutton' &&
    el.props['aria-label'] === '重命名' + oldName)[0]
  assert.ok(rename, 'real rename action must be available: ' + oldName)
  await act(async () => { rename.props.onClick(); await flush() })
  const text = view.root.findAll(el => el.type === 'textfield' &&
    el.props.label === '文件夹名称')[0]
  assert.ok(text, 'real dialog must have a folder name field')
  await act(async () => { text.props.onChange({ target: { value: newName } }); await flush() })
  await act(async () => { findButton(view, '确认').props.onClick(); await flush() })
}
async function beginCreate(view, name) {
  await act(async () => { findButton(view, '新建相册文件夹').props.onClick(); await flush() })
  const text = view.root.findAll(el => el.type === 'textfield' &&
    el.props.label === '文件夹名称')[0]
  assert.ok(text)
  await act(async () => { text.props.onChange({ target: { value: name } }); await flush() })
  await act(async () => { findButton(view, '确认').props.onClick(); await flush() })
}
async function switchPort(view, actions) {
  await act(async () => { view.update(React.createElement(component, props(actions))); await flush() })
}

test('G04 album folder: older Port rename cannot regress a freshly loaded revision on new Port', async () => {
  const oldRename = pending(), sends = []
  const oldPort = {
    list: async () => [folder('old-port', 1)],
    update: (id, revision, changes) => {
      sends.push([id, revision, changes])
      return oldRename.promise
    },
  }
  const newPort = { list: async () => [folder('new-port-authoritative', 9)] }
  const view = await mount(oldPort)
  try {
    assert.equal(hasName(view, 'old-port'), true)
    await beginRename(view, 'old-port', 'old-change')
    assert.deepEqual(sends, [[7, 1, { name: 'old-change' }]])
    await switchPort(view, newPort)
    assert.equal(hasName(view, 'new-port-authoritative'), true)
    await act(async () => { oldRename.resolve(folder('old-change', 2)); await flush() })
    assert.equal(hasName(view, 'new-port-authoritative'), true,
      'a completed old Port mutation must not replace the newer Server/Agent revision')
    assert.equal(hasName(view, 'old-change'), false)
  } finally {
    oldRename.resolve(folder('old-change', 2))
    await act(async () => view.unmount())
  }
})

test('G04 album folder: old Port mutation failure cannot publish error or recovery list into new Port', async () => {
  const oldRename = pending()
  let oldReads = 0
  const oldPort = {
    list: async () => {
      oldReads++
      return [folder('old-port', 1)]
    },
    update: () => oldRename.promise,
  }
  const newPort = { list: async () => [folder('new-port-authoritative', 9)] }
  const view = await mount(oldPort)
  try {
    await beginRename(view, 'old-port', 'old-change')
    await switchPort(view, newPort)
    assert.equal(hasName(view, 'new-port-authoritative'), true)
    await act(async () => {
      oldRename.reject(new Error('obsolete port A revision conflict'))
      await flush()
    })
    assert.equal(hasName(view, 'new-port-authoritative'), true,
      'A revision-conflict recovery must not replace B folder records')
    assert.equal(view.root.findAll(el => el.type === 'alert' &&
      el.props.role === 'alert' &&
      String(el.props.children).includes('obsolete port A revision conflict')).length, 0,
      'obsolete transport error must not surface in the new Port')
    assert.equal(oldReads, 1,
      'old detached Port must not issue a recovery list after its mutation fails')
  } finally {
    oldRename.resolve(folder('old-change', 2))
    await act(async () => view.unmount())
  }
})

test('G04 album folder: older Port create cannot append its folder to new Port collection', async () => {
  const oldCreate = pending()
  const oldPort = {
    list: async () => [folder('old-port', 1)],
    create: () => oldCreate.promise,
  }
  const newPort = { list: async () => [folder('new-port-authoritative', 9)] }
  const view = await mount(oldPort)
  try {
    await beginCreate(view, 'old-created')
    await switchPort(view, newPort)
    await act(async () => {
      oldCreate.resolve(folder('old-created', 1, 101))
      await flush()
    })
    assert.equal(hasName(view, 'new-port-authoritative'), true)
    assert.equal(hasFolderID(view, 101), false,
      'an older Server transport must not append a detached folder into the new Port')
  } finally {
    oldCreate.resolve(folder('old-created', 1, 101))
    await act(async () => view.unmount())
  }
})

test('G04 album folder control: current Port rename publishes its authoritative result', async () => {
  const calls = []
  const port = {
    list: async () => [folder('current', 1)],
    update: async (id, revision, change) => {
      calls.push([id, revision, change])
      return folder('renamed-current', 2)
    },
  }
  const view = await mount(port)
  try {
    await beginRename(view, 'current', 'renamed-current')
    assert.deepEqual(calls, [[7, 1, { name: 'renamed-current' }]])
    assert.equal(hasName(view, 'renamed-current'), true)
    assert.equal(hasName(view, 'current'), false)
  } finally {
    await act(async () => view.unmount())
  }
})

test('G04 album folder: new Port can rename while older Port write is pending', async () => {
  const oldRename = pending(), secondRename = pending(), calls = []
  const oldPort = {
    list: async () => [folder('old-port', 1)],
    update: () => oldRename.promise,
  }
  const newPort = {
    list: async () => [folder('new-port-authoritative', 9)],
    update: (id, revision, change) => {
      calls.push([id, revision, change])
      return secondRename.promise
    },
  }
  const view = await mount(oldPort)
  try {
    await beginRename(view, 'old-port', 'old-change')
    await switchPort(view, newPort)
    await beginRename(view, 'new-port-authoritative', 'new-port-committed')
    assert.deepEqual(calls, [[7, 9, { name: 'new-port-committed' }]],
      'old Port Busy must not block an independent newer Port command')
    await act(async () => { oldRename.resolve(folder('old-change', 2)); await flush() })
    await act(async () => {
      secondRename.resolve(folder('new-port-committed', 10))
      await flush()
    })
    assert.equal(hasName(view, 'new-port-committed'), true,
      'old Port completion cannot clear the newer Port pending action')
    assert.equal(hasName(view, 'old-change'), false)
  } finally {
    oldRename.resolve(folder('old-change', 2))
    secondRename.resolve(folder('new-port-committed', 10))
    await act(async () => view.unmount())
  }
})
