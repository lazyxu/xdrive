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
  ownerScopeInvalidationModes:[],
  fullGalleryPageModes:[],fullGalleryDirectPhotoModes:[],mobileDrawerModes:[],
  favoriteMapCloseModes:[],fullDocumentHandoffModes:[],
  fullDocumentComboModes:[],fullDocumentNegativeFilterModes:[],
  iosCompactModes:[],sourceRevisionModes:[],realHEICMapCoverModes:[],realLIVPMapCoverModes:[],
  checks:[],passed:false,errors:[]}
const record=(name,ok)=>{summary.checks.push({name,passed:!!ok});assert(ok,name)}
const h264GoSource=fs.readFileSync(path.join(root,
  'internal/api/media_gallery_first_visible_performance_integration_test.go'),'utf8')
const h264Match=/galleryFirstVisibleVideoMP4Base64\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(h264GoSource)
assert(h264Match,'existing genuine H264 test fixture missing')
const h264Movie=Buffer.from(h264Match[1],'base64')
assert(h264Movie.length>1000&&h264Movie.length<65536&&
  h264Movie.subarray(0,128).includes(Buffer.from('ftyp')),
  'only bounded genuine MP4 test bytes permitted')
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
      this.zoom=12;this.overlays=[];this.maxOverlays=0;this.listeners=new Map()
      this.panOffset={x:0,y:0}
      // Public, synthetic SDK state only; never Owner tokens, GPS or URLs.
      ;(window.__xdriveSyntheticMapInstances ||= []).push(this)}
    centerAndZoom(point,zoom){this.center=point;this.zoom=zoom}
    setViewport(points){if(points[0])this.center=points[0]}
    enableScrollWheelZoom(){}
    enableDoubleClickZoom(){}
    enablePinchToZoom(){}
    addEventListener(name,fn){this.listeners.set(name,fn)}
    removeEventListener(name){this.listeners.delete(name)}
    addOverlay(label){this.overlays.push(label)
      this.maxOverlays=Math.max(this.maxOverlays,this.overlays.length)}
    removeOverlay(label){this.overlays=this.overlays.filter(x=>x!==label)}
    getCenter(){return this.center}
    getZoom(){return this.zoom}
    getBounds(){return {getSouthWest:()=>new Point(100,20),
      getNorthEast:()=>new Point(125,40)}}
    pointToPixel(){
      // The synthetic representative is deliberately centered in the
      // CURRENT CSS map canvas. A fixed old 180px point would make short
      // landscape tests accidentally accept stale pre-resize projections.
      const width=Math.round(this.canvas?.clientWidth||0)
      const height=Math.round(this.canvas?.clientHeight||0)
      return {x:(width>=120?Math.round(width/2):180)+this.panOffset.x,
        y:(height>=120?Math.round(height/2):180)+this.panOffset.y}
    }
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
const ginFailureStage=path.join(temp,'real-gin-failure-stage')
async function startRealGin(galleryOrigin){
  const binary=process.env.XD_PLACES_P04_GO_BINARY
  if(!binary)return
  assert(fs.existsSync(binary),'compiled real Gin fixture required')
  ginProcess=spawn(binary,['-test.run=^TestPlacesP04MountedBrowserRealGinFixture$',
    '-test.count=1','-test.timeout=4m'],{
    env:{...process.env,XD_PLACES_P04_BROWSER_GIN:'1',
      XD_PLACES_P04_GALLERY_ORIGIN:galleryOrigin,
      XD_PLACES_P04_READY_FILE:ginReady,XD_PLACES_P04_STOP_FILE:ginStop,
      XD_PLACES_P04_FAILURE_STAGE:ginFailureStage},
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
    if(ginProcess.exitCode!==null){
      const stage=fs.existsSync(ginFailureStage)
        ? fs.readFileSync(ginFailureStage,'utf8').trim() : 'unknown'
      throw Error('real Gin exited before readiness at '+
        (/^[a-z0-9-]{1,40}$/.test(stage)?stage:'redacted'))
    }
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


async function testFullDocumentMapHandoff(browser,from,port,combined=false){
  const target=from==='inline'?'isolated':'prototype'
  const label=from+(combined?':Family-date-kind-sort':'')
  const expectedCount=combined?2:3
  const checkScope=query=>{
    if(!combined)return query.favorite===true&&query.albumKey===''
    const filters=query.filters
    return query.favorite===true&&query.albumKey==='manual:Family'&&
      filters?.sort_by==='added'&&filters?.sort_dir==='asc'&&
      filters?.favorite===true&&filters?.asset_kind==='image'&&
      filters?.captured_from==='2026-10-19'&&
      filters?.captured_to==='2026-10-22'&&filters?.time_zone==='Asia/Tokyo'
  }
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const u=new URL(route.request().url())
    assert.equal(u.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    const fromQuery=from==='isolated'?'&places_map_mode=isolated':''
    await page.goto('https://'+galleryHost+':'+port+
      '/?handoff_doc=1'+(combined?'&handoff_combo=1':'')+fromQuery,
      {waitUntil:'domcontentloaded'})
    // This is the actual XDriveMediaGalleryPlacesMap Parent, not the old
    // minimal TestApp fixture. Its authoritative ready signal is the rendered
    // trusted Owner Count, not TestApp's private __mapProbe.ready boolean.
    await page.getByText('当前地图可查看 '+expectedCount+' 张照片',
      {exact:true}).waitFor()
    const original=await page.evaluate(()=>window.__mapProbe.queries)
    record(label+': original restricted Owner map before document handoff',
      original.length>0&&original.every(checkScope))
    await page.locator('[data-xdrive-places-map-more-menu] > summary').click()
    await page.locator('[data-xdrive-map-mode-'+target+']').click()
    await page.waitForURL(url=>url.searchParams.get('places_map_scope_required')==='1'&&
      (target==='prototype'?!url.searchParams.has('places_map_mode'):
        url.searchParams.get('places_map_mode')==='isolated'))
    await page.waitForFunction(()=>window.__mapProbe?.handoff?.state==='ready')
    await page.getByText('当前地图可查看 '+expectedCount+' 张照片',
      {exact:true}).waitFor()
    const accepted=await page.evaluate(()=>({
      url:location.href,
      ownerQueries:window.__mapProbe.queries,
      handoff:window.__mapProbe.handoff,
      count:document.querySelector('[data-xdrive-places-map-photo-summary]')?.textContent,
      cover:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
    }))
    // Assert independent real-Gin restore properties before waiting for
    // any third-party SDK pixel projection. A valid Owner /cells Count may
    // render before asynchronously projected pins; neither should mask an
    // authentication or filter regression behind a composite assertion.
    record(label+'→'+target+': one Gin/PostgreSQL Owner handoff consumed',
      accepted.handoff.consumes===1&&accepted.handoff.state==='ready')
    record(label+'→'+target+': precise restricted Owner Cells survived full document',
      accepted.ownerQueries.length>0&&
      accepted.ownerQueries.every(checkScope)&&
      accepted.count?.includes(expectedCount+' 张照片'))
    await page.locator('[data-xdrive-places-trusted-photo-cover]')
      .first().waitFor({state:'visible'})
    record(label+'→'+target+': restored Owner photo cover actually rendered',
      await page.locator('[data-xdrive-places-trusted-photo-cover]').count()>0)
    record(label+'→'+target+': opaque one-use token hides Owner filters',
      accepted.url.includes('places_map_scope_required=1')&&
      !accepted.url.includes('places_map_handoff=')&&
      !accepted.url.includes('manual:')&&!accepted.url.includes('favorite=true')&&
      !accepted.url.includes('asset_kind')&&!accepted.url.includes('captured_from')&&
      !accepted.url.includes('time_zone'))
    if(combined){
      // The original combo scenario proves exact preservation, but its nine
      // sampled photos all have the same image kind and October 20 capture
      // date. Exercise the SHIPPED shared filter controls on the restored
      // Owner map, so a backend that ignores date or kind now fails visibly.
      const menu=page.locator('[data-xdrive-places-map-filter-menu]')
      const openFilters=async()=>{
        if(!(await menu.evaluate(element=>element.open)))
          await menu.locator('summary').click()
      }
      const filteredEmpty='当前筛选条件下暂无定位照片；可调整筛选或手动刷新。'
      const currentMap=()=>page.evaluate(()=>({
        queries:window.__mapProbe.queries,
        covers:document.querySelectorAll(
          '[data-xdrive-places-trusted-photo-cover]').length,
        empty:document.querySelector(
          '[data-xdrive-places-map-photo-summary]')?.textContent,
      }))
      await openFilters()
      await page.locator('[data-xdrive-places-map-photo-filters] input[type="date"]')
        .first().fill('2026-10-21')
      await page.getByText(filteredEmpty,{exact:true}).waitFor()
      const excludedDate=await currentMap()
      record(label+'→'+target+': real Owner date filter excludes October 20 photos',
        excludedDate.queries.at(-1)?.count===0&&excludedDate.covers===0&&
        excludedDate.queries.at(-1)?.albumKey==='manual:Family'&&
        excludedDate.queries.at(-1)?.filters?.favorite===true&&
        excludedDate.queries.at(-1)?.filters?.asset_kind==='image'&&
        excludedDate.queries.at(-1)?.filters?.captured_from==='2026-10-21'&&
        excludedDate.queries.at(-1)?.filters?.captured_to==='2026-10-22')
      await openFilters()
      await page.locator('[data-xdrive-places-map-photo-filters] input[type="date"]')
        .first().fill('2026-10-19')
      await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
      await page.locator('[data-xdrive-places-trusted-photo-cover]')
        .first().waitFor({state:'visible'})
      const recoveredDate=await currentMap()
      record(label+'→'+target+': date restore recovers exact Family Favorite intersection',
        recoveredDate.queries.at(-1)?.count===2&&
        recoveredDate.queries.at(-1)?.filters?.captured_from==='2026-10-19'&&
        recoveredDate.covers>0)
      await openFilters()
      await page.getByRole('combobox',{name:'照片类型'}).click()
      await page.getByRole('option',{name:'视频',exact:true}).click()
      await page.getByText(filteredEmpty,{exact:true}).waitFor()
      const excludedKind=await currentMap()
      record(label+'→'+target+': real Owner media-kind filter excludes image-only Album',
        excludedKind.queries.at(-1)?.count===0&&excludedKind.covers===0&&
        excludedKind.queries.at(-1)?.albumKey==='manual:Family'&&
        excludedKind.queries.at(-1)?.filters?.favorite===true&&
        excludedKind.queries.at(-1)?.filters?.asset_kind==='video'&&
        excludedKind.queries.at(-1)?.filters?.captured_from==='2026-10-19')
      await openFilters()
      await page.getByRole('combobox',{name:'照片类型'}).click()
      await page.getByRole('option',{name:'照片',exact:true}).click()
      await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
      await page.locator('[data-xdrive-places-trusted-photo-cover]')
        .first().waitFor({state:'visible'})
      const recoveredKind=await currentMap()
      record(label+'→'+target+': kind restore recovers Owner pins with no scope expansion',
        recoveredKind.queries.at(-1)?.count===2&&recoveredKind.covers>0&&
        recoveredKind.queries.every(q=>q.albumKey==='manual:Family'&&
          q.favorite===true)&&errors.length===0)
      summary.fullDocumentNegativeFilterModes.push(from)
    }
    await page.reload({waitUntil:'domcontentloaded'})
    await page.locator('[data-xdrive-map-handoff-denied="1"]').waitFor()
    const denied=await page.evaluate(()=>({
      state:window.__mapProbe?.handoff?.state,
      queries:window.__mapProbe?.queries?.length,
      map:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      token:location.href.includes('places_map_handoff='),
    }))
    record(label+'→'+target+': full reload cannot replay or broaden restricted Owner map',
      denied.state==='denied'&&denied.queries===0&&denied.map===0&&
      !denied.token&&errors.length===0)
    if(combined)summary.fullDocumentComboModes.push(from)
    else summary.fullDocumentHandoffModes.push(from)
  }finally{await context.close()}
}


/** Real loopback Gin + PostgreSQL pending ticket, then a test-only bounded
 * Album/Owner state change before full-document mode handoff consumption.
 * The authentic Web startup scrubber must deny SDK, Viewer and all Cells;
 * no origin, bearer, nonce or Album value is logged or persisted in fixtures. */
/** The same authenticated shared Gallery map in both SDK Hosts is the
 * mobile iOS photo-map canvas. Inspect actually rendered Chromium layout and
 * Owner pins: screenshots alone and source-only CSS tests cannot prove that
 * the map stays visible beneath its floating chrome. */
async function testIOSPhotoMapCompactChrome(browser,mode,scheme,port){
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',colorScheme:scheme,
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    const query='/?handoff_doc=1&handoff_combo=1&ios_compact=1&ui_scheme='+
      scheme+(mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto('https://'+galleryHost+':'+port+query,
      {waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-trusted-photo-cover]')
      .first().waitFor({state:'visible'})
    const expectedDark=scheme==='dark'
    for(const [width,height] of [
      [375,812],[390,844],[844,390],[899,390],[900,390],
      [899,1200],[900,1200],
    ]){
      const beforeResizeQueries=await page.evaluate(()=>window.__mapProbe.queries.length)
      await page.setViewportSize({width,height})
      // A real container size change must not reuse an old 390px photo
      // projection. Both SDK Hosts cancel it and request a freshly signed
      // viewport after the existing 500ms camera quiet period.
      await page.waitForFunction(before=>
        window.__mapProbe.queries.length>before,
        beforeResizeQueries,{timeout:30000})
      await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
      await page.locator('[data-xdrive-places-trusted-photo-cover]')
        .first().waitFor({state:'visible'})
      const actual=await page.evaluate(()=>{
        const map=document.querySelector('[data-xdrive-places-ios-map-canvas="1"]')
        const toolbar=document.querySelector('[data-xdrive-places-map-ios-chrome="1"]')
        const noFixedPhotoStrip=!document.querySelector(
          '[data-xdrive-places-photo-collection-strip], '+
          '[data-xdrive-places-map-photo-strip-shell], '+
          '[data-xdrive-places-collection-thumb]')
        const pins=Array.from(
          document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]'))
        const count=document.querySelector('[data-xdrive-places-map-photo-summary]')
        const bounds=el=>{
          if(!el)return null
          const b=el.getBoundingClientRect()
          return {x:b.x,y:b.y,width:b.width,height:b.height,
            top:b.top,bottom:b.bottom,left:b.left,right:b.right}
        }
        // A closed <details> can give hidden advanced-menu buttons positive
        // getBoundingClientRect() dimensions in real Chromium. Only controls
        // that are actually painted/hit-testable count as 44px touch targets.
        const hits=Array.from(toolbar?.querySelectorAll('summary,button')||[])
          .filter(el=>el.checkVisibility())
          .map(el=>bounds(el)).filter(b=>b&&b.width>0&&b.height>0)
        const badge=document.querySelector('[data-xdrive-places-photo-count-badge]')
        return {map:bounds(map),toolbar:bounds(toolbar),
          footer:bounds(count),noFixedPhotoStrip,hits,
          pins:pins.length,pinButtons:pins.map(bounds),
          badge:badge?getComputedStyle(badge).backgroundColor:null,
          toolbarPosition:toolbar?getComputedStyle(toolbar).position:null,
          text:toolbar?.textContent||'',summary:count?.textContent||'',
          currentOwnerQueries:window.__mapProbe.queries,
        }
      })
      const label=mode+': '+scheme+' '+width+'x'+height
      record(label+': one photo-first full-bleed map and floating header',
        actual.map!==null&&actual.toolbar!==null&&
        actual.toolbarPosition==='absolute'&&
        actual.map.height>=Math.max(180,height-160)&&
        actual.map.bottom<=height-8&&
        actual.toolbar.top>=actual.map.top&&
        actual.toolbar.bottom<=actual.map.top+80&&
        actual.toolbar.left>=actual.map.left&&
        actual.toolbar.right<=actual.map.right+1&&
        actual.text.includes('地图'))
      const touchGeometryOK=actual.footer!==null&&
        actual.footer.bottom<=actual.map.bottom&&
        actual.footer.left>=actual.map.left&&
        actual.footer.right<=actual.map.right+1&&
        actual.noFixedPhotoStrip&&
        actual.hits.length>=3&&
        actual.hits.every(b=>b.width>=44&&b.height>=44)&&
        actual.pins>0&&
        actual.pinButtons.length===actual.pins&&
        actual.pinButtons.every(b=>b.width>=44&&b.height>=44)
      if(!touchGeometryOK) {
        // Sanitized CSS rectangles only; never log Owner GPS, Cell or media.
        console.error('ios-compact-map-hit-targets',JSON.stringify({
          label,map:actual.map,toolbar:actual.toolbar,footer:actual.footer,
          noFixedPhotoStrip:actual.noFixedPhotoStrip,hits:actual.hits,
          pins:actual.pins,pinButtons:actual.pinButtons,
        }))
      }
      record(label+': 44px+ map photo and toolbar targets, no fixed photo dock',
        touchGeometryOK)
      record(label+': signed Family∩Favorites stays exactly two covers',
        actual.summary.includes('2 张照片')&&
        actual.currentOwnerQueries.length>0&&
        actual.currentOwnerQueries.every(q=>
          q.albumKey==='manual:Family'&&q.favorite===true&&q.count===2)&&
        actual.badge===(expectedDark
          ?'rgb(10, 132, 255)':'rgb(0, 122, 255)'))
    }
    await page.getByRole('button',{name:'关闭地图'}).click()
    await page.locator('[data-xdrive-ios-map-closed="1"]').waitFor()
    const closed=await page.evaluate(()=>({
      map:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      sdk:document.querySelectorAll('[data-xdrive-baidu-isolated-frame]').length,
      covers:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
    }))
    record(mode+': '+scheme+' mobile Close unmounts only the current Owner map',
      closed.map===0&&closed.sdk===0&&closed.covers===0&&errors.length===0)
    summary.iosCompactModes.push(mode+':'+scheme)
  }finally{await context.close()}
}

async function testInvalidatedOwnerHandoff(browser,from,port,scenario){
  const target=from==='inline'?'isolated':'prototype'
  assert(['foreign-owner','album-revision','album-missing','album-deleted',
    'session-revoked','map-epoch-revoked','network-drop'].includes(scenario))
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const runtimeErrors=[]
  let droppedConsumes=0
  page.on('pageerror',error=>runtimeErrors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  const actionPath='/__fixture/map-handoff-invalidate'
  const restore=async()=>{
    try{
      return await page.evaluate(async path=>{
        const owner=await fetch('/__fixture/map-owner',{cache:'no-store'})
          .then(r=>r.json())
        const response=await fetch(path,{method:'POST',cache:'no-store',
          headers:{Authorization:'Bearer '+owner.token,
            'Content-Type':'application/json'},
          body:JSON.stringify({action:'restore'})})
        return response.status
      },actionPath)
    }catch{return 0}
  }
  try{
    const initial='https://'+galleryHost+':'+port+'/?handoff_doc=1'+
      (from==='isolated'?'&places_map_mode=isolated':'')
    await page.goto(initial,{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    const prepared=await page.evaluate(async args=>{
      const owner=await fetch('/__fixture/map-owner',{cache:'no-store'})
        .then(r=>r.json())
      const path='/api/v1/media/places/baidu-jsapi/scope-handoff'
      const issued=await fetch(path,{method:'POST',cache:'no-store',
        headers:{Authorization:'Bearer '+owner.token,
          'Content-Type':'application/json'},
        body:JSON.stringify({target_mode:args.target,
          scope:{albumKey:'manual:Family',
            filters:{sort_by:'captured',sort_dir:'desc',favorite:true}}})})
      if(!issued.ok)return {issued:issued.status,changed:0,ticket:''}
      const receipt=await issued.json()
      if(!/^[a-f0-9]{64}$/.test(receipt?.ticket||''))
        return {issued:issued.status,changed:0,ticket:''}
      let changed=204
      if(args.scenario!=='foreign-owner'&&args.scenario!=='network-drop'){
        const response=await fetch(args.actionPath,{method:'POST',
          cache:'no-store',
          headers:{Authorization:'Bearer '+owner.token,
            'Content-Type':'application/json'},
          body:JSON.stringify({action:args.scenario})})
        changed=response.status
      }
      return {issued:issued.status,changed,ticket:receipt.ticket}
    },{scenario,target,actionPath})
    record(from+'→'+target+': test Owner issued one-use ticket before '+scenario,
      prepared.issued===200&&prepared.changed===204&&
      /^[a-f0-9]{64}$/.test(prepared.ticket))
    if(scenario==='network-drop'){
      // Interrupt the REAL Owner/Gin consumption request at Chromium's
      // transport boundary after the ticket is issued and before the new
      // document can mount its map. Never forge a 403/200 fixture response.
      await page.route('**/api/v1/media/places/baidu-jsapi/scope-handoff/consume',
        route=>{
          if(route.request().method()!=='POST')return route.continue()
          droppedConsumes++
          return route.abort('failed')
        })
    }
    // A real full document replace, not a synthetic consume response.
    await page.evaluate(({ticket,target,foreign})=>{
      const next=new URL(location.href)
      if(target==='isolated')next.searchParams.set('places_map_mode','isolated')
      else next.searchParams.delete('places_map_mode')
      next.searchParams.set('places_map_scope_required','1')
      next.searchParams.set('places_map_handoff',ticket)
      if(foreign)next.searchParams.set('handoff_foreign','1')
      location.replace(next.href)
    },{ticket:prepared.ticket,target,foreign:scenario==='foreign-owner'})
    await page.locator('[data-xdrive-map-handoff-denied="1"]').waitFor()
    const state=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {state:p.handoff.state,consumes:p.handoff.consumes,
        ownerQueries:p.queries.length,
        maps:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
        covers:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
        child:document.querySelectorAll('[data-xdrive-baidu-isolated-frame]').length,
        query:location.search,
      }
    })
    record(from+'→'+target+': '+scenario+' denies cross-document Owner map before SDK',
      state.state==='denied'&&state.consumes===0&&
      state.ownerQueries===0&&state.maps===0&&state.covers===0&&
      state.child===0&&!state.query.includes('places_map_handoff=')&&
      !state.query.includes('manual:Family')&&runtimeErrors.length===0)
    await page.reload({waitUntil:'domcontentloaded'})
    await page.locator('[data-xdrive-map-handoff-denied="1"]').waitFor()
    const reload=await page.evaluate(()=>({
      queries:window.__mapProbe.queries.length,
      maps:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      state:window.__mapProbe.handoff.state,
    }))
    record(from+'→'+target+': '+scenario+' reload cannot widen Owner PhotoScope',
      reload.state==='denied'&&reload.queries===0&&reload.maps===0)
    if(scenario==='network-drop')
      record(from+'→'+target+': dropped Gin consume is never retried on reload',
        droppedConsumes===1&&runtimeErrors.length===0)
    summary.ownerScopeInvalidationModes.push(from+':'+scenario)
  }finally{
    if(scenario!=='foreign-owner'){
      const restored=await restore()
      record(from+': test-only Owner/Album state restored after '+scenario,
        restored===204)
    }
    await context.close()
  }
}
/** A current Owner Node can be replaced after its BD09 position was
 * derived. The existing protected /cells and /cell-items must reject the
 * old source revision under both SDK Hosts, without a new map renderer or
 * a client-side fake permission. */
async function testStaleSourceRevisionOwnerMap(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  const fixtureMutation=action=>page.evaluate(async action=>{
    const owner=await fetch('/__fixture/map-owner',{cache:'no-store'})
      .then(response=>response.json())
    const response=await fetch('/__fixture/map-handoff-invalidate',{
      method:'POST',cache:'no-store',
      headers:{Authorization:'Bearer '+owner.token,
        'Content-Type':'application/json'},
      body:JSON.stringify({action})})
    return response.status
  },action)
  const capturedCells=()=>page.evaluate(async()=>{
    const original=window.__mapProbe?.queries?.at(-1)
    if(!original?.bounds)return {status:0,total:0}
    const owner=await fetch('/__fixture/map-owner',{cache:'no-store'})
      .then(response=>response.json())
    const bounds=original.bounds,filters=original.filters
    const params=new URLSearchParams({
      west:String(bounds.west),south:String(bounds.south),
      east:String(bounds.east),north:String(bounds.north),
      sort_by:filters.sort_by,sort_dir:filters.sort_dir,
      album:original.albumKey,favorite:String(filters.favorite),
      kind:filters.asset_kind,captured_from:filters.captured_from,
      captured_to:filters.captured_to,time_zone:filters.time_zone,
    })
    const response=await fetch('/api/v1/media/places/baidu-jsapi/cells?'+params,{
      cache:'no-store',headers:{Authorization:'Bearer '+owner.token}})
    const body=await response.json().catch(()=>({}))
    return {status:response.status,total:body.total_count,
      first:body.cells?.[0]??null,bounds,filters,
      albumKey:original.albumKey}
  })
  let mutated=false
  try{
    const query='/?handoff_doc=1&handoff_combo=1'+
      (mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto('https://'+galleryHost+':'+port+query,
      {waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    const original=await capturedCells()
    record(mode+': original real Owner Family/Favorite source map has two fresh revisions',
      original.status===200&&original.total===2&&
      original.first?.photo_count===2&&original.first.node_revision===1&&
      original.albumKey==='manual:Family'&&
      original.filters?.favorite===true&&
      original.filters?.asset_kind==='image')
    const changed=await fixtureMutation('source-revision-stale')
    mutated=changed===204
    record(mode+': test-only real PostgreSQL Owner Node advanced its revision',
      changed===204)
    const fresh=await capturedCells()
    record(mode+': real Owner map excludes stale BD09 position after Node revision',
      fresh.status===200&&fresh.total===1&&
      fresh.first?.photo_count===1&&
      fresh.first.node_id!==original.first.node_id&&
      fresh.first.node_revision===1&&fresh.albumKey==='manual:Family')
    const staleRange=await page.evaluate(async ({cell,bounds})=>{
      const owner=await fetch('/__fixture/map-owner',{cache:'no-store'})
        .then(response=>response.json())
      const params=new URLSearchParams({
        west:String(bounds.west),south:String(bounds.south),
        east:String(bounds.east),north:String(bounds.north),
        cell_x:String(cell.cell_x),cell_y:String(cell.cell_y),
        asset_id:String(cell.asset_id),node_id:String(cell.node_id),
        node_revision:String(cell.node_revision),
        photo_count:String(cell.photo_count),
        limit:'48',offset:'0',range:'true',
        sort_by:'added',sort_dir:'asc',album:'manual:Family',
        favorite:'true',kind:'image',captured_from:'2026-10-19',
        captured_to:'2026-10-22',time_zone:'Asia/Tokyo',
      })
      const response=await fetch('/api/v1/media/places/baidu-jsapi/cell-items?'+params,{
        cache:'no-store',headers:{Authorization:'Bearer '+owner.token}})
      const body=await response.json().catch(()=>({}))
      return {status:response.status,error:body.error}
    },{cell:original.first,bounds:original.bounds})
    record(mode+': original signed Cell/Viewer range fails closed after source revision',
      staleRange.status===409&&staleRange.error==='map_cell_changed')
    const menu=page.locator('[data-xdrive-places-map-filter-menu]')
    const openFilters=async()=>{
      if(!(await menu.evaluate(element=>element.open)))
        await menu.locator('summary').click()
    }
    const dateInput=page.locator(
      '[data-xdrive-places-map-photo-filters] input[type="date"]').first()
    await openFilters()
    await dateInput.fill('2026-10-21')
    await page.getByText(
      '当前筛选条件下暂无定位照片；可调整筛选或手动刷新。',
      {exact:true}).waitFor()
    record(mode+': obsolete Owner map pins are removed before filtered empty paint',
      await page.locator('[data-xdrive-places-trusted-photo-cover]').count()===0)
    await openFilters()
    await dateInput.fill('2026-10-19')
    await page.getByText('当前地图可查看 1 张照片',{exact:true}).waitFor()
    await cover.waitFor({state:'visible'})
    const recovered=await page.evaluate(()=>({
      queries:window.__mapProbe.queries,
      coverExists:Boolean(document.querySelector('[data-xdrive-places-trusted-photo-cover]')),
      count:document.querySelector('[data-xdrive-places-map-photo-summary]')?.textContent,
    }))
    record(mode+': shared map refresh keeps only current Family/Favorite Owner member',
      recovered.queries.at(-1)?.count===1&&
      recovered.queries.every(q=>q.albumKey==='manual:Family'&&
        q.favorite===true)&&recovered.coverExists&&
      recovered.count?.includes('1 张照片')&&errors.length===0)
    const restored=await fixtureMutation('source-revision-restore')
    if(restored===204)mutated=false
    record(mode+': synthetic source revision restored after stale-map assertion',
      restored===204)
    await openFilters()
    await dateInput.fill('2026-10-21')
    await page.getByText(
      '当前筛选条件下暂无定位照片；可调整筛选或手动刷新。',
      {exact:true}).waitFor()
    await openFilters()
    await dateInput.fill('2026-10-19')
    await page.getByText('当前地图可查看 2 张照片',{exact:true}).waitFor()
    await cover.waitFor({state:'visible'})
    const afterRestore=await capturedCells()
    record(mode+': current Owner BD09 identity is restored without widening filters',
      afterRestore.status===200&&afterRestore.total===2&&
      afterRestore.first?.photo_count===2&&
      afterRestore.first.node_revision===1&&
      afterRestore.albumKey==='manual:Family'&&
      afterRestore.filters?.favorite===true&&errors.length===0)
    summary.sourceRevisionModes.push(mode)
  }finally{
    if(mutated){
      const restore=await fixtureMutation('source-revision-restore').catch(()=>0)
      record(mode+': fixture source revision cleanup after failure',restore===204)
    }
    await context.close()
  }
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
    // Measure the REAL common map container in the same Chromium fixture for
    // both SDK Host modes, not a screenshot/DOM-free source assertion.
    // A 640px desktop floor must not overflow a 390px iPhone landscape.
    for(const [width,height] of [[375,667],[390,844],[844,390],[900,390]]){
      await page.setViewportSize({width,height})
      const geometry=await page.locator('[data-xdrive-places-cluster-overview]')
        .evaluate(element=>{
          const rect=element.getBoundingClientRect()
          return {height:rect.height,bottom:rect.bottom,windowHeight:innerHeight}
        })
      record(mode+': map fits '+width+'x'+height+' portrait/landscape viewport',
        geometry.height>=180 && geometry.height<=height-80 &&
        geometry.bottom<=height-8 && geometry.windowHeight===height)
    }
    await page.setViewportSize({width:960,height:760})
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
    // A rotation changes the SDK camera's 8x8 Cell authority. The old
    // React drawer MUST be detached first. After a NEW signed Owner /cells
    // page, the shared Parent may automatically restore only the same
    // representative Node+PhotoAsset+revision with an independent /cell-items
    // fetch. No click on an obsolete photo cover or accessible Cell is allowed.
    const beforeLandscape=await page.evaluate(()=>{
      const probe=window.__mapProbe
      probe.oldDrawer=document.querySelector('[data-xdrive-places-photo-drawer]')
      return {queries:probe.queries.length,previews:probe.photoPreviewRanges.length}
    })
    await page.setViewportSize({width:844,height:390})
    await page.waitForFunction(before=>
      window.__mapProbe.queries.length>before.queries &&
      window.__mapProbe.photoPreviewRanges.length>before.previews,
      beforeLandscape)
    const sheet=page.locator('[data-xdrive-places-photo-drawer]')
    await sheet.waitFor({state:'visible'})
    await sheet.locator('[data-xdrive-places-photo-drawer-items] button')
      .first().waitFor({state:'visible'})
    await page.waitForFunction(()=>
      document.querySelector('[data-xdrive-places-photo-drawer-handle]')
        ?.getAttribute('aria-expanded')==='true')
    const landscapeFresh=await page.evaluate(()=>{
      const probe=window.__mapProbe
      const newDrawer=document.querySelector('[data-xdrive-places-photo-drawer]')
      const query=probe.queries.at(-1), preview=probe.photoPreviewRanges.at(-1)
      return {oldDetached:probe.oldDrawer?.isConnected===false &&
          probe.oldDrawer!==newDrawer,
        currentCount:query?.count, favorite:query?.favorite,
        itemTotal:preview?.total,
        items:newDrawer?.querySelectorAll(
          '[data-xdrive-places-photo-drawer-items] button').length,
        expanded:newDrawer?.querySelector(
          '[data-xdrive-places-photo-drawer-handle]')?.getAttribute('aria-expanded')}
    })
    record(mode+': rotation revokes prior camera-scoped photo drawer',
      landscapeFresh.oldDetached)
    record(mode+': rotation automatically restores only fresh signed Owner Cell items',
      landscapeFresh.currentCount===3&&landscapeFresh.favorite===true&&
      landscapeFresh.itemTotal===3&&landscapeFresh.items===3&&
      landscapeFresh.expanded==='true')
    const sheetGeometry=await page.evaluate(()=>{
      const map=document.querySelector('[data-xdrive-places-cluster-overview]')
      const sheet=document.querySelector('[data-xdrive-places-photo-drawer]')
      if(!map||!sheet)return null
      const area=map.getBoundingClientRect(),dialog=sheet.getBoundingClientRect()
      return {mapTop:area.top,mapBottom:area.bottom,top:dialog.top,
        bottom:dialog.bottom,height:dialog.height,screen:innerHeight}
    })
    const drawerFits=sheetGeometry!==null&&sheetGeometry.height>=80&&
      sheetGeometry.top>=sheetGeometry.mapTop+8&&
      sheetGeometry.bottom<=sheetGeometry.mapBottom-8&&
      sheetGeometry.bottom<=sheetGeometry.screen-8
    if(!drawerFits) console.error('places-drawer-landscape-geometry',JSON.stringify({
      mode,viewport:'844x390',geometry:sheetGeometry,
    }))
    record(mode+': expanded drawer fits inside 844x390 map and safe area',drawerFits)
    // Reversing to portrait requires ANOTHER signed /cells + /cell-items.
    // Old landscape DOM and its revoked selection are not reused.
    const beforePortrait=await page.evaluate(()=>{
      const probe=window.__mapProbe
      probe.oldDrawer=document.querySelector('[data-xdrive-places-photo-drawer]')
      return {queries:probe.queries.length,previews:probe.photoPreviewRanges.length}
    })
    await page.setViewportSize({width:960,height:760})
    await page.waitForFunction(before=>
      window.__mapProbe.queries.length>before.queries &&
      window.__mapProbe.photoPreviewRanges.length>before.previews,
      beforePortrait)
    await sheet.waitFor({state:'visible'})
    await sheet.locator('[data-xdrive-places-photo-drawer-items] button')
      .first().waitFor({state:'visible'})
    await page.waitForFunction(()=>
      document.querySelector('[data-xdrive-places-photo-drawer-handle]')
        ?.getAttribute('aria-expanded')==='true')
    const portraitFresh=await page.evaluate(()=>{
      const probe=window.__mapProbe
      const newDrawer=document.querySelector('[data-xdrive-places-photo-drawer]')
      const q=probe.queries.at(-1), preview=probe.photoPreviewRanges.at(-1)
      return {oldDetached:probe.oldDrawer?.isConnected===false &&
          probe.oldDrawer!==newDrawer,
        count:q?.count,favorite:q?.favorite,previewCount:preview?.total,
        newItems:newDrawer?.querySelectorAll(
          '[data-xdrive-places-photo-drawer-items] button').length}
    })
    record(mode+': portrait resize revokes short-landscape Cell scope',
      portraitFresh.oldDetached)
    record(mode+': portrait automatically restores current Owner drawer',
      portraitFresh.count===3&&portraitFresh.favorite===true&&
      portraitFresh.previewCount===3&&portraitFresh.newItems===3)
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

// Test the shipped Gallery Page + real Gin Owner Cell Range + shared LIVP
// Viewer, not a new map or preview implementation. Synthetic MOV bytes are
// transport-only; real HEIC still pixels must decode on both SDK Hosts.
async function testFullGalleryLIVPViewerReturn(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',hasTouch:true,
    isMobile:true,ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',e=>errors.push(e.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+
      '&full_gallery=1&full_gallery_direct=1&map_real_livp=1'+
      (mode==='isolated'?'&places_map_mode=isolated':''),{
      waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 1 张照片',{exact:true}).waitFor()
    const pin=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await pin.waitFor({state:'visible'})
    await pin.click()
    const drawer=page.locator('[data-xdrive-places-photo-drawer]')
    await drawer.waitFor({state:'visible'})
    const photo=drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
    await photo.waitFor({state:'visible'})
    const before=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {ranges:p.galleryPageReads.filter(x=>x.kind==='cell'),
        cameras:p.cameras,scopes:p.queries,node:p.livp.nodeID}
    })
    record(mode+': real LIVP map drawer contains one signed Owner photo',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===1&&
      before.ranges.length>=1&&before.ranges.at(-1)?.total===1&&
      before.ranges.at(-1).nodeIDs?.length===1&&
      before.ranges.at(-1).nodeIDs[0]===before.node&&
      before.scopes.length>0&&before.scopes.every(q=>q.count===1&&!q.favorite))
    await photo.click()
    await page.locator('[data-xdrive-image-phase]').first().waitFor({state:'visible'})
    await page.waitForFunction(()=>{
      const p=window.__mapProbe
      const images=Array.from(document.querySelectorAll(
        '[data-xdrive-image-phase] img:not([aria-hidden="true"])'))
      return p.galleryPageDirectOpens.at(-1)?.live===true&&
        p.liveViewer.stillTickets>=1&&
        images.some(x=>x instanceof HTMLImageElement&&x.complete&&
          x.naturalWidth===512&&x.naturalHeight===512)
    })
    const opened=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {open:p.galleryPageDirectOpens.at(-1),
        ranges:p.galleryPageReads.filter(x=>x.kind==='cell'),
        stillTickets:p.liveViewer.stillTickets,errors:p.galleryPageErrors}
    })
    record(mode+': shared Live Photo Viewer keeps exactly same Owner Cell',
      opened.open?.kind==='baidu-cell'&&opened.open?.live===true&&
      opened.open?.total===1&&opened.open?.nodeID===before.node&&
      opened.ranges.length>before.ranges.length&&
      opened.ranges.at(-1)?.total===1&&opened.stillTickets>=1&&
      opened.errors.length===0)
    record(mode+': actual shared Viewer offers Live Photo hold-to-play',
      await page.getByRole('button',{name:/按住播放，松开停止/}).count()===1&&
      errors.length===0)
    if(mode==='isolated')record('isolated: Live Viewer disposes HTTPS SDK Child',
      !page.frames().some(f=>f.url().includes(childHost))&&
      await page.locator('[data-xdrive-baidu-isolated-frame]').count()===0)
    // iOS full-screen Viewer has a "返回图库" action; reveal its
    // auto-hidden controls through the shared keyboard-accessible chrome.
    await page.keyboard.press('Tab')
    await page.getByRole('button',{name:'返回图库'}).click()
    await page.getByText('当前地图可查看 1 张照片',{exact:true}).waitFor()
    await drawer.waitFor({state:'visible'})
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible'})
    await page.waitForFunction(previous=>
      window.__mapProbe.galleryPageDirectClosed===1&&
      window.__mapProbe.galleryPageReads.filter(x=>x.kind==='cell').length>previous,
      opened.ranges.length)
    const returned=await page.evaluate(()=>{
      const p=window.__mapProbe
      return {closed:p.galleryPageDirectClosed,
        range:p.galleryPageReads.filter(x=>x.kind==='cell').at(-1),
        cameras:p.cameras,scopes:p.queries,
        map:!!document.querySelector('[data-xdrive-places-cluster-overview]'),
        drawer:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
        errors:p.galleryPageErrors}
    })
    const camera=before.cameras.at(-1),after=returned.cameras.at(-1)
    const sameCamera=camera&&after
      ? camera.latitude===after.latitude&&
        camera.longitude===after.longitude&&camera.zoom===after.zoom
      : !camera&&!after
    record(mode+': Live Viewer Back restores exact map Owner and selection',
      returned.closed===1&&returned.range?.total===1&&
      returned.range.nodeIDs?.[0]===before.node&&sameCamera&&
      returned.scopes.length>0&&
      returned.scopes.every(q=>q.count===1&&!q.favorite)&&
      returned.map&&returned.drawer&&returned.errors.length===0&&
      errors.length===0)
    summary.fullGalleryLIVPViewerReturnModes.push(mode)
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
    await page.getByRole('dialog',{name:'此地点的照片'}).waitFor({state:'visible'})
    await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').waitFor({state:'visible'})
    record(mode+': Gallery photo modal opens expanded without a 12-thumbnail strip',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===3)
    await swipeMobileDrawerGrip(page,'down')
    await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="展开照片抽屉"]').waitFor({state:'visible'})
    record(mode+': real downward touch collapses without dismissing Owner album',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===3)
    await swipeMobileDrawerGrip(page,'up')
    await drawer.locator('[data-xdrive-places-photo-drawer-expand][aria-label="收起照片抽屉"]').waitFor({state:'visible'})
    record(mode+': real upward touch restores full trusted Gallery grid',
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
    // Both SDK runtimes share the same Parent overlay. Test actual rendered
    // menus after the real touch/Viewer round-trip, across narrow iPhone widths.
    // This catches a filter panel positioned from the Filter button instead of
    // the trailing toolbar (which clips its left edge on 320/390px screens).
    for (const width of [320,375,390,430,899,900]) {
      await page.setViewportSize({width,height:844})
      for (const kind of ['filter','more']) {
        const menu=page.locator('[data-xdrive-places-map-'+kind+'-menu]')
        await menu.locator('summary').first().click()
        await page.waitForFunction(selector=>
          Boolean(document.querySelector(selector)?.open),
          '[data-xdrive-places-map-'+kind+'-menu]')
        const bounds=await page.evaluate(kind=>{
          const panel=document.querySelector(
            '[data-xdrive-places-map-'+kind+'-panel]')?.getBoundingClientRect()
          const toolbar=document.querySelector(
            '[data-xdrive-places-map-toolbar]')?.getBoundingClientRect()
          const anchor=document.querySelector(
            '[data-xdrive-places-map-menu-anchor]')?.getBoundingClientRect()
          return {width:document.documentElement.clientWidth,
            left:panel?.left,right:panel?.right,top:panel?.top,
            toolbarLeft:toolbar?.left,toolbarRight:toolbar?.right,
            anchorRight:anchor?.right,scrollWidth:document.documentElement.scrollWidth}
        },kind)
        record(mode+': iOS '+width+'px '+kind+' map menu is visible and unclipped '+
          JSON.stringify(bounds),
          bounds.width===width&&Number.isFinite(bounds.left)&&
          Number.isFinite(bounds.right)&&Number.isFinite(bounds.top)&&
          bounds.left>=-0.5&&bounds.right<=width+0.5&&
          bounds.top>=0&&bounds.toolbarRight<=width+0.5)
        await menu.locator('summary').first().click()
      }
      // Close is a third 44px toolbar action. In a 320px iPhone viewport it
      // must remain visible and genuinely hit-testable after the menus close.
      const closeBounds=await page.evaluate(()=>{
        const close=document.querySelector('[data-xdrive-places-map-close]')
        const rect=close?.getBoundingClientRect()
        if (!close || !rect) return null
        const hit=document.elementFromPoint(rect.left+rect.width/2,
          rect.top+rect.height/2)
        return {left:rect.left,right:rect.right,top:rect.top,
          width:rect.width,height:rect.height,
          hit:hit===close || close.contains(hit),
          viewport:document.documentElement.clientWidth}
      })
      record(mode+': iOS '+width+'px map Close remains a hit-testable 44px target',
        closeBounds?.viewport===width && closeBounds.left>=-0.5 &&
        closeBounds.right<=width+0.5 && closeBounds.top>=0 &&
        closeBounds.width>=44 && closeBounds.height>=44 && closeBounds.hit===true)
    }
    // Apple-style Close uses the existing current Owner Gallery navigation,
    // not an SDK Child route or a synthetic unfiltered photo reader.
    const closeMap=page.locator('[data-xdrive-places-map-close]')
    await closeMap.waitFor({state:'visible'})
    await closeMap.tap()
    await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
    const closed=await page.evaluate(()=>({
      mapCount:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      ordinaryOwnerReads:window.__mapProbe.galleryPageReads.filter(
        read=>read.kind==='ordinary').length,
      errors:window.__mapProbe.galleryPageErrors.length,
    }))
    record(mode+': closing the mobile map returns to authenticated Gallery',
      closed.mapCount===0&&closed.ordinaryOwnerReads>=1&&
      closed.errors===0&&errors.length===0)
    summary.mobileDrawerModes.push(mode)
  }finally{await context.close()}
}

async function testFavoritesMapClose(browser,mode,port){
  // A real favorite-only Owner Range must survive Library→Map→Close without
  // broadening to all photos. Use the mounted production Gallery/Router.
  const context=await browser.newContext({
    viewport:{width:390,height:844},deviceScaleFactor:3,
    locale:'zh-CN',isMobile:true,hasTouch:true,
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
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
      '&full_gallery=1&start_favorites=1'+
      (mode==='isolated'?'&places_map_mode=isolated':'')
    await page.goto(url,{waitUntil:'domcontentloaded'})
    await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
    const before=await page.evaluate(()=>{
      const reads=window.__mapProbe.galleryPageReads.filter(r=>r.kind==='ordinary')
      return reads.at(-1)
    })
    record(mode+': Favorites start from genuine scoped Owner Range',
      before?.favorite===true&&before?.total===3)
    await page.locator('[data-xdrive-gallery-show-map]').click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-map-close]').tap()
    await page.locator('[data-xdrive-media-tile]').first().waitFor({state:'visible'})
    const after=await page.evaluate(()=>{
      const reads=window.__mapProbe.galleryPageReads.filter(r=>r.kind==='ordinary')
      return {last:reads.at(-1),length:reads.length,
        mapCount:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
        errors:window.__mapProbe.galleryPageErrors.length}
    })
    record(mode+': closing collection map restores favorite Owner membership',
      after.length>=2&&after.last?.favorite===true&&after.last?.total===3&&
      after.mapCount===0&&after.errors===0&&errors.length===0)
    record(mode+': Favorites map Close never lets SDK Child read private media',
      requests.every(item=>item.host!=='child'||!item.path.startsWith('/api/v1/')))
    // Closing a previously signed Favorite map is NOT permission to reveal an
    // unfiltered Gallery. The original Owner Range must independently succeed
    // before the trusted React Parent commits the collection navigation.
    await page.locator('[data-xdrive-gallery-show-map]').click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    const beforeDeniedReads=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(r=>r.kind==='ordinary').length)
    let deniedRanges=0
    let unscopedReads=0
    await page.route('**/api/v1/media/items?**',route=>{
      const url=new URL(route.request().url())
      if(url.searchParams.get('favorite')!=='true')unscopedReads++
      deniedRanges++
      return route.fulfill({status:403,contentType:'application/json',
        body:'{"error":"test_only_owner_forbidden"}'})
    })
    await page.locator('[data-xdrive-places-map-close]').tap()
    await page.waitForFunction(()=>window.__mapProbe.galleryPageErrors.length>=1)
    const blocked=await page.evaluate(()=>({
      mapCount:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      tiles:document.querySelectorAll('[data-xdrive-media-tile]').length,
      ordinaryReads:window.__mapProbe.galleryPageReads.filter(
        r=>r.kind==='ordinary').length,
      errors:window.__mapProbe.galleryPageErrors.length,
    }))
    record(mode+': denied Favorite Owner return stays on map without unfiltered media',
      deniedRanges>=1&&unscopedReads===0&&blocked.mapCount===1&&
      blocked.tiles===0&&blocked.ordinaryReads===beforeDeniedReads&&
      blocked.errors>=1&&errors.length===0)
    await page.unroute('**/api/v1/media/items?**')
    let expiredOwnerReads=0
    page.on('request',request=>{
      if(new URL(request.url()).pathname==='/api/v1/media/items')
        expiredOwnerReads++
    })
    // The original Favorite map entry is a short-lived visual hint. Time
    // expiry cannot become a second implicit invitation to all-library.
    await page.evaluate(()=>{
      const unadjustedNow=Date.now.bind(Date)
      Date.now=()=>unadjustedNow()+600_001
    })
    const acceptedBeforeExpiry=await page.evaluate(()=>
      window.__mapProbe.galleryPageReads.filter(r=>r.kind==='ordinary').length)
    const closeAgain=page.locator('[data-xdrive-places-map-close]')
    await closeAgain.tap()
    await page.getByText('地图返回范围已失效，请从原收藏或相册重新打开地图。',
      {exact:true}).waitFor({state:'visible'})
    // Repeat is intentional: clearing an expired ref and then letting the
    // second Close use root Library is a subtle Owner-scope widening bug.
    await closeAgain.tap()
    const expired=await page.evaluate(()=>({
      mapCount:document.querySelectorAll('[data-xdrive-gallery-places-map]').length,
      tiles:document.querySelectorAll('[data-xdrive-media-tile]').length,
      accepted:window.__mapProbe.galleryPageReads.filter(
        r=>r.kind==='ordinary').length,
    }))
    record(mode+': expired map return and repeated Close never open all-library',
      expired.mapCount===1&&expired.tiles===0&&
      expired.accepted===acceptedBeforeExpiry&&expiredOwnerReads===0&&
      errors.length===0)
    summary.favoriteMapCloseModes.push(mode)
  }finally{await context.close()}
}

// Real mounted shared React Parent, not a source regex or direct onReady stub.
// Intentionally exercise BOTH SDK Hosts without native moveend on centerAndZoom.
async function testDelayedBD09Map(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try {
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+'&delayed_bd09=1',
      {waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__mapProbe?.ready===true)
    const sdkAtEmptyMap=mode==='inline' ? inlineSDKLoads : childSDKLoads
    await page.locator('[data-xdrive-places-empty-map-recheck]').waitFor({state:'visible'})
    const initial=await page.evaluate(()=>({
      empty:window.__mapProbe.queries.some(q=>q.count===0&&
        q.bounds.west===-180&&q.bounds.east===180),
      pins:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
      completed:window.__mapProbe.bd09Completions,
    }))
    record(mode+': initial GPS backlog shows genuine empty Owner BD09 map',
      initial.empty&&initial.pins===0&&initial.completed===0)
    await page.locator('#fixture-finish-bd09').click()
    // The button exercises the production trusted Parent refresh callback;
    // no new SDK, WGS84 forwarding, GeoConv, or unscoped Gallery query.
    await page.locator('[data-xdrive-places-empty-map-recheck]').click()
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first()
      .waitFor({state:'visible'})
    await page.waitForFunction(()=>{
      const image=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return image && image.complete && image.naturalWidth>0
    })
    await page.waitForFunction(()=>window.__mapProbe?.cameras.some(camera=>
      camera.coordinate_space==='bd09ll' &&
      Math.abs(camera.latitude-30.135)<0.00001 &&
      Math.abs(camera.longitude-119.975)<0.00001 && camera.zoom===8))
    // The isolated Host coalesces Child 'viewport' IPC for 120 ms after
    // Camera. Wait for the Owner-signed result, not merely SDK motion.
    await page.waitForFunction(()=>window.__mapProbe?.queries.some(q=>
      q.count===9 && q.bounds.west===100 && q.bounds.south===20 &&
      q.bounds.east===125 && q.bounds.north===40))
    const recovered=await page.evaluate(()=>{
      const probe=window.__mapProbe
      const image=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return {completed:probe.bd09Completions,decoded:Boolean(image?.naturalWidth),
        world:probe.queries.some(q=>q.count===9&&q.bounds.west===-180&&
          q.bounds.south===-85&&q.bounds.east===180&&q.bounds.north===85),
        live:probe.queries.some(q=>q.count===9&&q.bounds.west===100&&
          q.bounds.south===20&&q.bounds.east===125&&q.bounds.north===40),
        allScoped:probe.queries.every(q=>q.albumKey===''&&q.favorite===false),
        failed:probe.failed}
    })
    record(mode+': late BD09 produces Owner worldwide discovery and live camera Cells',
      recovered.completed===1&&recovered.world&&recovered.live&&
      recovered.allScoped&&!recovered.failed)
    record(mode+': trusted cover appears with decoded image after late camera restore',
      recovered.decoded)
    record(mode+': recovering derived pins does not remount the Provider SDK',
      (mode==='inline' ? inlineSDKLoads : childSDKLoads)===sdkAtEmptyMap)
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first().click()
    const drawer=page.locator('[data-xdrive-places-photo-drawer]')
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible'})
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first().click()
    await page.locator('#fixture-viewer').waitFor({state:'visible'})
    await page.locator('#fixture-viewer-back').click()
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible'})
    const back=await page.evaluate(()=>({
      drawer:!!document.querySelector('[data-xdrive-places-photo-drawer]'),
      opens:window.__mapProbe.photoOpens,
      count:window.__mapProbe.queries.at(-1)?.count,
      failure:window.__mapProbe.failed,
    }))
    record(mode+': map cover → Owner Cell drawer → preview → same signed drawer on Back',
      back.drawer&&back.opens.some(x=>x.valid===true)&&
      back.count===9&&!back.failure&&errors.length===0)
  } finally {await context.close()}
}

// Exercise the ACTUAL production 120-second empty-map interval callback in
// mounted Chromium, not a manual Refresh click or source regex. Capture only
// this named timer in the Parent and invoke it synchronously: neither a
// two-minute test sleep nor a direct fake owner /cells request is permitted.
// Both SDK Hosts must ignore hidden tabs and recover fresh Owner BD09 photos
// once the Parent document becomes visible, without remounting the SDK.
async function testAutomaticBD09VisibilityRecheck(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(25000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(() => {
    // page.addInitScript may run in the independent isolated Child. Only the
    // trusted Parent document owns the actual authenticated 120s poll.
    if(window.top!==window)return
    const originalSet=window.setInterval.bind(window)
    const originalClear=window.clearInterval.bind(window)
    const syntheticTimerID=2147483001
    window.__xdriveBD09SyntheticHidden=false
    window.__xdriveBD09IntervalTick=null
    window.__xdriveBD09IntervalStopped=false
    Object.defineProperty(document,'visibilityState',{
      configurable:true,
      get:()=>window.__xdriveBD09SyntheticHidden?'hidden':'visible',
    })
    window.setInterval=(callback,interval,...args)=>{
      if(interval===120000 && typeof callback==='function'){
        window.__xdriveBD09IntervalTick=callback
        window.__xdriveBD09IntervalStopped=false
        return syntheticTimerID
      }
      return originalSet(callback,interval,...args)
    }
    window.clearInterval=id=>{
      if(id===syntheticTimerID){
        window.__xdriveBD09IntervalStopped=true
        return
      }
      return originalClear(id)
    }
  })
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+
      '/?mode='+mode+'&delayed_bd09=1',{waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>
      window.__mapProbe?.ready===true &&
      typeof window.__xdriveBD09IntervalTick==='function')
    await page.locator('[data-xdrive-places-empty-map-recheck]')
      .waitFor({state:'visible'})
    await page.waitForTimeout(250)
    const sdkAtEmpty=mode==='inline' ? inlineSDKLoads : childSDKLoads
    const old=await page.evaluate(()=>({
      reads:window.__mapProbe.queries.length,
      world:window.__mapProbe.queries.some(q=>q.count===0 &&
        q.bounds.west===-180&&q.bounds.east===180),
      pins:document.querySelectorAll(
        '[data-xdrive-places-trusted-photo-cover]').length,
    }))
    record(mode+': pending BD09 has a real accepted empty Owner map and poll',
      old.world && old.pins===0 && old.reads>0)
    // This test-only button flips fixture source readiness; it must not
    // call the manual production map Refresh button or start a new Owner read.
    await page.locator('#fixture-finish-bd09').click()
    const beforeTick=await page.evaluate(()=>window.__mapProbe.queries.length)
    await page.evaluate(()=>{
      window.__xdriveBD09SyntheticHidden=true
      window.__xdriveBD09IntervalTick()
    })
    const hidden=await page.evaluate(()=>window.__mapProbe.queries.length)
    record(mode+': hidden automatic BD09 poll leaves signed Owner query idle',
      old.reads===beforeTick&&hidden===beforeTick)
    await page.evaluate(()=>{
      window.__xdriveBD09SyntheticHidden=false
      window.__xdriveBD09IntervalTick()
    })
    await page.getByText('当前地图可查看 9 张照片',{exact:true})
      .waitFor({state:'visible'})
    await page.locator('[data-xdrive-places-trusted-photo-cover]')
      .first().waitFor({state:'visible'})
    await page.waitForFunction(()=>window.__mapProbe?.queries.some(q=>
      q.count===9 && q.bounds.west===-180 && q.bounds.east===180))
    await page.waitForFunction(()=>window.__xdriveBD09IntervalStopped===true)
    const now=await page.evaluate(()=>{
      const q=window.__mapProbe.queries
      return {reads:q.length,
        world:q.some(x=>x.count===9&&x.bounds.west===-180&&
          x.bounds.east===180),
        allOwnerScoped:q.every(x=>x.albumKey===''&&x.favorite===false),
        oldEmptyGone:document.querySelectorAll(
          '[data-xdrive-places-empty-map-recheck]').length===0,
        photoButtons:document.querySelectorAll(
          '[data-xdrive-places-trusted-photo-cover]').length,
        stopped:window.__xdriveBD09IntervalStopped,
        completion:window.__mapProbe.bd09Completions,
        failed:window.__mapProbe.failed,
      }
    })
    record(mode+': visible timer automatically recovers only fresh signed BD09',
      now.world&&now.reads>beforeTick&&now.allOwnerScoped&&
      now.oldEmptyGone&&now.photoButtons>0&&now.stopped&&
      now.completion===1&&!now.failed&&errors.length===0)
    record(mode+': automatic BD09 Owner recovery reuses mounted SDK Host',
      (mode==='inline' ? inlineSDKLoads : childSDKLoads)===sdkAtEmpty)
    // A newly arrived photo must remain a real current authorized Cell
    // opened through /cell-items, not an invented fallback Gallery query.
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first().click()
    await page.locator('[data-xdrive-places-photo-drawer-item]')
      .first().waitFor({state:'visible'})
    const owner=await page.evaluate(()=>window.__mapProbe.photoPreviewRanges.at(-1))
    record(mode+': automatic backfill still opens the exact 9-photo Owner Cell',
      owner?.total===9&&owner?.items===9&&errors.length===0)
  }finally{await context.close()}
}

// Post-ready Server /cells failure is different from a valid zero-photo map.
// Run the SAME shipped React Parent + private cover logic under both SDK Hosts.
async function testOwnerCellsFailureRetry(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try {
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+'&cells_failure=1',
      {waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__mapProbe?.ready===true)
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    // Await the initial *live* SDK Camera query before inducing a new
    // favorite-scope request, so a pending startup event cannot steal fault.
    await page.waitForFunction(()=>window.__mapProbe?.queries.some(q=>
      q.count===9&&q.bounds.west===100&&q.bounds.south===20&&
      q.bounds.east===125&&q.bounds.north===40))
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first()
      .waitFor({state:'visible'})
    const sdkBefore=mode==='inline' ? inlineSDKLoads : childSDKLoads
    await page.locator('#fixture-arm-cells-failure').click()
    await page.locator('#toggle-favorite').click()
    const warning=page.locator('[data-xdrive-places-cells-query-error]')
    await warning.waitFor({state:'visible'})
    const empty=await page.evaluate(()=>({
      faults:window.__mapProbe.failedOwnerCellsReads,
      stalePins:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
      failureText:document.querySelector('[data-xdrive-places-cells-query-error]')?.textContent || '',
      sdkFailed:window.__mapProbe.failed,
    }))
    record(mode+': genuine post-ready Owner Cells fault clears stale private cover pins',
      empty.faults.length===1&&empty.faults[0].favorite===true&&
      empty.faults[0].albumKey===''&&empty.stalePins===0&&!empty.sdkFailed)
    record(mode+': failed map query is not mislabeled as an empty GPS photo map',
      empty.failureText.includes('定位照片范围读取或校验失败')&&
      empty.failureText.includes('重试定位照片')&&
      !empty.failureText.includes('暂无可显示的定位照片'))
    await page.locator('[data-xdrive-places-cells-query-retry]').click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    await page.waitForFunction(()=>{
      const image=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return Boolean(image?.complete&&image.naturalWidth>0)
    })
    const restored=await page.evaluate(()=>({
      errorStillVisible:Boolean(document.querySelector('[data-xdrive-places-cells-query-error]')),
      favorites:window.__mapProbe.queries.filter(q=>q.favorite===true),
      faults:window.__mapProbe.failedOwnerCellsReads.length,
      sdkFailed:window.__mapProbe.failed,
    }))
    record(mode+': retry restores decoded favorites only under the same Owner scope',
      !restored.errorStillVisible&&!restored.sdkFailed&&restored.faults===1&&
      restored.favorites.some(q=>q.albumKey===''&&q.count===3))
    record(mode+': Owner Cells retry reuses the mounted SDK Host',
      (mode==='inline' ? inlineSDKLoads : childSDKLoads)===sdkBefore)
    await cover.click()
    const drawer=page.locator('[data-xdrive-places-photo-drawer]')
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible'})
    const drawerCount=await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()
    record(mode+': recovered favorites cover opens only the authorized 3-photo drawer',
      drawerCount===3&&errors.length===0)
  } finally {await context.close()}
}

// P0 regression: real mounted React photo markers used to disappear on
// movestart because all previously signed Cells were synchronously revoked.
// Keep the PREVIOUS cover visible and SDK-reprojected, but visually inert;
// only fresh signed Owner /cells may restore clickability after moveend.
async function testPhotoCoverDuringMapPan(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode,
      {waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    await page.waitForFunction(()=>window.__mapProbe?.queries.some(q=>
      q.count===9 && q.bounds.west===100 && q.bounds.south===20 &&
      q.bounds.east===125 && q.bounds.north===40))
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    const before=await cover.boundingBox()
    assert(before,'current Owner cover must be displayed before SDK gesture')
    const sdkFrame=mode==='inline'
      ? page : page.frames().find(f=>f.url().includes(childHost))
    assert(sdkFrame,'a real JSAPI Host map frame is required')
    const old=await page.evaluate(()=>({
      reads:window.__mapProbe.queries.length,
      previews:window.__mapProbe.photoPreviewRanges.length,
    }))
    await sdkFrame.evaluate(()=>{
      const sdk=window.__xdriveSyntheticMapInstances?.at(-1)
      if(!sdk)throw Error('no real synthetic SDK mounted')
      sdk.panOffset={x:88,y:33}
      sdk.listeners.get('movestart')?.()
      sdk.listeners.get('moving')?.()
    })
    const moving=page.locator('[data-xdrive-places-gesture-photo-cover]').first()
    await moving.waitFor({state:'visible'})
    await page.waitForFunction(origin=>{
      const cover=document.querySelector('[data-xdrive-places-gesture-photo-cover]')
      if(!cover)return false
      const b=cover.getBoundingClientRect()
      return Number.isFinite(b.left)&&Number.isFinite(b.top) &&
        Math.abs(b.left-origin.x-88)<3 && Math.abs(b.top-origin.y-33)<3
    },before)
    const after=await moving.boundingBox()
    const state=await page.evaluate(()=>({
      moving:document.querySelectorAll('[data-xdrive-places-gesture-photo-cover]').length,
      clickable:document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length,
      disabled:document.querySelector('[data-xdrive-places-gesture-photo-cover]')?.disabled,
      previews:window.__mapProbe.photoPreviewRanges.length,
      queries:window.__mapProbe.queries.length,
    }))
    record(mode+': SDK pan keeps photo cover visible at newly projected BD09 pixel',
      after&&state.moving>0&&state.clickable===0&&state.disabled===true&&
      Math.abs(after.x-before.x-88)<3&&Math.abs(after.y-before.y-33)<3&&
      state.previews===old.previews&&state.queries===old.reads&&errors.length===0)
    // The old visual button is disabled. Even a programmatic event must not
    // invoke a stale Owner /cell-items; the current API authority is gone.
    await moving.evaluate(el=>el.click())
    const denied=await page.evaluate(()=>({
      reads:window.__mapProbe.queries.length,
      previews:window.__mapProbe.photoPreviewRanges.length,
    }))
    record(mode+': old camera photo remains inert and cannot reopen stale Cell',
      denied.previews===old.previews&&denied.reads===old.reads)
    await sdkFrame.evaluate(()=>{
      const sdk=window.__xdriveSyntheticMapInstances?.at(-1)
      sdk.listeners.get('moveend')?.()
    })
    await cover.waitFor({state:'visible'})
    await moving.waitFor({state:'hidden'})
    const fresh=await page.evaluate(()=>({
      count:window.__mapProbe.queries.at(-1)?.count,
      reads:window.__mapProbe.queries.length,
    }))
    record(mode+': fresh Owner /cells replaces inert layer after pan debounce',
      fresh.count===9&&fresh.reads>old.reads&&errors.length===0)
    await cover.click()
    await page.locator('[data-xdrive-places-photo-drawer-item]')
      .first().waitFor({state:'visible'})
    const preview=await page.evaluate(()=>window.__mapProbe.photoPreviewRanges.at(-1))
    record(mode+': photo click after pan opens newly verified Owner album',
      preview?.total===9&&preview?.items===9&&errors.length===0)
  }finally{await context.close()}
}

// P0 regression: clicking the blue count on a 28-photo marker opens an
// actual focus-trapped Gallery-style grid modal, not the old 12-photo strip.
async function testPhotoCellAlbumDialog28(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>
    route.fulfill({status:200,contentType:'text/javascript',body:sdkStub}))
  try{
    await page.goto('https://'+galleryHost+':'+port+
      '/?mode='+mode+'&album_dialog_28=1',{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 28 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first().click()
    const dialog=page.getByRole('dialog',{name:'此地点的照片'})
    await dialog.waitFor({state:'visible'})
    await page.waitForFunction(()=>document.querySelectorAll(
      '[data-xdrive-places-photo-drawer-item]').length===28)
    const state=await page.evaluate(()=>{
      const region=document.querySelector('[data-xdrive-places-photo-drawer]')
      const list=document.querySelector('[data-xdrive-places-photo-drawer-items]')
      const dialog=document.querySelector('[role="dialog"]')
      const rect=dialog?.getBoundingClientRect()
      return {role:dialog?.getAttribute('role'),tiles:list?.children.length,
        grid:list?getComputedStyle(list).display:'',
        width:rect?.width,left:rect?.left,right:rect?.right,
        inside:rect?.left>=0&&rect?.right<=innerWidth+1,
        total:region?.textContent||'',
        preview:window.__mapProbe.photoPreviewRanges.at(-1),
        strip:document.querySelectorAll(
          '[data-xdrive-places-photo-collection-strip]').length,
      }
    })
    record(mode+': 28 photos open full Gallery grid modal with signed Range',
      state.role==='dialog'&&state.tiles===28&&state.grid==='grid'&&
      state.inside&&state.total.includes('28 张照片和视频')&&
      state.preview?.total===28&&state.preview?.items===28&&
      state.preview?.limit===48&&state.strip===0&&errors.length===0)
    await page.keyboard.press('Escape')
    await dialog.waitFor({state:'hidden'})
    record(mode+': Escape closes map photo album without unmounting map',
      await page.locator('[data-xdrive-places-cluster-overview]').count()===1)
  }finally{await context.close()}
}

// Real Chromium multi-Cell presentation proof. Two signed Owner Cells share
// one pixel target and only the highest-count React photo survives declutter.
// The other Cell remains accessible via the Owner-signed Cell list/Range.
// SDK Host inspection reads only synthetic label counts, never private media.
async function testPhotoMarkerPresentation(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+
      '/?mode='+mode+'&mixed_markers=1',{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 14 张照片',{exact:true}).waitFor()
    await page.locator('[data-xdrive-places-trusted-photo-cover]').first()
      .waitFor({state:'visible'})
    const sdkFrame=mode==='inline'
      ? page : page.frames().find(f=>f.url().includes(childHost))
    assert(sdkFrame,'actual map SDK Host frame required')
    await sdkFrame.waitForFunction(()=>{
      const sdk=window.__xdriveSyntheticMapInstances?.at(-1)
      return sdk && sdk.maxOverlays>=2 && sdk.overlays.length===0
    })
    const presentation=await page.evaluate(()=>{
      const root=document.querySelector('[data-xdrive-places-cluster-overview]')
      return {pins:root?.querySelectorAll(
        '[data-xdrive-places-trusted-photo-cover]').length,
        cellCount:document.querySelectorAll(
          '[data-xdrive-places-cluster-list] button').length,
        strip:document.querySelectorAll(
          '[data-xdrive-places-photo-collection-strip], '+
          '[data-xdrive-places-map-photo-strip-shell], '+
          '[data-xdrive-places-collection-thumb]').length,
        count:window.__mapProbe.queries.at(-1)?.count}
    })
    record(mode+': one verified photo layer removes competing SDK labels',
      presentation.pins===1&&presentation.cellCount===2&&
      presentation.count===14&&presentation.strip===0&&errors.length===0)
    const cells=page.locator('[data-xdrive-places-cluster-list]')
    if(await cells.getAttribute('open')===null)
      await cells.locator('summary').click()
    await cells.locator('button').nth(1).click()
    await page.locator('[data-xdrive-places-photo-drawer-items] button')
      .first().waitFor({state:'visible'})
    const preview=await page.evaluate(()=>window.__mapProbe.photoPreviewRanges.at(-1))
    record(mode+': decluttered Cell still opens current Owner-signed 5-photo Range',
      preview?.total===5&&preview?.items===5&&errors.length===0)
  }finally{await context.close()}
}

// Real Chromium proves the shared trusted Parent measures floating iOS map
// controls rather than relying on a stale fixed-pixel bottom dock. Force a
// narrow/wrapped summary into the camera without altering any SDK/Owner Cell;
// both inline and isolated Hosts must hide the occluded photo cover, then
// restore it when the control moves away.
async function testMapOverlayPinOcclusion(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    assert.equal(new URL(route.request().url()).searchParams.get('ak'),
      'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode,
      {waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    const original=await cover.boundingBox()
    assert(original,'original verified photo cover must have a painted rectangle')
    const before=await page.evaluate(()=>window.__mapProbe.queries.length)
    const reflow=await page.addStyleTag({content:
      '[data-xdrive-places-map-photo-summary]{'+
      'left:calc(50% - 150px)!important;right:auto!important;'+
      'width:300px!important;min-height:140px!important;'+
      'bottom:calc(50% - 70px)!important;'+
      'justify-content:center!important;align-items:center!important;}'})
    // The actual DOM controls now occupy the previous photo rectangle.
    // ResizeObserver reselects marker presentation without a new /cells.
    const occupied=await page.evaluate(pin=>{
      const summary=document.querySelector('[data-xdrive-places-map-photo-summary]')
      return Array.from(summary?.children||[]).some(el=>{
        const box=el.getBoundingClientRect()
        return box.left<pin.x+pin.width && box.right>pin.x &&
          box.top<pin.y+pin.height && box.bottom>pin.y
      })
    },original)
    await page.waitForFunction(()=>
      document.querySelectorAll('[data-xdrive-places-trusted-photo-cover]').length===0)
    const after=await page.evaluate(()=>({
      queries:window.__mapProbe.queries.length,
      count:document.querySelector('[data-xdrive-places-map-photo-summary]')?.textContent,
      signedCells:document.querySelectorAll(
        '[data-xdrive-places-cluster-list] button').length,
      fixedStrip:document.querySelectorAll(
        '[data-xdrive-places-photo-collection-strip]').length,
    }))
    record(mode+': measured map controls hide a genuinely overlapping photo pin',
      occupied && after.signedCells===1 && after.queries===before &&
      after.count?.includes('9 张照片') && after.fixedStrip===0 &&
      errors.length===0)
    // A hidden presentation is never a revoked Owner Cell: its existing
    // signed Cell must still load through /cell-items into the real drawer.
    const list=page.locator('[data-xdrive-places-cluster-list]')
    if(await list.getAttribute('open')===null)
      await list.locator('summary').click()
    await list.locator('button').first().click()
    await page.locator('[data-xdrive-places-photo-drawer-items] button')
      .first().waitFor({state:'visible'})
    const range=await page.evaluate(()=>
      window.__mapProbe.photoPreviewRanges.at(-1))
    record(mode+': occluded map photo still opens its current signed Owner Range',
      range?.total===9 && range?.items===9 && errors.length===0)
    await page.getByRole('button',{name:'关闭照片抽屉'}).click()
    await reflow.evaluate(el=>el.remove())
    await cover.waitFor({state:'visible'})
    record(mode+': removing a wrapped map overlay restores the photo without refetch',
      await page.evaluate(()=>window.__mapProbe.queries.length)===before &&
      errors.length===0)
  }finally{await context.close()}
}

// Real browser accessibility and color-scheme semantics for the SAME mounted
// trusted Owner React map, in inline and independent HTTPS Child SDK modes.
// This is controlled Chromium (not physical VoiceOver/Safari certification).
async function testMapKeyboardAppearance(browser,mode,scheme,port){
  const dark=scheme==='dark'
  const context=await browser.newContext({
    viewport:{width:390,height:844},locale:'zh-CN',colorScheme:scheme,
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(20000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.name))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try {
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+
      '&ui_scheme='+scheme,{waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__mapProbe?.ready===true)
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    const cover=page.getByRole('button',{name:'查看该区域 9 张照片'}).first()
    await cover.waitFor({state:'visible'})
    const region=page.getByRole('region',{name:'定位照片聚集地图'})
    const fullCameraWall=page.getByRole('button',{name:'查看此地图的全部照片'})
    await region.waitFor({state:'visible'})
    await fullCameraWall.waitFor({state:'visible'})
    const mobile=await page.evaluate(()=>{
      const map=document.querySelector('[data-xdrive-places-cluster-overview]')
      const cover=document.querySelector('[data-xdrive-places-trusted-photo-cover]')
      const badge=document.querySelector('[data-xdrive-places-photo-count-badge]')
      const bounds=map?.getBoundingClientRect()
      const target=cover?.getBoundingClientRect()
      return {mapBottom:bounds?.bottom,coverWidth:target?.width,
        coverHeight:target?.height,
        noFixedPhotoStrip:!document.querySelector(
          '[data-xdrive-places-photo-collection-strip], '+
          '[data-xdrive-places-map-photo-strip-shell], '+
          '[data-xdrive-places-collection-thumb]'),
        badge:badge?getComputedStyle(badge).backgroundColor:null,
        ownerQueries:window.__mapProbe.queries.every(q=>q.albumKey===''&&!q.favorite)}
    })
    record(mode+': '+scheme+' 390px accessible map and >=44px cover targets',
      await region.count()===1 && await fullCameraWall.count()===1 &&
      mobile.mapBottom<=844-8 && mobile.coverWidth>=44 &&
      mobile.coverHeight>=44&&mobile.noFixedPhotoStrip&&mobile.ownerQueries)
    record(mode+': '+scheme+' iOS blue map count has correct light/dark theme',
      mobile.badge===(dark?'rgb(10, 132, 255)':'rgb(0, 122, 255)'))
    // On landscape iPhone heights, the same trusted Parent cannot force a
    // 640px desktop minimum that moves keyboard/VoiceOver content offscreen.
    await page.setViewportSize({width:844,height:390})
    const landscape=await region.evaluate(element=>{
      const bounds=element.getBoundingClientRect()
      return {bottom:bounds.bottom,height:bounds.height}
    })
    record(mode+': '+scheme+' 844x390 landscape map stays within safe viewport',
      landscape.height>=180&&landscape.bottom<=390-8)
    // iOS 27 map parity must cover the actual 899/900 breakpoint in both
    // orientations as well as the narrower 375px iPhone. Execute on the same
    // already-mounted trusted React Parent and both SDK Hosts: a source-only
    // CSS assertion cannot prove the photos stay visible after a real resize.
    for (const [width,height] of [[375,812],[899,390],[900,390],
      [899,1200],[900,1200]]) {
      const beforeCamera=await page.evaluate(()=>window.__mapProbe.queries.length)
      await page.setViewportSize({width,height})
      // The old projected pin is revoked synchronously. Wait for a NEW
      // signed Owner camera before checking physical screen geometry.
      await page.waitForFunction(before=>window.__mapProbe.queries.length>before,
        beforeCamera)
      await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
      await page.locator('[data-xdrive-places-cluster-list] button').first()
        .waitFor({state:'attached'})
      const bounds=await page.evaluate(()=>{
        const rect=selector=>{
          const element=document.querySelector(selector)
          if(!element)return null
          const box=element.getBoundingClientRect()
          return {left:box.left,right:box.right,top:box.top,
            bottom:box.bottom,width:box.width,height:box.height}
        }
        const accessible=document.querySelector(
          '[data-xdrive-places-cluster-list]')
        return {map:rect('[data-xdrive-places-cluster-overview]'),
          cover:rect('[data-xdrive-places-trusted-photo-cover]'),
          summary:rect('[data-xdrive-places-map-photo-summary]'),
          noFixedPhotoStrip:!document.querySelector(
            '[data-xdrive-places-photo-collection-strip], '+
            '[data-xdrive-places-map-photo-strip-shell], '+
            '[data-xdrive-places-collection-thumb]'),
          count:document.querySelector('[data-xdrive-places-photo-count-badge]')?.textContent,
          accessibleCount:accessible?.querySelectorAll('button').length||0,
          accessibleLabel:accessible?.textContent||'',
          regionLabel:document.querySelector('[aria-label="定位照片聚集地图"]')?.getAttribute('role')}
      })
      const inside=(outer,inner)=>Boolean(outer&&inner&&
        inner.left>=outer.left-1&&inner.right<=outer.right+1&&
        inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1)
      const visibleCover=inside(bounds.map,bounds.cover)&&
        bounds.cover.width>=44&&bounds.cover.height>=44&&bounds.count==='9'
      // A noncompact 899/900x390 viewport has less than 226px of
      // available map height. Its 72px photo cover + count badge must not
      // overlap the floating map controls. Here the CURRENT authorized Cell list,
      // including the actual signed count, is the accessible fallback.
      const truthfulFallback=bounds.map&&bounds.map.height<226&&
        bounds.cover===null&&bounds.accessibleCount>=1&&
        bounds.accessibleLabel.includes('9')
      record(mode+': '+scheme+' '+width+'x'+height+
        ' map and signed-photo cover remain within the usable viewport',
        bounds.map&&bounds.map.width>0&&bounds.map.height>=180&&
        bounds.map.bottom<=height-8&&bounds.map.right<=width+1&&
        (visibleCover||truthfulFallback))
      record(mode+': '+scheme+' '+width+'x'+height+
        ' summary controls stay inside map without fixed strip',
        inside(bounds.map,bounds.summary)&&bounds.summary.width>=44&&
        bounds.noFixedPhotoStrip)
    }
    const beforeReturnCamera=await page.evaluate(()=>window.__mapProbe.queries.length)
    await page.setViewportSize({width:390,height:844})
    await page.waitForFunction(before=>window.__mapProbe.queries.length>before,
      beforeReturnCamera)
    await cover.waitFor({state:'visible'})
    await cover.focus()
    const focused=await cover.evaluate(element=>document.activeElement===element)
    await cover.press('Enter')
    const drawer=page.getByRole('region',{name:'当前位置的照片'})
    await drawer.waitFor({state:'visible'})
    await drawer.locator('[data-xdrive-places-photo-drawer-item]').first()
      .waitFor({state:'visible'})
    const photos=await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()
    record(mode+': '+scheme+' map cover keyboard Enter opens the signed 9-photo drawer',
      focused&&photos===9&&errors.length===0)
    await page.getByRole('button',{name:'关闭照片抽屉'}).click()
    await drawer.waitFor({state:'hidden'})
    await cover.focus()
    await cover.press('Enter')
    await drawer.waitFor({state:'visible'})
    record(mode+': '+scheme+' current map cover keyboard Enter reopens Owner drawer',
      await drawer.locator('[data-xdrive-places-photo-drawer-item]').count()===9&&
      errors.length===0)
  }finally{await context.close()}
}

// Real AVC1/H264 sample from the existing Go Gallery test source. No new
// network download, synthetic codec label, or invented poster byte sequence.
async function testMapColdH264Poster(browser,mode,port){
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',ignoreHTTPSErrors:true,
    serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+'&map_h264=1',
      {waitUntil:'domcontentloaded'})
    await page.waitForFunction(()=>window.__mapProbe?.ready === true)
    const sdkLoads=mode==='inline' ? inlineSDKLoads : childSDKLoads
    await page.getByText('当前地图可查看 9 张照片',{exact:true}).waitFor()
    const cover=page.locator('[data-xdrive-places-trusted-photo-cover]').first()
    await cover.waitFor({state:'visible'})
    await page.waitForFunction(()=>window.__mapProbe?.h264.puts >= 1)
    await page.waitForFunction(()=>{
      const img=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return img instanceof HTMLImageElement && img.complete &&
        img.naturalWidth>0 && img.naturalHeight>0 &&
        (img.currentSrc||img.src).startsWith('blob:')
    })
    const proof=await page.evaluate(async()=>{
      const img=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      await img.decode()
      await new Promise(resolve=>requestAnimationFrame(()=>
        requestAnimationFrame(resolve)))
      return {dimensions:[img.naturalWidth,img.naturalHeight],
        currentSrc:(img.currentSrc||img.src).startsWith('blob:'),
        h264:{...window.__mapProbe.h264},
        queries:window.__mapProbe.queries.map(q=>({count:q.count,favorite:q.favorite,album:q.albumKey})),
        failed:window.__mapProbe.failed}
    })
    record(mode+': real H264 cold Owner preview produces decoded 512px-bounded JPEG map cover',
      proof.currentSrc&&proof.dimensions[0]>0&&proof.dimensions[0]<=512&&
      proof.dimensions[1]>0&&proof.dimensions[1]<=512&&
      proof.h264.misses>=1&&proof.h264.previewURLs>=1&&
      proof.h264.puts>=1&&proof.h264.putBytes>200&&
      proof.queries.every(q=>!q.favorite&&q.album==='')&&!proof.failed)
    const warmBefore=proof.h264.warm
    await page.locator('#toggle-favorite').click()
    await page.getByText('当前地图可查看 3 张照片',{exact:true}).waitFor()
    await page.waitForFunction(before=>window.__mapProbe?.h264.warm>before,
      warmBefore)
    await page.waitForFunction(()=>{
      const img=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return img instanceof HTMLImageElement&&img.complete&&
        img.naturalWidth>0&&img.naturalHeight>0
    })
    const warm=await page.evaluate(()=>({
      h264:{...window.__mapProbe.h264},
      favorite:window.__mapProbe.queries.some(q=>q.favorite&&q.count===3),
      errored:window.__mapProbe.failed,
    }))
    record(mode+': same Owner video uses warm persisted-Poster path after Favorites revalidation',
      warm.h264.warm>=1&&warm.favorite&&!warm.errored&&errors.length===0)
    record(mode+': video poster does not remount SDK or grant third-party media access',
      (mode==='inline' ? inlineSDKLoads : childSDKLoads)===sdkLoads&&
      requests.every(x=>x.host==='gallery'||x.host==='child'))
  }finally{await context.close()}
}


/** The REAL 512x512 HEVC-coded source in internal/media/testdata is decoded
 * with production ThumbnailWithAlpha in the opt-in Gin fixture and fetched
 * over its authenticated Owner /thumbnail route. No Browser HEIC decoder or
 * fake image MIME is involved: both SDK Hosts reuse the same React cover. */
async function testRealHEICOwnerMapCover(browser,mode,port,kind='heic'){
  assert(kind==='heic'||kind==='livp','only genuine reviewed HEIC media cases')
  const isLIVP=kind==='livp'
  const context=await browser.newContext({
    viewport:{width:960,height:760},locale:'zh-CN',
    ignoreHTTPSErrors:true,serviceWorkers:'block'})
  const page=await context.newPage()
  page.setDefaultTimeout(30000)
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://api.map.baidu.com/api?**',route=>{
    const url=new URL(route.request().url())
    assert.equal(url.searchParams.get('ak'),'TEST_ONLY_BROWSER_AK')
    return route.fulfill({status:200,contentType:'text/javascript',body:sdkStub})
  })
  try{
    await page.goto('https://'+galleryHost+':'+port+'/?mode='+mode+
      (isLIVP?'&map_real_livp=1':'&map_real_heic=1'),{waitUntil:'domcontentloaded'})
    await page.getByText('当前地图可查看 1 张照片',{exact:true}).waitFor()
    const image=page.locator('[data-xdrive-places-trusted-photo-cover] img').first()
    await image.waitFor({state:'visible'})
    await page.waitForFunction(kind=>{
      const img=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      return img instanceof HTMLImageElement&&img.complete&&
        img.naturalWidth===512&&img.naturalHeight===512&&
        (img.currentSrc||img.src).startsWith('blob:')&&
        window.__mapProbe?.[kind]?.reads>=1
    },kind)
    const proof=await page.evaluate(async()=>{
      const img=document.querySelector('[data-xdrive-places-trusted-photo-cover] img')
      await img.decode()
      const proof={...window.__mapProbe[location.search.includes('map_real_livp=1')
        ? 'livp':'heic']}
      return {heic:proof,
        photoCount:window.__mapProbe.queries.map(q=>q.count),
        nodeID:proof.nodeID,
        pixelSize:[img.naturalWidth,img.naturalHeight],
        blobSource:(img.currentSrc||img.src).startsWith('blob:')}
    })
    record(mode+': '+kind+' original becomes decoded cached Owner JPEG map cover',
      proof.heic.mime==='image/jpeg'&&proof.heic.bytes>512&&
      proof.pixelSize[0]===512&&proof.pixelSize[1]===512&&
      proof.blobSource&&proof.photoCount.length>0&&
      proof.photoCount.every(n=>n===1)&&proof.nodeID>0)
    const foreign=await page.evaluate(async nodeID=>{
      const owner=await fetch('/__fixture/map-owner',{cache:'no-store'}).then(r=>r.json())
      const reply=await fetch('/api/v1/media/items/'+nodeID+'/thumbnail?revision=1',{
        cache:'no-store',headers:{Authorization:'Bearer '+owner.token},
      })
      return reply.status
    },proof.nodeID)
    record(mode+': original Owner cannot read a separate '+kind+' Owner thumbnail',
      foreign===403||foreign===404)
    record(mode+': '+kind+' cover never sends Node or original bytes to the SDK Child',
      errors.length===0&&requests.every(x=>
        x.host==='gallery'||x.host==='child'))
    if(isLIVP){
      const liveReceipt=await page.evaluate(async nodeID=>{
        const {token}=await fetch('/__fixture/map-owner?account=livp',
          {cache:'no-store'}).then(r=>r.json())
        const headers={Authorization:'Bearer '+token}
        const item=await fetch('/api/v1/media/items/'+nodeID,{
          cache:'no-store',headers}).then(r=>r.json())
        const issued=await fetch('/api/v1/media/items/'+nodeID+
          '/live-photo-motion-ticket',{method:'POST',cache:'no-store',headers})
        if(!issued.ok)return {livePhoto:item.live_photo,motionIssued:false}
        const ticket=await issued.json()
        if(typeof ticket.url!=='string' ||
          !ticket.url.startsWith('/api/v1/media-live-photo-motion/') ||
          ticket.url.startsWith('//'))return {motionIssued:false}
        const motion=await fetch(ticket.url,{
          cache:'no-store',headers:{Range:'bytes=0-31'}})
        const data=await motion.arrayBuffer()
        const originalOwner=await fetch('/__fixture/map-owner',
          {cache:'no-store'}).then(r=>r.json())
        const forbidden=await fetch('/api/v1/media/items/'+nodeID+
          '/live-photo-motion-ticket',{method:'POST',cache:'no-store',
          headers:{Authorization:'Bearer '+originalOwner.token}})
        return {livePhoto:item.live_photo,container:item.metadata?.container_kind,
          motionIssued:true,mime:motion.headers.get('content-type'),
          status:motion.status,bytes:data.byteLength,
          denied:forbidden.status}
      },proof.nodeID)
      // Keep all three requirements independent: if a new source/Owner
      // regression occurs, the failure tells us precisely which contract
      // broke without disclosing a live signed URL or bearer token.
      record(mode+': actual Gin identifies HEIC LIVP as Live Photo',
        liveReceipt.livePhoto===true&&liveReceipt.container==='livp')
      record(mode+': real LIVP motion uses exact signed Owner HTTP 206 Range',
        liveReceipt.motionIssued===true&&
        liveReceipt.mime?.startsWith('video/quicktime')&&
        liveReceipt.status===206&&liveReceipt.bytes===32)
      record(mode+': other Owner cannot mint LIVP motion stream ticket',
        [403,404].includes(liveReceipt.denied))
      summary.realLIVPMapCoverModes.push(mode)
    }else{
      summary.realHEICMapCoverModes.push(mode)
    }
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
    if(gallery&&pathname==='/'){
      let html=ginURL?resultHTML.replace('</head>',
        '<script>window.__P04_REAL_GIN=true</script></head>'):resultHTML
      if(new URL(req.url||'/','https://'+host).searchParams.get('handoff_doc')==='1')
        html=html.replace('<head>','<head><meta name="referrer" content="no-referrer">')
      return content(res,200,'text/html',html)
    }
    if(gallery&&ginURL&&
      (pathname==='/__fixture/map-owner' ||
        pathname==='/__fixture/map-handoff-invalidate' ||
        pathname.startsWith('/api/v1/media/places/baidu-jsapi/') ||
        pathname==='/api/v1/media/items' ||
        pathname.startsWith('/api/v1/media/items/') ||
        pathname.startsWith('/api/v1/files/') ||
        pathname.startsWith('/api/v1/file-preview/') ||
        pathname.startsWith('/api/v1/media-live-photo-motion/')))
      return proxyRealGin(req,res)
    if(gallery&&pathname==='/__fixture/h264.mp4'&&req.method==='GET'){
      // Single same-origin test-only signed-Preview substitute; browser
      // Range seeks read exactly the pre-existing real AVC1/H264 bitstream.
      const requestRange=typeof req.headers.range==='string'
        ? /^bytes=(\d+)-(\d*)$/.exec(req.headers.range) : null
      if(req.headers.range && !requestRange)
        return content(res,416,'text/plain','invalid media Range')
      const begin=requestRange?Number(requestRange[1]):0
      const end=requestRange&&requestRange[2]
        ? Number(requestRange[2]):h264Movie.length-1
      if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||
         begin<0||end<begin||end>=h264Movie.length)
        return content(res,416,'text/plain','invalid media Range')
      const bytes=h264Movie.subarray(begin,end+1)
      return content(res,requestRange?206:200,'video/mp4',bytes,{
        'Accept-Ranges':'bytes','Content-Length':String(bytes.length),
        ...(requestRange?{'Content-Range':'bytes '+begin+'-'+end+'/'+h264Movie.length}:{})
      })
    }
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
    if(!ginURL){
      await testPhotoMarkerPresentation(browser,'inline',port)
      await testPhotoMarkerPresentation(browser,'isolated',port)
      await testPhotoCoverDuringMapPan(browser,'inline',port)
      await testPhotoCoverDuringMapPan(browser,'isolated',port)
      await testPhotoCellAlbumDialog28(browser,'inline',port)
      await testPhotoCellAlbumDialog28(browser,'isolated',port)
      await testMapOverlayPinOcclusion(browser,'inline',port)
      await testMapOverlayPinOcclusion(browser,'isolated',port)
      await testDelayedBD09Map(browser,'inline',port)
      await testDelayedBD09Map(browser,'isolated',port)
      await testAutomaticBD09VisibilityRecheck(browser,'inline',port)
      await testAutomaticBD09VisibilityRecheck(browser,'isolated',port)
      await testMapColdH264Poster(browser,'inline',port)
      await testMapColdH264Poster(browser,'isolated',port)
      await testOwnerCellsFailureRetry(browser,'inline',port)
      await testOwnerCellsFailureRetry(browser,'isolated',port)
      for(const scheme of ['light','dark']){
        await testMapKeyboardAppearance(browser,'inline',scheme,port)
        await testMapKeyboardAppearance(browser,'isolated',scheme,port)
      }
    }
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
      await testFavoritesMapClose(browser,'inline',port)
      await testFavoritesMapClose(browser,'isolated',port)
      record('both Hosts return from map to same authenticated Favorites membership',
        summary.favoriteMapCloseModes.join(',')==='inline,isolated')
      await testFullDocumentMapHandoff(browser,'inline',port)
      await testFullDocumentMapHandoff(browser,'isolated',port)
      record('both SDK Hosts perform real one-use Gin scope handoff across full document',
        summary.fullDocumentHandoffModes.join(',')==='inline,isolated')
      await testFullDocumentMapHandoff(browser,'inline',port,true)
      await testFullDocumentMapHandoff(browser,'isolated',port,true)
      record('both Hosts preserve real Family Album, Favorite, Date, Kind, Sort after full reload',
        summary.fullDocumentComboModes.join(',')==='inline,isolated')
      record('both Hosts exclude real date/kind and recover only scoped Owner covers',
        summary.fullDocumentNegativeFilterModes.join(',')==='inline,isolated')
      for(const scenario of ['album-revision','album-missing','album-deleted',
        'session-revoked','map-epoch-revoked','foreign-owner','network-drop']){
        await testInvalidatedOwnerHandoff(browser,'inline',port,scenario)
        await testInvalidatedOwnerHandoff(browser,'isolated',port,scenario)
      }
      record('two SDK Hosts deny pending Owner tickets on Album/revoke/network failures',
        summary.ownerScopeInvalidationModes.length===14)
      await testStaleSourceRevisionOwnerMap(browser,'inline',port)
      await testStaleSourceRevisionOwnerMap(browser,'isolated',port)
      record('both SDK Hosts reject stale Node revisions in real Gin Owner map/Cell Range',
        summary.sourceRevisionModes.join(',')==='inline,isolated')
      await testRealHEICOwnerMapCover(browser,'inline',port)
      await testRealHEICOwnerMapCover(browser,'isolated',port)
      record('both SDK Hosts decoded signed real HEIC-derived JPEG photo pins',
        summary.realHEICMapCoverModes.join(',')==='inline,isolated')
      await testRealHEICOwnerMapCover(browser,'inline',port,'livp')
      await testRealHEICOwnerMapCover(browser,'isolated',port,'livp')
      record('both SDK Hosts decoded HEIC LIVP still and authorized motion',
        summary.realLIVPMapCoverModes.join(',')==='inline,isolated')
      for(const scheme of ['light','dark']){
        await testIOSPhotoMapCompactChrome(browser,'inline',scheme,port)
        await testIOSPhotoMapCompactChrome(browser,'isolated',scheme,port)
      }
      record('two SDK Hosts use one iOS map canvas in light and dark',
        summary.iosCompactModes.join(',')===
          'inline:light,isolated:light,inline:dark,isolated:dark')
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
