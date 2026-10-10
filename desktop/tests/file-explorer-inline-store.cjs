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


function actualSelectionController() {
  const file = path.resolve(__dirname, '../../ui/shared/src/file-explorer-controller.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', output)(mod, mod.exports)
  return mod.exports
}

/** Execute WebFileExplorer's real inline Node projection with stable useRef
 * slots, then validate using the real shared Server node/operation contract. */
function actualWebInlineProjection() {
  const web = fs.readFileSync(path.resolve(__dirname, '../../web/src/WebFileExplorer.tsx'), 'utf8')
  const originalStart = web.indexOf('  const inlineOwnerByNodeID = new Map<number, number>()')
  const retainedStart = web.indexOf('  const selectedMobileNodesRef = useRef(')
  const start = retainedStart >= 0 && retainedStart < originalStart ? retainedStart : originalStart
  const end = web.indexOf('  const inlineMobileBranches =', start)
  assert.ok(start >= 0 && end > start, 'Web inline Node projection must be present')
  const ending = [
    'return {nodeByID, inlineCrumbsForItem,',
    "retainedCount: typeof selectedMobileNodesRef !== 'undefined' ? selectedMobileNodesRef.current.size : 0,",
    "notifySelection: typeof retainMobileSelection === 'function' ? retainMobileSelection : null};",
  ].join('\n')
  const output = ts.transpileModule(web.slice(start, end) + ending, {
    fileName: 'WebFileExplorer-inline.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const invoke = new Function('inlineSnapshot', 'nodeByID', 'useRef', 'current', 'crumbs',
    'inlineScopeKey', 'explorerVirtualCollection', output)
  const refs = []
  return function render(snapshot, nodes, scope = 'session-A:root:1') {
    let hookIndex = 0
    const useRef = initial => refs[hookIndex++] ??= { current: initial }
    return invoke(snapshot, new Map(nodes.map(node => [node.id, node])), useRef,
      { id: 1, name: '我的文件' }, [{ id: 1, name: '我的文件' }],
      scope, { retainInteractionIDs() {} })
  }
}

test('F-PARITY-07E: selected root and nested Node IDs survive real 100k sparse-range eviction', async () => {
  const validation = actualSelectionController()
  const render = actualWebInlineProjection()
  const root = { id: 1, name: '我的文件', type: 'dir', revision: 1, parent_id: 0 }
  const folder = { id: 2, name: 'Work', type: 'dir', revision: 2, parent_id: 1 }
  const rootFile = { id: 81, name: 'root.txt', type: 'file', revision: 5, parent_id: 1 }
  const childFile = { id: 41, name: 'inside.txt', type: 'file', revision: 7, parent_id: 2 }
  const errors = []
  const store = new Store(async (ownerID, offset, limit) => ({
    offset, limit, totalCount: 100000,
    items: Array.from({ length: limit }, (_, i) => offset + i === 0
      ? childFile
      : { id: 5000 + offset + i, name: 'other.txt', type: 'file', revision: 1, parent_id: ownerID }),
  }), error => errors.push(error))
  let rootRows = [root, folder, rootFile]
  let projection = render(store.getSnapshot(), rootRows)
  store.subscribe(() => { projection = render(store.getSnapshot(), rootRows) })
  try {
    store.toggle(2, 1, 0, 'Work')
    await tick()
    assert.equal(projection.nodeByID.get(childFile.id)?.revision, 7)
    const selected = [
      { id: childFile.id, name: childFile.name, kind: 'file', revision: 7 },
      { id: rootFile.id, name: rootFile.name, kind: 'file', revision: 5 },
    ]
    projection.notifySelection?.(selected)
    rootRows = [root, folder]
    store.ensureViewport([{ ownerID: 2, startIndex: 99900, endIndex: 99910 }])
    await tick()
    projection = render(store.getSnapshot(), rootRows)
    assert.equal(store.getSnapshot().branches[0].items.has(0), false,
      'first child page must truly be evicted, not retained as a 100k collection')
    for (const action of ['copy', 'cut', 'move-to', 'copy-to', 'delete', 'download']) {
      assert.equal(validation.xDriveFileExplorerSelectionActionDisabledReason({
        selected, selectedCount: 2, nodeByID: projection.nodeByID,
        requireRevision: action !== 'download', maxItems: 200,
      }), null, action + ' must resolve the original selected Server Nodes')
    }
    const nodes = validation.xDriveFileExplorerResolveSelectionNodes(selected, projection.nodeByID)
    assert.deepEqual(nodes.map(node => [node.id, node.revision]), [[41, 7], [81, 5]])
    assert.equal(validation.xDriveFileExplorerCopyPath(selected[0],
      projection.inlineCrumbsForItem(selected[0])), '/Work/inside.txt',
      'selected child must keep its real containing path after eviction')
    assert.equal(errors.length, 0)
    assert.ok(store.getSnapshot().branches[0].items.size <= 400,
      'only sparse pages and selected IDs can survive, not 100k')
    assert.ok(projection.retainedCount <= 200)

    projection.notifySelection?.([])
    projection = render(store.getSnapshot(), rootRows)
    assert.equal(projection.retainedCount, 0)
    assert.equal(projection.nodeByID.has(41), false)
    store.clear()
    projection = render(store.getSnapshot(), [root, folder], 'session-B:root:1')
    assert.equal(projection.nodeByID.has(41), false, 'no cross-account Node leak')
  } finally {
    store.destroy()
  }
})


test('F-PARITY-07F: selected cache honors wide-Web 1000 download bound, then narrows massive selection to 200', () => {
  const render = actualWebInlineProjection()
  const root = { id: 1, name: '我的文件', type: 'dir', revision: 1 }
  const folders = [{ id: 2, name: 'Work', type: 'dir', revision: 1 }]
  const files = Array.from({ length: 1100 }, (_, i) => ({
    id: i + 1000, name: 'file-' + i, type: 'file', revision: 1, parent_id: 1,
  }))
  let view = render({ branches: [] }, [root, ...folders, ...files], 'account-A:root')
  const items = files.map(node => ({
    id: node.id, name: node.name, kind: 'file', revision: node.revision,
  }))
  view.notifySelection?.(items.slice(0, 1000))
  view = render({ branches: [] }, [root, ...folders], 'account-A:root')
  assert.equal(view.retainedCount, 1000, '1000 selected downloads remain supported')
  assert.equal(view.nodeByID.has(1999), true)
  view.notifySelection?.(items.slice(0, 1001))
  view = render({ branches: [] }, [root, ...folders], 'account-A:root')
  assert.equal(view.retainedCount, 200, 'over-limit 1001+ selections never pin an entire 100k collection')
  assert.equal(view.nodeByID.has(1000), true)
  assert.equal(view.nodeByID.has(1999), false)
  view = render({ branches: [] }, [root, ...folders], 'account-B:root')
  assert.equal(view.retainedCount, 0, 'a new login must drop all prior-account identities')
  assert.equal(view.nodeByID.has(1000), false)
})


test('F-PARITY-07F: operation limit precedes sparse Node metadata failure for 100k selected IDs', () => {
  const validation = actualSelectionController()
  const selected = Array.from({ length: 100000 }, (_, i) => ({ id: i + 1 }))
  for (const [maxItems, label] of [[200, '修改操作'], [1000, '下载']]) {
    assert.match(validation.xDriveFileExplorerSelectionActionDisabledReason({
      selected, selectedCount: 100000, nodeByID: new Map(),
      requireRevision: maxItems === 200, maxItems,
    }), new RegExp(String(maxItems)), label + ' must explain its real shared Server limit first')
  }
  assert.match(validation.xDriveFileExplorerSelectionActionDisabledReason({
    selected: [{ id: 9 }], selectedCount: 1, nodeByID: new Map(),
    requireRevision: true, maxItems: 200,
  }), /尚未完整加载/, 'within the limit missing Node metadata must still be rejected')
})
