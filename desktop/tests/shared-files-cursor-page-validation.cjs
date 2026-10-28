'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts')
const source = fs.readFileSync(filename, 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: filename,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const failures = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.deepEqual(failures.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
const unit = { exports: {} }
new Function('module', 'exports', compiled.outputText)(unit, unit.exports)
const read = unit.exports.xDriveFileExplorerReadDirectoryPage

function request(cursor = '', limit = 200, parentID = 13) {
  return {
    mode: 'cursor', parentID, limit, cursor,
    sort: { key: 'name', direction: 'asc' },
    signal: new AbortController().signal,
  }
}
const node = id => ({ id, name: `owner-${id}` })

test('valid opaque cursor and authentic page object remain unchanged, with original signal', async () => {
  let received
  const page = { items: [node(7), node(8)], has_more: true, next_cursor: 'opaque:/==+' }
  const r = request('previous==')
  const port = { mode: 'cursor', readPage: async (...args) => { received = args; return page } }
  const response = await read(port, r)
  assert.strictEqual(response.page, page)
  assert.equal(response.mode, 'cursor')
  assert.strictEqual(received[4], r.signal)
  assert.deepEqual(received.slice(0, 4), [13, 200, r.sort, 'previous=='])
  assert.equal('total_count' in response.page, false)
  assert.equal('offset' in response.page, false)
})

test('invalid requests are rejected without invoking either Host transport', async () => {
  let calls = 0
  const port = { mode: 'cursor', readPage: async () => { calls++; return null } }
  for (const r of [
    request('', 0), request('', -1), request('', 201), request('', 1001), request('', 1.5),
    request('', 200, 0), request('', 200, -1),
    request('', 200, Number.MAX_SAFE_INTEGER + 1),
    request('x\ny'), request('x\ry'), request(String.fromCharCode(0)),
    request('x'.repeat(1025)),
  ]) {
    await assert.rejects(read(port, r), /Invalid Files Host cursor request/)
  }
  assert.equal(calls, 0)
})

test('malformed and unbounded cursor pages cannot be rendered', async () => {
  const valid = { items: [node(7)], has_more: true, next_cursor: 'next' }
  for (const page of [
    null,
    { ...valid, items: null },
    { ...valid, has_more: 'yes' },
    { ...valid, items: Array.from({ length: 201 }, (_, i) => node(i + 1)) },
    { ...valid, items: [node(7), node(7)] },
    { ...valid, items: [node(0)] },
    { ...valid, items: [node(Number.MAX_SAFE_INTEGER + 1)] },
    { ...valid, items: [null] },
    { ...valid, items: [] },
    { ...valid, next_cursor: '' },
    { ...valid, has_more: false, next_cursor: 'unexpected-terminal' },
    { ...valid, next_cursor: 'current' },
    { ...valid, next_cursor: 'x\ny' },
    { ...valid, next_cursor: 'x'.repeat(1025) },
  ]) {
    await assert.rejects(read({
      mode: 'cursor', readPage: async () => page,
    }, request('current')), /Invalid|Non-advancing/)
  }
})

test('terminal empty page and nonempty continued pages are valid; Range read is unchanged', async () => {
  const terminal = { items: [], has_more: false }
  const fullContinued = { items: [node(9)], has_more: true, next_cursor: 'next==+' }
  const terminalResponse = await read({ mode: 'cursor', readPage: async () => terminal }, request())
  const continuedResponse = await read({ mode: 'cursor', readPage: async () => fullContinued }, request())
  assert.strictEqual(terminalResponse.page, terminal)
  assert.strictEqual(continuedResponse.page, fullContinued)
  const indexed = {
    items: [node(3)], total_count: 100000, offset: 50, limit: 200,
    total_count_included: true, sort: 'name', order: 'asc',
  }
  const grouping = { groupBy: 'none', foldersFirst: true }
  const range = await read({ mode: 'range', readRange: async () => indexed }, {
    mode: 'range', parentID: 0, offset: 50, limit: 200,
    sort: { key: 'name', direction: 'asc' },
    includeCount: true, grouping, signal: new AbortController().signal,
  })
  assert.strictEqual(range.page, indexed, 'Desktop indexed 100k range semantics stay unchanged')
})
