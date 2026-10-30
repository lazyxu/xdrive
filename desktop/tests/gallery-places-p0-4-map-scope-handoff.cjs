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


test('P0-4 in-flight map handoff is fenced to the issued route, Owner, filter and BD09 camera',()=>{
  const original={ownerScope:'owner-a',photoScopeKey:'["manual:Trip",[["favorite",true]]]',
    routeHref:'https://gallery.example.org/?theme=dark#/app/gallery?section=places',
    camera:{coordinate_space:'bd09ll',latitude:35.5,longitude:139.5,zoom:11}}
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
    ...original,camera:{...original.camera},
  }),true)
  for (const changedRoute of [
    'https://gallery.example.org/?theme=dark#/app/files',
    'https://gallery.example.org/?theme=dark#/app/gallery?section=albums',
    'https://gallery.example.org/?theme=light#/app/gallery?section=places',
  ]) {
    assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
      ...original,routeHref:changedRoute,
    }),false,'hash/tab/query navigation invalidates the issued map ticket')
  }
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches({
    ...original,routeHref:'',
  },{...original,routeHref:''}),false,'missing original route cannot authorize navigation')
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
    ...original,ownerScope:'owner-b',
  }),false,'Owner switch invalidates an issued one-use ticket')
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
    ...original,photoScopeKey:'["",[]]',
  }),false,'filter/album change must not navigate to the former private scope')
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
    ...original,camera:{...original.camera,zoom:12},
  }),false,'gesture invalidates camera captured at ticket issuance')
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(original,{
    ...original,camera:null,
  }),false,'clearing camera invalidates a camera-bound ticket')
  const noCamera={...original,camera:null}
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(noCamera,{...noCamera}),true)
  assert.equal(mode.xDrivePlacesMapHandoffFenceMatches(noCamera,original),false)
  const map=fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')
  assert.match(map,/xDrivePlacesMapHandoffFenceMatches\(issuedFence/)
  assert.match(map,/cancelStaleHandoff\(\)/)
  assert.match(map,/currentHandoffOwnerScope, currentHandoffPhotoScopeKey/)
  assert.match(map,/priorCamera\.latitude !== camera\.latitude/)
  assert.match(map,/routeHref: window\.location\.href/)
  assert.match(map,/xDrivePlacesMapScopeHandoffURL\(issuedFence\.routeHref, next, ticket\)/)
  assert.equal((map.match(/routeHref: window\.location\.href/g)||[]).length,2)
  const issuedURL=mode.xDrivePlacesMapScopeHandoffURL(original.routeHref,'isolated',T)
  assert.equal(new URL(issuedURL).hash,'#/app/gallery?section=places')
  assert.ok(map.indexOf('xDrivePlacesMapHandoffFenceMatches(issuedFence') <
    map.indexOf('window.location.replace(url)'),
    'do not navigate with a stale issued ticket')
})

test('P0-4 Safari denied history.state still strips the map ticket before any SDK', () => {
  const href = mode.xDrivePlacesMapScopeHandoffURL(
    'https://gallery.example.org/?theme=dark#/app/gallery?section=places', 'isolated', T)
  const browser = win(href)
  let writes = 0
  Object.defineProperty(browser.history, 'state', { configurable: true,
    get() { throw Error('SecurityError: Safari denies History.state getter') },
  })
  browser.history.replaceState = (state, _title, url) => {
    assert.equal(state, null, 'unreadable history state is never fabricated')
    writes++
    browser.removed.push(url)
    browser.location.href = url
  }
  const policy = { content: 'no-referrer' }
  browser.document = { querySelector: () => policy }
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser), false,
    'ticket must not be disclosed as a third-party Referer before scrub')
  assert.deepEqual(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser), {
    state: 'pending', ticket: T, target: 'isolated',
  })
  assert.equal(writes, 1)
  assert.ok(!browser.location.href.includes(T))
  assert.match(browser.location.href, /places_map_scope_required=1/,
    'the restricted scope survives ticket redemption and browser reload')
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser), true)
  assert.equal(policy.content, 'strict-origin-when-cross-origin')
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied',
    'hard refresh cannot widen a restricted map into full Owner Library')
})

test('P0-4 unreadable History.state never overrides a denied nonce rewrite', () => {
  const href = mode.xDrivePlacesMapScopeHandoffURL(
    'https://gallery.example.org/#/app/gallery?section=places', 'prototype', T)
  const browser = win(href, false)
  Object.defineProperty(browser.history, 'state', {
    get() { throw Error('SecurityError: denied state getter') },
  })
  const policy = { content: 'no-referrer' }
  browser.document = { querySelector: () => policy }
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied')
  assert.equal(browser.removed.length, 0)
  assert.ok(browser.location.href.includes(T),
    'unscrubbed ticket is still present, so the early HTML no-referrer rule must remain')
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser), false)
  assert.equal(policy.content, 'no-referrer')
  assert.equal(bootstrap.xDriveAbandonMapScopeRequired(browser), false,
    'even user-initiated abandonment cannot claim success when History rewrite is denied')
})

test('P0-4 invalid duplicate ticket is scrubbed even with denied History.state', () => {
  const href = mode.xDrivePlacesMapScopeHandoffURL(
    'https://gallery.example.org/#/app/gallery', 'prototype', T)
  const duplicate = new URL(href)
  duplicate.searchParams.append('places_map_handoff', T)
  const browser = win(duplicate.href)
  Object.defineProperty(browser.history, 'state', {
    get() { throw Error('SecurityError: denied state getter') },
  })
  browser.history.replaceState = (state, _title, url) => {
    assert.equal(state, null)
    browser.removed.push(url)
    browser.location.href = url
  }
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied')
  assert.equal(browser.removed.length, 1)
  assert.ok(!browser.location.href.includes(T))
  assert.match(browser.location.href, /places_map_scope_required=1/)
})

test('P0-4 explicit abandon handles denied History.state without downgrading rewrite security', () => {
  const href = 'https://gallery.example.org/?places_map_scope_required=1&theme=dark#/app/gallery'
  const browser = win(href)
  Object.defineProperty(browser.history, 'state', {
    get() { throw Error('SecurityError: denied state getter') },
  })
  browser.history.replaceState = (state, _title, url) => {
    assert.equal(state, null)
    browser.removed.push(url)
    browser.location.href = url
  }
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied')
  assert.equal(bootstrap.xDriveAbandonMapScopeRequired(browser), true)
  assert.equal(browser.removed.length, 1)
  assert.ok(!browser.location.href.includes('places_map_scope_required'))
  assert.match(browser.location.href, /theme=dark/)
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'none',
    'only the explicit abandon action may remove the required restricted scope')
})

test('P0-4 silent History.replaceState no-op never authorizes map ticket redemption', () => {
  const href = mode.xDrivePlacesMapScopeHandoffURL(
    'https://gallery.example.org/#/app/gallery', 'prototype', T)
  const browser = win(href)
  let calls = 0
  browser.history.replaceState = () => { calls++ } // A restricted browser adapter ignores URL mutation.
  const policy = { content: 'no-referrer' }
  browser.document = { querySelector: () => policy }
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied')
  assert.equal(calls, 1)
  assert.ok(browser.location.href.includes(T), 'one-use ticket remained visible')
  assert.equal(bootstrap.xDriveRestoreMapReferrerAfterScrub(browser), false)
  assert.equal(policy.content, 'no-referrer', 'unscrubbed ticket keeps the strict referrer shield')
})

test('P0-4 silent History.replaceState no-op never marks explicit map abandon successful', () => {
  const browser = win('https://gallery.example.org/?places_map_scope_required=1#/app/gallery')
  browser.history.replaceState = () => {}
  assert.equal(bootstrap.xDriveAbandonMapScopeRequired(browser), false)
  assert.match(browser.location.href, /places_map_scope_required=1/)
  assert.equal(bootstrap.xDriveTakeMapScopeHandoffFromURL(browser).state, 'denied')
})

test('real mounted two-host Gin browser rejects a pending map ticket when Parent route changes',()=>{
  const driver=fs.readFileSync(path.join(root,
    'desktop/scripts/gallery-places-dual-host-chromium.cjs'),'utf8')
  assert.match(driver,/async function testPendingMapHandoffRejectsChangedParentRoute\(/)
  assert.match(driver,/page\.route\('\*\*\/api\/v1\/media\/places\/baidu-jsapi\/scope-handoff'/)
  assert.match(driver,/history\.replaceState\(null,'',next\.href\)/)
  assert.match(driver,/next\.hash='#\/app\/files'/)
  assert.match(driver,/next\.searchParams\.set\('theme','dim'\)/)
  assert.match(driver,/after\.consumes===0/)
  assert.match(driver,/after\.reads===before\.reads/)
  assert.match(driver,/await testPendingMapHandoffRejectsChangedParentRoute\(browser,'inline',port\)/)
  assert.match(driver,/await testPendingMapHandoffRejectsChangedParentRoute\(browser,'isolated',port\)/)
})
