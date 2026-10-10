const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const file = path.resolve(__dirname, '../../ui/shared/src/file-explorer-inline-range-store.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const rangesForViewport = ({ startIndex, endIndex, totalCount, pageSize, overscanPages = 1 }) => {
  const ranges = []
  const first = Math.max(0, Math.floor(startIndex / pageSize) - overscanPages)
  const last = Math.min(Math.floor((totalCount - 1) / pageSize), Math.floor(endIndex / pageSize) + overscanPages)
  for (let page = first; page <= last; page++) ranges.push({ offset: page * pageSize, limit: pageSize })
  return ranges
}
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, name => {
  assert.equal(name, './virtual-collection')
  return { xDriveVirtualCollectionRangesForViewport: rangesForViewport }
})
const { XDriveFileExplorerInlineRangeStore: Store } = mod.exports
const tick = async () => {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

test('F-PARITY-07B: initial/100k scroll requests stay bounded to real directory range', async () => {
  const calls = []
  const store = new Store(async (ownerID, offset, limit, signal) => {
    calls.push({ ownerID, offset, limit, signal })
    return { offset, limit, totalCount: 100000,
      items: Array.from({ length: limit }, (_, i) => ({ id: offset + i + 1000 })) }
  }, error => { throw error })
  store.toggle(2, 1, 3, 'Photos')
  await tick()
  assert.deepEqual(calls.map(call => [call.ownerID, call.offset, call.limit]), [[2, 0, 100]])
  assert.equal(store.getSnapshot().branches[0].itemCount, 100000)
  assert.equal(store.getSnapshot().branches[0].name, 'Photos')
  assert.equal(store.getSnapshot().branches[0].items.size, 100)
  store.ensureViewport([{ ownerID: 2, startIndex: 99900, endIndex: 99910 }])
  await tick()
  assert.ok(calls.some(call => call.offset === 99900))
  assert.ok(store.getSnapshot().branches[0].items.size <= 400)
  store.destroy()
})

test('F-PARITY-07B: collapse, ancestor collapse and session teardown abort stale requests', async () => {
  const calls = []
  const pending = []
  const store = new Store((ownerID, offset, limit, signal) => {
    calls.push({ ownerID, offset, limit, signal })
    return new Promise(resolve => pending.push({ resolve, offset, limit }))
  }, error => { throw error })
  store.toggle(2, 1, 0, 'Parent')
  await tick()
  store.toggle(3, 2, 0, 'Child')
  await tick()
  store.toggle(2, 1, 0)
  assert.equal(store.getSnapshot().branches.length, 0)
  assert.ok(calls.every(call => call.signal.aborted))
  for (const { resolve, offset, limit } of pending) {
    resolve({ offset, limit, totalCount: 1, items: [{ id: 42 }] })
  }
  await tick()
  assert.equal(store.getSnapshot().branches.length, 0)
  store.toggle(4, 1, 2, 'Later')
  await tick()
  store.clear()
  assert.equal(calls.at(-1).signal.aborted, true)
  assert.equal(store.getSnapshot().branches.length, 0)
  store.destroy()
})

test('F-PARITY-07B: a rejected child range is visible and explicitly retryable', async () => {
  const errors = []
  let fail = true
  let count = 0
  const store = new Store(async (ownerID, offset, limit) => {
    count++
    if (fail) throw Error('403 Forbidden')
    return { offset, limit, totalCount: 0, items: [] }
  }, error => errors.push(error.message))
  store.toggle(2, 1, 0, 'Secure')
  await tick()
  assert.equal(store.getSnapshot().branches[0].error, '403 Forbidden')
  assert.deepEqual(errors, ['403 Forbidden'])
  store.ensureViewport([{ ownerID: 2, startIndex: 0, endIndex: 0 }])
  await tick()
  assert.equal(count, 1, 'failed ranges do not hot-loop without explicit retry')
  fail = false
  store.retry(2)
  await tick()
  assert.equal(count, 2)
  assert.equal(store.getSnapshot().branches[0].itemCount, 0)
  store.destroy()
})

test('F-PARITY-07B: incomplete range/count is not accepted as loaded', async () => {
  const errors = []
  const store = new Store(async (ownerID, offset, limit) => ({
    offset, limit, totalCount: 100000, items: [{ id: 5 }],
  }), error => errors.push(error.message))
  store.toggle(2, 1, 0)
  await tick()
  assert.match(store.getSnapshot().branches[0].error, /Invalid FileExplorer child/)
  assert.equal(store.getSnapshot().branches[0].itemCount, null)
  assert.equal(store.getSnapshot().branches[0].items.size, 0)
  assert.equal(errors.length, 1)
  store.destroy()
})

test('F-PARITY-07B: expanded owner count is bounded, destroy aborts pending requests', async () => {
  const errors = []
  const store = new Store(() => new Promise(() => {}), error => errors.push(error.message))
  for (let i = 0; i < 70; i++) store.toggle(1000 + i, 1, i, 'Folder')
  assert.equal(store.getSnapshot().branches.length, 48)
  assert.equal(errors.length, 22)
  store.destroy()
})
