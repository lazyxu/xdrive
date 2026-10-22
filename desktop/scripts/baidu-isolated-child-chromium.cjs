#!/usr/bin/env node
'use strict'
// Actual controlled Chromium: two synthetic HTTPS sites and a malicious child.
// No production network, Baidu account, real GPS, JWT or user media.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const {spawn,execFileSync} = require('node:child_process')
const root=path.resolve(__dirname,'../..')
const read=name=>fs.readFileSync(path.join(root,'deploy/baidu-isolated-child',name),'utf8')
const galleryHost='gallery.example.net'
const childHost='map-isolated.example.org'
const browser=process.env.XDRIVE_BROWSER_EXECUTABLE||'/usr/bin/chromium'

function parentPageScript() {
  const parentOrigin=location.origin
  const childOrigin='https://map-isolated.example.org:'+location.port
  localStorage.setItem('test-private','PRIVATE_PARENT_SENTINEL')
  const iframe=document.createElement('iframe')
  iframe.setAttribute('sandbox','allow-scripts allow-same-origin')
  iframe.referrerPolicy='no-referrer'
  iframe.src=childOrigin+'/_xdrive_baidu_isolated/index.html'
  let ready=false,attack=null
  const done=()=>{
    if(!ready||!attack)return
    const ok=attack.dom===true&&attack.storage===true&&attack.cookie===true&&
      attack.fetch===true&&attack.navigationAttempted===true&&location.origin===parentOrigin
    document.body.dataset.proof=ok?'PASS':'FAIL'
  }
  window.addEventListener('message',event=>{
    if(event.origin!==childOrigin||event.source!==iframe.contentWindow)return
    if(event.data?.version===1&&event.data.kind==='ready'&&
      event.data.nonce==='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'){
      ready=true
      iframe.contentWindow.postMessage({version:1,generation:9,
        nonce:'a'.repeat(64),kind:'map-session',ticket:'b'.repeat(64)},childOrigin)
      done()
    }
    if(event.data?.kind==='adversarial-result'){attack=event.data.proof;done()}
  })
  iframe.addEventListener('load',()=>{
    iframe.contentWindow.postMessage({
      version:1,generation:9,
      nonce:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      kind:'cells',cells:[],
    },childOrigin)
  })
  document.body.appendChild(iframe)
}
function hostileChildScript() {
  const galleryOrigin='https://gallery.example.net:'+location.port
  const proof={dom:false,storage:false,fetch:false,cookie:false,navigationAttempted:false}
  // This attacker script is the *actual SDK Loader response*, executed after
  // Child-only ticket redemption, not a harmless script in a mock document.
  const Point=function(lng,lat){this.lng=lng;this.lat=lat}
  const Label=function(){this.setStyle=()=>{};this.addEventListener=()=>{};
    this.removeEventListener=()=>{}}
  const Map=function(){
    this.centerAndZoom=()=>{}
    this.addEventListener=()=>{}
    this.removeOverlay=()=>{}
    this.addOverlay=()=>{}
    this.getCenter=()=>new Point(116,39)
    this.getZoom=()=>9
    this.getBounds=()=>({getSouthWest:()=>new Point(115,38),
      getNorthEast:()=>new Point(117,40)})
  }
  window.BMap={Point,Label,Map}
  proof.cookie=!document.cookie.includes('XD_BMAP_SESSION') &&
    !document.cookie.includes('gallery-private')
  // A successful read is a failure even if its data happens to be absent.
  try {void parent.document.querySelector('#private-photo')}
  catch {proof.dom=true}
  try {void parent.localStorage.getItem('test-private')}
  catch {proof.storage=true}
  const done=()=>{
    proof.navigationAttempted=true
    // This is an ATTEMPT, not evidence of blocking. The independent
    // parent-side browser check must prove the URL remains unchanged after it.
    try {top.location.href=galleryOrigin+'/blocked-top-navigation'} catch {}
    parent.postMessage({kind:'adversarial-result',proof},galleryOrigin)
  }
  fetch(galleryOrigin+'/api/private',{credentials:'include'}).then(
    response=>response.text().then(
      ()=>{proof.fetch=false;done()},
      ()=>{proof.fetch=false;done()},
    ),
    ()=>{proof.fetch=true;done()},
  )
}
function runChrome(url) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-map-chrome-'))
  const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-proxy-server','--no-first-run','--ignore-certificate-errors',
    '--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+dir,
    '--host-resolver-rules=MAP '+galleryHost+' 127.0.0.1, MAP '+childHost+' 127.0.0.1',
    'about:blank']
  const chrome=spawn(browser,args,{env:{...process.env,NO_PROXY:'*',no_proxy:'*'}})
  let socket=null
  const work=async()=>{
    const port=await new Promise((resolve,reject)=>{
      let log='',resolved=false
      const timeout=setTimeout(()=>{if(!resolved){resolved=true;reject(Error('CDP timeout'))}},15000)
      chrome.stderr.on('data',chunk=>{
        if(resolved)return
        log+=chunk.toString()
        const match=/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log)
        if(match){resolved=true;clearTimeout(timeout);resolve(Number(match[1]))}
      })
      chrome.once('error',error=>{if(!resolved){resolved=true;clearTimeout(timeout);reject(error)}})
      chrome.once('exit',code=>{if(!resolved){resolved=true;clearTimeout(timeout);reject(Error('Chrome exit '+code))}})
    })
    const response=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})
    assert(response.ok,'CDP target creation failed')
    const target=await response.json()
    socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
    const awaiting=new Map()
    let next=0
    socket.onmessage=event=>{
      const message=JSON.parse(event.data)
      if(message.id&&awaiting.has(message.id)){
        const task=awaiting.get(message.id);awaiting.delete(message.id)
        if(message.error)task.reject(Error(message.error.message))
        else task.resolve(message.result)
      }
    }
    const call=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++next
      awaiting.set(id,{resolve,reject})
      socket.send(JSON.stringify({id,method,params}))
    })
    await call('Page.enable')
    await call('Runtime.enable')
    const navigation=await call('Page.navigate',{url})
    assert(!navigation.errorText,'HTTPS test navigation failed: '+navigation.errorText)
    for(let tries=0;tries<70;tries++){
      await new Promise(resolve=>setTimeout(resolve,160))
      const evaluation=await call('Runtime.evaluate',{
        expression:'({result:document.body?.dataset?.proof || null,origin:location.origin})',
        returnByValue:true,
      })
      const value=evaluation?.result?.value
      if(value?.result==='PASS'||value?.result==='FAIL'){
        // A sandboxed top navigation can be asynchronous. Confirm after the
        // attempted redirect has had time to commit, NOT merely upon an
        // attacker-supplied 'navigationAttempted' acknowledgement.
        await new Promise(resolve=>setTimeout(resolve,750))
        const after=await call('Runtime.evaluate',{
          expression:"({result:document.body?.dataset?.proof||null,origin:location.origin,pathname:location.pathname,privatePhoto:!!document.getElementById('private-photo')})",
          returnByValue:true,
        })
        const confirmed=after?.result?.value
        assert.equal(confirmed?.result,value.result,'attacker replaced the trusted parent document')
        assert.equal(confirmed?.origin,new URL(url).origin,'trusted parent Origin changed')
        assert.equal(confirmed?.pathname,'/','sandbox allowed a top-level navigation')
        assert.equal(confirmed?.privatePhoto,true,'trusted parent document was replaced')
        return {result:confirmed.result,origin:confirmed.origin}
      }
    }
    throw Error('Real Chromium did not complete parent-child malicious-source test')
  }
  return work().finally(async()=>{
    socket?.close()
    chrome.kill('SIGKILL')
    await new Promise(resolve=>{
      if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve()
      chrome.once('exit',resolve)
      setTimeout(resolve,1000)
    })
    try {fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:200})}catch{}
  })
}
async function main() {
  assert(fs.existsSync(browser),'real Chromium required')
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-map-tls-'))
  let server
  try {
    const key=path.join(tmp,'key.pem'),cert=path.join(tmp,'cert.pem')
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
      '-subj','/CN=gallery.example.net',
      '-addext','subjectAltName=DNS:'+galleryHost+',DNS:'+childHost,
      '-keyout',key,'-out',cert],{stdio:'ignore',timeout:10000})
    let galleryOrigin='',isolatedOrigin='',privateReads=0,childCookies=0,redeemed=0,sdkLoads=0
    // Exercise the actual optional Caddy template policy, not a separately
    // written approximation that could diverge from the deliverable.
    const policy=/^\s*Content-Security-Policy "([^"\n]+)"\s*$/m.exec(read('Caddyfile.example'))?.[1]
    assert(policy?.includes("connect-src 'self'"),'Caddy child CSP must block Parent API egress')
    assert(policy?.includes('frame-ancestors {$XD_BAIDU_GALLERY_ORIGIN}'),
      'Caddy child CSP must pin trusted parent')
    const childCSP=()=>policy.replace('{$XD_BAIDU_GALLERY_ORIGIN}',galleryOrigin)
    const galleryCSP=()=>[
      "default-src 'none'","script-src 'self'","frame-src "+isolatedOrigin,
      "connect-src 'self'","frame-ancestors 'none'",
    ].join('; ')
    server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
      const host=req.headers.host||'',url=req.url||''
      const parent=host===galleryHost+':'+server.address().port
      const child=host===childHost+':'+server.address().port
      if(!parent&&!child){res.writeHead(404).end();return}
      res.setHeader('Content-Security-Policy',parent?galleryCSP():childCSP())
      res.setHeader('Cache-Control','no-store')
      res.setHeader('Referrer-Policy','no-referrer')
      res.setHeader('X-Content-Type-Options','nosniff')
      if(child&&req.headers.cookie?.includes('gallery-private'))childCookies++
      if(parent&&(url==='/api/private'||url==='/blocked-top-navigation'))privateReads++
      if(parent&&url==='/'){
        res.setHeader('Set-Cookie','gallery-private=SENTINEL; Secure; HttpOnly; SameSite=Strict; Path=/')
        res.setHeader('Content-Type','text/html; charset=utf-8')
        res.end('<!doctype html><html><head><script defer src="/parent.js"></script></head><body><div id="private-photo">PARENT</div></body></html>')
      }else if(parent&&url==='/parent.js'){
        res.setHeader('Content-Type','application/javascript')
        res.end('('+parentPageScript.toString()+')();')
      }else if(parent&&url==='/api/private'){
        res.setHeader('Content-Type','text/plain')
        res.end('PRIVATE_API_SENTINEL')
      }else if(child&&url==='/_xdrive_baidu_isolated/index.html'){
        res.setHeader('Content-Type','text/html; charset=utf-8')
        res.end(read('index.html')
          .replace('REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN',galleryOrigin)
          )
      }else if(child&&url==='/_xdrive_baidu_isolated/child.js'){
        res.setHeader('Content-Type','application/javascript')
        res.end(read('child.js'))
      }else if(child&&url==='/_xdrive_baidu_isolated/session'){
        if(req.method!=='POST'){res.writeHead(405).end();return}
        let body=''
        req.on('data',chunk=>{body+=chunk.toString()})
        req.on('end',()=>{
          try{
            const input=JSON.parse(body)
            if(input.ticket!=='b'.repeat(64)||redeemed!==0){res.writeHead(403).end();return}
            redeemed++
            res.setHeader('Set-Cookie','XD_BMAP_SESSION=MAP_ONLY; Secure; HttpOnly; SameSite=None; Partitioned; Path=/_BMapService/')
            res.setHeader('Content-Type','application/json')
            res.end(JSON.stringify({provider:'baidu-jsapi-4.0',runtime_enabled:true}))
          }catch{res.writeHead(400).end()}
        })
      }else if(child&&url==='/_BMapService/api?v=4.0'){
        sdkLoads++
        res.setHeader('Content-Type','application/javascript')
        res.end('('+hostileChildScript.toString()+')();')
      }else res.writeHead(404).end()
    })
    await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',err=>err?reject(err):resolve()))
    galleryOrigin='https://'+galleryHost+':'+server.address().port
    isolatedOrigin='https://'+childHost+':'+server.address().port
    const result=await runChrome(galleryOrigin+'/')
    const success=result.result==='PASS'&&result.origin===galleryOrigin&&privateReads===0&&childCookies===0&&redeemed===1&&sdkLoads===1
    console.log('A3I_MSG3A_REAL_CHROMIUM '+JSON.stringify({
      success,domStorageAndAPIBlocked:result.result==='PASS',
      parentPrivateRequests:privateReads,childPrivateCookies:childCookies,
      syntheticTLS:true,production:false,providerSDK:true,redeemed,sdkLoads,
    }))
    assert(success,'Cross-Origin/CSP/iframe sandbox hostile child test must block all access')
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve))
    fs.rmSync(tmp,{force:true,recursive:true,maxRetries:3,retryDelay:200})
  }
}
main().catch(error=>{
  console.error('A3I_MSG3A_BROWSER_TEST_FAILED '+error.message)
  process.exitCode=1
})
