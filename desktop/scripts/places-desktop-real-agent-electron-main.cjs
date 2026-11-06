'use strict'
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {app,BrowserWindow,session}=require('electron')
const {privateLANOrigin,verifiedLANRootPEM}=require('../dist/main/lan_root_auto.cjs')
const {readTrustedPlacesLANPeerFingerprint,placesGuestIPRequestAllowed,verifyDesktopPlacesLANCertificate}=
  require('../dist/main/places_guest_lan_tls.cjs')
app.disableHardwareAcceleration()
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const deadline=(promise,ms,reason)=>Promise.race([
  promise,delay(ms).then(()=>{throw Error('timeout '+reason)}),
])
function readOnePrivateInput(){
  return new Promise((resolve,reject)=>{
    let body=''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data',chunk=>{
      body+=chunk
      if(body.length>12000){reject(Error('oversized private fixture input'));return}
      const idx=body.indexOf('\n')
      if(idx!==-1){
        process.stdin.pause()
        try{resolve(JSON.parse(body.slice(0,idx)))}
        catch{reject(Error('invalid private fixture input'))}
      }
    })
    process.stdin.once('end',()=>reject(Error('missing private test input')))
  })
}
async function check(){
  // The fixture ticket/CA arrive in a short-lived private pipe, never CLI args,
  // URL, localStorage or a printed CI artifact.
  const input=await deadline(readOnePrivateInput(),10000,'test-only pipe')
  const origin=input.origin, target=privateLANOrigin(origin)
  const ca=verifiedLANRootPEM(input.ca)
  assert.ok(target&&ca&&input.owner==='desktop-map-e2e-owner'&&
    typeof input.ticket==='string'&&/^[a-f0-9]{64}$/.test(input.ticket),
    'invalid trusted synthetic server or native one-use ticket')
  const pin={server:origin,username:input.owner,domain:'',
    source:'user-approved-lan',root_pem:input.ca,sha256:ca.sha256}
  const partition='xdrive-places-web-'+randomUUID()
  const isolated=session.fromPartition(partition,{cache:false})
  let current=true,verifications=0,blocked=0,allowedRequests=0
  const tlsDecisions=[]
  const observedCertCodes=[]
  isolated.setPermissionRequestHandler((_guest,_permission,callback)=>callback(false))
  isolated.setPermissionCheckHandler(()=>false)
  isolated.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=current&&placesGuestIPRequestAllowed(details.url,origin)
    if(!allowed)blocked++
    else allowedRequests++
    callback({cancel:!allowed})
  })
  isolated.setCertificateVerifyProc((request,callback)=>{
    verifications++
    // Record only numeric TLS verification codes and hostname match. Never
    // log certificate bytes, signed URLs or the Owner's browser secret.
    observedCertCodes.push({
      errorCode:request.errorCode,
      hostnameMatched:request.hostname===target.ip,
      pemPresent:typeof request.certificate?.data==='string',
    })
    void verifyDesktopPlacesLANCertificate(request,pin,origin,()=>current)
      .then(code=>{tlsDecisions.push(code);callback(code)},()=>{
        tlsDecisions.push(-2);callback(-2)
      })
  })
  // Actual Electron network service redeems the *real Agent/PG* ticket and
  // receives a real server-issued HttpOnly browser refresh Cookie.
  const endpoint=origin+'/api/v1/auth/desktop-map/redeem'
  const opts={method:'POST',credentials:'include',redirect:'error',cache:'no-store',
    headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({ticket:input.ticket})}
  const nativePeer=await readTrustedPlacesLANPeerFingerprint(
    target.ip,target.port,input.ca)
  assert.ok(nativePeer,'strict Node TLS/CA/IP-SAN preflight could not verify synthetic HTTPS server')
  // The real Electron network service must accept the *same* peer that the
  // native pin validation accepts. No TLS bypass or substitute Node POST.
  let redeemed
  try{
    redeemed=await deadline(isolated.fetch(endpoint,opts),20000,'one-use native exchange')
  }catch(error){
    throw Error('real Electron session.fetch redemption failed: '+
      String(error?.code||error?.message||'network')+
      ' allowed='+allowedRequests+' blocked='+blocked+
      ' certChecks='+verifications+
      ' certErrors='+JSON.stringify(observedCertCodes.slice(0,5))+
      ' certDecisions='+JSON.stringify(tlsDecisions.slice(0,5))+
      ' strictNodePeer=true')
  }
  assert.equal(redeemed.status,200)
  const receipt=await redeemed.json()
  assert.equal(receipt.username,input.owner)
  assert.equal(receipt.browser_session,true)
  assert.equal(receipt.refresh_token,'')
  assert.ok(typeof receipt.access_token==='string'&&receipt.access_token.length>20)
  const before=await isolated.cookies.get({url:origin,name:'__Host-xdrive_refresh'})
  assert.equal(before.length,1)
  assert.ok(before[0].httpOnly&&before[0].secure)
  const replay=await isolated.fetch(endpoint,opts)
  assert.equal(replay.status,401,'same ticket was redeemed twice')
  const after=await isolated.cookies.get({url:origin,name:'__Host-xdrive_refresh'})
  assert.equal(after.length,1)
  assert.equal(after[0].value,before[0].value,'replay rotated valid browser Cookie')
  const foreign=await isolated.fetch(origin+'/api/v1/auth/desktop-map/session',{
    method:'POST',credentials:'include',redirect:'error',cache:'no-store',
    headers:{Origin:'https://evil.example.invalid',
      'X-XDrive-Browser-Owner':input.owner}
  })
  assert.equal(foreign.status,403,'foreign Origin reused Owner Cookie')
  const host=new BrowserWindow({show:true,width:900,height:600,webPreferences:{
    webviewTag:true,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true
  }})
  try{
    let attached=0
    host.webContents.on('will-attach-webview',(event,prefs,params)=>{
      attached++
      if(params.partition!==partition||params.src!==origin+'/__fixture/map'){
        event.preventDefault();return
      }
      prefs.sandbox=true
      prefs.nodeIntegration=false
      prefs.contextIsolation=true
      prefs.webSecurity=true
      delete prefs.preload
    })
    const promise=new Promise((resolve,reject)=>{
      host.webContents.on('did-attach-webview',(_event,guest)=>{
        guest.once('did-finish-load',()=>resolve(guest))
        guest.on('did-fail-load',(_event,code,description,_url,mainFrame)=>{
          if(mainFrame)reject(Error('real guest failed '+code+' '+description))
        })
      })
    })
    const html='<!doctype html><html><body><webview partition="'+partition+
      '" src="'+origin+'/__fixture/map" style="display:block;width:800px;height:500px">'+
      '</webview></body></html>'
    await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
    const guest=await deadline(promise,20000,'actual HTTPS sandboxed Electron WebView')
    assert.equal(attached,1)
    assert.equal(guest.session,isolated)
    const state=await guest.executeJavaScript(
      '({mounted:!!document.querySelector("[data-xdrive-test-only-map]"),'+
      'cookie:document.cookie,native:typeof window.xdriveDesktop,href:location.href})')
    assert.equal(state.mounted,true)
    assert.equal(state.native,'undefined')
    assert.ok(!state.cookie.includes('__Host-xdrive_refresh'))
    assert.ok(!state.href.includes(input.ticket))
    const script='(async()=>{'+
      'const refreshed=await fetch("/api/v1/auth/browser/refresh",{method:"POST",'+
      'credentials:"include",cache:"no-store",'+
      'headers:{"X-XDrive-Browser-Owner":'+JSON.stringify(input.owner)+'}});'+
      'if(refreshed.status!==200)return {status:refreshed.status};'+
      'const session=await refreshed.json();'+
      'if(session.refresh_token!==""||!session.browser_session)'+
      'return {error:"invalid browser session"};'+
      'const result=await fetch("/api/v1/me",{cache:"no-store",'+
      'headers:{Authorization:"Bearer "+session.access_token}});'+
      'return {status:result.status,owner:result.status===200?'+
      '(await result.json()).username:null};})()'
    const owner=await guest.executeJavaScript(script)
    assert.deepEqual(owner,{status:200,owner:input.owner},
      'actual Chromium Cookie could not authorize exact Gin/PostgreSQL Owner')
    const probe=await isolated.fetch(origin+'/api/v1/auth/desktop-map/session',{
      method:'POST',credentials:'include',redirect:'error',cache:'no-store',
      headers:{Origin:origin,'X-XDrive-Browser-Owner':input.owner}
    })
    assert.equal(probe.status,200)
    const checked=await probe.json()
    assert.equal(checked.username,input.owner)
    assert.equal(checked.browser_session,true)
    assert.equal(checked.refresh_token,undefined)
    assert.ok(verifications>=1,'real Chromium TLS verifier did not run')
    console.log('XDRIVE_REAL_AGENT_ELECTRON_MAP '+JSON.stringify({
      passed:true,actualGoAgent:true,actualGinPostgres:true,
      actualElectronWebView:true,nativeTicketOneUse:true,
      secureHttpOnlyCookie:true,exactOwner:true,
      rejectedReplayAndForeignOrigin:true,syntheticMapPage:true,
      callbacks:verifications,blocked,partitionEphemeral:true
    }))
  }finally{
    current=false
    if(!host.isDestroyed())host.destroy()
    await isolated.closeAllConnections().catch(()=>{})
    await isolated.clearStorageData({storages:['cookies','localstorage']}).catch(()=>{})
  }
}
const guard=setTimeout(()=>{console.error('actual Agent/Electron test timed out');app.exit(1)},105000)
app.whenReady().then(check).then(()=>{clearTimeout(guard);app.exit(0)},error=>{
  clearTimeout(guard)
  console.error('actual Agent/Electron test failed: '+String(error?.stack||error))
  app.exit(1)
})
