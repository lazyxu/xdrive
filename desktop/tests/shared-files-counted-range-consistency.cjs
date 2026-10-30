'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const filename = 'ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts'
const source = fs.readFileSync(path.join(repo, filename), 'utf8')
const js = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', js)(mod, mod.exports)
const read = mod.exports.xDriveFileExplorerReadDirectoryPage
const sort = { key: 'name', direction: 'asc' }
const grouping = { groupBy: 'none', foldersFirst: true }
const signal = new AbortController().signal
const request = overrides => ({
  mode: 'range', parentID: 0, offset: 8, limit: 2,
  sort, grouping, includeCount: true, signal,
  ...overrides,
})
const counted = overrides => ({
  items: [{ id: 9 }, { id: 10 }],
  offset: 8, limit: 2, total_count: 10,
  total_count_included: true,
  sort: 'name', order: 'asc',
  ...overrides,
})

test('overflowed absolute Range end is denied before Host IO', async () => {
  let calls = 0
  const port = { mode: 'range', readRange: async () => {
    calls += 1
    throw Error('should not enter Host')
  } }
  for (const r of [
    request({ offset: Number.MAX_SAFE_INTEGER - 1, limit: 4 }),
    request({ offset: Number.MAX_SAFE_INTEGER, limit: 1 }),
  ]) {
    await assert.rejects(read(port, r), /Invalid Files Host counted Range request/)
  }
  assert.equal(calls, 0)
})

test('claimed total cannot be smaller than the returned end of a counted Range', async () => {
  let calls = 0
  const malformed = counted({ total_count: 9 })
  const port = { mode: 'range', readRange: async () => { calls++; return malformed } }
  await assert.rejects(read(port, request()), /Invalid Files Host counted Range page/)
  assert.equal(calls, 1, 'only the authorized Host may report a real Range')
})

test('a coherent counted window retains exact Host page and AbortSignal', async () => {
  let received
  const page = counted()
  const port = { mode: 'range', readRange: async (...args) => {
    received = args
    return page
  } }
  const result = await read(port, request())
  assert.strictEqual(result.page, page)
  assert.strictEqual(received[6], signal)
  assert.deepEqual(received.slice(0, 6), [0, 8, 2, sort, true, grouping])
})

test('empty out-of-bounds page and count-less sparse reads remain compatible', async () => {
  const pastEnd = counted({ items: [], total_count: 10, offset: 20, limit: 2 })
  const emptyRequest = request({ offset: 20 })
  const result = await read({
    mode: 'range', readRange: async () => pastEnd,
  }, emptyRequest)
  assert.strictEqual(result.page, pastEnd)

  const sparse = counted({
    items: [{ id: 1000 }], offset: 999, limit: 2,
    total_count: 0, total_count_included: false,
  })
  const resultSparse = await read({
    mode: 'range', readRange: async () => sparse,
  }, request({ offset: 999, includeCount: false }))
  assert.strictEqual(resultSparse.page, sparse)
  assert.equal('next_cursor' in sparse, false)
})

test('read boundary remains transport-neutral and cannot grant editing methods', () => {
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|cloudUpload|cloudDelete|fetch\s*\(/)
  assert.match(source, /Number\.isSafeInteger\(request\.offset \+ request\.limit\)/)
  assert.match(source, /page\.total_count < request\.offset \+ page\.items\.length/)
})
