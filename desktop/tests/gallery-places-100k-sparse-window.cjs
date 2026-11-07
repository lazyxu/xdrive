'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { performance } = require('node:perf_hooks')

const root = path.resolve(__dirname, '../..')
const cache = new Map()
// Load the actual pure TypeScript policy/Owner range validator, not a fake
// Gallery or server response. No UI, CAS or production photo bytes are needed.
function loadTS(relative) {
  const pathname = path.resolve(root, relative)
  assert.ok(pathname.startsWith(root + path.sep))
  if (cache.has(pathname)) return cache.get(pathname).exports
  const file = pathname.endsWith('.ts') ? pathname : pathname + '.ts'
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(x => x.category === ts.DiagnosticCategory.Error)
    .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  const mod = { exports: {} }
  cache.set(pathname, mod)
  const localRequire = name => name.startsWith('.')
    ? loadTS(path.relative(root, path.resolve(path.dirname(file), name)))
    : require(name)
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, localRequire)
  return mod.exports
}

const {
  XDRIVE_PLACES_DRAWER_WINDOW_ITEM_LIMIT: bound,
  xDrivePlacesPhotoWindowAppend: append,
  xDrivePlacesPhotoWindowRehydrate: rehydrate,
  xDrivePlacesPhotoWindowMissingOffset: missing,
} = loadTS('ui/shared/src/media-gallery-places-photo-window.ts')

const total = 100000
const limit = 48
const selection = {
  grid_scheme: 'world_stable_v1', cell_x: 1, cell_y: 1,
  asset_id: 1, node_id: 1, node_revision: 1, photo_count: total,
  bounds: {coordinate_space:'bd09ll',west:115,east:116,south:39,north:40},
}
const page = offset => ({
  offset, limit, total_count: total,
  items: Array.from({length: Math.min(limit, total - offset)}, (_, index) => ({
    node: {id: offset + index + 1, revision: 1},
  })),
})

test('three deterministic 100k Owner ranges retain at most 10 authenticated pages, never 100k Node identities', () => {
  for (let run = 0; run < 3; run++) {
    const start = performance.now()
    let window = {start:0,items:page(0).items,depth:48,total}
    let maximum = window.items.length
    let reads = 1
    for (let offset=48; offset<total; offset+=limit) {
      const next = append(selection, window, page(offset))
      assert.ok(next, 'a valid forward signed page must be accepted')
      window = next
      maximum = Math.max(maximum, window.items.length)
      assert.ok(window.items.length <= bound, 'resident window must be bounded')
      assert.ok(window.depth <= total)
      assert.equal(window.start + window.items.length, window.depth)
      reads++
    }
    assert.equal(window.depth, total)
    assert.equal(reads, Math.ceil(total/limit))
    assert.equal(maximum, bound)
    assert.ok(window.start>0)
    const residentIDs = window.items.map(item=>item.node.id)
    assert.ok(!residentIDs.includes(1), 'the earliest media identity must be evicted')

    // Genuine virtual host positions older than the resident pages must be
    // freshly authorized on the current Owner/cell, not copied from a cache.
    assert.equal(missing(window,0,8),0)
    const older = rehydrate(selection,window,page(0))
    assert.ok(older)
    assert.equal(older.start,0)
    assert.equal(older.items.length,48)
    assert.equal(older.depth,total)
    assert.equal(missing(older,48,75),48)
    const nextOlder = rehydrate(selection,older,page(48))
    assert.ok(nextOlder)
    assert.equal(nextOlder.items.length,96)
    assert.equal(nextOlder.depth,total)
    assert.ok(performance.now()>=start)
    process.stdout.write('Owner 100k deterministic pass '+(run+1)+
      ': '+reads+' signed pages, max resident '+maximum+
      ', elapsed_ms='+Math.round(performance.now()-start)+'\n')
  }
})

test('evicted positions never accept wrong offset, same-total duplicate or changed range',()=>{
  const current={start:0,items:page(0).items,depth:48,total}
  assert.equal(append(selection,current,{...page(48),offset:96}),null)
  assert.equal(append(selection,current,{...page(48),total_count:total+1}),null)
  const duplicate=page(48)
  duplicate.items[0]={node:{...current.items[0].node}}
  assert.equal(append(selection,current,duplicate),null)
  assert.equal(rehydrate(selection,{start:48,items:page(48).items,depth:96,total},
    {...page(0),total_count:total+1}),null)
  assert.equal(missing(current,-1,8),null)
})
