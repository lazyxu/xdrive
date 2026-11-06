'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
function loadTS(filename,deps={}) {
  const code=ts.transpileModule(read(filename),{
    fileName:filename,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((code.diagnostics||[])
    .filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const mod={exports:{}}
  new Function('module','exports','require',code.outputText)(
    mod,mod.exports,name=>{
      assert.ok(Object.hasOwn(deps,name),'unreviewed helper dependency '+name)
      return deps[name]
    })
  return mod.exports
}
const mapScope=require('./helpers/load-baidu-map-scope.cjs')
const visual=loadTS('ui/shared/src/media-gallery-baidu-map-visual-state.ts',{
  './media-gallery-baidu-map-photo-scope':mapScope,
})
const lifecycle=loadTS('ui/shared/src/media-gallery-places-request-lifecycle.ts')
const mode=loadTS('ui/shared/src/media-gallery-places-map-mode.ts')
const restricted={albumKey:'manual:Family2026',filters:{
  sort_by:'added',sort_dir:'asc',favorite:true,asset_kind:'video',
  captured_from:'2026-01-01',captured_to:'2026-11-06',time_zone:'Asia/Tokyo',
}}
const another={albumKey:'manual:Others',filters:{
  sort_by:'captured',sort_dir:'desc',favorite:false,asset_kind:'image',
}}
const copy=o=>JSON.parse(JSON.stringify(o))
const drain=async()=>{await Promise.resolve();await Promise.resolve()}

test('P1-09: Owner-bound map filters survive Viewer/Back remount without gaining media authority',()=>{
  const owner='web:map-owner-a',foreign='web:map-owner-b'
  visual.xDriveClearBaiduMapVisualScope(owner)
  visual.xDriveClearBaiduMapVisualScope(foreign)
  assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,restricted,1000),true)
  assert.deepEqual(visual.xDriveReadBaiduMapVisualScope(owner,1001),restricted)
  assert.equal(visual.xDriveReadBaiduMapVisualScope(foreign,1001),undefined)
  const readBack=visual.xDriveReadBaiduMapVisualScope(owner,1002)
  readBack.filters.sort_by='captured'
  assert.deepEqual(visual.xDriveReadBaiduMapVisualScope(owner,1003),restricted,
    'a Viewer cannot mutate the remembered filter snapshot')
  assert.equal(visual.xDriveBaiduMapViewerReturnScopeMatches(restricted,restricted),true)
  for(const stale of [another,mapScope.xDriveEmptyBaiduMapPhotoScope,
    {...restricted,filters:{...restricted.filters,favorite:false}},
    {...restricted,filters:{...restricted.filters,asset_kind:'image'}},
    {...restricted,filters:{...restricted.filters,captured_from:undefined}},
  ])assert.equal(visual.xDriveBaiduMapViewerReturnScopeMatches(restricted,stale),false,
    'an old cell/viewport return cannot broaden or replace current Owner scope')
  assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,{
    ...restricted,albumKey:'not-a-valid-album',
  },1004),false)
  assert.deepEqual(visual.xDriveReadBaiduMapVisualScope(owner,1005),restricted)
  assert.equal(visual.xDriveReadBaiduMapVisualScope(owner,1000+
    visual.XDRIVE_BAIDU_MAP_VISUAL_SCOPE_TTL_MS),undefined)
  assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,restricted,2000000),true)
  visual.xDriveClearBaiduMapVisualScope(owner)
  assert.equal(visual.xDriveReadBaiduMapVisualScope(owner,2000001),undefined)
})

test('P1-09: cached map visual state is bounded by Owner and never stored externally',()=>{
  for(let i=0;i<10;i++)
    assert.equal(visual.xDriveRememberBaiduMapVisualScope('map:'+i,restricted,3_000_000+i),true)
  assert.equal(visual.xDriveReadBaiduMapVisualScope('map:0',3_000_011),undefined)
  assert.equal(visual.xDriveReadBaiduMapVisualScope('map:1',3_000_011),undefined)
  assert.deepEqual(visual.xDriveReadBaiduMapVisualScope('map:9',3_000_011),restricted)
  assert.equal(visual.xDriveRememberBaiduMapVisualScope('',restricted,4_000_000),false)
  assert.equal(visual.xDriveRememberBaiduMapVisualScope('x'.repeat(1025),restricted,4_000_000),false)
  assert.equal(visual.xDriveRememberBaiduMapVisualScope('map:invalid',
    {...restricted,filters:{...restricted.filters,token:'secret'}},4_000_000),false)
  const source=read('ui/shared/src/media-gallery-baidu-map-visual-state.ts')
  assert.doesNotMatch(source,/localStorage|sessionStorage|document\.cookie|window\.BMap|fetch\(/)
  for(let i=0;i<10;i++)visual.xDriveClearBaiduMapVisualScope('map:'+i)
})

test('P1-08: pending request always settles on deadline even if transport ignores AbortSignal',async()=>{
  const ctl=new AbortController()
  let expired=0
  const never=new Promise(()=>{})
  const result=lifecycle.xDrivePlacesRequestWithDeadline(never,ctl.signal,15,()=>{
    expired++
    ctl.abort()
  })
  await assert.rejects(result,/places-request-timeout/)
  assert.equal(expired,1)
  assert.equal(ctl.signal.aborted,true)
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,15999,true),true)
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,16000,true),false)
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,1100,false),false)
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,999,true),false)
})

test('P1-08: Owner switch/cancel fences late resolution without changing a new map',async()=>{
  let finishA
  const ctlA=new AbortController()
  const first=lifecycle.xDrivePlacesRequestWithDeadline(
    new Promise(resolve=>{finishA=resolve}),ctlA.signal,15000)
  ctlA.abort()
  await assert.rejects(first,/places-request-cancelled/)
  let finishB
  const ctlB=new AbortController()
  const second=lifecycle.xDrivePlacesRequestWithDeadline(
    new Promise(resolve=>{finishB=resolve}),ctlB.signal,15000)
  finishB('current Owner scope')
  assert.equal(await second,'current Owner scope')
  finishA('stale Owner scope')
  await drain()
  assert.equal(ctlA.signal.aborted,true)
  await assert.rejects(lifecycle.xDrivePlacesRequestWithDeadline(
    Promise.resolve('aborted'),ctlA.signal,100),/places-request-cancelled/)
  await assert.rejects(lifecycle.xDrivePlacesRequestWithDeadline(
    Promise.resolve(true),new AbortController().signal,0),
    /invalid-places-request-deadline/)
})

test('P1-09: mode/camera/route handoff rejects stale identity and keeps URL opaque',()=>{
  const cam={coordinate_space:'bd09ll',latitude:39.9,longitude:116.4,zoom:12.5}
  const issued={ownerScope:'web:alice',photoScopeKey:mapScope.xDriveBaiduMapPhotoScopeKey(restricted),
    routeHref:'https://drive.example/#/app/gallery?section=places',camera:cam}
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(issued,copy(issued)),true)
  for(const mutated of [
    {...issued,ownerScope:'web:bob'},
    {...issued,photoScopeKey:mapScope.xDriveBaiduMapPhotoScopeKey(another)},
    {...issued,routeHref:'https://drive.example/#/app/gallery?section=library'},
    {...issued,camera:{...cam,zoom:13}},
    {...issued,camera:null},
  ])assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(issued,mutated),false)
  const ticket='a'.repeat(64)
  const href=mode.xDrivePlacesMapScopeHandoffURL(issued.routeHref,'isolated',ticket)
  assert.ok(href&&href.includes(ticket))
  for(const privateWord of ['manual:Family2026','web:alice','39.9','116.4','favorite'])
    assert.equal(href.includes(privateWord),false,'private scope/camera leaked to URL')
})

test('P1-08/09: real shared Gallery + Desktop map lifecycle owns cancellation, filter and camera',()=>{
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const main=read('desktop/src/main/index.cts')
  assert.match(map,/handoffAbort\.current \|\| typeof window === 'undefined'/)
  assert.match(map,/pagehide', cancelStaleHandoff/)
  assert.match(map,/document\.addEventListener\('visibilitychange',hidden\)/)
  assert.match(map,/xDrivePlacesRequestWithDeadline\(request,controller\.signal,/)
  assert.match(map,/XDRIVE_PLACES_HANDOFF_TIMEOUT_MS/)
  assert.match(map,/xDrivePlacesHandoffTimeValid\(issuedAt,Date\.now\(\),/)
  assert.match(map,/xDrivePlacesMapHandoffFenceMatches\(issuedFence/)
  assert.match(map,/XDRIVE_PLACES_EMBED_PREPARE_TIMEOUT_MS/)
  assert.match(map,/XDRIVE_PLACES_STATUS_TIMEOUT_MS/)
  assert.match(map,/if\(document\.visibilityState==='hidden'\)return/)
  assert.match(map,/window\.addEventListener\('pageshow',resumed\)/)
  assert.match(map,/cameraOwnerRef\.current!==currentHandoffOwnerScope/)
  assert.match(gallery,/xDriveReadBaiduMapVisualScope\(preferenceScope\)/)
  assert.match(gallery,/xDriveRememberBaiduMapVisualScope\(preferenceScope,next\)/)
  assert.match(gallery,/xDriveBaiduMapViewerReturnScopeMatches\(mapPhotoScopeRef\.current,approved\)/)
  assert.match(gallery,/xDriveTakeBaiduCellViewerReturn\(preferenceScope\)/)
  assert.match(gallery,/xDriveTakeBaiduViewportViewerReturn\(preferenceScope\)/)
  assert.match(gallery,/range\.anchor_index/)
  assert.match(main,/prepareRevision!==desktopPlacesPrepareRevision/)
  assert.match(main,/if\(prepareRevision===desktopPlacesPrepareRevision\)desktopPlacesPending=null/)
  assert.match(main,/powerMonitor\.on\('suspend'/)
  assert.match(main,/powerMonitor\.on\('resume'/)
  // The map SDK never receives credentials, raw GPS, signed Cell source, or
  // an untrusted fallback to the full Owner library.
  assert.doesNotMatch(map,/setDesktopFallback|GPS 备用地图|localStorage|sessionStorage/)
  const tsx=ts.transpileModule(map,{fileName:'MediaGalleryPlacesMap.tsx',
    reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,
      module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((tsx.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
})

test('P1-08: actual Desktop Main handler refuses stale concurrent Owner/scope preparations',async()=>{
  const main=read('desktop/src/main/index.cts')
  const a=main.indexOf("  ipcMain.handle('desktop:prepare-places-embed',async")
  const b=main.indexOf("  ipcMain.handle('desktop:places-embed-consume'",a)
  assert.ok(a>=0&&b>a,'prepare handler cannot be extracted')
  const transpiled=ts.transpileModule(main.slice(a,b),{
    fileName:'desktop/src/main/index.cts',
    reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.deepEqual((transpiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const requests=[]
  const handlers=new Map()
  const mainWindow={isDestroyed:()=>false,webContents:{id:42,mainFrame:{}}}
  const state={connected:true,status:{configured:true,username:'alice',
    server:'https://drive.example',auth_status:'已登录'}}
  const env={
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    mainWindow,agentState:state,
    xDriveResolveSecureBaiduMapTarget:server=>server&&
      {origin:new URL(server).origin},
    xDriveParseDesktopBaiduMapScope:scope=>scope?.albumKey!==undefined ? scope:null,
    ensureDesktopPlacesWebAuth:()=>new Promise(resolve=>requests.push(resolve)),
    desktopPlacesWebOwnerStillCurrent:identity=>
      state.connected&&state.status.username===identity.owner,
  }
  const names=Object.keys(env)
  const runtime=new Function(...names,'exports',
    'let desktopPlacesPrepareRevision=0;let desktopPlacesPending=null;\n'+
      transpiled.outputText+'\nreturn {pending:()=>desktopPlacesPending,revision:()=>desktopPlacesPrepareRevision}')(
    ...names.map(n=>env[n]),{})
  const handler=handlers.get('desktop:prepare-places-embed')
  assert.equal(typeof handler,'function')
  const event={sender:mainWindow.webContents,senderFrame:mainWindow.webContents.mainFrame}
  const scopeA={albumKey:'manual:old',filters:{favorite:false}}
  const scopeB={albumKey:'manual:new',filters:{favorite:true}}
  const first=handler(event,scopeA),second=handler(event,scopeB)
  assert.equal(requests.length,2)
  requests[1](true)
  const current=await second
  assert.equal(current.ok,true)
  assert.equal(runtime.pending().scope.albumKey,'manual:new')
  requests[0](true)
  const stale=await first
  assert.equal(stale.ok,false)
  assert.equal(runtime.pending().scope.albumKey,'manual:new',
    'late request must not clear the new Owner/scope receipt')
  // An untrusted or stale WebView IPC sender must not mutate the trusted
  // Main window's already prepared Owner scope or generation.
  const revisionBefore=runtime.revision()
  const foreign=await handler({sender:{},senderFrame:{}},scopeA)
  assert.equal(foreign.ok,false)
  assert.equal(runtime.revision(),revisionBefore)
  assert.equal(runtime.pending().scope.albumKey,'manual:new')
  assert.equal(requests.length,2)
  const third=handler(event,scopeA)
  state.status={...state.status,username:'bob'}
  requests[2](true)
  const invalid=await third
  assert.equal(invalid.ok,false)
  assert.equal(runtime.pending(),null)
})
