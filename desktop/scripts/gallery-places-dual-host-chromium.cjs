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
// The true production Parent drives this choice. An old SDK-only success
// cannot masquerade as the shipped photo-first Drawer feature passing.
const shippedPhotoDrawer=fs.readFileSync(path.join(root,
  'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),'utf8')
  .includes('<XDriveMediaGalleryPlacesPhotoDrawer')
const galleryHost='gallery.example.net'
const childHost='map-isolated.example.org'
const out=path.resolve(process.env.XDRIVE_PLACES_DUAL_HOST_RESULT_DIR ||
  path.join(os.tmpdir(),'xdrive-places-dual-host-results'))
fs.mkdirSync(out,{recursive:true})
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'xdrive-places-dual-'))
const summary={sourceCommit:process.env.XD_PR_HEAD || null,
  realChromium:true,realReactParent:true,realChildSource:true,
  realGin:false,realBaiduProvider:false,physicalDevice:false,
  fullGalleryPageModes:[],fullGalleryDirectPhotoModes:[],mobileDrawerModes:[],
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
    // Click the same trusted photo cover a real user sees; the diagnostic
    // <details> can remount when Owner filter requests race and is not the UI.
    const mapCover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await mapCover.waitFor({state:'visible'})
    await mapCover.click()
    await page.locator('[data-xdrive-places-photo-drawer-items] button').first().waitFor()
    const handle=page.locator('[data-xdrive-places-photo-drawer-handle]')
    await handle.click()
    await page.waitForFunction(()=>document.querySelector(
      '[data-xdrive-places-photo-drawer-handle]')?.getAttribute('aria-expanded')==='true')
    record(mode+': semantic shared photo sheet handle opens by pointer click',
      await handle.getAttribute('aria-expanded')==='true')
    await handle.press('Enter')
    await page.waitForFunction(()=>document.querySelector(
      '[data-xdrive-places-photo-drawer-handle]')?.getAttribute('aria-expanded')==='false')
    record(mode+': shared photo sheet handle closes by keyboard Enter',
      await handle.getAttribute('aria-expanded')==='false')
    const photoPreview=await page.evaluate(()=>({
      count:document.querySelectorAll('[data-xdrive-places-photo-drawer-items] button').length,
      queries:window.__mapProbe.photoPreviewRanges.length,
      total:window.__mapProbe.photoPreviewRanges.at(-1)?.total,
      failed:window.__mapProbe.failed,
    }))
    record(mode+': signed Owner Cell opens current bounded Parent photo drawer',
      photoPreview.count===3 && photoPreview.total===3 &&
      photoPreview.queries>=1 && !photoPreview.failed)
    await page.locator('[data-xdrive-places-photo-drawer-open-all]').click()
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
    // This deliberately unmounts the map to exercise the ephemeral selection
    // return. The production Gallery Viewer is tested separately above.
    await mapCover.waitFor({state:'visible'})
    await mapCover.click()
    await page.locator('[data-xdrive-places-photo-drawer-items] button').first().waitFor()
    // Shrink ONLY the synthetic drawer viewport so the three real Owner cells
    // visibly scroll; this tests pixel-offset return, not an iOS screenshot.
    await page.addStyleTag({content:
      '[data-xdrive-places-photo-drawer]{max-height:190px!important}'+
      '[data-xdrive-places-photo-drawer-items]{max-width:135px!important;'+
      'max-height:100px!important;min-height:0!important;'+
      'grid-template-columns:minmax(92px,1fr)!important;'+
      'grid-auto-rows:minmax(140px,auto)!important;'+
      'overflow-y:scroll!important}'})
    await page.locator('[data-xdrive-places-photo-drawer-expand]').click()
    record(mode+': genuine React photo drawer opens expanded',
      await page.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').count()===1 &&
      await page.locator('[data-xdrive-places-photo-drawer-handle][aria-expanded="true"]').count()===1)
    const scrolled=await page.locator('[data-xdrive-places-photo-drawer-items]')
      .evaluate(element=>{
        // A test-only one-column viewport guarantees overflow even when the
        // Drawer is nested in a flex layout with intrinsic grid sizing.
        for(const [name,value] of [
          ['width','135px'],['height','90px'],['max-height','90px'],
          ['min-height','0'],['flex','0 0 90px'],
          ['grid-template-columns','minmax(0, 1fr)'],
          ['overflow-y','scroll'],
        ])element.style.setProperty(name,value,'important')
        element.scrollTop=70
        return {top:element.scrollTop,client:element.clientHeight,
          content:element.scrollHeight,display:getComputedStyle(element).display}
      })
    if(!(scrolled.content>scrolled.client+2 && scrolled.top>0))
      console.error('real drawer scroll geometry '+mode+' '+JSON.stringify(scrolled))
    record(mode+': expanded drawer owns a scrollable thumbnail area'+
      ' (top='+scrolled.top+',client='+scrolled.client+
      ',content='+scrolled.content+')',
      scrolled.content>scrolled.client+2 && scrolled.top>0)
    // Choose an on-screen thumbnail without letting Playwright auto-scroll
    // the last tile to the bottom and rewrite the user-owned scroll position.
    await page.locator('[data-xdrive-places-photo-drawer-items] button').nth(1).click()
    const reachedOwnerRange=await page.waitForFunction(()=>
      window.__mapProbe.photoOpens.length>0 || window.__mapProbe.rangeError,
      null,{timeout:8000}).then(()=>true).catch(()=>false)
    const photoClick=await page.evaluate(()=>({
      opens:window.__mapProbe.photoOpens.length,
      rangeError:window.__mapProbe.rangeError,
      previewReads:window.__mapProbe.photoPreviewRanges.length,
      drawerVisible:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
    }))
    record(mode+': photo click reaches a distinct Owner Range'+
      ' (opens='+photoClick.opens+',error='+photoClick.rangeError+
      ',reads='+photoClick.previewReads+',drawer='+photoClick.drawerVisible+')',
      reachedOwnerRange && photoClick.opens>0 && !photoClick.rangeError)
    await page.locator('#fixture-viewer').waitFor()
    const viewer=await page.evaluate(()=>window.__mapProbe.photoOpens.at(-1))
    record(mode+': selected thumbnail rechecks a distinct Owner Cell Range',
      viewer?.valid===true)
    record(mode+': selected thumbnail retains bounded expanded drawer state',
      viewer?.expanded===true && Number.isSafeInteger(viewer?.scrollTop) &&
      viewer.scrollTop>0 && Number.isSafeInteger(viewer?.scrollLeft))
    await page.locator('#fixture-viewer-back').click()
    await page.locator('[data-xdrive-places-photo-drawer-items] button').first().waitFor()
    record(mode+': Viewer Back restores only freshly matched Cell drawer and expansion',
      await page.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').count()===1 &&
      await page.locator('[data-xdrive-places-photo-drawer-handle][aria-expanded="true"]').count()===1)
    const restoredScroll=await page.locator('[data-xdrive-places-photo-drawer-items]')
      .evaluate(element=>element.scrollTop)
    record(mode+': real scroll position survives Viewer Back and fresh Range',
      restoredScroll>0&&Math.abs(restoredScroll-viewer.scrollTop)<=2)
    const returned=await page.evaluate(()=>window.__mapProbe.photoPreviewRanges)
    record(mode+': Viewer Back refreshes bounded signed Owner range, never stale media',
      returned.length>=3&&returned.every(v=>v.total===3&&v.items===3&&
        (v.limit===12||v.limit===48)))
    record(mode+': no SDK/runtime failure after Viewer remount',
      await page.evaluate(()=>!window.__mapProbe.failed)&&errors.length===0)
    return {mode,count:9,favoriteCount:3,selectedCount:selected.count,
      coordinateSpace:scoped.wall.bounds.coordinate_space,cameraSpace:scoped.camera.coordinate_space}
  }finally{await context.close()}
}

// Use the shipped UI. Older Gallery code opens the virtual Cell Wall
// immediately; photo-first Gallery opens a trusted Owner photo drawer first.
// Never mock this transition or make the SDK Child responsible for media.
async function openActualOwnerCellFromMap(page,mode){
  const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
  if(shippedPhotoDrawer){
    // Photo-first UI must expose an actual Parent-owned image marker.
    // Do not silently fall back to the diagnostic Cell list if its cover is late.
    await cover.waitFor({state:'visible',timeout:30000})
    await cover.click()
  }else{
    await page.locator('[data-xdrive-places-cluster-list] summary').click()
    await page.locator('[data-xdrive-places-cluster-list] button').first().click()
  }
  await page.waitForFunction(()=>
    Boolean(document.querySelector('[data-xdrive-media-tile]') ||
      document.querySelector('[data-xdrive-places-photo-drawer]')),
    null,{timeout:30000})
  const drawer=page.locator('[data-xdrive-places-photo-drawer]')
  if(!await drawer.count())return false
  const photos=drawer.locator('[data-xdrive-places-photo-drawer-item]')
  await photos.first().waitFor({state:'visible',timeout:30000})
  record(mode+': trusted Owner photo drawer presents exactly three authorized images',
    await photos.count()===3)
  record(mode+': map SDK Child does not access private drawer photo API',
    requests.every(item=>item.host!=='child'||!item.path.startsWith('/api/v1/')))
  await drawer.locator('[data-xdrive-places-photo-drawer-open-all]').click()
  await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
  return true
}
async function testFullGalleryPage(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    const url='https://'+galleryHost+':'+port+'/?mode='+mode+
      '&full_gallery=1'+(mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto(url,{waitUntil:'domcontentloaded'})
    // This is the real shipped Page/Photo Wall, not the minimal React Host
    // fixture and not a second business SDK/Range implementation.
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    record(mode+': actual Gallery Page opens authorized Favorite BD09 map',
      await page.locator('[data-xdrive-gallery-places-map]').count()===1)
    const filterMenu=page.locator('[data-xdrive-places-map-filter-menu]')
    const moreMenu=page.locator('[data-xdrive-places-map-more-menu]')
    await filterMenu.locator('summary').first().click()
    record(mode+': shared Filter opens in the trusted Parent',
      await filterMenu.getAttribute('open')!==null)
    await moreMenu.locator('summary').first().click()
    await page.waitForFunction(()=>
      !document.querySelector('[data-xdrive-places-map-filter-menu]')?.open)
    record(mode+': shared More is mutually exclusive with Filter',
      await moreMenu.getAttribute('open')!==null &&
      await filterMenu.getAttribute('open')===null)
    await page.keyboard.press('Escape')
    record(mode+': Escape closes More and returns focus to its summary',
      await moreMenu.getAttribute('open')===null &&
      await page.evaluate(()=>document.activeElement===
        document.querySelector('[data-xdrive-places-map-more-menu] > summary')))
    await filterMenu.locator('summary').first().click()
    await page.locator('[data-xdrive-places-map-toolbar]')
      .click({position:{x:2,y:2}})
    await page.waitForFunction(()=>
      !document.querySelector('[data-xdrive-places-map-filter-menu]')?.open)
    record(mode+': Parent click-away closes Filter above shared map',
      await filterMenu.getAttribute('open')===null)
    // Grid labels ("区域 N") are viewport-relative; the verified Cell Range
    // and its Owner Node IDs, not the displayed label, define the collection.
    const drawerUsed=await openActualOwnerCellFromMap(page,mode)
    record(mode+': shipped shared photo drawer entry actually ran',
      drawerUsed===shippedPhotoDrawer)
    const tile=page.locator('[data-xdrive-media-tile]').first()
    await tile.waitFor({state:'visible'})
    const originalTileRect=await tile.boundingBox()
    const wall=await page.evaluate(()=>{
      const tiles=document.querySelectorAll('[data-xdrive-media-tile]')
      const selected=tiles[0]
      const p=window.__mapProbe
      return {count:tiles.length,first:selected?.getAttribute('data-xdrive-media-index'),
        realCell:p.galleryPageReads.some(q=>q.kind==='cell'&&q.total===3),
        errors:[...p.galleryPageErrors]}
    })
    record(mode+': real Gallery virtual Cell Wall receives current Gin 3-photo Range',
      wall.realCell&&wall.count>=1&&wall.errors.length===0)
    const initialCell=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(read=>read.kind==='cell').at(-1))
    record(mode+': original Cell signed Owner member identity is complete',
      initialCell?.total===3&&initialCell.nodeIDs?.length===3&&
      initialCell.nodeIDs.every(id=>Number.isSafeInteger(id)&&id>0)&&
      new Set(initialCell.nodeIDs).size===3)
    const binary=page.waitForResponse(response=>new URL(response.url()).pathname
      .startsWith('/api/v1/file-preview/')&&response.status()===200)
    await tile.click()
    const original=page.locator('[data-xdrive-image-phase="original"]').first()
    await original.waitFor({state:'visible'})
    const img=original.locator('img:not([aria-hidden="true"])').first()
    await img.waitFor({state:'visible'})
    const preview=await (await binary).body()
    record(mode+': real Gallery Wall Viewer decodes authenticated physical PNG',
      preview.length>50&&preview.subarray(0,8).equals(
        Buffer.from([137,80,78,71,13,10,26,10]))&&
      await img.evaluate(x=>x instanceof HTMLImageElement&&x.complete&&
        x.naturalWidth===2&&x.naturalHeight===2))
    if(mode==='isolated'){
      // Opening the real Cell Wall unmounts Places entirely, so its untrusted
      // SDK Child must be DISPOSED before the Gallery Viewer loads an original.
      // The standalone trusted Parent fixture still tests hostile Child
      // cross-Origin DOM isolation while the Child is actually mounted.
      record('isolated: actual Gallery Viewer has no running map SDK Child',
        !page.frames().some(frame=>frame.url().includes(childHost))&&
        await page.locator('[data-xdrive-baidu-isolated-frame]').count()===0)
    }
    await page.getByRole('button',{name:'关闭预览'}).click()
    const returnedTile=page.locator('[data-xdrive-media-tile]').first()
    await returnedTile.waitFor({state:'visible'})
    const returnedTileRect=await returnedTile.boundingBox()
    record(mode+': Viewer Back retains virtual Wall index and pixel scroll anchor',
      await returnedTile.getAttribute('data-xdrive-media-index')===wall.first &&
      originalTileRect!==null&&returnedTileRect!==null&&
      Math.abs(returnedTileRect.y-originalTileRect.y)<2)
    await page.getByRole('button',{name:'返回上一级'}).click()
    await page.locator('[data-xdrive-places-cluster-overview]').waitFor()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    record(mode+': Cell Wall Back restores trusted Gallery map and Owner Scope',
      await page.locator('[data-xdrive-gallery-places-map]').count()===1 &&
      await page.locator('[data-xdrive-places-cluster-list] button').count()===1)
    // The native <details> is collapsed after a real Page remount. Reopen it
    // via an actual user action, then re-enter the *currently authorized*
    // Cell instead of comparing stale viewport-relative "区域 N" labels.
    const previousCellReads=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(read=>read.kind==='cell').length)
    const returnDrawerUsed=await openActualOwnerCellFromMap(page,mode)
    record(mode+': same trusted Cell entry flow is restored after Viewer Back',
      returnDrawerUsed===drawerUsed)
    await page.waitForFunction(before=>
      window.__mapProbe.galleryPageReads.filter(read=>read.kind==='cell').length>before,
      previousCellReads)
    const freshCell=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(read=>read.kind==='cell').at(-1))
    const canonicalIDs=ids=>JSON.stringify([...ids].sort((a,b)=>a-b))
    record(mode+': returned map Cell reauthorizes identical Owner photo members',
      freshCell?.total===initialCell.total&&freshCell.nodeIDs?.length===3&&
      canonicalIDs(freshCell.nodeIDs)===canonicalIDs(initialCell.nodeIDs))
    await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
    await page.getByRole('button',{name:'返回上一级'}).click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    record(mode+': repeated trusted Cell navigation returns to Owner map',
      await page.locator('[data-xdrive-places-cluster-overview]').count()===1)
    record(mode+': real Gallery Child never fetches private Owner media',
      requests.every(item=>item.host!=='child'||
        !item.path.startsWith('/api/v1/')))
    record(mode+': mounted production Gallery has no runtime error',
      errors.length===0)
    // Both SDK Hosts must reauthorize the SAME current camera Owner Range.
    const priorCameraReads=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(read=>read.kind==='viewport').length)
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first().click()
    await page.locator('[data-xdrive-places-photo-drawer-nearby]').waitFor({state:'visible'})
    await page.locator('[data-xdrive-places-photo-drawer-nearby]').click()
    await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
    const nearby=await page.evaluate(()=>({
      reads:window.__mapProbe.galleryPageReads.filter(read=>read.kind==='viewport'),
      errors:window.__mapProbe.galleryPageErrors,
    }))
    record(mode+': nearby sheet uses freshly authorized Camera Range',
      nearby.reads.length>priorCameraReads &&
      nearby.reads.at(-1)?.total===3 &&
      nearby.errors.length===0)
    await page.getByRole('button',{name:'返回上一级'}).click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    record(mode+': nearby sheet back returns to Owner map without SDK error',
      await page.locator('[data-xdrive-gallery-places-map]').count()===1 &&
      errors.length===0)
    // Mark a mode only after the complete shipped Page → Cell → Viewer →
    // Wall → Map flow has passed all real Gin/PG and browser assertions.
    summary.fullGalleryPageModes.push(mode)
    return {mode,drawerUsed}
  } finally {await context.close()}
}
async function testFullGalleryDirectPhoto(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    const url='https://'+galleryHost+':'+port+'/?mode='+mode+
      '&full_gallery=1&full_gallery_direct=1'+
      (mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto(url,{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    await cover.click()
    const drawer=page.locator('[data-xdrive-places-photo-drawer]')
    await drawer.waitFor({state:'visible'})
    const photo=drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
    await photo.waitFor({state:'visible'})
    record(mode+': shipped Gallery Page shows 3 authorized thumbnail cells',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===3)
    const before=await page.evaluate(()=>{
      const r=window.__mapProbe.galleryPageReads.filter(x=>x.kind==='cell')
      return {count:r.length,range:r.at(-1)}
    })
    record(mode+': Page drawer thumbnails originated in Gin Owner Cell Range',
      before.count>=1&&before.range?.total===3&&
      before.range.nodeIDs?.length===3)
    const originalBytes=page.waitForResponse(response=>{
      const path=new URL(response.url()).pathname
      return path.startsWith('/api/v1/file-preview/')&&response.status()===200
    })
    await photo.click()
    const original=page.locator('[data-xdrive-image-phase="original"]').first()
    await original.waitFor({state:'visible'})
    const img=original.locator('img:not([aria-hidden="true"])').first()
    await img.waitFor({state:'visible'})
    const binary=await (await originalBytes).body()
    const opened=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {opens:p.galleryPageDirectOpens,
        ranges:p.galleryPageReads.filter(x=>x.kind==='cell'),
        errors:p.galleryPageErrors}
    })
    const photoOpen=opened.opens.at(-1)
    record(mode+': Photo drawer used separate signed Owner Cell Range before Viewer',
      opened.opens.length===1&&opened.ranges.length>before.count&&
      opened.ranges.at(-1)?.total===3&&
      photoOpen?.kind==='baidu-cell'&&photoOpen.total===3&&
      before.range.nodeIDs.includes(photoOpen.nodeID)&&
      photoOpen.revision>0&&opened.errors.length===0)
    record(mode+': direct Page Viewer loads and decodes physical PNG CAS bytes',
      binary.length>50&&binary.subarray(0,8).equals(
        Buffer.from([137,80,78,71,13,10,26,10]))&&
      await img.evaluate(x=>x instanceof HTMLImageElement&&
        x.complete&&x.naturalWidth===2&&x.naturalHeight===2))
    if(mode==='isolated'){
      record('isolated: direct Viewer disposes map SDK Child before loading original',
        !page.frames().some(frame=>frame.url().includes(childHost))&&
        await page.locator('[data-xdrive-baidu-isolated-frame]').count()===0)
    }
    await page.getByRole('button',{name:'关闭预览'}).click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    const restored=page.locator('[data-xdrive-places-photo-drawer]')
    try {
      await restored.waitFor({state:'visible',timeout:11000})
      await restored.locator('[data-xdrive-places-photo-drawer-item]').first()
        .waitFor({state:'visible'})
    } catch (error) {
      // A missing return is not a pass. Record only synthetic test identities
      // and counts; never print auth tokens, media URLs, or Owner credentials.
      const diagnostic=await page.evaluate(()=>{
        const p=window.__mapProbe
        const cell=p.galleryPageReads.filter(x=>x.kind==='cell')
        return {closed:p.galleryPageDirectClosed,
          map:!!document.querySelector('[data-xdrive-places-cluster-overview]'),
          drawer:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
          selection:p.galleryPageDirectOpens.at(-1)?.nodeID,
          cameraCount:p.cameras.length,ownerCells:p.queries.length,
          recentScopes:p.queries.slice(-2).map(x=>({
            count:x.count,favorite:x.favorite,bounds:x.bounds})),
          ownerMemberReads:cell.length,lastMember:cell.at(-1),
          errors:p.galleryPageErrors.slice(-3),failed:p.failed}
      })
      throw Error(mode+': trusted drawer missing after Viewer Back: '+
        JSON.stringify(diagnostic)+'; '+String(error))
    }
    const returning=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {closed:p.galleryPageDirectClosed,
        ranges:p.galleryPageReads.filter(x=>x.kind==='cell'),
        errors:p.galleryPageErrors}
    })
    const ids=items=>JSON.stringify([...items].sort((a,b)=>a-b))
    record(mode+': direct Viewer Back restores drawer using fresh Gin Owner Range',
      returning.closed===1&&returning.ranges.length>opened.ranges.length&&
      returning.ranges.at(-1)?.total===3&&
      ids(returning.ranges.at(-1)?.nodeIDs||[])===
        ids(before.range.nodeIDs)&&returning.errors.length===0)
    record(mode+': restored Page has no runtime or cross-Origin media leak',
      errors.length===0&&requests.every(x=>x.host!=='child'||
        !x.path.startsWith('/api/v1/')))
    summary.fullGalleryDirectPhotoModes.push(mode)
  }finally{await context.close()}
}
async function swipeMobileDrawerGrip(page,direction){
  const rect=await page.locator('[data-xdrive-places-photo-drawer-grip]').boundingBox()
  assert(rect && rect.width>100 && rect.height>=24,'actual visible photo grip required')
  const x=Math.round(rect.x+rect.width/2)
  const y=Math.round(rect.y+rect.height/2)
  const sign=direction==='up'?-1:1
  const cdpsession=await page.context().newCDPSession(page)
  try{
    await cdpsession.send('Input.dispatchTouchEvent',
      {type:'touchStart',touchPoints:[{x,y}]})
    await cdpsession.send('Input.dispatchTouchEvent',
      {type:'touchMove',touchPoints:[{x,y:y+sign*26}]})
    await cdpsession.send('Input.dispatchTouchEvent',
      {type:'touchMove',touchPoints:[{x,y:y+sign*76}]})
    await cdpsession.send('Input.dispatchTouchEvent',
      {type:'touchEnd',touchPoints:[]})
  }finally{await cdpsession.detach()}
}
async function testMobilePhotoDrawer(browser,mode,port){
  // 390px real-touch Chromium with shipped Gallery and real Gin Owner Ranges.
  // CDP touch dispatch exercises native pointer capture, not synthetic DOM swipes.
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,
    locale:'zh-CN',ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',e=>errors.push(e.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    const url='https://'+galleryHost+':'+port+'/?mode='+mode+
      '&full_gallery=1&full_gallery_direct=1'+
      (mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto(url,{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first().tap()
    const drawer=page.locator('[data-xdrive-places-photo-drawer]')
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first().waitFor()
    const geometry=await page.evaluate(()=>{
      const rect=document.querySelector('[data-xdrive-places-photo-drawer]').getBoundingClientRect()
      const map=document.querySelector('[data-xdrive-places-cluster-overview]').getBoundingClientRect()
      return {viewport:window.innerWidth,left:rect.left,right:rect.right,
        width:rect.width,mapWidth:map.width,mapHeight:map.height}
    })
    record(mode+': iOS 390px sheet and map remain within screen bounds',
      geometry.viewport===390&&geometry.left>=0&&
      geometry.right<=geometry.viewport+1&&geometry.mapWidth<=geometry.viewport+1&&
      geometry.mapHeight>=520)
    await swipeMobileDrawerGrip(page,'up')
    await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').waitFor({state:'visible'})
    record(mode+': real upward touch expands trusted photo drawer',
      await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').count()===1)
    await swipeMobileDrawerGrip(page,'down')
    await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="展开照片抽屉"]').waitFor({state:'visible'})
    record(mode+': real downward touch collapses without dismissing Owner photos',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===3)
    const before=await page.evaluate(()=>window.__mapProbe.galleryPageReads.filter(
      r=>r.kind==='cell').length)
    const touchPhoto=drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
    const hit=await touchPhoto.evaluate(node=>{
      const rect=node.getBoundingClientRect()
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2
      const at=document.elementFromPoint(x,y)
      return {inside:!!at&&node.contains(at),width:rect.width,height:rect.height,
        pointerEvents:getComputedStyle(node).pointerEvents}
    })
    record(mode+': mobile photo thumbnail is genuinely hit-testable after grip',
      hit.inside&&hit.width>=44&&hit.height>=44&&hit.pointerEvents!=='none')
    // Invalid native contacts must never turn into a Viewer/Owner Range, even
    // if Chromium generates a follow-on compatibility click. These are CDP
    // touch events, not dispatchEvent()/synthetic DOM click shortcuts.
    const nativeNoOpen = async (kind) => {
      const initial=await page.evaluate(()=>({
        reads:window.__mapProbe.galleryPageReads.filter(x=>x.kind==='cell').length,
        opens:window.__mapProbe.galleryPageDirectOpens.length,
        errors:window.__mapProbe.galleryPageErrors.length,
      }))
      const rect=await touchPhoto.boundingBox()
      assert(rect && rect.width>=44&&rect.height>=44,
        'native negative photo touch requires visible 44px tile')
      const x=Math.round(rect.x+rect.width/2)
      const y=Math.round(rect.y+rect.height/2)
      const cdp=await context.newCDPSession(page)
      try {
        await cdp.send('Input.dispatchTouchEvent',{
          type:'touchStart',touchPoints:[{x,y}]})
        if (kind==='long-hold') await page.waitForTimeout(760)
        if (kind==='drag') {
          await cdp.send('Input.dispatchTouchEvent',{
            type:'touchMove',touchPoints:[{x:x-24,y}]})
          await cdp.send('Input.dispatchTouchEvent',{
            type:'touchMove',touchPoints:[{x:x-52,y}]})
        }
        await cdp.send('Input.dispatchTouchEvent',{
          type:kind==='cancel'?'touchCancel':'touchEnd',touchPoints:[]})
      } finally { await cdp.detach() }
      await page.waitForTimeout(110)
      const after=await page.evaluate(()=>({
        reads:window.__mapProbe.galleryPageReads.filter(x=>x.kind==='cell').length,
        opens:window.__mapProbe.galleryPageDirectOpens.length,
        errors:window.__mapProbe.galleryPageErrors.length,
        drawer:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
      }))
      record(mode+': native mobile '+kind+' never authorizes Viewer',
        after.reads===initial.reads&&after.opens===initial.opens&&
        after.errors===initial.errors&&after.drawer)
    }
    await nativeNoOpen('long-hold')
    await nativeNoOpen('drag')
    await nativeNoOpen('cancel')
    // Observe a real DOM click without manually dispatching it. The owner
    // contract must then complete another authorized /cell-items Range.
    await touchPhoto.evaluate(node=>{
      node.addEventListener('click',()=>{
        window.__mapProbe.mobilePhotoDOMClicks=
          (window.__mapProbe.mobilePhotoDOMClicks||0)+1
      },{once:true})
      // Diagnose native event delivery without dispatching a fake click or
      // reading Owner photo identities/URLs. A touch swipe must not be
      // mistaken for an authorized thumbnail tap.
      const trace=(window.__mapProbe.mobileTouchTrace=[])
      for(const type of ['pointerdown','pointerup','pointercancel',
        'touchstart','touchend','touchcancel','click']){
        document.addEventListener(type,event=>{
          if(trace.length>=24)return
          const target=event.target
          const tile=target instanceof Element&&
            target.closest('[data-xdrive-places-photo-drawer-item]')
          trace.push({type,onTile:Boolean(tile),
            pointerType:event.pointerType||null,
            defaultPrevented:Boolean(event.defaultPrevented)})
        },{capture:true})
      }
      // Bubble-phase evidence distinguishes browser gesture suppression from
      // a consumer calling preventDefault; never dispatch a synthetic click.
      for(const type of ['pointerdown','pointerup','touchstart','touchend']){
        document.addEventListener(type,event=>{
          if(trace.length>=24)return
          const target=event.target
          const tile=target instanceof Element&&
            target.closest('[data-xdrive-places-photo-drawer-item]')
          trace.push({type:type+'-bubble',onTile:Boolean(tile),
            defaultPrevented:Boolean(event.defaultPrevented)})
        },{capture:false})
      }
    })
    const previewStatuses=[]
    const onPreviewResponse=response=>{
      const pathname=new URL(response.url()).pathname
      if(pathname.startsWith('/api/v1/file-preview/'))
        previewStatuses.push(response.status())
    }
    page.on('response',onPreviewResponse)
    await touchPhoto.tap()
    const didOpen=await page.waitForFunction(()=>
      window.__mapProbe.galleryPageDirectOpens.length>0 ||
      window.__mapProbe.galleryPageErrors.length>0,
      null,{timeout:10000}).then(()=>true).catch(()=>false)
    const snapshot=async()=>page.evaluate(()=>({
      clicks:window.__mapProbe.mobilePhotoDOMClicks||0,
      touchTrace:window.__mapProbe.mobileTouchTrace||[],
      ownerRanges:window.__mapProbe.galleryPageReads.filter(r=>r.kind==='cell').length,
      viewerOpens:window.__mapProbe.galleryPageDirectOpens.length,
      errorCount:window.__mapProbe.galleryPageErrors.length,
      mapVisible:!!document.querySelector('[data-xdrive-places-cluster-overview]'),
      drawerVisible:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
      viewerVisible:!!document.querySelector('[data-xdrive-open-preview-dialog]'),
      imagePhase:document.querySelector('[data-xdrive-image-phase]')?.getAttribute('data-xdrive-image-phase')||'none',
    }))
    const clickState=await snapshot()
    const nativeTouch=clickState.touchTrace
      .some(event=>event.type==='pointerdown'&&event.onTile&&
        event.pointerType==='touch'&&!event.defaultPrevented) &&
      clickState.touchTrace
        .some(event=>event.type==='pointerup'&&event.onTile&&
          event.pointerType==='touch'&&!event.defaultPrevented) &&
      clickState.touchTrace
        .some(event=>event.type==='touchend'&&event.onTile&&
          !event.defaultPrevented) &&
      !clickState.touchTrace.some(event=>
        event.type==='pointercancel'&&event.onTile)
    record(mode+': real mobile touch uses genuine uncancelled tile pointer '+
      JSON.stringify(clickState.touchTrace),nativeTouch)
    // Chrome/Safari can suppress the follow-on compatibility click after a
    // native scroll gesture. Product pointerup activates this *actual* short
    // touch once; a real click, when present, must not duplicate authorization.
    // No DOM-dispatched click, synthetic click, or bypass of signed Owner Range.
    record(mode+': real mobile photo touch activates one Viewer Owner Range '+
      JSON.stringify(clickState),
      didOpen&&nativeTouch&&clickState.viewerOpens===1&&
      clickState.ownerRanges>before&&clickState.errorCount===0)
    const original=page.locator('[data-xdrive-image-phase="original"]').first()
    const decoded=await original.waitFor({state:'visible',timeout:12000})
      .then(()=>true).catch(()=>false)
    const decodeState=await snapshot()
    page.off('response',onPreviewResponse)
    record(mode+': mobile photo Viewer decodes real signed CAS PNG '+
      JSON.stringify({...decodeState,previewHTTP:previewStatuses}),
      decoded&&decodeState.imagePhase==='original'&&
      previewStatuses.includes(200))
    const opened=clickState.ownerRanges
    // Narrow immersive Viewer uses its accessible iOS back control,
    // not the desktop-only "关闭预览" button.
    const mobileBack=page.getByRole('button',{name:'返回图库'})
    await mobileBack.waitFor({state:'visible'})
    const chromeHeader=page.locator('[data-xdrive-preview-chrome="header"]')
    if(await chromeHeader.evaluate(node=>
      getComputedStyle(node).pointerEvents==='none')){
      // Wake genuine auto-hidden mobile chrome with an actual touch; do not
      // directly invoke a React handler or bypass the Owner Viewer.
      await page.locator('[data-xdrive-image-phase="original"]').first().tap()
      await page.waitForFunction(() => {
        const chrome=document.querySelector('[data-xdrive-preview-chrome="header"]')
        return chrome && getComputedStyle(chrome).pointerEvents!=='none'
      })
    }
    await mobileBack.tap()
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible',timeout:11000})
    const returned=await page.evaluate(()=>({
      ranges:window.__mapProbe.galleryPageReads.filter(r=>r.kind==='cell').length,
      errors:window.__mapProbe.galleryPageErrors,
    }))
    record(mode+': mobile Viewer Back restores Owner-authorized photo drawer',
      returned.ranges>opened&&returned.errors.length===0&&errors.length===0)
    record(mode+': mobile isolated SDK never accesses private media',
      requests.every(item=>item.host!=='child'||!item.path.startsWith('/api/v1/')))
    summary.mobileDrawerModes.push(mode)
  }finally{await context.close()}
}

async function main(){
  await esbuild.build({
    entryPoints:[source],bundle:true,jsx:'automatic',logLevel:'silent',
    outfile:path.join(temp,'bundle.js'),
    nodePaths:[path.join(root,'desktop/node_modules')],
    alias:{'@fixture/surface':path.join(root,'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'),
      '@fixture/viewer':path.join(root,'ui/shared/src/mui/MediaGalleryViewer.tsx'),
      '@fixture/gallery-page':path.join(root,'ui/shared/src/mui/MediaGallery.tsx')},
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
        pathname==='/api/v1/media/items' ||
        pathname.startsWith('/api/v1/media/items/') ||
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
    record('Child SDK loaded only after each separate HTTPS map session',
      childSDKLoads===2&&childSessionRedeems===2)
    record('only reviewed synthetic registered sites were accessed',
      requests.every(item=>item.host==='gallery'||item.host==='child'))
    if(ginURL){
      const inlinePage=await testFullGalleryPage(browser,'inline',port)
      const isolatedPage=await testFullGalleryPage(browser,'isolated',port)
      record('both SDK Hosts completed the real Gallery Page Viewer return',
        summary.fullGalleryPageModes.join(',')==='inline,isolated')
      record('inline and isolated Hosts use identical trusted Cell entry flow',
        inlinePage.drawerUsed===isolatedPage.drawerUsed)
      await testFullGalleryDirectPhoto(browser,'inline',port)
      await testFullGalleryDirectPhoto(browser,'isolated',port)
      record('both Hosts passed real Page thumbnail→Viewer→drawer Back',
        summary.fullGalleryDirectPhotoModes.join(',')==='inline,isolated')
      await testMobilePhotoDrawer(browser,'inline',port)
      await testMobilePhotoDrawer(browser,'isolated',port)
      record('both SDK Hosts completed 390px touch grip and real Owner Viewer return',
        summary.mobileDrawerModes.join(',')==='inline,isolated')
    }
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
