'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname,'../../ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')

const queryStart = source.indexOf('    const queryCells = async')
const refreshStart = source.indexOf('    refreshFilteredCells.current=(skipPending=false)=>{',queryStart)
const queryBody = source.slice(queryStart,refreshStart)
// The actual query handler uses TypeScript type annotations. Strip only
// types; exercise the unchanged compiled async callback with real promises.
const compiledQuery = ts.transpileModule(queryBody,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const refreshBody = source.slice(refreshStart,
  source.indexOf('    const acquireTicket=async()',refreshStart))

test('map query failure is distinct from map SDK failure, has a safe shared Parent retry',()=>{
  assert.ok(queryStart>0 && refreshStart>queryStart)
  assert.match(source,/const \[failedCellsScope,setFailedCellsScope\] = useState<\{owner:string;key:string\} \| null>\(null\)/)
  assert.match(source,/failedCellsScopeRef\.current = null/)
  assert.match(queryBody,/approved\.key===filterRef\.current\.key/)
  assert.match(queryBody,/failedCellsScopeRef\.current = failureScope/)
  assert.match(queryBody,/setFailedCellsScope\(failureScope\)/)
  assert.match(source,/phase === 'ready' && failedCellsScope\?\.owner === \(scope \?\? ''\)/)
  assert.match(source,/data-xdrive-places-cells-query-error/)
  assert.match(source,/data-xdrive-places-cells-query-retry/)
  assert.match(source,/onClick=\{\(\) => refreshFilteredCells\.current\?\.\(true\)\}/)
  assert.match(source,/未显示未经确认的照片/)
  const errorUI=source.slice(source.indexOf('        {phase === \'ready\' && failedCellsScope'),
    source.indexOf('        {activeDrawer && loadThumbnail'))
  assert.doesNotMatch(errorUI,/xDriveMount|loadThumbnail|listOwnerCellItems|bootstrapMapSession|Geoconv/)
})

function harness({badResponse=false,aborted=false}={}){
  const b={coordinate_space:'bd09ll',west:110,south:20,east:130,north:40}
  const failedCellsScopeRef={current:null}
  const acceptedScope={current:null},acceptedCells={current:[]}
  const latestAcceptedViewport={current:null}
  // Failed/aborted Owner Cells must discard any one-shot rotation visual hint.
  const pendingResizeDrawer={current:{owner:'fixture-owner-a',key:'owner:family',hint:{}}}
  const gesturePresentationRef={current:null}
  const canceledVisual=[],clearedVisual=[]
  const failed=[],summaries=[],published=[],accessible=[]
  const controller=new AbortController()
  const deps={
    lifetime:{signal:controller.signal},
    cancel:keepVisual=>{canceledVisual.push(keepVisual)},
    gesturePresentationRef,
    clearGesturePresentation:()=>{clearedVisual.push(true)},
    lastViewport:{current:null},frame:{replaceAuthorizedCells:pins=>{
      published.push([...pins]);return true}},
    filterRef:{current:{key:'owner:family',snapshot:{
      filters:{sort_by:'captured',sort_dir:'desc'},albumKey:'manual:family'}}},
    generation:0,activeQuery:null,
    listOwnerCells:async()=>{
      if(aborted)controller.abort()
      if(badResponse)return {cells:[{node_id:-1}]}
      throw new Error('bounded simulated Owner request failure')
    },
    xDriveValidBaiduNativeCellsPage:()=>false,
    xDriveSelectBaiduNativeCell:()=>null,
    acceptedScope,acceptedCells,restoreHint:{current:null},pendingResizeDrawer,
    selectCellRef:{current:()=>{}},xDrivePlacesDrawerMatchesFresh:()=>false,
    setAccessible:items=>accessible.push(items),
    setSummary:page=>summaries.push(page),
    setAcceptedViewport:()=>{},latestAcceptedViewport,
    setFailedCellsScope:value=>failed.push(value),
    failedCellsScopeRef,scope:'fixture-owner-a',
    initialWorldEmpty:false,cameraTouched:true,
    frameReplaceSentinel:true,
  }
  const names=Object.keys(deps)
  const query=new Function(...names,compiledQuery+'; return queryCells;')(...names.map(n=>deps[n]))
  return {run:()=>query(b,true),ref:failedCellsScopeRef,failed,summaries,published,
    accessible,bounds:b,pendingResizeDrawer,canceledVisual,clearedVisual}
}

test('rejected current Owner /cells cannot keep stale pins or silently show zero photos',async()=>{
  const f=harness()
  assert.equal(await f.run(),false)
  assert.deepEqual(f.ref.current,{owner:'fixture-owner-a',key:'owner:family'})
  assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
  assert.deepEqual(f.summaries,[null])
  assert.deepEqual(f.published,[[],[]])
  assert.deepEqual(f.canceledVisual,[false], 'failed Owner read invalidates old query work')
  assert.deepEqual(f.clearedVisual,[true], 'failed Owner read clears gesture presentation')
  assert.equal(f.pendingResizeDrawer.current,null,
    'failed Owner Cells must discard stale rotation intent')
})

test('invalid signed cells page takes the same fail-closed retry path',async()=>{
  const f=harness({badResponse:true})
  assert.equal(await f.run(),false)
  assert.deepEqual(f.ref.current,{owner:'fixture-owner-a',key:'owner:family'})
  assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
  assert.deepEqual(f.published,[[],[]])
  assert.deepEqual(f.canceledVisual,[false], 'failed Owner read invalidates old query work')
  assert.deepEqual(f.clearedVisual,[true], 'failed Owner read clears gesture presentation')
  assert.equal(f.pendingResizeDrawer.current,null,
    'invalid Owner Cells must discard stale rotation intent')
})

test('aborted request never grants a retry scope or reports an error',async()=>{
  const f=harness({aborted:true})
  assert.equal(await f.run(),false)
  assert.equal(f.ref.current,null)
  assert.deepEqual(f.failed,[])
  assert.deepEqual(f.published,[[]])
  assert.deepEqual(f.canceledVisual,[false], 'aborted query cancels old generation')
  assert.deepEqual(f.clearedVisual,[], 'abort never publishes a new Owner error')
  assert.equal(f.pendingResizeDrawer.current,null,
    'aborted Owner Cells must discard stale rotation intent')
})

test('current failed Owner scope can retry once, in-flight and cross-scope cannot',()=>{
  const keys={current:{key:'owner:family'}}
  const acceptedScope={current:null}
  const failedCellsScopeRef={current:{owner:'fixture-owner-a',key:'owner:family'}}
  const sent=[]
  const refreshFilteredCells={current:null}
  const lastViewport={current:{bounds:{coordinate_space:'bd09ll',
    west:110,south:20,east:130,north:40},live:true}}
  const deps={
    refreshFilteredCells,lifetime:{signal:{aborted:false}},failed:false,
    lastViewport,activeQuery:null,acceptedScope,failedCellsScopeRef,
    filterRef:keys,scope:'fixture-owner-a',initialWorldEmpty:false,cameraTouched:true,
    queryCells:(bounds,live)=>{sent.push({bounds,live});return Promise.resolve(true)},
  }
  const names=Object.keys(deps)
  new Function(...names,refreshBody)(...names.map(n=>deps[n]))
  refreshFilteredCells.current(true)
  assert.deepEqual(sent,[{bounds:lastViewport.current.bounds,live:true}])
  assert.notEqual(sent[0].bounds,lastViewport.current.bounds)
  deps.activeQuery={}
  // The function closes over the original activeQuery primitive; instead
  // prove in-flight and old-scope guards using new closures with fresh deps.
  const call=options=>{
    const arr=[]
    const d={...deps, ...options,queryCells:(bounds,live)=>{
      arr.push({bounds,live});return Promise.resolve(true)}}
    const ns=Object.keys(d),slot={current:null}
    d.refreshFilteredCells=slot
    new Function(...ns,refreshBody)(...ns.map(n=>d[n]))
    slot.current(true)
    return arr
  }
  assert.equal(call({activeQuery:{}}).length,0)
  assert.equal(call({failedCellsScopeRef:{current:{owner:'fixture-owner-a',key:'owner:stale'}}}).length,0)
  assert.equal(call({failedCellsScopeRef:{current:{owner:'fixture-owner-b',key:'owner:family'}}}).length,0)
  assert.equal(call({lifetime:{signal:{aborted:true}}}).length,0)
})
