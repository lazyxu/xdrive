'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(repo, file), 'utf8')
const filename = 'ui/shared/src/mui/FileExplorerDirectoryReadStrategy.ts'
const source = read(filename)
const js = ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleRef = { exports: {} }
new Function('exports', 'module', js)(moduleRef.exports, moduleRef)
const { xDriveFileExplorerReadDirectoryPage: readPage } = moduleRef.exports

test('DSM cursor reader forwards the entire opaque cursor and AbortSignal without inventing Range count', async () => {
  const abort = new AbortController()
  const calls = []
  const expected = { items: [{ id: 12, name: 'Owner file' }], has_more: true, next_cursor: 'opaque:==/not-a-position' }
  const port = { mode: 'cursor', readPage: async (...args) => {
    calls.push(args)
    return expected
  } }
  const request = {
    mode: 'cursor', parentID: 10, limit: 200,
    sort: { key: 'name', direction: 'asc' },
    cursor: 'opaque-current==', signal: abort.signal,
  }
  const result = await readPage(port, request)
  assert.equal(result.mode, 'cursor')
  assert.strictEqual(result.page, expected, 'must preserve authentic Owner response unchanged')
  assert.deepEqual(calls[0].slice(0, 4), [10, 200, request.sort, 'opaque-current=='])
  assert.strictEqual(calls[0][4], abort.signal, 'actual cancellation signal cannot be replaced')
  assert.equal('total_count' in result.page, false)
  assert.equal('offset' in result.page, false)
})

test('Desktop indexed reader preserves 100k count, grouping, offsets and independent viewport signal', async () => {
  const abort = new AbortController()
  const calls = []
  const grouping = { groupBy: 'none', foldersFirst: true }
  const first = { items: [{ id: 1 }], total_count: 100001, offset: 0, limit: 200,
    total_count_included: true, sort: 'name', order: 'asc' }
  const following = { items: [{ id: 1000 }], total_count: 0, offset: 999, limit: 30,
    total_count_included: false, sort: 'name', order: 'asc' }
  const port = {
    mode: 'range',
    readRange: async (...args) => {
      calls.push(args)
      return calls.length === 1 ? first : following
    },
  }
  const sort = { key: 'name', direction: 'asc' }
  const firstResponse = await readPage(port, {
    mode: 'range', parentID: 3, offset: 0, limit: 200, sort,
    includeCount: true, grouping, signal: abort.signal,
  })
  assert.equal(firstResponse.mode, 'range')
  assert.strictEqual(firstResponse.page, first)
  assert.equal(firstResponse.page.total_count, 100001)
  assert.deepEqual(calls[0].slice(0, 6), [3, 0, 200, sort, true, grouping])
  assert.strictEqual(calls[0][6], abort.signal)
  const secondResponse = await readPage(port, {
    mode: 'range', parentID: 3, offset: 999, limit: 30, sort,
    includeCount: false, grouping, signal: abort.signal,
  })
  assert.strictEqual(secondResponse.page, following)
  assert.deepEqual(calls[1].slice(0, 6), [3, 999, 30, sort, false, grouping])
  assert.equal('next_cursor' in secondResponse.page, false,
    'indexed ranges must not invent a sequential cursor')
})

test('mismatched Host read mode is rejected before either authorized endpoint runs', async () => {
  const controller = new AbortController()
  const sort = { key: 'name', direction: 'asc' }
  let calls = 0
  const cursor = { mode: 'cursor', readPage: async () => { calls++; throw Error('should not be called') } }
  await assert.rejects(readPage(cursor, {
    mode: 'range', parentID: 1, offset: 0, limit: 200, sort,
    includeCount: true, grouping: { groupBy: 'none', foldersFirst: true },
    signal: controller.signal,
  }), /read strategy does not match/)
  const range = { mode: 'range', readRange: async () => { calls++; throw Error('should not be called') } }
  await assert.rejects(readPage(range, {
    mode: 'cursor', parentID: 1, limit: 200, sort, cursor: '',
    signal: controller.signal,
  }), /read strategy does not match/)
  assert.equal(calls, 0, 'unsupported Host read transports cannot be probed')
})

test('Web/Desktop and DSM both call the same typed read strategy with no privileged fallback', () => {
  const ranged = read('ui/shared/src/mui/CloudFilesController.ts')
  const cursor = read('ui/shared/src/mui/FileExplorerCursorDirectoryController.ts')
  const exported = read('ui/shared/src/mui/index.tsx')
  assert.ok(ranged.includes('xDriveFileExplorerReadDirectoryPage<TNode, TSort>'))
  assert.ok(cursor.includes('xDriveFileExplorerReadDirectoryPage<TNode, TSort>'))
  assert.ok(exported.includes("export * from './FileExplorerDirectoryReadStrategy'"))
  assert.equal(['fetch(', 'ipcRenderer', 'window.xdriveDesktop', 'Authorization', 'localStorage'].some(token => source.includes(token)), false,
    'the common reader must never own Server credentials or a transport')
})

test('counted Range requests and replies fail closed before shared Files publication', async () => {
  const signal = new AbortController().signal
  const grouping = { groupBy: 'none', foldersFirst: true }
  const sort = { key: 'name', direction: 'asc' }
  const request = {
    mode: 'range', parentID: 10, offset: 100, limit: 2,
    sort, includeCount: false, grouping, signal,
  }
  let calls = 0
  const page = {
    items: [{ id: 101, name: 'A' }],
    offset: 100, limit: 2,
    total_count: 0, total_count_included: false,
    sort: 'name', order: 'asc',
  }
  const port = { mode: 'range', readRange: async () => { calls++; return page } }
  for (const delta of [
    { parentID: -3 },
    { offset: -1 },
    { offset: 1.5 },
    { limit: 0 },
    { limit: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await assert.rejects(readPage(port, { ...request, ...delta }), /Invalid Files Host counted Range request/)
  }
  assert.equal(calls, 0, 'bad positional reads must never reach authenticated Host IO')

  const valid = await readPage(port, request)
  assert.strictEqual(valid.page, page, 'a validated Host response must keep its object identity')
  assert.equal(calls, 1)
  // Indexed Range has a signed Owner root sentinel at zero. It is not a
  // cursor parent and must remain eligible without widening authorization.
  const rootResponse = await readPage(port, { ...request, parentID: 0 })
  assert.strictEqual(rootResponse.page, page)
  assert.equal(calls, 2)
  for (const altered of [
    { offset: 99 }, // wrong directory window, never publish under request offset
    { limit: 3 },  // Host must not silently widen a requested range
    { items: [{ id: 101 }, { id: 102 }, { id: 103 }] },
    { total_count: -1 },
    { sort: 'updated' },
    { order: 'desc' },
    { items: [{ id: 101 }, { id: 101 }] },
    { items: [{ id: -1 }] },
    { total_count_included: 'false' },
  ]) {
    const malformed = { ...page, ...altered }
    await assert.rejects(readPage({
      mode: 'range', readRange: async () => malformed,
    }, request), /Invalid (Files Host counted Range page|or duplicate Files Host Range node)/)
  }
})

test('counted Range validation tolerates absent optional echo fields but never forges a cursor or count', async () => {
  const request = {
    mode: 'range', parentID: 1, offset: 999, limit: 30,
    sort: { key: 'name', direction: 'asc' },
    includeCount: false, grouping: { groupBy: 'none', foldersFirst: false },
    signal: new AbortController().signal,
  }
  const page = {
    items: [{ id: 1001 }], total_count: 0,
    total_count_included: false, offset: 999, limit: 30,
  }
  const result = await readPage({ mode: 'range', readRange: async () => page }, request)
  assert.strictEqual(result.page, page)
  assert.equal(result.page.total_count_included, false)
  assert.equal('next_cursor' in result.page, false)
})
