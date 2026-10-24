'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const load=(file,inject={})=>{
  const filename=path.join(root,file)
  const transpiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    fileName:filename,reportDiagnostics:true,compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,
    }})
  assert.deepEqual((transpiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const m=new Module(filename,module)
  m.filename=filename
  m.paths=Module._nodeModulePaths(path.join(root,'desktop'))
  const orig=m.require.bind(m)
  m.require=id=>Object.hasOwn(inject,id)?inject[id]:orig(id)
  m._compile(transpiled.outputText,filename)
  return m.exports
}
const mode=load('ui/shared/src/media-gallery-places-map-mode.ts')
const bootstrap=load('web/src/mapScopeHandoff.ts',{
  '../../ui/shared/src/media-gallery-places-map-mode':mode,
})
const T='0123456789abcdef'.repeat(4)

function win(href,stripOK=true){
  const obj={location:{href,origin:new URL(href).origin},removed:[]}
  obj.history={state:{xdriveHistoryIndex:4},replaceState(state,title,url){
    if(!stripOK)throw Error('history not authorized')
    assert.equal(state.xdriveHistoryIndex,4)
    obj.removed.push(url)
    obj.location.href=url
  }}
  return obj
}

test('P0-4 canonical map URL carries only an opaque random hint',()=>{
  const from='https://gallery.example.org/?search=ok#/app/gallery?section=places'
  const next=mode.xDrivePlacesMapScopeHandoffURL(from,'isolated',T)
  assert.ok(next)
  const url=new URL(next)
  assert.equal(url.searchParams.get('places_map_mode'),'isolated')
  assert.equal(url.searchParams.get('places_map_handoff'),T)
  assert.equal(url.searchParams.get('places_map_scope_required'),'1')
  assert.equal(url.hash,'#/app/gallery?section=places')
  for(const secret of ['manual:Summer','favorite','owner_id','wgs84','JWT'])
    assert.equal(next.includes(secret),false)
  assert.equal(mode.xDrivePlacesMapScopeHandoffURL(from,'isolated','token=secret'),null)
  assert.equal(mode.xDrivePlacesMapScopeHandoffURL('http://gallery.example.org','isolated',T),null)
  assert.equal(mode.xDrivePlacesMapScopeHandoffURL('file:///gallery','isolated',T),null)
  assert.equal(mode.xDrivePlacesMapScopeHandoffURL(next,'prototype',T),null)
  const back=mode.xDrivePlacesMapScopeHandoffURL(from,'prototype',T)
  assert.ok(back)
  assert.equal(new URL(back).searchParams.has('places_map_mode'),false)
})

test('P0-4 document bootstrap strips the hint before third-party SDK creation',()=>{
  for(const to of ['prototype','isolated']){
    const href=mode.xDrivePlacesMapScopeHandoffURL(
      'https://gallery.example.org/#/app/gallery?section=places',to,T)
    const browser=win(href)
    const result=bootstrap.xDriveTakeMapScopeHandoffFromURL(browser)
    assert.deepEqual(result,{state:'pending',ticket:T,target:to})
    assert.equal(browser.removed.length,1)
    assert.ok(!browser.location.href.includes(T))
    assert.ok(!browser.location.href.includes('places_map_handoff'))
    // After the one-use hint was scrubbed, forced refresh must still refuse
    // silently resetting to the full gallery. Only an explicit abandon can.
    assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    assert.equal(bootstrap.xDriveAbandonMapScopeRequired(browser),true)
    assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'none')
  }
})
test('P0-4 duplicate/invalid/cross-origin/rewrite denial is fail-closed',()=>{
  const clean='https://gallery.example.org/?places_map_mode=isolated'
  for(const href of [
    clean+'&places_map_handoff=garbage',
    clean+'&places_map_handoff='+T+'&places_map_handoff='+T,
    clean+'&places_map_handoff='+T+'&places_map_mode=prototype',
    'http://gallery.example.org/?places_map_handoff='+T,
  ]){
    const browser=win(href)
    assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state,'denied')
    assert.ok(browser.removed.length>0)
    assert.ok(!browser.location.href.includes('places_map_handoff'))
  }
  const b=win(clean+'&places_map_handoff='+T+'&places_map_scope_required=1',false)
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(b).state,'denied')
  const stale=win(clean+'&places_map_scope_required=1')
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(stale).state,'denied')
  const duplicate=win(clean+'&places_map_scope_required=1&places_map_scope_required=1')
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(duplicate).state,'denied')
  assert.equal(bootstrap.xDriveAbandonMapScopeRequired(win(clean+'&places_map_scope_required=1',false)),false)
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(win(clean)).state,'none')
})

test('P0-4 Web/Mobile page gates render until redeemed, preserves filters and Owner',()=>{
  const html=fs.readFileSync(path.join(root,'web/index.html'),'utf8')
  assert.match(html, /<meta name="referrer" content="no-referrer"/)
  assert.ok(html.indexOf('name="referrer"') < html.indexOf('<script type="module"'))
  const app=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
  assert.match(app,/const boundClaim=webMapScopeClaimRef.current/)
  const map=fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')
  const page=fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  const api=fs.readFileSync(path.join(root,'web/src/api.ts'),'utf8')
  const server=fs.readFileSync(path.join(root,'internal/api/baidu_map_scope_handoff.go'),'utf8')
  assert.match(app,/const initialWebMapScopeHandoff/)
  assert.match(app,/xDriveTakeMapScopeHandoffFromURL\(window\)/)
  assert.match(app,/webMapScopeHandoff\.state!=='none' && !webMapScopeOwnerReady/)
  assert.match(app,/initialMapPhotoScope=\{secureMapOwnerReady/)
  assert.match(app,/onMapModeHandoff=\{!window\.xdriveSecureMapBridge/)
  assert.match(app,/state:'ready',ownerID:profile.id,username:profile.username/)
  assert.match(app,/existing.ownerID!==profile.id/)
  assert.match(app,/existing.username!==profile.username/)
  assert.match(app,/existing.api!==api/)
  assert.match(app,/xDriveAbandonMapScopeRequired\(window\)/)
  assert.match(page,/onMapModeHandoff=\{onMapModeHandoff\}/)
  assert.match(map,/xDriveBaiduMapScopeSurvivesFullReload\(scope\)/)
  assert.match(map,/onMapModeHandoff\(scope, next, controller.signal,/)
  assert.match(app,/initialBaiduNativeCamera=\{webMapScopeOwnerReady/)
  assert.match(api,/mediaBaiduMapScopeHandoffIssue/)
  assert.match(api,/mediaBaiduMapScopeHandoffConsume/)
  for(const contract of ['SessionVersion','RevocationEpoch','AlbumRevision',
    'currentBaiduJSAPI4OperatorRelease','Locking{Strength: "UPDATE"}',
    'consumed_at IS NULL','TargetMode']) assert.ok(server.includes(contract),contract)
  assert.doesNotMatch(bootstrap.xDriveTakeMapScopeHandoffFromURL.toString(),/localStorage|sessionStorage/)
  assert.doesNotMatch(map,/localStorage|sessionStorage/)
})

test('P0-4 startup suppresses ticket Referer but restores origin-only SDK policy after scrub',()=>{
  const url=mode.xDrivePlacesMapScopeHandoffURL('https://gallery.example.org/#/app/gallery',
    'isolated',T)
  const browser=win(url)
  const policy={content:'no-referrer'}
  browser.document={querySelector:selector=>{
    assert.equal(selector,'meta[name="referrer"]')
    return policy
  }}
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser),false)
  assert.equal(policy.content,'no-referrer')
  const accepted=bootstrap.xDriveTakeMapScopeHandoffFromURL(browser)
  assert.equal(accepted.state,'pending')
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser),true)
  assert.equal(policy.content,'strict-origin-when-cross-origin')
  assert.ok(!browser.location.href.includes(T))
  const app=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
  assert.ok(app.indexOf('xDriveTakeMapScopeHandoffFromURL(window)')>=0)
  assert.ok(app.indexOf('xDriveTakeMapScopeHandoffFromURL(window)') <
    app.indexOf('xDriveRestoreMapReferrerAfterScrub(window)'))
})
