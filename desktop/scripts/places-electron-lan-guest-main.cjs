'use strict'
// Real Chromium/Electron Guest LAN TLS E2E. Synthetic CA/cookies only.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const https=require('node:https')
const {randomUUID,createHash,X509Certificate}=require('node:crypto')
const {spawnSync}=require('node:child_process')
const {app,BrowserWindow,session}=require('electron')
const {verifyDesktopPlacesLANCertificate,placesGuestIPRequestAllowed}
  =require('../dist/main/places_guest_lan_tls.cjs')
const {privateLANOrigin,verifiedLANRootPEM}
  =require('../dist/main/lan_root_auto.cjs')
const ip=process.env.XD_PLACES_TEST_LAN_IP||'10.233.15.9'
assert.ok(privateLANOrigin('https://'+ip),'CI requires a synthetic private IPv4')
app.disableHardwareAcceleration()
function cmd(dir,args) {
  const r=spawnSync('openssl',args,{cwd:dir,encoding:'utf8'})
  assert.equal(r.status,0,'openssl '+r.stderr)
}
function certs(dir) {
  cmd(dir,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-subj','/CN=xDrive synthetic Electron LAN root',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','root.key','-out','root.pem'])
  cmd(dir,['req','-new','-newkey','rsa:2048','-nodes',
    '-subj','/CN=xDrive synthetic Electron LAN leaf',
    '-keyout','leaf.key','-out','leaf.csr'])
  fs.writeFileSync(path.join(dir,'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\n'+
    'keyUsage=critical,digitalSignature,keyEncipherment\n'+
    'extendedKeyUsage=serverAuth\nsubjectAltName=IP:'+ip+'\n')
  cmd(dir,['x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key',
    '-CAcreateserial','-days','1','-out','leaf.pem','-extfile','leaf.ext'])
  const ca=fs.readFileSync(path.join(dir,'root.pem'),'utf8')
  const cert=fs.readFileSync(path.join(dir,'leaf.pem'),'utf8')
  const key=fs.readFileSync(path.join(dir,'leaf.key'),'utf8')
  assert.ok(verifiedLANRootPEM(ca))
  return {ca,cert,key,sha256:createHash('sha256').update(new X509Certificate(ca).raw).digest('hex')}
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const deadline=(promise,ms,label)=>Promise.race([
  promise,delay(ms).then(()=>{throw Error('timeout '+label)}),
])
async function listen(server) {
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,ip,resolve)
  })
  return server.address().port
}
async function check() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-map-real-electron-'))
  const windows=[],servers=[]
  try {
    const fixture=certs(dir)
    const hits={map:0,version:0,cookie:0,alt:0,bearer:0}
    const main=https.createServer({key:fixture.key,cert:fixture.cert},(req,res)=>{
      if(req.headers.authorization)hits.bearer++
      if(req.url==='/map'){
        hits.map++
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store',
          'Set-Cookie':'__Host-xdrive_refresh=synthetic-only; Path=/; Secure; HttpOnly; SameSite=Strict'})
        res.end('<!doctype html><html><body><div id="synthetic-private-map">ready</div></body></html>')
      }else if(req.url==='/api/v1/version'){
        hits.version++
        if(String(req.headers.cookie||'').includes('__Host-xdrive_refresh=synthetic-only'))
          hits.cookie++
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'})
        res.end('{"version":"synthetic-https"}')
      }else {res.writeHead(404);res.end()}
    })
    servers.push(main)
    const origin='https://'+ip+':'+await listen(main)
    assert.equal(privateLANOrigin(origin).origin,origin)
    const other=https.createServer({key:fixture.key,cert:fixture.cert},(_req,res)=>{
      hits.alt++;res.writeHead(200);res.end('denied')
    })
    servers.push(other)
    const alt='https://'+ip+':'+await listen(other)+'/trap'
    const pin={server:origin,username:'test-owner',domain:'',
      source:'user-approved-lan',root_pem:fixture.ca,sha256:fixture.sha256}
    const part='xdrive-places-web-'+randomUUID()
    const scoped=session.fromPartition(part,{cache:false})
    let trusted=true,verifies=0,blocked=0
    scoped.setPermissionRequestHandler((_sender,_permission,cb)=>cb(false))
    scoped.setPermissionCheckHandler(()=>false)
    scoped.webRequest.onBeforeRequest((details,cb)=>{
      const allow=trusted&&placesGuestIPRequestAllowed(details.url,origin)
      if(!allow)blocked++
      cb({cancel:!allow})
    })
    scoped.setCertificateVerifyProc((request,cb)=>{
      verifies++
      void verifyDesktopPlacesLANCertificate(request,pin,origin,()=>trusted)
        .then(cb,()=>cb(-2))
    })
    const host=new BrowserWindow({show:true,width:850,height:540,
      webPreferences:{webviewTag:true,sandbox:true,nodeIntegration:false,
        contextIsolation:true,webSecurity:true}})
    windows.push(host)
    let attach=0
    host.webContents.on('will-attach-webview',(event,prefs,params)=>{
      attach++
      if(params.partition!==part||params.src!==origin+'/map'){
        event.preventDefault();return
      }
      prefs.nodeIntegration=false
      prefs.contextIsolation=true
      prefs.sandbox=true
      prefs.webSecurity=true
      delete prefs.preload
    })
    const guestReady=new Promise((resolve,reject)=>{
      host.webContents.on('did-attach-webview',(_event,guest)=>{
        guest.once('did-finish-load',()=>resolve(guest))
        guest.on('did-fail-load',(_e,code,description,_url,mainFrame)=>{
          if(mainFrame)reject(Error('guest navigation failed '+code+' '+description))
        })
      })
    })
    const html='<!doctype html><html><body><webview partition="'+part+
      '" src="'+origin+'/map" style="display:block;width:780px;height:450px"></webview></body></html>'
    await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
    const guest=await deadline(guestReady,25000,'real webview HTTPS mount')
    assert.equal(attach,1)
    assert.equal(guest.getURL(),origin+'/map')
    assert.equal(guest.session,scoped)
    const state=await guest.executeJavaScript(
      '({mounted:!!document.getElementById("synthetic-private-map"),'+
      'nativeAPI:typeof window.xdriveDesktop,documentCookie:document.cookie})')
    assert.equal(state.mounted,true)
    assert.equal(state.nativeAPI,'undefined')
    assert.equal(state.documentCookie.includes('__Host-xdrive_refresh'),false)
    const cookies=await scoped.cookies.get({url:origin,name:'__Host-xdrive_refresh'})
    assert.equal(cookies.length,1)
    assert.ok(cookies[0].httpOnly&&cookies[0].secure)
    const data=await guest.executeJavaScript(
      'fetch("/api/v1/version",{credentials:"include",cache:"no-store"})'+
      '.then(r=>r.json()).then(x=>x.version)')
    assert.equal(data,'synthetic-https')
    assert.equal(hits.cookie,1)
    const isolated=session.fromPartition('xdrive-places-web-'+randomUUID(),{cache:false})
    assert.equal((await isolated.cookies.get({url:origin,name:'__Host-xdrive_refresh'})).length,0)
    const altSucceeded=await guest.executeJavaScript(
      'fetch('+JSON.stringify(alt)+',{mode:"no-cors",cache:"no-store"})'+
      '.then(()=>true,()=>false)')
    assert.equal(altSucceeded,false)
    assert.equal(hits.alt,0)
    assert.ok(blocked>=1)
    async function expectUntrustedOrRevokedDenied(revoked){
      const alternateSession=session.fromPartition('xdrive-places-web-'+randomUUID(),{cache:false})
      if(revoked)alternateSession.setCertificateVerifyProc((request,cb)=>{
        void verifyDesktopPlacesLANCertificate(request,pin,origin,()=>false)
          .then(cb,()=>cb(-2))
      })
      const window=new BrowserWindow({show:false,webPreferences:{
        session:alternateSession,sandbox:true,nodeIntegration:false,
        contextIsolation:true,webSecurity:true}})
      windows.push(window)
      let succeeded=false
      try{await window.loadURL(origin+'/map');succeeded=true}catch{}
      assert.equal(succeeded,false,'an untrusted or revoked CA opened the private map')
      assert.equal((await alternateSession.cookies.get({url:origin,
        name:'__Host-xdrive_refresh'})).length,0)
    }
    await expectUntrustedOrRevokedDenied(false)
    await expectUntrustedOrRevokedDenied(true)
    const before=hits.version
    trusted=false
    const staleSent=await guest.executeJavaScript(
      'fetch("/api/v1/version",{credentials:"include",cache:"no-store"})'+
      '.then(()=>true,()=>false)')
    assert.equal(staleSent,false)
    assert.equal(hits.version,before)
    assert.equal(hits.bearer,0)
    assert.ok(verifies>=1)
    console.log('XDRIVE_REAL_ELECTRON_LAN_GUEST '+JSON.stringify({
      passed:true,actualElectron:true,actualWebView:true,privateHTTPS:true,
      syntheticCA:true,httpOnly:true,partitionIsolated:true,
      foreignPrivatePortBlocked:true,untrustedAndRevokedCARejected:true,
      retiredPartitionDenied:true,verifications:verifies,blockedRequests:blocked,
    }))
  }finally{
    for(const w of windows.reverse())if(!w.isDestroyed())w.destroy()
    for(const server of servers){
      server.closeAllConnections?.()
      await new Promise(resolve=>server.close(resolve))
    }
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
const watchdog=setTimeout(()=>{
  console.error('real Electron LAN test timed out')
  app.exit(1)
},90000)
app.whenReady().then(check).then(()=>{
  clearTimeout(watchdog);app.exit(0)
},err=>{
  clearTimeout(watchdog)
  console.error('real Electron LAN test FAILED: '+String(err?.stack||err))
  app.exit(1)
})
