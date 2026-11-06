'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { act, create } = require('react-test-renderer')
const root = path.resolve(__dirname, '../..')
function load(relative, modules = {}) {
  const file = path.join(root, relative)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const result = { exports: {} }
  new Function('exports', 'module', 'require', compiled)(result.exports, result,
    name => modules[name] ?? require(name))
  return result.exports
}
const identity = load('ui/shared/src/photo-content-identity.ts')
const key = 'sha256:' + 'a'.repeat(64)
const other = 'sha256:' + 'b'.repeat(64)
test('photo identity survives equal-content locator changes without targeting replacement bytes', () => {
  const original = { node: { id: 1, revision: 2 }, content_key: key }
  const copy = { node: { id: 2, revision: 8 }, content_key: key }
  assert.equal(identity.photoContentIdentity(original), identity.photoContentIdentity(copy))
  assert.notEqual(identity.photoContentIdentity(original), identity.photoContentIdentity({ ...original, content_key: other }))
  assert.deepEqual(identity.photoContentSelection([1], identity.photoContentKeys([original])), { content_keys: [key] })
  assert.throws(() => identity.photoContentKeys([original, { node: { id: 3, revision: 1 } }]))
  assert.throws(() => identity.photoContentPath(1, '../items/2'))
  assert.throws(() => identity.photoContentIdentity({ ...original, content_key: key.toUpperCase() }))
  assert.equal(identity.photoContentPath(999, key), '/api/v1/media/content/' + encodeURIComponent(key))
})

const passthrough = tag => ({ children, ...props }) => React.createElement(tag, props, children)
const { XDrivePhotoContentSources } = load('ui/shared/src/mui/PhotoContentSources.tsx', {
  '@mui/material': { Stack: passthrough('section'), Button: passthrough('button'), Typography: passthrough('span') },
})
test('source pages cancel obsolete reads and keep a bounded numeric server cursor', async () => {
  const calls = []
  const read = (contentKey, cursor, signal) => new Promise(resolve => calls.push({ contentKey, cursor, signal, resolve }))
  let renderer
  try {
    await act(async () => { renderer = create(React.createElement(XDrivePhotoContentSources, { contentKey: key, load: read })) })
    await act(async () => { renderer.update(React.createElement(XDrivePhotoContentSources, { contentKey: other, load: read })) })
    assert.equal(calls[0].signal.aborted, true)
    await act(async () => { calls[0].resolve({ content_key: key, items: [{ id: 1, type: 'file', name: 'obsolete.jpg' }] }) })
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /obsolete/)
    await act(async () => { calls[1].resolve({ content_key: other,
      items: [{ id: 50, type: 'file', name: 'current.jpg' }], next_cursor: 50 }) })
    assert.match(JSON.stringify(renderer.toJSON()), /current.jpg/)
    await act(async () => { renderer.root.findAllByType('button').find(b => b.props.children === '下一页副本').props.onClick() })
    assert.equal(calls[2].cursor, '50')
    assert.equal(calls[1].signal.aborted, true)
    await act(async () => { calls[2].resolve({ content_key: other, items: [{ id: 51, type: 'file', name: 'next.jpg' }] }) })
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /current.jpg/)
    assert.match(JSON.stringify(renderer.toJSON()), /next.jpg/)
  } finally { if (renderer) await act(async () => renderer.unmount()) }
})

test('desktop sources serialize a numeric cursor through the closed content IPC', async () => {
  let port
  const calls = []
  const agent = new Proxy({}, { get: (_, operation) => operation === 'photoContent'
    ? async input => { calls.push(input); return { ok: true, value: {} } }
    : async () => ({ ok: true, value: {} }) })
  const { createDesktopMediaGalleryDataSource } = load('desktop/src/renderer/mediaGalleryAdapter.ts', {
    '@xdrive/ui/mui': { createXDriveMediaGalleryDataSource: value => { port = value; return value } },
    '@xdrive/shared': {},
    './abortableViewportRequest': { xDriveDesktopViewportRequest: (_, run) => run('request-1') },
    './desktopViewerPreviewDecode': {}, './desktopPreviewURLLease': {},
  })
  createDesktopMediaGalleryDataSource(agent)
  await port.listContentSources(key, '50')
  await port.getItem(999, undefined, key)
  assert.deepEqual(calls[0], { operation: 'sources', content_key: key, cursor: 50 })
  assert.deepEqual(calls[1], { operation: 'get', content_key: key })
})
