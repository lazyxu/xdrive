'use strict'
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const net=require('node:net')
const tls=require('node:tls')
const https=require('node:https')
const {spawnSync}=require('node:child_process')
const {randomUUID}=require('node:crypto')
const {app,BrowserWindow,session}=require('electron')
const {desktopPlacesSelectedRoute,createDesktopPlacesPinnedRoute}=
  require('../dist/main/places_guest_connection_route.cjs')

const ip=process.env.XD_PLACES_SELECTED_IP || '10.233.15.17'
const domain='map-route.example.invalid'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const limit=(p,ms)=>Promise.race([p,delay(ms).then(()=>{throw Error('bounded Electron route timeout')})])
app.disableHardwareAcceleration()

function cmd(dir,args){
  const r=spawnSync('openssl',args,{cwd:dir,encoding:'utf8'})
  assert.equal(r.status,0,'local certificate fixture failed')
}
function cert(dir){
  cmd(dir,['req','-x509','-newkey','rsa:2048','-nodes','-days','2',
    '-subj','/CN=xDrive route test CA',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','root.key','-out','root.pem'])
  cmd(dir,['req','-new','-newkey','rsa:2048','-nodes',
    '-subj','/CN='+domain,'-keyout','leaf.key','-out','leaf.csr'])
  fs.writeFileSync(path.join(dir,'leaf.ext'),
    'basicConstraints=critical,CA:FALSE\n'+
    'keyUsage=critical,digitalSignature,keyEncipherment\n'+
    'extendedKeyUsage=serverAuth\n'+
    'subjectAltName=DNS:'+domain+'\n')
  cmd(dir,['x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key',
    '-CAcreateserial','-days','1','-out','leaf.pem','-extfile','leaf.ext'])
  return {ca:fs.readFileSync(path.join(dir,'root.pem'),'utf8'),
    key:fs.readFileSync(path.join(dir,'leaf.key'),'utf8'),
    cert:fs.readFileSync(path.join(dir,'leaf.pem'),'utf8')}
}
async function listen(server){
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,ip,()=>{server.off('error',reject);resolve()})
  })
  return server.address().port
}
function prohibitedCONNECT(route,authority){
  return limit(new Promise((resolve,reject)=>{
    const location=new URL(route.pacURL)
    const socket=net.connect({host:'127.0.0.1',port:Number(location.port)})
    let collected=''
    socket.once('connect',()=>{
      socket.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+
        '\r\nConnection: close\r\n\r\n')
    })
    socket.on('data',data=>{collected+=data.toString('latin1');if(collected.length>600)socket.destroy()})
    socket.once('close',()=>{
      if(collected.startsWith('HTTP/1.1 403'))resolve(true)
      else reject(Error('unrelated HTTPS CONNECT tunnel was not forbidden'))
    })
    socket.once('error',reject)
  }),3000)
}
async function secureCheck(port,ca){
  return limit(new Promise(resolve=>{
    const stream=tls.connect({host:ip,port,servername:domain,
      ca, rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{
        const good=stream.authorized
        stream.end();resolve(good)
      })
    stream.once('error',()=>resolve(false))
  }),5000)
}
async function check(){
  assert.equal(desktopPlacesSelectedRoute('https://'+domain+':443',ip)?.hostname,domain)
  for(const host of ['http://'+domain,'https://127.0.0.1',
    'https://localhost','https://'+domain+'/path',
    'https://'+domain+'?key=1']){
    assert.equal(desktopPlacesSelectedRoute(host,ip),null,'untrusted domain origin accepted')
  }
  for(const bad of ['127.0.0.1','169.254.0.1','invalid', '192.0.2.1']){
    assert.equal(desktopPlacesSelectedRoute('https://'+domain,bad),null,
      'unapproved IP destination accepted')
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-map-ip-route-'))
  let endpoint,route,host
  let allowed=true,checks=0,seenServerNames=[]
  try{
    const fixture=cert(dir)
    endpoint=https.createServer({key:fixture.key,cert:fixture.cert},(req,res)=>{
      seenServerNames.push(req.socket.servername||'')
      if(req.url==='/api/v1/version'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'})
        res.end(JSON.stringify({version:'selected-connection-ip',tlsSNI:req.socket.servername}))
        return
      }
      if(req.url==='/map'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',
          'Cache-Control':'no-store'})
        res.end('<!doctype html><html><body><main data-xdrive-selected-ip-map="1">'+
          'selected IP encrypted transport</main></body></html>')
        return
      }
      res.writeHead(404);res.end()
    })
    const port=await listen(endpoint)
    const origin='https://'+domain+':'+port
    route=await createDesktopPlacesPinnedRoute(origin,ip,()=>allowed)
    assert.ok(route.isActive())
    assert.equal(route.origin,origin)
    const chromium=session.fromPartition('xdrive-places-ip-'+randomUUID(),{cache:false})
    chromium.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false))
    chromium.setPermissionCheckHandler(()=>false)
    chromium.setCertificateVerifyProc((request,callback)=>{
      checks++
      if(request.hostname!==domain){callback(-3);return}
      // Test-only positive result AFTER strict CA+domain SAN and exact-IP TLS
      // verification, not an ignore-certificate-errors flag.
      void secureCheck(port,fixture.ca).then(ok=>callback(ok?-2: -2))
    })
    // The session is private. PAC selection must not affect system or
    // third-party provider URLs and must not permit a DIRECT fallback.
    await chromium.setProxy({mode:'pac_script',pacScript:route.pacURL})
    const serverProxy=await chromium.resolveProxy(origin+'/api/v1/version')
    const providerProxy=await chromium.resolveProxy('https://api.map.baidu.com/')
    assert.equal(serverProxy,route.proxyDirective)
    assert.equal(providerProxy,'DIRECT')
    assert.equal(await prohibitedCONNECT(route,domain+':'+(port+1)),true)
    assert.equal(await prohibitedCONNECT(route,'api.map.baidu.com:443'),true)
    assert.equal(await prohibitedCONNECT(route,'127.0.0.1:443'),true)

    // Verify a real Chromium network socket and DNS-less domain routing.
    // Certificate verify is intentionally strict on this private CA.
    chromium.setCertificateVerifyProc((request,callback)=>{
      checks++
      if(request.hostname!==domain){callback(-3);return}
      void secureCheck(port,fixture.ca).then(ok=>callback(ok?0:-2),()=>callback(-2))
    })
    const version=await limit(chromium.fetch(origin+'/api/v1/version',{
      method:'GET',cache:'no-store',redirect:'error'
    }),20000)
    assert.equal(version.status,200)
    const parsed=await version.json()
    assert.equal(parsed.version,'selected-connection-ip')
    assert.equal(parsed.tlsSNI,domain)
    host=new BrowserWindow({show:true,width:880,height:580,webPreferences:{
      webviewTag:true,contextIsolation:true,nodeIntegration:false,sandbox:true
    }})
    const loaded=new Promise((resolve,reject)=>{
      host.webContents.once('did-attach-webview',(_e,guest)=>{
        guest.once('did-finish-load',()=>resolve(guest))
        guest.once('did-fail-load',(_e,code)=>reject(Error('guest HTTPS failed '+code)))
      })
    })
    host.webContents.on('will-attach-webview',(event,prefs,params)=>{
      if(params.partition!==chromium.getStoragePath?.() && false){event.preventDefault()}
      prefs.sandbox=true;prefs.contextIsolation=true;prefs.nodeIntegration=false
    })
    const html='<!doctype html><html><body><webview partition="'+
      chromiumPartition+'" src="'+origin+'/map" style="width:800px;height:450px"></webview></body></html>'
    await host.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
    const guest=await limit(loaded,18000)
    assert.equal(guest.session,chromium)
    assert.equal(await guest.executeJavaScript(
      'document.querySelector("[data-xdrive-selected-ip-map]")!==null'),true)
    assert.equal(await guest.executeJavaScript('location.host'),domain+':'+port)
    assert.ok(seenServerNames.length>=2)
    assert.ok(seenServerNames.every(n=>n===domain))
    assert.ok(checks>=1)
    allowed=false
    route.close()
    await chromium.closeAllConnections()
    await assert.rejects(chromium.fetch(origin+'/api/v1/version',{
      method:'GET',cache:'no-store',redirect:'error',
      signal:AbortSignal.timeout(6000)
    }))
    console.log('XDRIVE_PLACES_SELECTED_IP_ROUTE '+JSON.stringify({
      passed:true,actualElectron:true,actualWebView:true,
      exactAgentIP:true,originalDomainSNI:true,chromiumTLS:true,
      dnsIndependent:true,providerDirect:true,foreignCONNECTDenied:true,
      revokedRouteDenied:true,callbacks:checks
    }))
  } finally {
    allowed=false
    route?.close()
    if(host&&!host.isDestroyed())host.destroy()
    if(endpoint)await new Promise(resolve=>endpoint.close(()=>resolve()))
    fs.rmSync(dir,{recursive:true,force:true})
  }
}
const chromiumPartition='xdrive-places-ip-'+randomUUID()
const guard=setTimeout(()=>app.exit(1),85000)
app.whenReady().then(check).then(()=>{clearTimeout(guard);app.exit(0)},err=>{
  clearTimeout(guard)
  console.error('selected-IP route E2E failed: '+String(err?.message||err))
  app.exit(1)
})
