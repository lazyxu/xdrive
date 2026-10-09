const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const repo = path.resolve(process.env.XDRIVE_FILE_EXPLORER_SOURCE_ROOT || path.join(__dirname, '../..'))
const dependencies = createRequire(path.join(repo, 'desktop/package.json'))
const ts = dependencies('typescript')

function actualAdapter(platform, bindings) {
  const file = path.join(repo, platform === 'Web' ? 'web/src/WebFileExplorer.tsx' : 'desktop/src/renderer/DesktopFileExplorer.tsx')
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer, exposed
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadMediaItem') initializer = node.initializer.getText(ast)
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'XDriveFileExplorer') {
      exposed = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === 'loadMediaItem').initializer.expression.getText(ast)
    }
    ts.forEachChild(node, walk)
  }
  walk(ast)
  assert.ok(initializer && exposed, `${platform} real canonical media callback and renderer prop`)
  const all = { useCallback: callback => callback, mediaPropertiesSupported: true, trashActive: false, nextDesktopFilePropertiesRequestID: (() => { let id = 0; return () => `actual-adapter-${++id}` })(), ...bindings }
  const code = ts.transpileModule(`const loadMediaItem = ${initializer}; return { loadMediaItem, exposed: ${exposed} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file }).outputText
  return new Function(...Object.keys(all), code)(...Object.values(all))
}

test('actual Desktop capability prop omits canonical media lookup for an old Agent', () => {
  const calls = []
  const result = actualAdapter('Desktop', { mediaPropertiesSupported: false, window: { xdriveDesktop: { agent: { getMediaItem: (...args) => calls.push(args) } } } })
  assert.equal(result.exposed, undefined)
  assert.deepEqual(calls, [])
})

test('actual Desktop loader couples abort to its exact IPC request ID and rejects late success ownership', async () => {
  let complete
  const calls = [], cancels = []
  const adapter = actualAdapter('Desktop', { window: { xdriveDesktop: { agent: {
    getMediaItem: (id, requestID) => { calls.push({ id, requestID }); return new Promise(resolve => { complete = resolve }) },
    cancelMediaItem: requestID => { cancels.push(requestID); return Promise.resolve({ ok: true }) },
  } } } })
  const controller = new AbortController()
  const pending = adapter.exposed({ id: '101', revision: 7, kind: 'file' }, controller.signal)
  assert.deepEqual(calls, [{ id: 101, requestID: 'actual-adapter-1' }])
  controller.abort()
  assert.deepEqual(cancels, ['actual-adapter-1'])
  complete({ ok: true, data: { node: { id: 101, revision: 7 } } })
  assert.equal(await pending, null)
})

test('actual Desktop pre-aborted media lookup never reaches IPC', async () => {
  const calls = []
  const adapter = actualAdapter('Desktop', { window: { xdriveDesktop: { agent: { getMediaItem: (...args) => calls.push(args) } } } })
  const controller = new AbortController(); controller.abort()
  assert.equal(await adapter.exposed({ id: 101, kind: 'file' }, controller.signal), null)
  assert.deepEqual(calls, [])
})

test('actual Web loader forwards the selected numeric ID and the same scoped AbortSignal', async () => {
  const calls = []
  const media = { node: { id: 101, revision: 7 } }
  const adapter = actualAdapter('Web', { api: { mediaItem: (id, signal) => { calls.push({ id, signal }); return Promise.resolve(media) } } })
  const controller = new AbortController()
  assert.equal(await adapter.exposed({ id: '101', revision: 7 }, controller.signal), media)
  assert.equal(calls[0].id, 101)
  assert.equal(calls[0].signal, controller.signal)
})
