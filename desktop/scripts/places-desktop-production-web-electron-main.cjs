'use strict'
const {app}=require('electron')
const assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process')
const origin=process.env.XD_DESKTOP_PLACES_PRODUCTION_ORIGIN
const owner=process.env.XD_DESKTOP_PLACES_PRODUCTION_OWNER
assert.ok(origin&&origin.startsWith('https://10.233.15.19:'))
assert.equal(owner,'production-map-owner')
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn,budget,reason) {
  const start=Date.now()
  let last
  while(Date.now()-start<budget){
    try{const got=await fn();if(got)return got;last=null}
    catch(error){last=String(error?.message||error)}
    await wait(150)
  }
  throw Error('production Desktop map '+reason+' timeout'+(last?' ('+last.slice(0,180)+')':''))
}
function inspectRealDesktop(){
  return {preload:!!window.xdriveDesktop?.agent,
    nav:!!document.querySelector('nav[aria-label="桌面版功能区"]')}
}
// Test-only instrumentation runs in the genuine production renderer before
// the Places section is activated. It stores ONLY error classes and DOM
// transition counters; URLs, photo IDs, raw errors and credentials are never
// returned to the test runner.
function installMapRendererFailureProbe(){
  const current={errors:[],redactedErrorMessages:[],warnings:0,rootRemovalCount:0,
    rootRenderCount:0,lastVisibleSection:'',installed:true}
  const classify=value=>{
    const v=String(value?.message||value||'')
    const name=typeof value?.name==='string'
      ?/^[A-Za-z]{1,35}Error$/.test(value.name)?value.name:'Error':'Error'
    const code=v.match(/Minified React error #(\d+)/i)
    if(code)return 'react_minified_'+code[1]
    if(/maximum update depth/i.test(v))return 'react_update_depth'
    if(/too many re-renders/i.test(v))return 'react_rerenders'
    if(/Rendered more hooks|Rendered fewer hooks/i.test(v))return 'react_hook_order'
    if(/Cannot read properties of (?:undefined|null)/i.test(v)){
      const key=v.match(/reading ['"]([A-Za-z0-9_$-]{1,45})['"]/)
      return 'nullish_property_'+(key?.[1]||'unknown')
    }
    if(/is not a function/i.test(v))return 'not_a_function'
    if(/not iterable/i.test(v))return 'not_iterable'
    if(/invalid hook call/i.test(v))return 'invalid_hook'
    if(/network error|Failed to fetch/i.test(v))return 'network_error'
    if(/ChunkLoadError|dynamically imported module/i.test(v))return 'chunk_load'
    if(/TypeError/i.test(v))return 'type_error'
    if(/ReferenceError/i.test(v))return 'reference_error'
    return 'other_'+name
  }
  const capture=(kind,value)=>{
    if(current.errors.length<10)current.errors.push(kind+':'+classify(value))
    // This is a wholly synthetic, isolated CI user/server fixture. Capture
    // the first exception MESSAGE only (never stack, source URLs or bodies).
    // Redact opaque credentials, IP/URLs and quoted unknown strings before
    // reporting a bounded category-specific diagnostic.
    if(current.redactedErrorMessages.length<3){
      const source=String(value?.message||value||'').split('\n')[0]
      const sanitized=source
        .replace(/https?:\/\/[^\s)]+/gi,'[url]')
        .replace(/[a-f0-9]{32,}/gi,'[opaque]')
        .replace(/(Bearer|refresh[_-]?token|password|Cookie)\s*[:=]\s*[^\s,;]+/gi,'[secret]')
        .slice(0,175)
      current.redactedErrorMessages.push(kind+':'+sanitized)
    }
  }
  window.addEventListener('error',e=>capture('window',e.error||e.message))
  window.addEventListener('unhandledrejection',e=>capture('promise',e.reason))
  const originalError=console.error.bind(console)
  console.error=(...args)=>{
    capture('console',args.find(a=>a instanceof Error)||args[0])
    originalError(...args)
  }
  const root=document.getElementById('root')
  if(root){
    const observe=()=>{
      if(root.childElementCount===0)current.rootRemovalCount++
      else current.rootRenderCount++
      const section=document.querySelector('[data-xdrive-gallery-section][aria-current="page"]')
      const known=section?.getAttribute('data-xdrive-gallery-section')
      if(['library','places','favorites','albums'].includes(known))
        current.lastVisibleSection=known
    }
    const observer=new MutationObserver(observe)
    observer.observe(root,{childList:true,subtree:false})
    observe()
  }
  window.__xdrivePlacesRendererFailureProbe=current
  return true
}
function clickGallery(){
  const box=document.querySelector('nav[aria-label="桌面版功能区"]')
  const target=Array.from(box?.querySelectorAll('[role="button"]')||[])
    .find(el=>el.textContent?.trim()==='图库')
  if(!target)return false
  target.click()
  return true
}
function clickPlaces(){
  const target=document.querySelector('[data-xdrive-gallery-section="places"]')
  if(!target)return false
  target.click()
  return true
}
async function diagnoseNativeMapAdmission(){
  const section=document.querySelector('[data-xdrive-gallery-section][aria-current="page"]')
    ?.getAttribute('data-xdrive-gallery-section')||''
  const known=['library','memories','people','places','albums','favorites',
    'media-types','cleanup','trash'].includes(section)?section:'unknown'
  const state=await window.xdriveDesktop?.agent?.getState?.().catch(()=>null)
  const current=state?.data?.status||state?.status||{}
  const map=document.querySelector('[data-xdrive-gallery-places-map]')
  const panel=document.querySelector('[data-xdrive-desktop-places-shared-web]')
  const failed=document.querySelector('[data-xdrive-desktop-map-unavailable]')
  const alert=panel?.querySelector('[role="alert"]')
  const waiting=panel?.querySelector('[role="status"]')
  const content=alert?.textContent||waiting?.textContent||''
  const safeProbe=window.__xdrivePlacesRendererFailureProbe||{}
  return {
    rendererExceptionClasses:Array.isArray(safeProbe.errors)
      ?safeProbe.errors.slice(0,10):[],
    errorMessages:Array.isArray(safeProbe.redactedErrorMessages)
      ?safeProbe.redactedErrorMessages.slice(0,3):[],
    rootRemovalCount:Number(safeProbe.rootRemovalCount||0),
    rootRenderCount:Number(safeProbe.rootRenderCount||0),
    lastVisibleSection:typeof safeProbe.lastVisibleSection==='string'
      ?safeProbe.lastVisibleSection:'',
    desktopNav:!!document.querySelector('nav[aria-label="桌面版功能区"]'),
    galleryNav:!!document.querySelector('[data-xdrive-gallery-section="places"]'),
    gallerySection:known,
    loginForm:!!document.querySelector('input[type="password"]'),
    agentConnected:state?.data?.connected===true||state?.connected===true,
    agentConfigured:current.configured===true,
    agentLoggedIn:current.auth_status==='已登录',
    agentMustChangePassword:current.must_change_password===true,
    documentReady:document.readyState==='complete',
    hasReactRoot:!!document.getElementById('root'),
    reactRootHasChildren:(document.getElementById('root')?.childElementCount||0)>0,
    bodyHasChildren:(document.body?.childElementCount||0)>0,
    desktopPreload:!!window.xdriveDesktop?.agent,
    hasGlobalAlert:!!document.querySelector('[role="alert"]'),
    placesIndex:!!document.querySelector('[data-xdrive-places-index]'),
    map:!!map,sharedWeb:!!panel,unavailable:!!failed,
    webview:!!document.querySelector('[data-xdrive-desktop-embedded-places]'),
    denied:!!alert,waiting:!!waiting,
    nativeReauth:!!document.querySelector('[data-xdrive-desktop-places-native-reauth]'),
    // Only known stable UI categories: never log the Owner's DOM, ID or URL.
    category:content.includes('超时')?'timeout':
      content.includes('验证失败')?'auth_denied':
      content.includes('连接准备失败')?'https_prepare':
      content.includes('正在按当前 Desktop')?'preparing':'other',
  }
}
function inspectRealWebGuest(){
  const root=document.querySelector('[data-xdrive-desktop-places-web-page]')
  const denied=document.querySelector('[data-xdrive-desktop-places-auth-denied]')
  const login=document.querySelector('#web-login-username, #web-login-password')
  if(denied||login)return {denied:true,login:!!login}
  if(!root)return null
  // The data-xdrive-places-map-mode marker has NO value. The actual
  // selected SDK mode is expressed by mutually exclusive aria-pressed
  // buttons, and must agree with the current HTTPS document query.
  const mode=root.querySelector('[data-xdrive-places-map-mode]')
  const normal=mode?.querySelector('[data-xdrive-map-mode-prototype]')
  const isolated=mode?.querySelector('[data-xdrive-map-mode-isolated]')
  const normalPressed=normal?.getAttribute('aria-pressed')==='true'
  const isolatedPressed=isolated?.getAttribute('aria-pressed')==='true'
  const mapMode=normalPressed!==isolatedPressed
    ? normalPressed?'prototype':'isolated' : ''
  const queryMode=new URLSearchParams(location.search).get('places_map_mode')
  const urlMode=queryMode===null || queryMode==='prototype'
    ? 'prototype' : queryMode==='isolated'?'isolated':'invalid'
  return {ready:true,denied:false,login:false,
    hasGallery:!!root.querySelector('[data-xdrive-places-index]'),
    mapMode,urlMode,modeConsistent:mapMode!==''&&mapMode===urlMode,
    hasModeControls:!!normal&&!!isolated,
    guestBridge:typeof window.xdrivePlacesEmbedBridge,
    hasNativeAgent:typeof window.xdriveDesktop,
    url:location.origin}
}

/**
 * Executes in the *real* production HTTPS WebView, using its pre-existing
 * HttpOnly browser session and the genuine Gin/PostgreSQL Owner endpoints.
 * Only synthetic counts and HTTP status classes return to Electron Main;
 * no AccessJWT, native refresh credential or raw photo metadata is logged.
 * The Web View/React UI is still mounted and authenticated before this runs.
 */
async function inspectRealWebGuestOwnerDataPath(expectedOwner){
  const tokenReply=await fetch('/api/v1/auth/browser/refresh',{
    method:'POST',redirect:'error',credentials:'same-origin',cache:'no-store',
    headers:{'X-XDrive-Browser-Owner':expectedOwner},
  })
  if(!tokenReply.ok)throw Error('map guest Cookie refresh rejected '+tokenReply.status)
  const receipt=await tokenReply.json()
  if(receipt.username!==expectedOwner || receipt.browser_session!==true ||
      typeof receipt.access_token!=='string' || receipt.access_token.length<30)
    throw Error('map guest browser JWT Owner mismatch')
  const bearer=receipt.access_token
  const request=async(path,method='GET')=>fetch(path,{
    method,credentials:'same-origin',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+bearer},
  })
  const bounds='west=100&south=20&east=125&north=40&sort_by=captured&sort_dir=desc'
  const base='/api/v1/media/places/baidu-jsapi/cells?'+bounds
  const readCells=async(suffix)=> {
    const response=await request(base+suffix)
    if(response.status!==200)throw Error('protected Owner cells HTTP '+response.status)
    const data=await response.json()
    if(data.coordinate_space!=='bd09ll' || !Array.isArray(data.cells))
      throw Error('invalid real BD09 cell response')
    return data
  }
  const [all,favorites,family,familyFavorites,emptyDate]=await Promise.all([
    readCells(''),readCells('&favorite=true'),
    readCells('&album=manual%3AFamily'),
    readCells('&album=manual%3AFamily&favorite=true'),
    readCells('&captured_from=2099-01-01'),
  ])
  if(all.total_count!==9 || favorites.total_count!==3 ||
      family.total_count!==3 || familyFavorites.total_count!==2 ||
      emptyDate.total_count!==0)
    // Only five synthetic integer counts are emitted; never session or photo IDs.
    throw Error('real Owner-scoped album/favorite/date counts differ from fixture; '+
      'synthetic_counts='+[all.total_count,favorites.total_count,
        family.total_count,familyFavorites.total_count,emptyDate.total_count].join(',')+
      ' expected=9,3,3,2,0')
  if(all.cells.length!==1 || favorites.cells.length!==1 ||
      family.cells.length!==1 || familyFavorites.cells.length!==1)
    throw Error('real Owner Cells did not preserve bounded descriptor')
  const cell=all.cells[0]
  const query=new URLSearchParams(bounds)
  for(const [key,value] of Object.entries({
    cell_x:cell.cell_x,cell_y:cell.cell_y,asset_id:cell.asset_id,
    node_id:cell.node_id,node_revision:cell.node_revision,
    photo_count:cell.photo_count,offset:0,limit:10,range:true,
  }))query.set(key,String(value))
  const items=await request('/api/v1/media/places/baidu-jsapi/cell-items?'+query)
  if(items.status!==200)throw Error('real Owner Cell-to-Viewer range HTTP '+items.status)
  const page=await items.json()
  if(page.total_count!==9 || !Array.isArray(page.items) ||
      page.items.length===0 || page.items.length>9)
    throw Error('real Owner Cell-to-Viewer range is not exact')
  const selected=page.items.find(item=>item?.node?.id===cell.node_id) || page.items[0]
  if(!Number.isSafeInteger(selected?.node?.id) || selected.node.id<=0)
    throw Error('Viewer range has no Owner-verified Node')
  const metadata=await request('/api/v1/media/items/'+selected.node.id)
  if(metadata.status!==200)throw Error('real Owner Viewer metadata HTTP '+metadata.status)
  const photo=await metadata.json()
  if(!photo || !photo.node || photo.node.id!==selected.node.id)
    throw Error('real Viewer metadata escaped the exact Owner Node')
  const thumbnail=await request('/api/v1/media/items/'+selected.node.id+'/thumbnail')
  const viewer=await request('/api/v1/media/items/'+selected.node.id+
    '/viewer-preview?format=jpeg')
  const isJPEG=async(response)=>{
    if(response.status!==200 ||
        !response.headers.get('content-type')?.startsWith('image/jpeg'))return false
    const data=new Uint8Array(await response.arrayBuffer())
    return data.length>=64 && data[0]===255 && data[1]===216 &&
      data[data.length-2]===255 && data[data.length-1]===217
  }
  const thumbnailBytesValid=await isJPEG(thumbnail)
  const viewerBytesValid=await isJPEG(viewer)
  if(!thumbnailBytesValid || !viewerBytesValid)
    throw Error('real Owner thumbnail or Viewer JPEG payload invalid')
  const unrelated=await Promise.all([
    request('/api/v1/nodes/root'),
    request('/api/v1/notes'),
    request('/api/v1/admin/users'),
    request('/api/v1/media/albums','POST'),
  ])
  if(unrelated.some(response=>response.status!==403))
    throw Error('map browser bearer escaped its dedicated route allowlist')
  return {
    ok:true,ownerCells:all.total_count,favorites:favorites.total_count,
    family:family.total_count,familyFavorites:familyFavorites.total_count,
    emptyDate:emptyDate.total_count,viewerRange:page.total_count,
    viewerMetadata:true,thumbnailStatus:thumbnail.status,
    viewerStatus:viewer.status,thumbnailBytesValid,viewerBytesValid,
    mapRouteOnly:true,
  }
}

/** Keeps the map JWT only in a guest-local closure across real Agent logout. */
async function armRealWebGuestNativeRevocation(expectedOwner){
  const receipt=await fetch('/api/v1/auth/browser/refresh',{
    method:'POST',redirect:'error',credentials:'same-origin',cache:'no-store',
    headers:{'X-XDrive-Browser-Owner':expectedOwner},
  })
  if(receipt.status!==200)throw Error('cannot arm protected guest revoke probe')
  const issued=await receipt.json()
  if(issued.username!==expectedOwner || !issued.browser_session ||
      !issued.access_token)throw Error('revocation probe Owner mismatch')
  const bearer=issued.access_token
  const read=()=>fetch('/api/v1/media/places/baidu-jsapi/cells?'+
    'west=100&south=20&east=125&north=40&sort_by=captured&sort_dir=desc',{
    credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{Authorization:'Bearer '+bearer},
  })
  if((await read()).status!==200)throw Error('map bearer not live before Agent logout')
  // Cancel a genuine in-flight protected HTTP request. A settled late result
  // must not mutate the same Owner's current map, even before native logout.
  const cancel=new AbortController()
  const pending=fetch('/api/v1/media/places/baidu-jsapi/cells?'+
    'west=100&south=20&east=125&north=40&sort_by=captured&sort_dir=desc',{
    credentials:'same-origin',redirect:'error',cache:'no-store',
    headers:{Authorization:'Bearer '+bearer},signal:cancel.signal})
  cancel.abort()
  let aborted=false
  try{await pending}catch(error){aborted=error?.name==='AbortError'}
  if(!aborted)throw Error('stale in-flight Owner Cells request was not aborted')
  // Boolean-only test signal; neither JWT nor private Owner IDs leave closure.
  window.__xdrivePlacesNativeRevocationReady=true
  await new Promise(resolve=>window.addEventListener(
    'xdrive-test-native-agent-logged-out',resolve,{once:true}))
  const response=await read()
  return {revoked:response.status===401 || response.status===403}
}

let launched=false
async function run(win){
  let stage='production-desktop-init'
  let guest=null
  let guestLoads=0
  const rendererFaults=[]
  let rendererGone=false
  const boundedFault=(message)=>{
    const text=String(message||'')
    const react=text.match(/Minified React error #(\d+)/i)
    if(react)return 'react_minified_'+react[1]
    if(/Cannot read properties of undefined/i.test(text))return 'undefined_property'
    if(/Cannot read properties of null/i.test(text))return 'null_property'
    if(/Uncaught (?:TypeError|ReferenceError)/i.test(text))return 'uncaught_js'
    if(/Uncaught Error:/i.test(text))return 'uncaught_error'
    if(/Failed to fetch dynamically imported module/i.test(text))return 'module_load'
    if(/Content Security Policy/i.test(text))return 'csp'
    if(/React/i.test(text)&&/error/i.test(text))return 'react_error'
    return null
  }
  const noteFault=(value)=>{
    const kind=boundedFault(value)
    if(kind&&rendererFaults.length<8)rendererFaults.push(kind)
  }
  win.webContents.on('console-message',(_event,details)=>{
    if(details&&typeof details==='object'){
      noteFault(details.message)
      if(details.level==='error' && rendererFaults.length<8)
        rendererFaults.push('renderer_error_message')
    }
  })
  win.webContents.on('render-process-gone',()=>{rendererGone=true})
  win.webContents.on('did-fail-load',(_event,code)=>{
    if(rendererFaults.length<8)rendererFaults.push('navigation_failed_'+String(Number(code)||0))
  })
  try{
    win.setContentSize(1280,900)
    win.webContents.on('did-attach-webview',(_event,attached)=>{
      guest=attached
      attached.on('did-finish-load',()=>{guestLoads++})
    })
    stage='production-Desktop-preload-nav'
    await until(async()=>{
      const state=await win.webContents.executeJavaScript(
        '('+inspectRealDesktop.toString()+')()')
      return state.preload&&state.nav
    },40000,'real Main/preload/Renderer login state')
    stage='production-Desktop-Gallery-open'
    assert.equal(await win.webContents.executeJavaScript(
      '('+installMapRendererFailureProbe.toString()+')()'),true)
    const nav=await win.webContents.executeJavaScript('('+clickGallery.toString()+')()')
    assert.ok(nav,'real Desktop Gallery navigation missing')
    await until(()=>win.webContents.executeJavaScript(
      'Boolean(document.querySelector(\'[data-xdrive-gallery-section="places"]\'))'
    ),30000,'actual shared Gallery section')
    stage='production-Desktop-Places-open'
    assert.ok(await win.webContents.executeJavaScript('('+clickPlaces.toString()+')()'),
      'real Gallery Places button missing')
    await until(()=>win.webContents.executeJavaScript(
      'Boolean(document.querySelector("[data-xdrive-places-index]"))'
    ),30000,'real Gallery Places page')
    try{
      await until(()=>win.webContents.executeJavaScript(
        'Boolean(document.querySelector("[data-xdrive-desktop-embedded-places]"))'
      ),30000,'native production map WebView host')
    }catch(error){
      const diagnostic=await win.webContents.executeJavaScript(
        '('+diagnoseNativeMapAdmission.toString()+')()').catch(()=>({unavailable:true}))
      throw Error('map admission '+JSON.stringify({
        ...diagnostic,rendererGone,rendererFaults,
        urlProtocol:win.webContents.getURL().split(':',1)[0],
        hostDestroyed:win.isDestroyed(),
      })+'; '+String(error?.message||error))
    }
    stage='production-Desktop-HTTPS-WebView-attach'
    const attached=await until(async()=>{
      return guest&&!guest.isDestroyed()?guest:null
    },30000,'actual Main-attached HTTPS WebView')
    // The real HTTPS Guest may attach before the window has been shown or
    // its document can receive keyboard events. Check F12 only after the
    // authenticated Web root is actually mounted, never via a fake IPC.
    stage='production-Web-Owner-Places-root'
    const state=await until(()=>attached.executeJavaScript(
      '('+inspectRealWebGuest.toString()+')()'),
      70000,'production Web Places Owner-bound root')
    assert.equal(state.ready,true)
    assert.equal(state.denied,false)
    assert.equal(state.login,false)
    assert.equal(state.guestBridge,'object')
    assert.equal(state.hasNativeAgent,'undefined')
    assert.equal(state.url,origin)
    assert.equal(state.hasGallery,true)
    assert.equal(state.mapMode,'prototype','default map unexpectedly forced isolation')
    assert.equal(state.modeConsistent,true,'initial Web SDK mode and navigation differ')
    assert.equal(state.hasModeControls,true,'production Web shared map controls absent')
    stage='production-Desktop-F12-real-WebView-DevTools'
    // Electron sendInputEvent may not behave like a native keyboard shortcut
    // on Xvfb. Use the real X11 focused window and XTest key delivery, then
    // require the production before-input-event path to open Guest DevTools.
    // Test instrumentation observes only key class / Guest vs Parent counts.
    const f12Events={parent:0,guest:0}
    const parentInput=(_event,input)=>{
      if(input?.type==='keyDown' && input.key==='F12') f12Events.parent++
    }
    const guestInput=(_event,input)=>{
      if(input?.type==='keyDown' && input.key==='F12') f12Events.guest++
    }
    win.webContents.on('before-input-event',parentInput)
    attached.on('before-input-event',guestInput)
    try{
      if(!win.isVisible())win.show()
      win.focus()
      attached.focus()
      await wait(250)
      const handle=win.getNativeWindowHandle()
      assert.ok(Buffer.isBuffer(handle)&&handle.length>=4,
        'real X11 BrowserWindow handle missing')
      const xid=String(handle.readUInt32LE(0))
      // No window manager is required: windowfocus uses XSetInputFocus;
      // key uses XTest rather than a fake JavaScript KeyboardEvent.
      execFileSync('xdotool',['windowfocus','--sync',xid],
        {timeout:5000,stdio:'ignore'})
      execFileSync('xdotool',['key','--clearmodifiers','F12'],
        {timeout:5000,stdio:'ignore'})
      await until(()=>attached.isDevToolsOpened(),10000,
        'real X11 F12 must open authenticated map Guest DevTools')
      assert.ok(f12Events.parent+f12Events.guest>0,
        'F12 was not received by the production Parent/Guest handler')
      assert.equal(win.webContents.isDevToolsOpened(),false,
        'F12 must not open Parent DevTools instead of map Guest')
      attached.closeDevTools()
    }catch(error){
      throw Error('native F12 map diagnostic failed; '+JSON.stringify({
        windowVisible:win.isVisible(),windowFocused:win.isFocused(),
        parentInputCount:f12Events.parent,guestInputCount:f12Events.guest,
        parentTools:win.webContents.isDevToolsOpened(),
        guestTools:attached.isDevToolsOpened(),guestDestroyed:attached.isDestroyed(),
      })+'; '+String(error?.message||error))
    }finally{
      win.webContents.removeListener('before-input-event',parentInput)
      if(!attached.isDestroyed())
        attached.removeListener('before-input-event',guestInput)
    }
    stage='production-Web-Owner-scoped-Gin-Cells-Viewer-and-map-route-fence'
    const media=await attached.executeJavaScript(
      '('+inspectRealWebGuestOwnerDataPath.toString()+')('+JSON.stringify(owner)+')')
    assert.equal(media.ok,true)
    assert.equal(media.ownerCells,9)
    assert.equal(media.favorites,3)
    assert.equal(media.family,3)
    assert.equal(media.familyFavorites,2)
    assert.equal(media.emptyDate,0)
    assert.equal(media.viewerRange,9)
    assert.equal(media.viewerMetadata,true)
    assert.equal(media.thumbnailBytesValid,true)
    assert.equal(media.viewerBytesValid,true)
    assert.equal(media.mapRouteOnly,true)
    const preload=await win.webContents.executeJavaScript(
      'Boolean(window.xdriveDesktop?.agent && document.querySelector("[data-xdrive-places-index]"))')
    assert.equal(preload,true)
    let realWebModeRoundTrip=false
    if(Number(process.env.XD_DESKTOP_PLACES_BOOT||'0')===1){
      stage='production-Web-prototype-isolated-prototype-mode-round-trip'
      const select=async(mode)=>{
        // location.replace may abort executeJavaScript's reply even when
        // Chromium performed the click. The following exact-mode wait is
        // mandatory and does not treat an arbitrary JS error as success.
        let moved=true
        try{
          moved=await attached.executeJavaScript(
            '(() => {const b=document.querySelector("[data-xdrive-map-mode-'+mode+']");'+
            'if(!b||b.disabled)return false;b.click();return true})()')
        }catch{}
        assert.equal(moved,true,'real Web mode control missing')
        await until(async()=>{
          try {
            const value=await attached.executeJavaScript(
              '('+inspectRealWebGuest.toString()+')()')
            return value?.ready && value?.mapMode===mode &&
              value?.urlMode===mode && value?.modeConsistent===true &&
              !value.login && !value.denied && value.url===origin
          }catch{return false}
        },50000,'same-Owner real production Web map mode '+mode)
      }
      await select('isolated')
      await select('prototype')
      // The production browser must remain authorized for the same exact
      // filtered /cells, protected JPEG Viewer and route fence after two
      // genuine document navigations. UI mode alone is insufficient.
      const afterModes=await attached.executeJavaScript(
        '('+inspectRealWebGuestOwnerDataPath.toString()+')('+JSON.stringify(owner)+')')
      for(const name of ['ownerCells','favorites','family','familyFavorites',
        'emptyDate','viewerRange','thumbnailBytesValid','viewerBytesValid','mapRouteOnly'])
        assert.equal(afterModes[name],media[name],
          'Owner scoped media changed across SDK mode: '+name)
      realWebModeRoundTrip=true
    }
    let legacyServerFailedClosed=false
    let browserLogoutRecovered=false
    if(Number(process.env.XD_DESKTOP_PLACES_BOOT||'0')===1){
      stage='production-Desktop-recover-after-browser-Cookie-revocation'
      const status=await attached.executeJavaScript(
        '(async()=>{const r=await fetch("/api/v1/auth/browser/logout",'+
        '{method:"POST",credentials:"same-origin",redirect:"error",'+
        'headers:{"X-XDrive-Browser-Owner":"production-map-owner"}});'+
        'return r.status})()')
      assert.ok(status>=200&&status<300,'browser Cookie revocation failed')
      await attached.reload()
      await until(async()=>{
        try{return await win.webContents.executeJavaScript(
          'Boolean(document.querySelector("[data-xdrive-desktop-places-native-reauth]"))'
        )}catch{return false}
      },45000,'expired map Cookie must offer trusted Desktop reauthentication')
      const noNestedLogin=await win.webContents.executeJavaScript(
        '!Boolean(document.querySelector("#web-login-username"))')
      assert.equal(noNestedLogin,true,'unexpected nested Web login')
      const clickTrustedRetry=()=>win.webContents.executeJavaScript(
        '(() => {const p=document.querySelector("[data-xdrive-desktop-places-shared-web]");'+
        'const b=[...(p?.querySelectorAll("button")||[])].find(x=>'+
        'x.textContent?.includes("重试 Web 地图"));'+
        'if(!b)return false;b.click();return true})()')
      const fs=require('node:fs')
      const legacyMarker=process.env.XD_DESKTOP_PLACES_LEGACY_MARKER
      assert.ok(legacyMarker,'old-Server test marker missing')
      fs.writeFileSync(legacyMarker,'old-server',{mode:0o600})
      assert.equal(await clickTrustedRetry(),true,
        'native-safe map retry unavailable for legacy Server')
      await until(async()=>{
        try{return await win.webContents.executeJavaScript(
          'Boolean(document.querySelector("[data-xdrive-desktop-places-native-reauth]"))'
        )}catch{return false}
      },30000,'old Server must show trusted Desktop fallback')
      fs.rmSync(legacyMarker,{force:true})
      legacyServerFailedClosed=true
      assert.equal(await clickTrustedRetry(),true,'map retry after Server capability restored missing')
      const recovered=await until(async()=>{
        if(!guest||guest.isDestroyed())return null
        try{
          const v=await guest.executeJavaScript(
            '('+inspectRealWebGuest.toString()+')()')
          return v?.ready&&!v.denied&&!v.login&&v.url===origin?v:null
        }catch{return null}
      },70000,'same Owner native Agent map session regrant')
      assert.equal(recovered.guestBridge,'object')
      assert.equal(recovered.hasNativeAgent,'undefined')
      browserLogoutRecovered=true
    }
    let nativeLogoutBlockedOldMap=false
    let oldMapHiddenAfterLogout=false
    if(Number(process.env.XD_DESKTOP_PLACES_BOOT||'0')===2){
      stage='production-Desktop-live-Agent-logout-while-WebView-mounted'
      const readyFile=process.env.XD_DESKTOP_PLACES_LOGOUT_READY
      const doneFile=process.env.XD_DESKTOP_PLACES_LOGOUT_DONE
      assert.ok(readyFile && doneFile,'test-only logout coordination absent')
      const fs=require('node:fs')
      const inFlight=attached.executeJavaScript(
        '('+armRealWebGuestNativeRevocation.toString()+')('+JSON.stringify(owner)+')')
      await until(async()=>{
        if(attached.isDestroyed())return false
        return attached.executeJavaScript(
          'window.__xdrivePlacesNativeRevocationReady===true')
      },12000,'live browser bearer ready before native logout')
      fs.writeFileSync(readyFile,'ready',{mode:0o600})
      await until(()=>fs.existsSync(doneFile),40000,'real Go Agent logout')
      if(!attached.isDestroyed()){
        try{await attached.executeJavaScript(
          'window.dispatchEvent(new Event("xdrive-test-native-agent-logged-out"))')
        }catch{}
      }
      const response=await Promise.race([
        inFlight.then(x=>x).catch(()=>({guestClosed:true})),
        wait(9000).then(()=>({guestClosed:attached.isDestroyed()})),
      ])
      nativeLogoutBlockedOldMap=response.revoked===true || (
        response.guestClosed===true && attached.isDestroyed())
      assert.equal(nativeLogoutBlockedOldMap,true,
        'native logout left already-minted Web map bearer usable')
      const guestStillVisible=async()=>{
        if(win.isDestroyed()||win.webContents.isDestroyed())return false
        return win.webContents.executeJavaScript(
          '(() => {const guest=document.querySelector("[data-xdrive-desktop-embedded-places]");'+
          'return !!guest && getComputedStyle(guest).visibility!=="hidden" &&'+
          'getComputedStyle(guest).display!=="none"})()').catch(()=>false)
      }
      await until(async()=> !(await guestStillVisible()),
        15000,'old Owner map WebView must retire or hide after logout')
      oldMapHiddenAfterLogout=true
    }
    console.log('XDRIVE_PLACES_PRODUCTION_RESTART '+JSON.stringify({
      passed:true,productionMain:true,productionPreload:true,
      productionRenderer:true,actualWebVite:true,actualGinPostgreSQL:true,
      currentOwner:owner,realGuest:true,secureOrigin:true,
      embeddedOnly:true,noNestedLogin:true,syntheticPhotosOnly:true,
      phase:Number(process.env.XD_DESKTOP_PLACES_BOOT||'0'),
      guestLoads,mapMode:state.mapMode,
      exactOwnerCells:media.ownerCells,exactFavorites:media.favorites,
      exactFamily:media.family,exactFamilyFavorites:media.familyFavorites,
      exactViewerRange:media.viewerRange,viewerMetadata:media.viewerMetadata,
      noUnrelatedMapBearerAccess:media.mapRouteOnly,
      thumbnailStatus:media.thumbnailStatus,viewerStatus:media.viewerStatus,
      thumbnailBytesValid:media.thumbnailBytesValid,viewerBytesValid:media.viewerBytesValid,
      realWebModeRoundTrip,legacyServerFailedClosed,browserLogoutRecovered,
      nativeLogoutBlockedOldMap,oldMapHiddenAfterLogout
    }))
    app.exit(0)
  }catch(error){
    console.error('XDRIVE_PLACES_PRODUCTION_FAILED '+stage+': '+String(error?.message||error).slice(0,1350))
    app.exit(1)
  }
}
app.on('browser-window-created',(_event,win)=>{
  if(launched)return
  launched=true
  win.webContents.once('did-finish-load',()=>{void run(win)})
})
require('../dist/main/index.cjs')
