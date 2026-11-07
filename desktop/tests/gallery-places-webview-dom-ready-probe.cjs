'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const ts=require('typescript')

const root=path.resolve(__dirname,'../..')
const source=fs.readFileSync(
  path.join(root,'ui/shared/src/desktop-places-embed-admission.ts'),'utf8')
const component=fs.readFileSync(
  path.join(root,'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')
const compiled=ts.transpileModule(source,{
  fileName:'desktop-places-embed-admission.ts',
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>
  x.category===ts.DiagnosticCategory.Error),[])
const sandbox={exports:{},module:{exports:{}},URLSearchParams,Promise}
vm.runInNewContext(compiled.outputText,sandbox)
const {xDriveStartDesktopPlacesGuestProbe:start,
  XDRIVE_DESKTOP_PLACES_GUEST_PROBE:script,
  xDriveDesktopPlacesGuestProbeState:decode}=sandbox.exports
const sdkSurface=fs.readFileSync(path.join(root,
  'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
function guestState({rootPresent=false,phase=null,unavailable=false,
  login=false,denied=false}={}){
  const sdk=phase===null?null:{
    getAttribute:key=>key==='data-xdrive-places-sdk-phase'?phase:null,
  }
  const page={querySelector:selector=>{
    if(selector==='[data-xdrive-baidu-isolated-photo-map]')return sdk
    if(selector==='[data-xdrive-baidu-map-unavailable]')return unavailable?{}:null
    return null
  }}
  const document={querySelector:selector=>{
    if(selector==='[data-xdrive-desktop-places-web-page]')
      return rootPresent?page:null
    if(selector==='#web-login-username')return login?{}:null
    if(selector==='[data-xdrive-desktop-places-auth-denied]')
      return denied?{}:null
    return null
  }}
  return vm.runInNewContext(script,{document})
}

test('real guest helper contains pre-dom-ready synchronous exception without unmounting React',async()=>{
  let mounted=false,attempts=0
  const guest={executeJavaScript:(query)=>{
    assert.equal(query,script)
    attempts++
    if(!mounted)throw Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.')
    return Promise.resolve('ready')
  }}
  assert.equal(start(guest,script),null)
  assert.equal(attempts,1)
  mounted=true
  assert.equal(decode(await start(guest,script)),'ready')
  assert.equal(attempts,2)
})
test('pending guest never authenticates or leaks native data',async()=>{
  assert.equal(start(null,script),null)
  assert.equal(start({},script),null)
  const navigation={executeJavaScript:()=>Promise.reject(Error('navigation in progress'))}
  await assert.rejects(start(navigation,script),/navigation/)
  assert.equal(decode('unknown'),'pending')
  assert.match(component,/xDriveStartDesktopPlacesGuestProbe\(\s*guest,XDRIVE_DESKTOP_PLACES_GUEST_PROBE\)/)
  assert.doesNotMatch(source,/native_refresh_token|desktopMapGuestGrant|Authorization: Bearer/)
})
 
test('black-screen regression: React root alone must never expose an empty WebView',()=>{
  assert.equal(guestState(), 'pending')
  assert.equal(guestState({rootPresent:true}), 'pending')
  assert.equal(guestState({rootPresent:true,phase:'loading'}), 'pending')
  assert.equal(guestState({rootPresent:true,phase:'ready'}), 'ready')
  assert.equal(guestState({rootPresent:true,phase:'unavailable'}), 'unavailable')
  assert.equal(guestState({rootPresent:true,unavailable:true}), 'unavailable')
  assert.equal(guestState({rootPresent:true,phase:'ready',login:true}), 'login')
  assert.equal(guestState({rootPresent:true,phase:'ready',denied:true}), 'denied')
  assert.equal(decode('unavailable'),'unavailable')
  assert.match(sdkSurface,/data-xdrive-places-sdk-phase=\{phase\}/)
  assert.match(component,/state==='unavailable'/)
  assert.match(component,/按 F12 查看地图 Console 和 Network/)
})
