#!/usr/bin/env node
'use strict'
// Genuine mounted React Gallery map surface in Chromium, with two local HTTPS
// site origins and controlled synthetic SDK/Owner Cells. An opt-in separate
// job connects BOTH actual mounted Hosts to real Gin/PostgreSQL Owner scope
// issue/redeem via a loopback-only proxy. No live Baidu or physical iOS.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const https=require('node:https')
const http=require('node:http')
const {execFileSync,spawn}=require('node:child_process')
const {createRequire}=require('node:module')
const root=path.resolve(__dirname,'../..')
const requireRepo=createRequire(path.join(root,'desktop/package.json'))
const esbuild=requireRepo('esbuild')
const {chromium}=require(process.env.XDRIVE_PLAYWRIGHT_MODULE || 'playwright-core')
const source=path.join(__dirname,'gallery-places-dual-host-chromium.tsx')
const childDir=path.join(root,'deploy/baidu-isolated-child')
const galleryHost='gallery.example.net'
const childHost='map-isolated.example.org'
const out=path.resolve(process.env.XDRIVE_PLACES_DUAL_HOST_RESULT_DIR ||
  path.join(os.tmpdir(),'xdrive-places-dual-host-results'))
fs.mkdirSync(out,{recursive:true})
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-places-dual-'))
const summary={sourceCommit:process.env.XD_PR_HEAD || null,
  realChromium:true,realReactParent:true,realChildSource:true,
  realGin:false,realBaiduProvider:false,physicalDevice:false,
  checks:[],passed:false,errors:[]}
const record=(name,ok)=>{summary.checks.push({name,passed:!!ok});assert(ok,name)}
const sdkStub='('+function sdkFactory(){
  class Point {constructor(lng,lat){this.lng=lng;this.lat=lat}}
  class Size {constructor(width,height){this.width=width;this.height=height}}
  class Label {
    constructor(text,options){this.text=text;this.options=options;this.listeners=new Map()}
    setStyle(){}
    addEventListener(name,fn){this.listeners.set(name,fn)}
    removeEventListener(name){this.listeners.delete(name)}
  }
  class BaiduMap {
    constructor(canvas){this.canvas=canvas;this.center=new Point(119.975,30.135)
      this.zoom=12;this.overlays=[];this.listeners=new Map()}
    centerAndZoom(point,zoom){this.center=point;this.zoom=zoom}
    setViewport(points){if(points[0])this.center=points[0]}
    enableScrollWheelZoom(){}
    enableDoubleClickZoom(){}
    enablePinchToZoom(){}
    addEventListener(name,fn){this.listeners.set(name,fn)}
    removeEventListener(name){this.listeners.delete(name)}
    addOverlay(label){this.overlays.push(label)}
    removeOverlay(label){this.overlays=this.overlays.filter(x=>x!==label)}
    getCenter(){return this.center}
    getZoom(){return this.zoom}
    getBounds(){return {getSouthWest:()=>new Point(100,20),
      getNorthEast:()=>new Point(125,40)}}
    pointToPixel(){return {x:180,y:180}}
    destroy(){this.overlays=[];this.listeners.clear()}
  }
  // Historical prototype's unused namespace checks are included so this
  // controlled Host parity fixture can run on master before or after the
  // production inline core-only capability change.
  class Convertor {translate(points,_from,_to,done){done({status:0,points})}}
  class ClusterLayer {}
  window.BMap={Map:BaiduMap,Point,Label,Size,Convertor,ClusterLayer}
  const callback=new URL(document.currentScript?.src || location.href)
    .searchParams.get('callback')
  if(callback && typeof window[callback]==='function')window[callback]()
}.toString()+')()'
const resultHTML='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
  '<body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>'
const content=(res,code,type,body,headers={})=>{
  res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store',...headers})
  res.end(body)
}
const certified=()=>{
  const key=path.join(temp,'key.pem'),cert=path.join(temp,'cert.pem')
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
    '-keyout',key,'-out',cert,'-days','1','-subj','/CN=gallery.example.net',
    '-addext','subjectAltName=DNS:gallery.example.net,DNS:map-isolated.example.org'],
    {stdio:'ignore'})
  return {key:fs.readFileSync(key),cert:fs.readFileSync(cert)}
}
let appServer,childSessionRedeems=0,childSDKLoads=0,inlineSDKLoads=0
let ginURL='',ginProcess=null
const ginReady=path.join(temp,'real-gin-ready.json')
const ginStop=path.join(temp,'real-gin-finished')
async function startRealGin(galleryOrigin){
  const binary=process.env.XD_PLACES_P04_GO_BINARY
  if(!binary)return
  assert(fs.existsSync(binary),'compiled real Gin fixture required')
  ginProcess=spawn(binary,['-test.run=^TestPlacesP04MountedBrowserRealGinFixture$',
    '-test.count=1','-test.timeout=4m'],{
    env:{...process.env,XD_PLACES_P04_BROWSER_GIN:'1',
      XD_PLACES_P04_GALLERY_ORIGIN:galleryOrigin,
      XD_PLACES_P04_READY_FILE:ginReady,XD_PLACES_P04_STOP_FILE:ginStop},
    stdio:['ignore','pipe','pipe'],
  })
  // Never echo fixture stdout/stderr: no token, key or database URL is
  // eligible for CI logs/artifacts. Only bounded JSON readiness is read.
  ginProcess.stdout.resume()
  ginProcess.stderr.resume()
  for(let tries=0;tries<100;tries++){
    if(fs.existsSync(ginReady)){
      const ready=JSON.parse(fs.readFileSync(ginReady,'utf8'))
      const target=new URL(ready.url)
      assert(ready.real_gin===true&&ready.postgresql===true &&
        target.protocol==='http:'&&target.hostname==='127.0.0.1'&&
        Number(target.port)>0,'real Gin is not loopback-only')
      ginURL=target.origin
      summary.realGin=true
      return
    }
    if(ginProcess.exitCode!==null)throw Error('real Gin exited before readiness')
    await new Promise(resolve=>setTimeout(resolve,350))
  }
  throw Error('real Gin startup timeout')
}
function proxyRealGin(req,res){
  if(!ginURL)return content(res,503,'text/plain','unavailable')
  const destination=new URL(req.url,ginURL)
  const headers={...req.headers} // preserve browser Host, Origin and Fetch Metadata
  const forward=http.request(destination,{method:req.method,headers,timeout:12000},
    upstream=>{
      const safe={}
      for(const key of ['content-type','cache-control','referrer-policy',
        'cross-origin-resource-policy','x-content-type-options']){
        if(upstream.headers[key])safe[key]=upstream.headers[key]
      }
      res.writeHead(upstream.statusCode||502,safe)
      upstream.pipe(res)
    })
  forward.on('timeout',()=>forward.destroy())
  forward.on('error',()=>{if(!res.headersSent)content(res,502,'text/plain','unavailable')
    else res.destroy()})
  req.pipe(forward)
}
async function stopRealGin(){
  if(!ginProcess)return
  try{fs.writeFileSync(ginStop,'complete\n',{mode:0o600})}catch{}
  const code=await new Promise(resolve=>{
    if(ginProcess.exitCode!==null)return resolve(ginProcess.exitCode)
    const timer=setTimeout(()=>{ginProcess.kill('SIGTERM');resolve(null)},15000)
    ginProcess.once('exit',exitCode=>{clearTimeout(timer);resolve(exitCode)})
  })
  if(code!==0){
    summary.passed=false
    summary.errors.push('non-production Gin fixture failed')
    process.exitCode=1
  }
}
const requests=[]
const listen=server=>new Promise((resolve,reject)=>
  server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()))
async function testActualGinIssueRedeem(page,mode){
  if(!ginURL)return
  // Execute real authenticated HTTP from the same Chromium document as
  // the mounted SDK Host. Return only booleans: never a bearer or ticket.
  const result=await page.evaluate(async target=>{
    const base='/api/v1/media/places/baidu-jsapi/scope-handoff'
    const authReply=await fetch('/__fixture/map-owner',{cache:'no-store'})
    const foreignReply=await fetch('/__fixture/map-owner?account=foreign',{cache:'no-store'})
    if(!authReply.ok||!foreignReply.ok)return {auth:false}
    const auth=await authReply.json(),foreign=await foreignReply.json()
    const post=async(url,token,body)=>{
      const response=await fetch(url,{method:'POST',cache:'no-store',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify(body)})
      return {status:response.status,text:await response.text()}
    }
    const health=await fetch('/api/v1/media/places/baidu-jsapi/status',{
      cache:'no-store',headers:{Authorization:'Bearer '+auth.token}})
    const status=await health.json()
    const scope={albumKey:'manual:Family',
      filters:{sort_by:'captured',sort_dir:'desc',favorite:true}}
    const camera={coordinate_space:'bd09ll',latitude:35.42,longitude:119.2,zoom:11}
    const issued=await post(base,auth.token,{target_mode:target,scope,camera})
    let receipt=null
    try{receipt=JSON.parse(issued.text)}catch{}
    const ticket=receipt?.ticket
    if(issued.status!==200||typeof ticket!=='string')return{
      auth:true,signed:status?.enabled===true&&
        status?.activation_state==='authorized_signed_release' &&
        status?.isolated_child_origin==='',issue:false}
    const targetOther=target==='prototype'?'isolated':'prototype'
    const foreignResult=await post(base+'/consume',foreign.token,{target_mode:target,ticket})
    const wrong=await post(base+'/consume',auth.token,{target_mode:targetOther,ticket})
    const correct=await post(base+'/consume',auth.token,{target_mode:target,ticket})
    const replay=await post(base+'/consume',auth.token,{target_mode:target,ticket})
    let accepted=null
    try{accepted=JSON.parse(correct.text)}catch{}
    return {
      auth:true,
      signed:status?.enabled===true&&
        status?.activation_state==='authorized_signed_release' &&
        status?.isolated_child_origin==='',
      issue:issued.status===200&&/^[a-f0-9]{64}$/.test(ticket)&&
        !issued.text.includes('manual:Family')&&!issued.text.includes('35.42'),
      foreignBlocked:foreignResult.status===403,
      wrongModeBlocked:wrong.status===403,
      valid:correct.status===200&&accepted?.target_mode===target&&
        accepted?.scope?.albumKey==='manual:Family'&&
        accepted?.scope?.filters?.favorite===true&&
        accepted?.camera?.coordinate_space==='bd09ll'&&
        accepted?.camera?.zoom===11,
      replayBlocked:replay.status===403,
    }
  },mode==='inline'?'prototype':'isolated')
  for(const [key,label] of [
    ['auth','synthetic test-only Owner JWT is available'],
    ['signed','actual Gin signed release requires no Child DNS for inline'],
    ['issue','private Owner scope issued as opaque one-use ticket'],
    ['foreignBlocked','cross-Owner ticket consumption rejected'],
    ['wrongModeBlocked','wrong SDK mode ticket consumption rejected'],
    ['valid','actual Gin/PostgreSQL Owner Scope and Camera restored'],
    ['replayBlocked','consumed Owner scope ticket cannot replay'],
  ])record(mode+': '+label,result[key]===true)
}

async function testMode(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  page.on('requestfailed',request=>{
    if(!request.failure()?.errorText?.includes('ERR_ABORTED'))
      errors.push('requestfailed:'+new URL(request.url()).hostname)
  })
  await page.route('https://api.map.baidu.com/api?**',route=>{
    inlineSDKLoads++
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode,
      {waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__mapProbe?.ready === true)
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    record(mode+': signed BD09 Owner Cells render the same 9 photos',
      await page.locator('[data-xdrive-places-cluster-list] button').count()===1)
    const first=await page.evaluate(()=>({
      mode:window.__mapProbe.mode,count:window.__mapProbe.queries.at(-1)?.count,
      ready:window.__mapProbe.ready}))
    record(mode+': actual mounted shared business state',
      first.mode===mode&&first.count===9&&first.ready===true)
    if(mode==='isolated'){
      record('isolated: actual independent HTTPS iframe mounted',
        await page.locator('[data-xdrive-baidu-isolated-frame]').count()===1)
      const child=page.frames().find(frame=>frame.url().includes(childHost))
      record('isolated: independent Child is a real browser frame',!!child)
      const result=await child.evaluate(()=>{
        try{return !!parent.document.querySelector('#private-parent')}
        catch{return 'cross-origin-blocked'}
      })
      record('isolated: Child cannot read trusted Parent DOM',
        result==='cross-origin-blocked')
    }else{
      record('inline: no independent Child iframe mounted',
        await page.locator('[data-xdrive-baidu-isolated-frame]').count()===0)
    }
    await page.locator('#toggle-favorite').click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    record(mode+': Owner favorite filter refreshes same Cells',
      await page.locator('[data-xdrive-places-cluster-list] button').count()===1)
    // The production accessible Cell list lives inside a closed <details>.
    // Open it with an actual browser action before clicking a visible Cell.
    await page.locator('[data-xdrive-places-cluster-list] summary').click()
    await page.locator('[data-xdrive-places-cluster-list] button').first().click()
    await page.waitForFunction(()=>window.__mapProbe.clicks.length===1)
    const selected=await page.evaluate(()=>window.__mapProbe.clicks[0])
    record(mode+': Cell click retains trusted Owner identity and revision',
      ginURL
        ? Number.isSafeInteger(selected.node)&&selected.node>0&&
          Number.isSafeInteger(selected.asset)&&selected.asset>0&&
          selected.revision===1&&selected.count===3&&selected.favorite===true
        : selected.node===75&&selected.asset===33&&selected.revision===2&&
          selected.count===3&&selected.favorite===true)
    if(ginURL){
      await page.waitForFunction(()=>
        window.__mapProbe.ownerCellRange!==null||window.__mapProbe.rangeError)
      const range=await page.evaluate(()=>window.__mapProbe.ownerCellRange)
      record(mode+': actual signed Gin Cell/Viewer member Range is Owner-filtered',
        range?.total===3&&range?.items===3&&range?.consistent===true)
    }
    await page.locator('[data-xdrive-places-full-camera-wall]').waitFor()
    await page.locator('[data-xdrive-places-full-camera-wall]').click()
    await page.waitForFunction(()=>window.__mapProbe.viewports.length>=1)
    const scoped=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {wall:p.viewports.at(-1),camera:p.cameras.at(-1),failed:p.failed}
    })
    record(mode+': full viewport uses current Owner favorite scope',
      scoped.wall.favorite===true&&scoped.wall.bounds.coordinate_space==='bd09ll')
    record(mode+': SDK reports BD09 camera',
      scoped.camera?.coordinate_space==='bd09ll'&&scoped.camera.zoom>=3)
    if(ginURL){
      await page.waitForFunction(()=>
        window.__mapProbe.ownerViewportRange!==null||window.__mapProbe.rangeError)
      const range=await page.evaluate(()=>window.__mapProbe.ownerViewportRange)
      record(mode+': actual signed Gin Camera/Viewer member Range matches Owner',
        range?.total===3&&range?.items===3&&range?.consistent===true)
    }
    record(mode+': no SDK/runtime failure',!scoped.failed&&errors.length===0)
    await testActualGinIssueRedeem(page,mode)

    if(ginURL){
      const before=await page.evaluate(()=>{
        const map=document.querySelector('[data-xdrive-places-cluster-overview]')
        window.__mapProbe.mapElement=map
        return {valid:!!map,camera:window.__mapProbe.cameras.at(-1)}
      })
      record(mode+': map Parent still mounted before genuine Viewer',before.valid)
      // Foreign Owner cannot obtain a signed preview for the selected Node.
      const foreignStatus=await page.evaluate(async()=>{
        const ownerNode=window.__mapProbe.viewerSourceItem?.node?.id
        if(!Number.isSafeInteger(ownerNode))return 0
        const foreign=await fetch('/__fixture/map-owner?account=foreign',
          {cache:'no-store'}).then(r=>r.json())
        const response=await fetch('/api/v1/files/'+ownerNode+'/preview-ticket',{
          method:'POST',cache:'no-store',
          headers:{Authorization:'Bearer '+foreign.token}})
        return response.status
      })
      record(mode+': foreign Owner cannot mint map Viewer original ticket',
        foreignStatus===404)
      const pngResponse=page.waitForResponse(response=>{
        const url=new URL(response.url())
        return url.pathname.startsWith('/api/v1/file-preview/') &&
          response.status()===200
      },{timeout:30000})
      await page.locator('#open-real-viewer').click()
      // This data attribute is on the decoded-image *surface*, not an IMG.
      // Select its visible original IMG after the actual decode-ready phase.
      const original=page.locator('[data-xdrive-image-phase="original"]').first()
      await original.waitFor({state:'visible',timeout:30000})
      const image=original.locator('img:not([aria-hidden="true"])').first()
      await image.waitFor({state:'visible',timeout:15000})
      const binary=await (await pngResponse).body()
      record(mode+': real signed Gin preview loads physical PNG CAS bytes',
        binary.length>50&&binary.subarray(0,8).equals(
          Buffer.from([137,80,78,71,13,10,26,10])))
      record(mode+': shared Gallery Viewer decodes genuine CAS original',
        await image.evaluate(img=>img instanceof HTMLImageElement&&
          img.complete&&img.naturalWidth===2&&img.naturalHeight===2))
      if(mode==='isolated'){
        const child=page.frames().find(frame=>frame.url().includes(childHost))
        const safety=await child.evaluate(()=>{
          try{return !!parent.document.querySelector('[data-xdrive-image-phase="original"]')}
          catch{return 'cross-origin-blocked'}
        })
        record('isolated: actual Viewer original remains hidden from untrusted Child',
          safety==='cross-origin-blocked')
      }
      record(mode+': private Viewer bytes never requested by map Child',
        requests.every(item=>item.host!=='child'||
          !item.path.startsWith('/api/v1/')))
      await page.getByRole('button',{name:'关闭预览'}).click()
      record(mode+': Viewer return retains exact trusted map DOM and BD09 camera',
        await page.evaluate((camera)=>{
          const p=window.__mapProbe
          const next=p.cameras.at(-1)
          return p.viewerOpened===1&&p.viewerClosed===1&&
            document.querySelector('[data-xdrive-places-cluster-overview]')===p.mapElement&&
            next?.coordinate_space==='bd09ll' &&
            next?.latitude===camera?.latitude&&
            next?.longitude===camera?.longitude&&next?.zoom===camera?.zoom
        },before.camera))
    }
    return {mode,count:9,favoriteCount:3,selectedCount:selected.count,
      coordinateSpace:scoped.wall.bounds.coordinate_space,cameraSpace:scoped.camera.coordinate_space}
  }finally{await context.close()}
}
async function main(){
  await esbuild.build({
    entryPoints:[source],bundle:true,jsx:'automatic',logLevel:'silent',
    outfile:path.join(temp,'bundle.js'),
    nodePaths:[path.join(root,'desktop/node_modules')],
    alias:{'@fixture/surface':path.join(root,'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),
      '@fixture/viewer':path.join(root,'ui/shared/src/mui/MediaGalleryViewer.tsx')},
    define:{'process.env.NODE_ENV':'"production"'}
  })
  let galleryOrigin=''
  const childHTML=fs.readFileSync(path.join(childDir,'index.html'),'utf8')
  const childJS=fs.readFileSync(path.join(childDir,'child.js'),'utf8')
  const childCSS=fs.readFileSync(path.join(childDir,'child.css'),'utf8')
  appServer=https.createServer(certified(),(req,res)=>{
    const host=req.headers.host
    const port=appServer.address().port
    const gallery=host===galleryHost+':'+port
    const child=host===childHost+':'+port
    const pathname=new URL(req.url||'/','https://'+host).pathname
    requests.push({host:gallery?'gallery':child?'child':'unexpected',path:pathname})
    if(gallery&&pathname==='/')return content(res,200,'text/html',
      ginURL?resultHTML.replace('</head>',
        '<script>window.__P04_REAL_GIN=true</script></head>'):resultHTML)
    if(gallery&&ginURL&&
      (pathname==='/__fixture/map-owner' ||
        pathname.startsWith('/api/v1/media/places/baidu-jsapi/') ||
        pathname.startsWith('/api/v1/files/') ||
        pathname.startsWith('/api/v1/file-preview/')))
      return proxyRealGin(req,res)
    if(gallery&&pathname==='/bundle.js')
      return content(res,200,'text/javascript',fs.readFileSync(path.join(temp,'bundle.js')))
    if(child&&pathname==='/_xdrive_baidu_isolated/index.html')
      return content(res,200,'text/html',
        childHTML.replace('REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN',galleryOrigin))
    if(child&&pathname==='/_xdrive_baidu_isolated/child.js')
      return content(res,200,'text/javascript',childJS)
    if(child&&pathname==='/_xdrive_baidu_isolated/child.css')
      return content(res,200,'text/css',childCSS)
    if(child&&pathname==='/_xdrive_baidu_isolated/session'&&req.method==='POST'){
      let raw=''
      req.on('data',buf=>{raw+=buf.toString('utf8')})
      req.on('end',()=>{
        try{
          const obj=JSON.parse(raw)
          if(raw.length>200||obj.ticket!=='b'.repeat(64))throw Error('invalid')
          childSessionRedeems++
          return content(res,200,'application/json',JSON.stringify({
            provider:'baidu-jsapi-4.0',runtime_enabled:true}),
          {'Set-Cookie':'XD_BMAP_SESSION=MAP_ONLY; Secure; HttpOnly; SameSite=None; Partitioned; Path=/_BMapService/'})
        }catch{return content(res,403,'text/plain','forbidden')}
      })
      return
    }
    if(child&&pathname==='/_BMapService/api'&&req.method==='GET'){
      childSDKLoads++
      return content(res,200,'text/javascript',sdkStub)
    }
    content(res,404,'text/plain','not found')
  })
  await listen(appServer)
  const port=appServer.address().port
  galleryOrigin='https://'+galleryHost+':'+port
  await startRealGin(galleryOrigin)
  const exe=process.env.XDRIVE_BROWSER_EXECUTABLE
  assert(exe&&fs.existsSync(exe),'real Chromium executable required')
  const browser=await chromium.launch({executablePath:exe,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server',
      '--host-resolver-rules=MAP '+galleryHost+' 127.0.0.1, MAP '+childHost+' 127.0.0.1']})
  try{
    summary.browserVersion=browser.version()
    const inline=await testMode(browser,'inline',port)
    const isolated=await testMode(browser,'isolated',port)
    record('both SDK Hosts return identical authorized Count, Cell and Camera',
      inline.count===isolated.count&&
      inline.favoriteCount===isolated.favoriteCount&&
      inline.selectedCount===isolated.selectedCount&&
      inline.coordinateSpace===isolated.coordinateSpace&&
      inline.cameraSpace===isolated.cameraSpace)
    record('one browser-direct inline SDK, no unintended network',
      inlineSDKLoads===1)
    record('Child SDK loaded only after one Child map ticket',
      childSDKLoads===1&&childSessionRedeems===1)
    record('only reviewed synthetic registered sites were accessed',
      requests.every(item=>item.host==='gallery'||item.host==='child'))
    summary.passed=true
  }finally{await browser.close()}
}
main().catch(error=>{
  summary.errors.push(String(error?.message||error).slice(0,600))
  process.exitCode=1
 }).finally(async()=>{
  await stopRealGin()
  if(appServer)await new Promise(resolve=>appServer.close(resolve))
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n')
  console.log(JSON.stringify({sourceCommit:summary.sourceCommit,
    passed:summary.passed,checks:summary.checks.length,errors:summary.errors},null,2))
  fs.rmSync(temp,{recursive:true,force:true})
})
