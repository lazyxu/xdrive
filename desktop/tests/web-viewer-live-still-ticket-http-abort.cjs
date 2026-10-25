'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const apiSource = read('web/src/api.ts')
const source = ts.createSourceFile('api.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const ownerAPI = source.statements.find(node =>
  ts.isClassDeclaration(node) && node.name?.text === 'XDriveApi')
assert.ok(ownerAPI, 'read the actual production XDriveApi class')
const method = ownerAPI.members.find(node =>
  ts.isMethodDeclaration(node) && node.name?.getText(source) === 'mediaLivePhotoStillURL')
assert.ok(method, 'read the actual production Live Photo still-ticket method')
const compiled = ts.transpileModule(
  "const API_BASE = 'http://xdrive.test';\n" +
  "class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }\n" +
  "class OwnerApi {\n  constructor(request) { this.request = request }\n" +
  method.getText(source) + "\n}\nexports.OwnerApi = OwnerApi",
  { fileName: 'LiveStillTicket.ts', compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } },
).outputText
const moduleResult = { exports: {} }
new Function('exports', compiled)(moduleResult.exports)
const API = moduleResult.exports.OwnerApi
const ticket = '/api/v1/media-live-photo-still/91?ticket=local-test'

test('Live Photo still signed ticket uses an abortable POST and preserves allowlist', async () => {
  const signal = new AbortController().signal
  const reads = []
  const api = new API(async (url, options) => {
    reads.push({ url, options })
    return { url: ticket, kind: 'image', mime_type: 'image/jpeg' }
  })
  assert.equal(await api.mediaLivePhotoStillURL(91, signal), 'http://xdrive.test' + ticket)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].url, '/api/v1/media/items/91/live-photo-still-ticket')
  assert.equal(reads[0].options.method, 'POST')
  assert.strictEqual(reads[0].options.signal, signal)
  const hostile = new API(async () => ({
    url: '//untrusted.example.com/private', kind: 'image', mime_type: 'image/jpeg',
  }))
  await assert.rejects(() => hostile.mediaLivePhotoStillURL(91, signal), /Invalid Live Photo still URL/)
})

test('already-cancelled Live Photo still source makes no new ticket request', async () => {
  const controller = new AbortController()
  controller.abort()
  let requests = 0
  const api = new API(async () => { requests++; return { url: ticket } })
  await assert.rejects(() => api.mediaLivePhotoStillURL(91, controller.signal),
    error => error?.name === 'AbortError')
  assert.equal(requests, 0)
})

test('closing a live still Viewer aborts the actual in-flight ticket HTTP POST', async () => {
  let enteredResolve
  const entered = new Promise(resolve => { enteredResolve = resolve })
  let closedResolve
  const closed = new Promise(resolve => { closedResolve = resolve })
  const server = http.createServer((request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/api/v1/media/items/91/live-photo-still-ticket')
    response.once('close', () => closedResolve(!response.writableEnded))
    request.resume()
    enteredResolve()
    // Deliberately keep the response pending: only AbortSignal should release it.
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const url = 'http://127.0.0.1:' + address.port
  const api = new API(async (endpoint, { method, signal }) => {
    const response = await fetch(url + endpoint, { method, signal })
    return response.json()
  })
  const controller = new AbortController()
  const timeout = async (promise, label) => {
    let handle
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        handle = setTimeout(() => reject(new Error(label + ' timed out')), 6000)
      })])
    } finally { clearTimeout(handle) }
  }
  try {
    const promise = api.mediaLivePhotoStillURL(91, controller.signal)
    await timeout(entered, 'ticket started')
    controller.abort()
    await assert.rejects(promise, error => error?.name === 'AbortError')
    assert.equal(await timeout(closed, 'server observed early close'), true,
      'source cancellation must close the real HTTP request before response completes')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('Web Gallery, routed Viewer and FileExplorer all forward their active Owner abort', () => {
  const expected = [
    ['web/src/mediaGalleryAdapter.ts',
      /\?\s*api\.mediaLivePhotoStillURL\(nodeID,\s*signal\)/],
    ['web/src/WebFileExplorer.tsx',
      /return await api\.mediaLivePhotoStillURL\(Number\(item\.id\),\s*signal\)/],
    ['web/src/WebFileViewerApps.tsx',
      /\?\s*api\.mediaLivePhotoStillURL\(viewer\.node!\.id,\s*signal\)/],
  ]
  for (const [file, check] of expected) {
    assert.match(read(file), check, file + ' must not drop the current abort signal')
  }
})
