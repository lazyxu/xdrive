'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', compiled)(mod.exports, mod)
const read = mod.exports.xDriveFileExplorerReadDirectoryPage

const sort = { key: 'name', direction: 'asc' }
const grouping = { groupBy: 'none', foldersFirst: true }
const cursorRequest = signal => ({
  mode: 'cursor', parentID: 12, sort, limit: 200, cursor: '', signal,
})
const rangeRequest = signal => ({
  mode: 'range', parentID: 0, offset: 0, limit: 200,
  includeCount: true, grouping, sort, signal,
})
const cursorPage = { items: [{ id: 22 }], has_more: false }
const rangePage = {
  items: [{ id: 22 }], offset: 0, limit: 200,
  total_count: 1, total_count_included: true, sort: 'name', order: 'asc',
}

test('already-aborted cursor and Range never enter the authenticated Host', async () => {
  for (const mode of ['cursor', 'range']) {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const port = mode === 'cursor'
      ? { mode, readPage: async () => { calls++; return cursorPage } }
      : { mode, readRange: async () => { calls++; return rangePage } }
    const request = mode === 'cursor'
      ? cursorRequest(controller.signal) : rangeRequest(controller.signal)
    await assert.rejects(read(port, request), error =>
      error.name === 'AbortError' && /cancelled/.test(error.message))
    assert.equal(calls, 0, mode + ' must not make a cancelled network request')
  }
})

test('late Host replies are discarded even if a noncooperative transport resolves', async () => {
  for (const mode of ['cursor', 'range']) {
    const controller = new AbortController()
    let resolve, calls = 0, receivedSignal
    const port = mode === 'cursor'
      ? { mode, readPage: async (...args) => {
          calls++; receivedSignal = args[4]
          return new Promise(done => { resolve = done })
        } }
      : { mode, readRange: async (...args) => {
          calls++; receivedSignal = args[6]
          return new Promise(done => { resolve = done })
        } }
    const request = mode === 'cursor'
      ? cursorRequest(controller.signal) : rangeRequest(controller.signal)
    const pending = read(port, request)
    await Promise.resolve()
    assert.equal(calls, 1)
    assert.strictEqual(receivedSignal, controller.signal)
    controller.abort()
    resolve(mode === 'cursor' ? cursorPage : rangePage)
    await assert.rejects(pending, error => error.name === 'AbortError')
  }
})

test('active Host replies keep the identical authenticated page and signal', async () => {
  for (const mode of ['cursor', 'range']) {
    const controller = new AbortController()
    let actualSignal
    const port = mode === 'cursor'
      ? { mode, readPage: async (...args) => {
          actualSignal = args[4]; return cursorPage
        } }
      : { mode, readRange: async (...args) => {
          actualSignal = args[6]; return rangePage
        } }
    const outcome = await read(port, mode === 'cursor'
      ? cursorRequest(controller.signal) : rangeRequest(controller.signal))
    assert.strictEqual(actualSignal, controller.signal)
    assert.strictEqual(outcome.page, mode === 'cursor' ? cursorPage : rangePage)
  }
})

test('the shared read boundary cannot authorize writes or manufacture a fallback', () => {
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|fetch\s*\(|cloudUpload|cloudDelete|localStorage/)
  assert.match(source, /assertActiveFilesRead\(request\.signal\)/)
  assert.match(source, /verifyCursorPage\(page/)
  assert.match(source, /verifyRangePage\(page/)
})
