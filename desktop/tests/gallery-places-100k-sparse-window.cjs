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


test('fully visited 528-photo Cell recovers an evicted failed page without claiming new depth', () => {
  const count=528
  const exactSelection={...selection,photo_count:count}
  const page528=offset=>({
    ...page(offset),total_count:count,
    items:page(offset).items.slice(0,Math.min(limit,count-offset)),
  })
  let window={start:0,items:page528(0).items,depth:48,total:count}
  for(let offset=48;offset<count;offset+=limit){
    const advanced=append(exactSelection,window,page528(offset))
    assert.ok(advanced,'next signed page stays valid')
    window=advanced
  }
  assert.equal(window.depth,window.total)
  assert.equal(window.items.length,bound)
  assert.equal(window.start,48)
  assert.equal(missing(window,0,8),0)
  // A failed or malformed Owner /cell-items re-read has no right to alter
  // the current album, no matter how deep the user has already scrolled.
  assert.equal(rehydrate(exactSelection,window,{...page528(0),total_count:count+1}),null)
  assert.equal(window.start,48)
  assert.equal(window.depth,count)
  // A manual retry invokes the SAME signed page verifier and stays bounded.
  const retried=rehydrate(exactSelection,window,page528(0))
  assert.ok(retried)
  assert.equal(retried.start,0)
  assert.equal(retried.depth,count)
  // Adjacent rehydration retains up to ten already authenticated pages;
  // it must not discard 432 valid identities or exceed the resident bound.
  assert.equal(retried.items.length,bound)
  assert.equal(retried.items.every((item,index)=>item.node.id===index+1),true)
})

test('Owner Parent provides a retry for failed evicted window even when all pages were visited', () => {
  const parent=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  const sheet=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx'),'utf8')
  const start=parent.indexOf('const loadDrawerWindow = (')
  const end=parent.indexOf('const openDrawerPhoto =',start)
  assert.ok(start>=0 && end>start)
  const authenticated=parent.slice(start,end)
  assert.match(authenticated,/state\.pageError && !manualRetry/,
    'failed window must not be re-fetched forever from auto layout callbacks')
  assert.match(authenticated,/drawerFetch\.current \|\| !approved/)
  assert.match(authenticated,/approved\.key!==filterRef\.current\.key/)
  assert.match(authenticated,/hasAcceptedCell\(state\.selection\)/)
  assert.match(authenticated,/xDrivePlacesPhotoWindowMissingOffset/)
  assert.match(authenticated,/pageErrorKind:'window'/)
  assert.match(authenticated,/failedWindowRange:\{start:visibleStart,end:visibleEnd\}/)
  assert.match(authenticated,/loadDrawerWindow\(state\.failedWindowRange\.start,state\.failedWindowRange\.end,true\)/)
  assert.match(parent,/onRetryWindow=\{retryDrawerWindow\}/)
  assert.match(sheet,/\{pageError \? \(/,
    'a complete logical album still needs a visible window retry')
  assert.doesNotMatch(sheet,/\{pageError && loadedDepth < total \? \(/)
  assert.match(sheet,/onClick=\{pageErrorKind === 'window' \? onRetryWindow : onLoadMore\}/)
  assert.match(sheet,/data-xdrive-places-photo-drawer-page-retry/)
})


test('100k far-scroll jumps directly to the visible signed Owner page, not 2k sequential requests',()=>{
  // Reachable after visiting the full album and then rehydrating the first
  // evicted page: the logical 100k depth is kept, but only page zero resides.
  const first={start:0,items:page(0).items,depth:total,total}
  const jumpStart=90721
  const jumpEnd=90741
  const targetOffset=Math.floor(jumpStart / limit)*limit
  assert.equal(missing(first,jumpStart,jumpEnd),targetOffset)
  assert.notEqual(targetOffset,first.start+first.items.length,
    'must not sequentially re-read page 48 after a 90k scroll jump')
  const reauthorized=rehydrate(selection,first,page(targetOffset))
  assert.ok(reauthorized)
  assert.equal(reauthorized.depth,total)
  assert.equal(reauthorized.start,targetOffset)
  assert.equal(reauthorized.items.length,limit)
  assert.equal(missing(reauthorized,jumpStart,jumpEnd),null,
    'one fresh signed Range must cover the actual visible viewport')
  assert.equal(missing(reauthorized,20,30),0,
    'jumping back also seeks directly to that signed page')
  assert.equal(missing(first,total+1,total+2),null,
    'never issue requests outside the visited Owner logical depth')
})

test('first-visit 100k logical wall directly seeks signed page 90k without visiting earlier pages', () => {
  // A newly opened place knows the exact, signed total but has only page zero.
  const cold={start:0,items:page(0).items,depth:48,total}
  const visibleStart=90253, visibleEnd=90269
  const offset=Math.floor(visibleStart/limit)*limit
  assert.equal(missing(cold,visibleStart,visibleEnd),offset)
  assert.ok(offset>480)
  const signed=rehydrate(selection,cold,page(offset))
  assert.ok(signed)
  assert.equal(signed.start,offset)
  assert.equal(signed.depth,48,'a far visit does not invent a contiguous prefix')
  assert.equal(signed.items.length,48)
  assert.equal(missing(signed,visibleStart,visibleEnd),null)
  assert.equal(missing(signed,0,7),0)
  // Restoring the start and subsequently reading its next page is still safe.
  const first=rehydrate(selection,signed,page(0))
  assert.ok(first)
  assert.equal(first.depth,48)
  assert.equal(first.start,0)
  const next=rehydrate(selection,first,page(48))
  assert.ok(next)
  assert.equal(next.depth,96)
  assert.equal(next.items.length,96)
  // No guessed range, altered revision, or beyond-total seek is accepted.
  assert.equal(rehydrate(selection,cold,{...page(offset),total_count:total-1}),null)
  assert.equal(rehydrate(selection,cold,{...page(offset),offset:total}),null)
  assert.equal(missing(cold,total,total),null)
})

test('trusted sparse Gallery wiring restores logical index, not 480 pages or old private IDs', () => {
  const read = p => fs.readFileSync(path.join(root,p),'utf8')
  const sheet=read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const parent=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const shared=read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
  const returns=read('ui/shared/src/media-gallery-places-photo-drawer.ts')
  assert.match(sheet,/itemCount: sparse && phase==='ready' \? total : loadedDepth/)
  assert.match(sheet,/onRangeChange: notifyRange/)
  assert.match(sheet,/onVisibleAnchorChange=\{captureVisibleAnchor\}/)
  assert.match(sheet,/restoreAnchorIndex=/)
  assert.match(sheet,/anchorIndex:index,anchorViewportOffset:/)
  assert.match(shared,/visibleWindow\.startRow \* metrics\.rowStep - visibleTop/)
  assert.match(shared,/collection\.loadedItems, collection\.onRangeChange/)
  assert.match(parent,/loadedDepth:window\?\.depth \?\? current\.loadedDepth/)
  assert.match(parent,/anchorIndex:rawIndex/)
  assert.match(returns,/anchorIndex\?: number/)
  assert.match(returns,/anchorViewportOffset\?: number/)
  assert.doesNotMatch(returns,/\.items.*anchorIndex/,'return hints cannot retain media')
})
