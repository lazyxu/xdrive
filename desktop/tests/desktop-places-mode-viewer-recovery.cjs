'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const mapScope=require('./helpers/load-baidu-map-scope.cjs')
function load(file,deps={}){
  const code=ts.transpileModule(
    fs.readFileSync(path.join(root,file),'utf8'),{
      fileName:file,reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((code.diagnostics||[]).filter(x=>
    x.category===ts.DiagnosticCategory.Error),[])
  const m={exports:{}}
  new Function('module','exports','require',code.outputText)(m,m.exports,id=>{
    assert.ok(Object.hasOwn(deps,id),'unexpected map module dependency '+id)
    return deps[id]
  })
  return m.exports
}
const deps={'./media-gallery-baidu-map-photo-scope':mapScope}
const visual=load('ui/shared/src/media-gallery-baidu-map-visual-state.ts',deps)
const cameraState=load('ui/shared/src/media-gallery-baidu-native-camera-session.ts')
const cell=load('ui/shared/src/media-gallery-baidu-cell-return-session.ts',deps)
const viewport=load('ui/shared/src/media-gallery-baidu-viewport-return-session.ts',deps)
const mode=load('ui/shared/src/media-gallery-places-map-mode.ts')
const lifecycle=load('ui/shared/src/media-gallery-places-request-lifecycle.ts')
const historyBootstrap=load('web/src/mapScopeHandoff.ts',{
  '../../ui/shared/src/media-gallery-places-map-mode':mode,
})
const owner='desktop:map-a',foreign='desktop:map-b'
const scope={albumKey:'manual:Family',filters:{favorite:true,asset_kind:'image',
  captured_from:'2026-10-01',captured_to:'2026-11-01',time_zone:'Asia/Tokyo',
  sort_by:'captured',sort_dir:'desc'}}
const camera={coordinate_space:'bd09ll',latitude:30.135,longitude:119.975,zoom:12.5}
const bounds={coordinate_space:'bd09ll',west:119,south:30,east:121,north:32}
const sort={by:'captured',dir:'desc'}
const selection={bounds,cell_x:2,cell_y:3,asset_id:42,node_id:411,
  node_revision:1,photo_count:2}
const href='https://maps.xdrive.example/#/app/gallery?section=places'
function clear(){
  for(const o of [owner,foreign]){
    visual.xDriveClearBaiduMapVisualScope(o)
    cameraState.xDriveClearBaiduNativeCamera(o)
    cell.xDriveClearBaiduCellReturn(o)
    viewport.xDriveClearBaiduViewportReturn(o)
  }
}
test('filtered Owner, BD-09 camera and Viewer anchor survive valid mode/Back but never grant media',()=>{
  clear()
  assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,scope,1000),true)
  assert.equal(cameraState.xDriveRememberBaiduNativeCamera(owner,camera,1000),true)
  assert.equal(cell.xDriveRememberBaiduCellReturn(owner,{selection,sort,photoScope:scope},1000),true)
  assert.equal(viewport.xDriveRememberBaiduViewportReturn(owner,
    {bounds,sort,photoScope:scope},1000),true)
  const issued={ownerScope:owner,photoScopeKey:mapScope.xDriveBaiduMapPhotoScopeKey(scope),
    routeHref:href,camera}
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(issued,{
    ...issued,camera:{...camera}}),true)
  const next=mode.xDrivePlacesMapScopeHandoffURL(href,'isolated','a'.repeat(64))
  assert.ok(next)
  assert.equal(new URL(next).searchParams.get('places_map_mode'),'isolated')
  for(const secret of ['manual:Family','desktop:map-a','30.135','119.975','favorite'])
    assert.equal(next.includes(secret),false,'private map state must not enter URL')
  const restored=visual.xDriveReadBaiduMapVisualScope(owner,1002)
  assert.deepEqual(restored,scope)
  assert.deepEqual(cameraState.xDriveReadBaiduNativeCamera(owner,1002),camera)
  assert.equal(visual.xDriveBaiduMapViewerReturnScopeMatches(restored,scope),true)
  assert.equal(cell.xDriveMarkBaiduCellViewerReturn(owner,411,1,1003),true)
  assert.equal(viewport.xDriveMarkBaiduViewportViewerReturn(owner,411,1,1003),true)
  assert.equal(cell.xDriveTakeBaiduCellViewerReturn(owner,1004).anchorNodeID,411)
  assert.equal(viewport.xDriveTakeBaiduViewportViewerReturn(owner,1004).anchorNodeID,411)
  assert.equal(cell.xDriveTakeBaiduCellViewerReturn(owner,1005),undefined)
  assert.equal(viewport.xDriveTakeBaiduViewportViewerReturn(owner,1005),undefined)
  assert.equal(visual.xDriveReadBaiduMapVisualScope(foreign,1005),undefined)
  assert.equal(cameraState.xDriveReadBaiduNativeCamera(foreign,1005),undefined)
  clear()
})
test('Owner/filter/date/camera/tab switches reject late one-use scope handoff',async()=>{
  const issued={ownerScope:owner,photoScopeKey:mapScope.xDriveBaiduMapPhotoScopeKey(scope),
    routeHref:href,camera}
  const differentScope=filter=>mapScope.xDriveBaiduMapPhotoScopeKey({
    ...scope,filters:{...scope.filters,...filter}})
  for(const changed of [
    {...issued,ownerScope:foreign},
    {...issued,photoScopeKey:differentScope({favorite:false})},
    {...issued,photoScopeKey:differentScope({captured_from:'2026-09-01'})},
    {...issued,photoScopeKey:differentScope({captured_to:'2026-12-01'})},
    {...issued,photoScopeKey:differentScope({asset_kind:'video'})},
    {...issued,photoScopeKey:differentScope({sort_by:'added'})},
    {...issued,photoScopeKey:differentScope({time_zone:'UTC'})},
    {...issued,photoScopeKey:mapScope.xDriveBaiduMapPhotoScopeKey({
      ...scope,albumKey:'manual:Other',
    })},
    {...issued,camera:{...camera,zoom:13}}, {...issued,camera:null},
    {...issued,routeHref:'https://maps.xdrive.example/#/app/files'},
  ])assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(issued,changed),false)
  const ctl=new AbortController()
  let fulfill
  const queued=new Promise(resolve=>{fulfill=resolve})
  const result=lifecycle.xDrivePlacesRequestWithDeadline(queued,ctl.signal,500)
  ctl.abort()
  await assert.rejects(result,/places-request-cancelled/)
  fulfill('stale Owner signed grant')
  await Promise.resolve()
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,1001,false),false)
  assert.equal(lifecycle.xDrivePlacesHandoffTimeValid(1000,16000,true),false)
})
test('Owner logout/switch clears even an already-marked Viewer return and old camera',()=>{
  clear()
  assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,scope,1000),true)
  assert.equal(cameraState.xDriveRememberBaiduNativeCamera(owner,camera,1000),true)
  assert.equal(cell.xDriveRememberBaiduCellReturn(owner,{selection,sort,photoScope:scope},1000),true)
  assert.equal(cell.xDriveMarkBaiduCellViewerReturn(owner,411,1,1001),true)
  assert.equal(cell.xDriveTakeBaiduCellViewerReturn(foreign,1002),undefined)
  visual.xDriveClearBaiduMapVisualScope(owner)
  cameraState.xDriveClearBaiduNativeCamera(owner)
  cell.xDriveClearBaiduCellReturn(owner)
  assert.equal(visual.xDriveReadBaiduMapVisualScope(owner,1003),undefined)
  assert.equal(cameraState.xDriveReadBaiduNativeCamera(owner,1003),undefined)
  assert.equal(cell.xDriveTakeBaiduCellViewerReturn(owner,1003),undefined)
  clear()
})


// Full-document mode switches must not reuse a previous one-use scope ticket,
// while already-authorized filters/camera remain a trusted Owner-only hint.
test('isolated/prototype mode URL roundtrip retires old one-use handoff',()=>{
  const token='f'.repeat(64)
  const ticket=mode.xDrivePlacesMapScopeHandoffURL(href,'isolated',token)
  assert.ok(ticket)
  assert.equal(mode.xDrivePlacesMapModeFromHref(ticket),'isolated')
  assert.equal(new URL(ticket).searchParams.get('places_map_scope_required'),'1')
  assert.equal(mode.xDrivePlacesMapScopeHandoffURL(ticket,'prototype',token),null,
    'a second untrusted map ticket cannot overwrite the first')
  const prototype=mode.xDrivePlacesMapModeNavigationURL(ticket,'prototype')
  assert.ok(prototype)
  assert.equal(mode.xDrivePlacesMapModeFromHref(prototype),'prototype')
  assert.equal(new URL(prototype).searchParams.has('places_map_handoff'),false)
  assert.equal(new URL(prototype).searchParams.has('places_map_scope_required'),false)
  const reroute=mode.xDrivePlacesMapScopeHandoffURL(prototype,'isolated',token)
  assert.ok(reroute)
  assert.equal(new URL(reroute).searchParams.has('places_map_handoff'),true)
  for(const value of [owner,scope.albumKey,scope.filters.time_zone,String(camera.latitude)])
    assert.equal(ticket.includes(value),false,'private map state stays outside URLs')
})

test('one-use Owner PhotoScope survives mode-only navigation but fails closed on Back/Forward, reload and logout',()=>{
  for(const target of ['prototype','isolated']){
    clear()
    assert.equal(visual.xDriveRememberBaiduMapVisualScope(owner,scope,1000),true)
    assert.equal(cameraState.xDriveRememberBaiduNativeCamera(owner,camera,1000),true)
    assert.equal(cell.xDriveRememberBaiduCellReturn(owner,
      {selection,sort,photoScope:scope},1000),true)
    assert.equal(viewport.xDriveRememberBaiduViewportReturn(owner,
      {bounds,sort,photoScope:scope},1000),true)
    const nonce='e'.repeat(64)
    const from=mode.xDrivePlacesMapScopeHandoffURL(href,target,nonce)
    assert.ok(from)
    const stack=[from]
    let position=0
    const location={href:from,origin:new URL(from).origin}
    const history={
      state:{xdriveHistoryIndex:17},
      replaceState(state,_title,url){
        assert.equal(state.xdriveHistoryIndex,17)
        this.state=state
        location.href=String(url)
        stack[position]=location.href
      },
      pushState(state,_title,url){
        this.state=state
        position++
        stack.splice(position)
        stack.push(new URL(String(url),location.href).href)
        location.href=stack[position]
      },
      back(){if(position>0)position--;location.href=stack[position]},
      forward(){if(position<stack.length-1)position++;location.href=stack[position]},
    }
    const browser={location,history}
    assert.deepEqual(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser),
      {state:'pending',ticket:nonce,target})
    const scrubbed=location.href
    assert.ok(!scrubbed.includes(nonce) &&
      new URL(scrubbed).searchParams.get('places_map_scope_required')==='1')
    // The private visual state stays Owner-only. A one-use ticket is not
    // re-minted merely by revisiting the saved history entry.
    assert.deepEqual(visual.xDriveReadBaiduMapVisualScope(owner,1002),scope)
    assert.deepEqual(cameraState.xDriveReadBaiduNativeCamera(owner,1002),camera)
    assert.equal(visual.xDriveReadBaiduMapVisualScope(foreign,1002),undefined)
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    const unrelated=new URL(location.href)
    unrelated.hash='#/app/files'
    history.pushState(history.state,'',unrelated.href)
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    history.back()
    assert.equal(location.href,scrubbed)
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    history.forward()
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    // Mark a live, signed Viewer selection before logout; the old Owner
    // cannot reuse it after switching routes or Browser history.
    assert.equal(cell.xDriveMarkBaiduCellViewerReturn(owner,411,1,1002),true)
    assert.equal(viewport.xDriveMarkBaiduViewportViewerReturn(owner,411,1,1002),true)
    // Owner logout invalidates EVERY private visual return pointer. A stale
    // browser history entry cannot authorize an old Viewer or camera.
    clear()
    assert.equal(visual.xDriveReadBaiduMapVisualScope(owner,1003),undefined)
    assert.equal(cameraState.xDriveReadBaiduNativeCamera(owner,1003),undefined)
    assert.equal(cell.xDriveTakeBaiduCellViewerReturn(owner,1003),undefined)
    assert.equal(viewport.xDriveTakeBaiduViewportViewerReturn(owner,1003),undefined)
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    // Only the explicit user abandon action may remove the nonsecret
    // restriction marker; it never resurrects any old Owner permission.
    assert.equal(historyBootstrap.xDriveAbandonMapScopeRequired(browser),true)
    assert.equal(historyBootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'none')
  }
})
