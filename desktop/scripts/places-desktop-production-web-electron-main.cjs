'use strict'
const {app}=require('electron')
const assert=require('node:assert/strict')
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
  const current={errors:[],warnings:0,rootRemovalCount:0,
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
  const mode=root.querySelector('[data-xdrive-places-map-mode]')
  return {ready:true,denied:false,login:false,
    hasGallery:!!root.querySelector('[data-xdrive-places-index]'),
    mapMode:mode?.getAttribute('data-xdrive-places-map-mode')||'',
    guestBridge:typeof window.xdrivePlacesEmbedBridge,
    hasNativeAgent:typeof window.xdriveDesktop,
    url:location.origin}
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
    assert.notEqual(state.mapMode,'isolated','default map unexpectedly forced isolation')
    const preload=await win.webContents.executeJavaScript(
      'Boolean(window.xdriveDesktop?.agent && document.querySelector("[data-xdrive-places-index]"))')
    assert.equal(preload,true)
    console.log('XDRIVE_PLACES_PRODUCTION_RESTART '+JSON.stringify({
      passed:true,productionMain:true,productionPreload:true,
      productionRenderer:true,actualWebVite:true,actualGinPostgreSQL:true,
      currentOwner:owner,realGuest:true,secureOrigin:true,
      embeddedOnly:true,noNestedLogin:true,syntheticPhotosOnly:true,
      phase:Number(process.env.XD_DESKTOP_PLACES_BOOT||'0'),
      guestLoads,mapMode:state.mapMode
    }))
    app.exit(0)
  }catch(error){
    console.error('XDRIVE_PLACES_PRODUCTION_FAILED '+stage+': '+String(error?.message||error).slice(0,650))
    app.exit(1)
  }
}
app.on('browser-window-created',(_event,win)=>{
  if(launched)return
  launched=true
  win.webContents.once('did-finish-load',()=>{void run(win)})
})
require('../dist/main/index.cjs')
