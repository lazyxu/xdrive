'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
const file='desktop/src/main/baidu_map_scope_handoff.cts'
const compiled=ts.transpileModule(read(file),{
  fileName:file,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
const mod={exports:{}}
new Function('module','exports','require',compiled.outputText)(
  mod,mod.exports,()=>{throw Error('map scope contract must have no runtime dependencies')})
const {xDriveParseDesktopBaiduMapScope:normalize,xDriveDesktopBaiduMapClaimAllowed:claim}=mod.exports
const valid={albumKey:'manual:Family Trip',filters:{
  sort_by:'added',sort_dir:'asc',favorite:true,asset_kind:'video',
  captured_from:'2026-01-01',captured_to:'2026-12-31',time_zone:'Asia/Tokyo'}}
const clone=v=>JSON.parse(JSON.stringify(v))
const allowed={
  windowID:44,pendingWindowID:44,serverOrigin:'https://xdrive.example',
  currentOrigin:'https://xdrive.example',expectedUsername:'alice',
  agentUsername:'alice',authenticatedWebUsername:'alice',
  frameURL:'https://xdrive.example/?places_map_mode=isolated#/app/gallery?section=places',
  isMainFrame:true,now:1000,expiresAt:601000,
}
test('strict private Owner map scope accepts all current signed BD09 filters',()=>{
  assert.deepEqual(normalize(valid),valid)
  assert.deepEqual(normalize({albumKey:'',filters:{}}),
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}})
  assert.deepEqual(normalize({albumKey:'folder:Holiday',filters:{favorite:false}}),
    {albumKey:'folder:Holiday',filters:{sort_by:'captured',sort_dir:'desc',favorite:false}})
})
test('unknown private identity, raw WGS84, URL, object pollution and invalid map members fail closed',()=>{
  for(const extra of [{owner_id:3},{latitude:35},{longitude:139},{browser_ak:'secret'},
    {jwt:'a.b.c'},{node_id:2},{url:'https://evil.example'},{bbox:'0,1,2,3'},
    {fold_duplicates:true},{anchor_node_id:100},{sort_by:'arbitrary'},
    {sort_dir:'left'},{favorite:'true'},{asset_kind:'audio'},
    {captured_from:'2026-01-01\nX-Debug:true'},
    {time_zone:' '.repeat(129)}]) {
    const item=clone(valid)
    Object.assign(item.filters,extra)
    assert.equal(normalize(item),null,JSON.stringify(extra))
  }
  assert.equal(normalize({...valid,asset_id:3}),null)
  assert.equal(normalize({...valid,albumKey:'not-an-album'}),null)
  assert.equal(normalize({...valid,albumKey:'manual:'}),null)
  assert.equal(normalize({...valid,albumKey:'manual:'+'a'.repeat(550)}),null)
  assert.equal(normalize({...valid,filters:[]}),null)
  assert.equal(normalize(null),null)
  assert.equal(normalize(undefined),null)
})
test('Web Owner, Desktop Owner, exact HTTPS origin, top frame, active session, TTL and isolated mode all required',()=>{
  assert.equal(claim(allowed),true)
  for(const changed of [
    {windowID:3},{pendingWindowID:2},
    {authenticatedWebUsername:'bob'},{agentUsername:'bob'},
    {currentOrigin:'https://other.example'},{serverOrigin:'https://evil.example'},
    {isMainFrame:false},{now:601000},{expiresAt:1000},
    {frameURL:'http://xdrive.example/?places_map_mode=isolated#/app/gallery?section=places'},
    {frameURL:'https://xdrive.example/#/app/gallery?section=places'},
    {frameURL:'https://xdrive.example/?places_map_mode=prototype#/app/gallery?section=places'},
    {frameURL:'https://xdrive.example/?places_map_mode=isolated#/app/files'},
    {frameURL:'https://xdrive.example/?places_map_mode=isolated#/app/gallery?section=albums'},
    {frameURL:'https://xdrive.example/?places_map_mode=isolated&token=secret#/app/gallery?section=places'},
  ]) assert.equal(claim({...allowed,...changed}),false,JSON.stringify(changed))
})
test('source connects only dedicated preload to Main and trusted HTTPS Web Parent',()=>{
  const main=read('desktop/src/main/index.cts')
  const securePreload=read('desktop/src/preload/baidu_map_secure.cts')
  const web=read('web/src/App.tsx')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const desktop=read('desktop/src/renderer/App.tsx')
  assert.match(main,/secureBaiduMapHandoff = null/)
  assert.match(main,/desktop:consume-baidu-map-scope/)
  assert.match(main,/event.senderFrame === win.webContents.mainFrame/)
  assert.match(main,/status.username/)
  assert.match(main,/preload: path.join\(__dirname, '\.\.', 'preload', 'baidu_map_secure.cjs'\)/)
  assert.match(securePreload,/contextBridge.exposeInMainWorld\('xdriveSecureMapBridge'/)
  assert.doesNotMatch(securePreload,/agent:|\.getMedia|exec|readFile|token|cookie|secret/)
  assert.match(web,/void api.me\(\)/)
  assert.match(web,/const secureMapOwnerReady/)
  assert.match(web,/xDriveNormalizeBaiduMapPhotoScope\(result.data.scope\)/)
  assert.match(web,/data-xdrive-desktop-map-scope-unavailable/)
  assert.match(gallery,/onOpenSecureDesktopMap\(entry.scope\)/)
  assert.match(gallery,/initialMapPhotoScope/)
  assert.match(desktop,/window.xdriveDesktop.openBaiduMapSecure\(scope\)/)
  assert.doesNotMatch(main,/window\.location\.hash.*albumKey/)
})
