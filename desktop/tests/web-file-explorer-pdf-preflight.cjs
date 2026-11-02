'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const modules = new Map()
function compile(source, filename, jsx = false) {
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  }).outputText
  return output
}
function common(filename) {
  if (modules.has(filename)) return modules.get(filename)
  const mod = { exports: {} }
  modules.set(filename, mod.exports)
  new Function('module', 'exports', 'require', compile(read(filename), filename))(
    mod, mod.exports, name => {
      assert.ok(name.startsWith('./'), 'unexpected shared dependency ' + name)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), name)) + '.ts'
      return common(resolved)
    })
  return mod.exports
}
const plan = common('ui/shared/src/file-explorer-preview-request.ts').xDriveFileExplorerPreviewRequest

const preflightSource = read('web/src/webPDFTicketPreflight.ts')
const preflightModule = { exports: {} }
new Function('exports', 'module', 'require',
  compile(preflightSource, 'web/src/webPDFTicketPreflight.ts'))(
  preflightModule.exports, preflightModule, require)
const preflight = preflightModule.exports.xDrivePreflightWebPDFTicket

const explorerSource = read('web/src/WebFileExplorer.tsx')
const explorerAST = ts.createSourceFile(
  'WebFileExplorer.tsx', explorerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declaration = explorerAST.statements
  .flatMap(node => {
    const found = []
    const walk = current => {
      if (ts.isVariableDeclaration(current) && current.name.getText(explorerAST) === 'loadPreviewURL') {
        found.push(current.initializer?.getText(explorerAST))
      }
      ts.forEachChild(current, walk)
    }
    walk(node)
    return found
  })
assert.equal(declaration.length, 1, 'extract the actual Web Files Quick Look loader')
const compiledLoader = { exports: {} }
new Function('exports', 'useCallback', 'xDriveFileExplorerPreviewRequest', 'api',
  'xDrivePreflightWebPDFTicket',
  compile('exports.load = ' + declaration[0], 'WebFilesPreviewLoader.ts'))(
  compiledLoader.exports, callback => callback, plan, {}, preflight)

const ticket = 'https://api.xdrive.example/api/v1/file-preview/27?ticket=opaque-ticket'
const response = (status, contentType = 'application/pdf') => ({
  status,
  headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
})
const item = { id: 27, kind: 'file', name: 'report.pdf', revision: 4 }

test('Web Files Quick Look preflights cross-origin PDF tickets before returning an iframe URL', async () => {
  const oldWindow = global.window
  const oldFetch = global.fetch
  const oldURL = global.URL
  const calls = []
  const reads = []
  global.window = { location: { href: 'https://web.xdrive.example/#/files' } }
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? response(404, 'text/html') : response(206, 'application/pdf; charset=binary')
  }
  const api = {
    filePreviewURL: async (id, signal) => {
      reads.push({ id, signal })
      return ticket
    },
  }
  const load = (() => {
    const compiled = { exports: {} }
    new Function('exports', 'useCallback', 'xDriveFileExplorerPreviewRequest', 'api',
      'xDrivePreflightWebPDFTicket', compile('exports.load = ' + declaration[0], 'WebFilesPreviewLoader.ts'))(
      compiled.exports, callback => callback, plan, api, preflight)
    return compiled.exports.load
  })()
  try {
    const signal = new AbortController().signal
    assert.equal(await load(item, 'pdf', signal), null,
      'an HTML 404 response must not be handed to the PDF iframe')
    assert.equal(await load(item, 'pdf', signal), ticket,
      'a fresh authenticated PDF stream can be retried successfully')
    assert.deepEqual(reads.map(read => read.id), [27, 27])
    assert.ok(reads.every(read => read.signal === signal))
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.url === ticket))
    assert.ok(calls.every(call => call.options.method === 'HEAD'))
    assert.ok(calls.every(call => call.options.signal === signal))
    assert.ok(calls.every(call => call.options.credentials === 'omit'))
    assert.ok(calls.every(call => call.options.redirect === 'error'))
  } finally {
    global.window = oldWindow
    global.fetch = oldFetch
    global.URL = oldURL
  }
})

test('Web Files PDF loader avoids duplicate HEAD for same-origin streams and skips non-PDF media', async () => {
  const oldWindow = global.window
  const oldFetch = global.fetch
  const calls = []
  global.window = { location: { href: 'https://web.xdrive.example/#/files' } }
  global.fetch = async (...args) => { calls.push(args); throw new Error('unexpected HEAD') }
  const api = {
    filePreviewURL: async id => id === 27
      ? 'https://web.xdrive.example/api/v1/file-preview/27?ticket=same-origin'
      : 'https://api.xdrive.example/api/v1/file-preview/28?ticket=video',
  }
  const compiled = { exports: {} }
  new Function('exports', 'useCallback', 'xDriveFileExplorerPreviewRequest', 'api',
    'xDrivePreflightWebPDFTicket', compile('exports.load = ' + declaration[0], 'WebFilesPreviewLoader.ts'))(
    compiled.exports, callback => callback, plan, api, preflight)
  try {
    const load = compiled.exports.load
    assert.equal(await load(item, 'pdf', new AbortController().signal),
      'https://web.xdrive.example/api/v1/file-preview/27?ticket=same-origin')
    assert.deepEqual(calls, [], 'same-origin status gate remains owned by FilePreviewSurface')
    assert.equal(await load({ ...item, id: 28, name: 'clip.mp4' }, 'video', new AbortController().signal),
      'https://api.xdrive.example/api/v1/file-preview/28?ticket=video')
    assert.deepEqual(calls, [], 'video retains native Range loading without a PDF HEAD')
  } finally {
    global.window = oldWindow
    global.fetch = oldFetch
  }
})
