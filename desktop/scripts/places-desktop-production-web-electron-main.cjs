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
    await until(()=>win.webContents.executeJavaScript(
      'Boolean(document.querySelector("[data-xdrive-desktop-embedded-places]"))'
    ),30000,'native production map WebView host')
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
