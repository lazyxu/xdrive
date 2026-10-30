'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  const mod = { exports: {} }
  new Function('module','exports','require',compiled.outputText)(mod,mod.exports,name => {
    if (!Object.hasOwn(imports,name)) throw Error('Unexpected shared read import: '+name)
    return imports[name]
  })
  return mod.exports
}
const cloud = load('ui/shared/src/cloud-files.ts')
const file = 'ui/shared/src/mui/FileExplorerReanchor.ts'
const shared = load(file, { '../cloud-files': cloud })
const sort = { key:'name', direction:'asc' }
const grouping = { groupBy:'none', foldersFirst:true }
const position = {
  node_id:321, revision:7, index:95237,
  sort:'name',order:'asc',group:'none',folders_first:true,
}
const request = (row, fn = shared.xDriveFileExplorerVerifiedChildReveal) => fn({
  parentID:12,nodeID:321,itemCount:100000,sort,grouping,
  revision:7,signal:new AbortController().signal,
  locate:async () => position,collectRange:async () => [row],
})

test('verified Range accepts exact numeric and canonical decimal node/revision identities', async () => {
  for(const row of [
    {id:321,revision:7,kind:'file',name:'actual.jpg'},
    {id:'321',revision:'7',kind:'file',name:'actual.jpg'},
    {id:321,revision:'7',kind:'file',name:'actual.jpg'},
  ]) {
    const revealed = await request(row)
    assert.equal(revealed?.index,95237)
    assert.strictEqual(revealed?.item,row)
    const restored = await request(row,shared.xDriveFileExplorerVerifiedChildReanchor)
    assert.strictEqual(restored?.item,row)
  }
})

test('ambiguous and unsafe coercions cannot restore another Owner row as a verified child', async () => {
  const base = { id:321,revision:7,kind:'file',name:'verified.jpg' }
  const forged = [
    {id:' 321 '},{id:'0321'},{id:'0x141'},
    {id:'3.21e2'},{id:'321.0'},{id:''},{id:'321\n'},
    {id:0},{id:-1},{id:1.5},{id:Infinity},
    {id:Number.MAX_SAFE_INTEGER + 1},
    {revision:' 7 '},{revision:'07'},{revision:'0x7'},
    {revision:'7e0'},{revision:''},{revision:'7.0'},
    {revision:0},{revision:-1},{revision:7.2},{revision:NaN},
    {revision:Number.MAX_SAFE_INTEGER + 1},
  ]
  for(const altered of forged) {
    const item = { ...base,...altered }
    assert.equal(await request(item),null,JSON.stringify(altered))
    assert.equal(await request(item,shared.xDriveFileExplorerVerifiedChildReanchor),
      null,JSON.stringify(altered))
  }
})

test('no eager fallback, mistaken Parent or stale position can produce a read ticket', async () => {
  let loaded = 0
  const proof = () => ({
    parentID:12,nodeID:321,itemCount:100000,sort,grouping,
    signal:new AbortController().signal,
    locate:async()=>({...position,node_id:999}),
    collectRange:async()=>{loaded++;return [{id:321,revision:7}]},
  })
  assert.equal(await shared.xDriveFileExplorerVerifiedChildReveal(proof()),null)
  assert.equal(loaded,0)
  assert.equal(await shared.xDriveFileExplorerVerifiedChildReanchor({
    ...proof(),revision:7,
  }),null)
  assert.equal(loaded,0)
  const code=fs.readFileSync(path.join(root,file),'utf8')
  assert.doesNotMatch(code,/fetch\s*\(|ipcRenderer|window\.|localStorage|cloudUpload|cloudDelete/)
})

function legacyWebKitSignal(controller, withoutReason = false) {
  // Browser simulation on a genuine AbortSignal, not a fake transport object:
  // legacy Safari/WebKit may lack throwIfAborted() (and older versions reason).
  Object.defineProperty(controller.signal, 'throwIfAborted', {
    configurable: true, value: undefined,
  })
  if (withoutReason) Object.defineProperty(controller.signal, 'reason', {
    configurable: true, value: undefined,
  })
  return controller.signal
}
const legacyParams = (signal, overrides = {}) => ({
  parentID: 12, nodeID: 321, revision: 7, itemCount: 100000,
  sort, grouping, signal,
  locate: async () => position,
  collectRange: async () => [{ id: '321', revision: '7', kind: 'file' }],
  ...overrides,
})

test('legacy WebKit without throwIfAborted still reveals and reanchors authorized exact Range', async () => {
  for (const fn of [
    shared.xDriveFileExplorerVerifiedChildReveal,
    shared.xDriveFileExplorerVerifiedChildReanchor,
  ]) {
    const controller = new AbortController()
    const signal = legacyWebKitSignal(controller)
    const calls = []
    const row = { id: '321', revision: '7', kind: 'file' }
    const result = await fn(legacyParams(signal, {
      locate: async (...args) => { calls.push(['locate', ...args]); return position },
      collectRange: async (...args) => { calls.push(['range', ...args]); return [row] },
    }))
    assert.strictEqual(result.item, row)
    assert.equal(result.index, 95237)
    assert.deepEqual(calls.map(x => x[0]), ['locate', 'range'])
    assert.equal(calls[0].at(-1), signal)
    assert.equal(calls[1].at(-1), signal)
  }
})

test('legacy WebKit cancellation never starts or publishes a stale Viewer child Range', async () => {
  for (const fn of [
    shared.xDriveFileExplorerVerifiedChildReveal,
    shared.xDriveFileExplorerVerifiedChildReanchor,
  ]) {
    for (const phase of ['before', 'after-locate', 'after-range']) {
      const controller = new AbortController()
      const signal = legacyWebKitSignal(controller)
      const reason = new DOMException('obsolete Owner or route', 'AbortError')
      let locates = 0, ranges = 0
      if (phase === 'before') controller.abort(reason)
      await assert.rejects(() => fn(legacyParams(signal, {
        locate: async () => {
          locates++
          if (phase === 'after-locate') controller.abort(reason)
          return position
        },
        collectRange: async () => {
          ranges++
          if (phase === 'after-range') controller.abort(reason)
          return [{ id: 321, revision: 7, kind: 'file' }]
        },
      })), error => error === reason,
      'obsolete cancellation must preserve the exact AbortSignal reason')
      assert.equal(locates, phase === 'before' ? 0 : 1, phase)
      assert.equal(ranges, phase === 'after-range' ? 1 : 0, phase)
    }
  }
})

test('legacy WebKit missing AbortSignal.reason still rejects an obsolete read with AbortError', async () => {
  for (const fn of [
    shared.xDriveFileExplorerVerifiedChildReveal,
    shared.xDriveFileExplorerVerifiedChildReanchor,
  ]) {
    const controller = new AbortController()
    const signal = legacyWebKitSignal(controller, true)
    controller.abort()
    let requests = 0
    await assert.rejects(() => fn(legacyParams(signal, {
      locate: async () => { requests++; return position },
      collectRange: async () => { requests++; return [] },
    })), error => error?.name === 'AbortError')
    assert.equal(requests, 0, 'obsolete Owner cannot issue any new private read')
  }
})
