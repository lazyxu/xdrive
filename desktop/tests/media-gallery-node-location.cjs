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

test('G06 media location flows through on-demand Web, Gallery, FileExplorer and Viewer', () => {
  assert.match(read('web/src/api.ts'), /nodeLocation\(nodeID: number, signal\?: AbortSignal\)/)
  assert.match(read('web/src/mediaGalleryAdapter.ts'), /getNodeLocation: \(nodeID, signal\) => api\.nodeLocation\(nodeID, signal\)/)
  assert.match(read('ui/shared/src/mui/MediaGallery.tsx'), /loadNodeLocation=\{source\.getNodeLocation\}/)
  assert.match(read('ui/shared/src/mui/MediaGalleryAdapter.ts'), /getNodeLocation: port\.getNodeLocation/)
  assert.match(read('ui/shared/src/mui/FileExplorer.tsx'), /loadNodeLocation=\{showMediaProperties \? loadNodeLocation : undefined\}/)
  assert.match(read('web/src/WebFileViewerApps.tsx'), /loadNodeLocation=\{gallerySource\.getNodeLocation\}/)
  assert.match(read('web/src/WebFileExplorer.tsx'), /navigateTo\(ancestry\)/)
  assert.match(read('web/src/App.tsx'), /launchWebApp\(\{ app: 'files', params: \{ dir: location\.parent_id \} \}\)/)
  assert.doesNotMatch(read('internal/api/node_location.go'), /MediaIndexer|Store\.Open|RefreshIndex/)
})

const filename = path.join(root, 'ui/shared/src/mui/MediaNodeLocationSection.tsx')
const output = ts.transpileModule(read('ui/shared/src/mui/MediaNodeLocationSection.tsx'), {
  fileName: filename,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  },
}).outputText
const mod = { exports: {} }
const stubs = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@mui/material': { Box: 'box', Button: 'button', Stack: 'stack', Typography: 'typography' },
  './StatusAlert': { XDriveStatusAlert: 'alert' },
  './MediaGalleryUtils': {
    xDriveMediaGalleryErrorMessage: (error) => error instanceof Error ? error.message : String(error),
  },
}
new Function('exports', 'module', 'require', output)(mod.exports, mod, (name) => {
  if (!(name in stubs)) throw new Error('Unexpected dependency: ' + name)
  return stubs[name]
})
const Location = mod.exports.XDriveMediaNodeLocationSection
const location = (nodeID, pathName) => ({
  node_id: nodeID, revision: 2, path: pathName, parent_id: 9, parent_path: 'Album',
  breadcrumbs: [{ id: 1, name: '', path: '' }, { id: 9, name: 'Album', path: 'Album' }],
  sync_folders: [{ source_id: 2, source_name: 'NAS', source_kind: 'synology', target_node_id: 1 }],
  sources: [{ source_id: 2, source_name: 'NAS', source_kind: 'synology',
    source_item_path: 'DCIM/a.jpg', original_path: '/volume1/a.jpg' }],
})
const nextDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}
const present = (view) => JSON.stringify(view.toJSON())

test('G06 exact node location shows path, original provenance and ID-backed folder action', async () => {
  let opened = null
  let view
  await act(async () => { view = renderer.create(React.createElement(Location, {
    nodeID: 7, revision: 2,
    loadNodeLocation: async () => location(7, 'Album/a.jpg'),
    onShowInFolder: (value) => { opened = value },
  })) })
  assert.match(present(view), /\/Album\/a.jpg/)
  assert.match(present(view), /\/volume1\/a.jpg/)
  assert.match(present(view), /当前同步文件夹/)
  const buttons = view.root.findAll((el) => el.type === 'button')
  assert.equal(buttons.length, 1)
  await act(async () => { buttons[0].props.onClick() })
  assert.equal(opened.parent_id, 9)
  await act(async () => { view.unmount() })
})

test('G06 old asynchronous location cannot overwrite new Node, aborts on switch', async () => {
  const pending = new Map()
  const aborts = []
  const loadNodeLocation = (id, signal) => {
    const next = nextDeferred()
    pending.set(id, next)
    signal.addEventListener('abort', () => aborts.push(id))
    return next.promise
  }
  let view
  await act(async () => { view = renderer.create(React.createElement(Location, {
    nodeID: 7, revision: 2, loadNodeLocation,
  })) })
  await act(async () => { view.update(React.createElement(Location, {
    nodeID: 8, revision: 3, loadNodeLocation,
  })) })
  assert.deepEqual(aborts, [7])
  await act(async () => { pending.get(7).resolve(location(7, 'Album/stale.jpg')) })
  assert.doesNotMatch(present(view), /stale\.jpg/)
  await act(async () => { pending.get(8).resolve(location(8, 'Album/current.jpg')) })
  assert.match(present(view), /current\.jpg/)
  await act(async () => { view.unmount() })
  assert.deepEqual(aborts, [7, 8])
})
