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

const diagnosticSource = fs.readFileSync(path.join(__dirname,
  '../../ui/shared/src/media-gallery-baidu-diagnostics.ts'),'utf8')
// Execute the actual status classifier so the test does not duplicate its contract.
const compiledDiagnostics = ts.transpileModule(diagnosticSource,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const diagnosticExports={}
new Function('exports',compiledDiagnostics)(diagnosticExports)
const classifyFailure=diagnosticExports.xDriveClassifyBaiduMapRequestFailure
assert.equal(typeof classifyFailure,'function')

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

function harness({badResponse=false,aborted=false,requestStatus=null}={}){
  const b={coordinate_space:'bd09ll',west:110,south:20,east:130,north:40}
  const failedCellsScopeRef={current:null}
  const acceptedScope={current:null},acceptedCells={current:[]}
  const latestAcceptedViewport={current:null}
  // Failed/aborted Owner Cells must discard any one-shot rotation visual hint.
  const pendingResizeDrawer={current:{owner:'fixture-owner-a',key:'owner:family',hint:{}}}
  const gesturePresentationRef={current:null}
  // This is a real branch of queryCells: a previously tapped, inert cover
  // must never open from a rejected new signed Owner Cell query.
  const pendingCoverClick={current:{
    owner:'fixture-owner-a',key:'owner:family',assetID:33,nodeID:75,revision:2,
  }}
  const coverStatuses=[]
  const canceledVisual=[],clearedVisual=[]
  const failed=[],summaries=[],published=[],accessible=[],diagnostics=[]
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
      if(requestStatus!==null){
        const error=new Error('simulated protected Owner HTTP error')
        error.status=requestStatus
        throw error
      }
      if(badResponse)return {cells:[{node_id:-1}]}
      throw new Error('bounded simulated Owner request failure')
    },
    xDriveRecordBaiduMapDiagnostic:(ownerScope,code)=>{
      diagnostics.push({scope:ownerScope,code});return true
    },
    xDriveClassifyBaiduMapRequestFailure:classifyFailure,
    xDriveValidBaiduNativeCellsPage:()=>false,
    xDriveSelectBaiduNativeCell:()=>null,
    acceptedScope,acceptedCells,restoreHint:{current:null},pendingResizeDrawer,
    selectCellRef:{current:()=>{}},xDrivePlacesDrawerMatchesFresh:()=>false,
    pendingCoverClick,setCoverClickStatus:value=>coverStatuses.push(value),
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
    accessible,bounds:b,pendingResizeDrawer,pendingCoverClick,coverStatuses,
    canceledVisual,clearedVisual,diagnostics}
}

test('rejected current Owner /cells cannot keep stale pins or silently show zero photos',async()=>{
  const f=harness()
  assert.equal(await f.run(),false)
  assert.deepEqual(f.ref.current,{owner:'fixture-owner-a',key:'owner:family'})
  assert.deepEqual(f.diagnostics,[{scope:'fixture-owner-a',code:'viewport_unavailable'}])
  assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
  assert.deepEqual(f.summaries,[null])
  assert.deepEqual(f.published,[[],[]])
  assert.deepEqual(f.canceledVisual,[false], 'failed Owner read invalidates old query work')
  assert.deepEqual(f.clearedVisual,[true], 'failed Owner read clears gesture presentation')
  assert.equal(f.pendingResizeDrawer.current,null,
    'failed Owner Cells must discard stale rotation intent')
  assert.equal(f.pendingCoverClick.current,null,
    'failed fresh Owner Cells must revoke a former-cover click intent')
  assert.deepEqual(f.coverStatuses,['重新确认地点照片失败，请点击照片重试。'])
})

test('invalid signed cells page takes the same fail-closed retry path',async()=>{
  const f=harness({badResponse:true})
  assert.equal(await f.run(),false)
  assert.deepEqual(f.ref.current,{owner:'fixture-owner-a',key:'owner:family'})
  assert.deepEqual(f.diagnostics,[{scope:'fixture-owner-a',code:'viewport_unavailable'}])
  assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
  assert.deepEqual(f.published,[[],[]])
  assert.deepEqual(f.canceledVisual,[false], 'failed Owner read invalidates old query work')
  assert.deepEqual(f.clearedVisual,[true], 'failed Owner read clears gesture presentation')
  assert.equal(f.pendingResizeDrawer.current,null,
    'invalid Owner Cells must discard stale rotation intent')
  assert.equal(f.pendingCoverClick.current,null,
    'invalid signed Owner Cells must revoke a former-cover click intent')
  assert.deepEqual(f.coverStatuses,['重新确认地点照片失败，请点击照片重试。'])
})

test('aborted request never grants a retry scope or reports an error',async()=>{
  const f=harness({aborted:true})
  assert.equal(await f.run(),false)
  assert.equal(f.ref.current,null)
  assert.deepEqual(f.diagnostics,[],'aborted requests cannot report failures')
  assert.deepEqual(f.failed,[])
  assert.deepEqual(f.published,[[]])
  assert.deepEqual(f.canceledVisual,[false], 'aborted query cancels old generation')
  assert.deepEqual(f.clearedVisual,[], 'abort never publishes a new Owner error')
  assert.equal(f.pendingResizeDrawer.current,null,
    'aborted Owner Cells must discard stale rotation intent')
  assert.deepEqual(f.coverStatuses,[],
    'an aborted request must not report a failed media reauthorization')
})

test('Owner 403 classifies viewport_denied and revokes unverified cells',async()=>{
  const f=harness({requestStatus:403})
  assert.equal(await f.run(),false)
  assert.deepEqual(f.diagnostics,[{scope:'fixture-owner-a',code:'viewport_denied'}])
  assert.deepEqual(f.published,[[],[]])
  assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
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

test('all Owner HTTP denial, quota and upstream classes clear stale map Cells before explicit retry',async()=>{
  for(const [status,code] of [
    [401,'viewport_denied'],
    [403,'viewport_denied'],
    [429,'viewport_rate_limited'],
    [503,'viewport_unavailable'],
  ]){
    const f=harness({requestStatus:status})
    assert.equal(await f.run(),false,'Owner request must fail closed: '+status)
    assert.deepEqual(f.diagnostics,[{scope:'fixture-owner-a',code}])
    assert.deepEqual(f.published,[[],[]],
      'no previous Owner Cell can be restored on HTTP '+status)
    assert.deepEqual(f.failed,[{owner:'fixture-owner-a',key:'owner:family'}])
    assert.deepEqual(f.summaries,[null])
    assert.equal(f.pendingCoverClick.current,null)
    assert.equal(f.pendingResizeDrawer.current,null)
  }
  const network=harness()
  assert.equal(await network.run(),false)
  assert.equal(network.diagnostics[0].code,'viewport_unavailable')
  // A denied map-only Session is distinct from a revoked Owner Cells Range.
  for(const [status,code] of [
    [401,'session_denied'],[403,'session_denied'],
    [429,'session_rate_limited'],[503,'session_unavailable'],
  ])assert.equal(classifyFailure('session',{status}),code)
  assert.equal(classifyFailure('status',{status:429}),'status_rate_limited')
})
