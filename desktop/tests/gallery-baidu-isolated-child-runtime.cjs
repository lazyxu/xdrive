'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const src = read('deploy/baidu-isolated-child/child.js')
const html = read('deploy/baidu-isolated-child/index.html')
const caddy = read('deploy/baidu-isolated-child/Caddyfile.example')

function childFixture(parentOrigin='https://gallery.example.net',childOrigin='https://map-isolated.example.org',sdkEnabled=false,options={}) {
  const events = new Map(), sent=[], moves=[], nativeEvents=new Map(), redeems=[], labels=[]
  const parent={postMessage(message,targetOrigin){sent.push({message,targetOrigin})}}
  const messageTarget={textContent:'',
    ...(options.resizeFixture ? {clientWidth:640,clientHeight:480} : {})}
  const scripts=[], resizeObservers=[]
  class ResizeObserverFixture {
    constructor(callback){this.callback=callback;this.disconnected=false;resizeObservers.push(this)}
    observe(element){assert.equal(element,messageTarget);this.element=element}
    disconnect(){this.disconnected=true}
    fire(){if(!this.disconnected)this.callback([])}
  }
  const fakeSDK={
    Point:function Point(lng,lat){this.lng=lng;this.lat=lat},
    Label:function Label(value){
      this.text=value;this.click=null
      this.setStyle=()=>{}
      this.addEventListener=(name,cb)=>{if(name==='click')this.click=cb}
      this.removeEventListener=(name)=>{if(name==='click')this.click=null}
    },
    Map:function Map(){
      this.centerAndZoom=(point,zoom)=>moves.push({latitude:point.lat,longitude:point.lng,zoom})
      this.addEventListener=(name,listener)=>nativeEvents.set(name,listener)
      this.addOverlay=label=>{labels.push(label)}
      this.removeOverlay=label=>{
        const i=labels.indexOf(label)
        if(i>=0)labels.splice(i,1)
      }
      this.getBounds=()=>({getSouthWest:()=>new fakeSDK.Point(115,38),
        getNorthEast:()=>new fakeSDK.Point(117,40)})
      this.getCenter=()=>new fakeSDK.Point(116,39)
      this.getZoom=()=>8
    },
  }
  const env={window:{location:{origin:childOrigin},parent,
    ...(sdkEnabled?{BMap:fakeSDK}:{}),
    ...(options.resizeFixture ? {ResizeObserver:ResizeObserverFixture} : {}),
    addEventListener(type,cb){events.set(type,cb)}},
    ...(sdkEnabled?{
      fetch:async()=>{
        redeems.push(true)
        if(options.sessionNetworkFailure)throw Error('controlled-session-failure')
        return {ok:!options.sessionDenied,
          json:async()=>options.sessionReceipt ?? {provider:'baidu-jsapi-4.0',runtime_enabled:true}}
      },
      setTimeout,clearTimeout,
    }:{}),
    document:{
      getElementById(){return messageTarget},
      ...(sdkEnabled?{
        head:{appendChild(script){scripts.push(script);queueMicrotask(()=>{
          if(options.sdkScriptError)script.onerror?.()
          else script.onload?.()
        })}},
        createElement(){return {remove(){},set src(value){this._src=value}}},
      }:{}),
      querySelector(selector){
      assert.equal(selector,'meta[name="xdrive-isolated-parent-origin"]')
      return {content:parentOrigin}
    }},URL,TextEncoder,Set,Array,Number,Object,JSON,Error}
  const context=vm.createContext(env)
  const code=new vm.Script(src,{filename:'deploy/baidu-isolated-child/child.js'})
  code.runInContext(context,{timeout:1500})
  return {events,sent,moves,nativeEvents,redeems,labels,scripts,resizeObservers,messageTarget,parent,context,sendObject(source,origin,obj){
    const literal=JSON.stringify(obj)
    context.payload=literal
    const shaped=vm.runInContext('JSON.parse(payload)',context)
    events.get('message')?.({source,origin,data:shaped})
  }}
}
const init={version:1,generation:7,nonce:'a'.repeat(64),kind:'cells',cells:[]}

test('isolated child loads only same-origin SDK after independent map session; no Gallery credentials',()=>{
  assert.match(html,/REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN/)
  assert.match(html,/<script defer src="\/_xdrive_baidu_isolated\/child\.js"><\/script>/)
  assert.doesNotMatch(src,/parent\.document|parent\.localStorage|document\.cookie|localStorage\.|sessionStorage\.|import\(|new Function|eval\(/)
  assert.match(src,/fetch\('\/_xdrive_baidu_isolated\/session'/)
  assert.match(src,/\/_BMapService\/api\?v=4\.0/)
  assert.match(caddy,/script-src 'self'; connect-src 'self'/)
  assert.match(caddy,/frame-ancestors \{\$XD_BAIDU_GALLERY_ORIGIN\}/)
  assert.match(caddy,/sandbox allow-scripts allow-same-origin/)
  assert.match(caddy,/@child_asset path \/_xdrive_baidu_isolated\/index\.html \/_xdrive_baidu_isolated\/child\.js/)
  assert.match(caddy,/handle \/_BMapService\/\*/)
  assert.match(caddy,/handle \/_xdrive_baidu_isolated\/session/)
  assert.doesNotMatch(caddy,/handle \/api|tls internal/)
})

test('child accepts only an exact parent WindowProxy, Origin, nonce and zero-cell handshake',()=>{
  const f=childFixture()
  assert(f.events.has('message'),'listener exists before parent iframe.onload')
  f.sendObject(f.parent,'https://evil.example.com',init)
  f.sendObject({},'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{...init,cells:[{key:'b'.repeat(32),latitude:22,longitude:115,count:1}]})
  assert.equal(f.sent.length,0)
  f.sendObject(f.parent,'https://gallery.example.net',init)
  assert.equal(f.sent.length,1)
  assert.deepEqual(JSON.parse(JSON.stringify(f.sent[0])),{
    message:{version:1,generation:7,nonce:'a'.repeat(64),kind:'ready'},
    targetOrigin:'https://gallery.example.net',
  })
  assert.match(f.messageTarget.textContent,/等待仅用于地图的会话/)
  f.sendObject(f.parent,'https://gallery.example.net',{
    ...init,cells:[{key:'b'.repeat(32),latitude:22,longitude:115,count:2}],
  })
  assert.equal(f.sent.length,1,'ordinary updated cells are never echoed')
  assert.doesNotMatch(f.messageTarget.textContent,/115|node|PhotoAsset|token/)
})

test('child fails closed on sibling sites, invalid config, replay and revoke',()=>{
  for(const parentOrigin of ['https://map-isolated.example.org',
    'https://gallery.example.org','http://gallery.example.net',
    'https://gallery.example.net/path','https://user:pw@gallery.example.net',
    'https://127.0.0.1','REPLACE_WITH_TRUSTED_HTTPS_PARENT_ORIGIN']){
    const f=childFixture(parentOrigin)
    assert.equal(f.events.has('message'),false,parentOrigin)
  }
  const f=childFixture()
  f.sendObject(f.parent,'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{...init,nonce:'b'.repeat(64)})
  f.sendObject(f.parent,'https://gallery.example.net',{...init,cells:[
    {key:'c'.repeat(32),latitude:23,longitude:118,count:1,asset_id:1}]})
  assert.equal(f.sent.length,1,'neither replay nor private Asset data are accepted')
  f.events.get('pagehide')?.()
  f.sendObject(f.parent,'https://gallery.example.net',init)
  assert.equal(f.sent.length,1,'pagehide permanently revokes the child generation')
})

test('original Child VM applies only valid post-ready BD09 return camera',async()=>{
  const f=childFixture('https://gallery.example.net',
    'https://map-isolated.example.org',true)
  f.sendObject(f.parent,'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'map-session',ticket:'b'.repeat(64)})
  await new Promise(resolve=>setTimeout(resolve,30))
  assert.equal(f.scripts.length,1,'SDK loaded only after map-only ticket')
  assert.equal(f.moves.length,1,'initial SDK camera')
  const camera={coordinate_space:'bd09ll',latitude:35.5,longitude:139.4,zoom:13}
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'restore-camera',camera})
  assert.deepEqual(f.moves.at(-1),{latitude:35.5,longitude:139.4,zoom:13})
  for(const bad of [
    {...camera,coordinate_space:'wgs84'}, {...camera,asset_id:12},
    {...camera,zoom:99},
  ]){
    const before=f.moves.length
    f.sendObject(f.parent,'https://gallery.example.net',{
      version:1,generation:7,nonce:'a'.repeat(64),kind:'restore-camera',camera:bad})
    assert.equal(f.moves.length,before)
  }
  f.events.get('pagehide')()
  const before=f.moves.length
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'restore-camera',camera})
  assert.equal(f.moves.length,before,'old generation cannot restore after disposal')
})

test('programmatic BD09 restore schedules an Owner viewport without SDK moveend',async()=>{
  const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true)
  f.sendObject(f.parent,'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),
    kind:'map-session',ticket:'b'.repeat(64)})
  await waitForChild(()=>f.nativeEvents.has('moveend'),'map SDK listeners attached')
  const count=kind=>f.sent.filter(event=>event.message.kind===kind).length
  await waitForChild(()=>count('viewport')===1,'initial Owner viewport reported')
  const priorViewport=count('viewport'), priorCamera=count('camera')
  const priorCancel=count('cancel')
  const camera={coordinate_space:'bd09ll',latitude:34.68,longitude:135.5,zoom:11}
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'restore-camera',camera})
  assert.deepEqual(f.moves.at(-1),{
    latitude:camera.latitude,longitude:camera.longitude,zoom:camera.zoom})
  // The synthetic SDK intentionally emits NO moveend/zoomend for centerAndZoom.
  assert.equal(count('viewport'),priorViewport,
    'no Owner range request before the normal 500ms quiet period')
  await waitForChild(()=>count('viewport')===priorViewport+1,
    'one fresh bounded viewport must follow a silent programmatic restore')
  assert.equal(count('camera'),priorCamera+1)
  assert.equal(count('cancel'),priorCancel,
    'a programmatic camera restore must not forge a user gesture')
  const observed=f.sent.filter(event=>event.message.kind==='viewport').at(-1)
  assert.equal(observed.message.bounds.coordinate_space,'bd09ll')
  assert.deepEqual(Object.keys(observed.message.bounds).sort(),
    ['coordinate_space','east','north','south','west'])
  assert(!JSON.stringify(f.sent).includes('asset_id'),
    'Child must not expose Owner photo IDs')
  const priorDisposed=count('viewport')
  f.events.get('pagehide')?.()
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'restore-camera',camera})
  await new Promise(resolve=>setTimeout(resolve,550))
  assert.equal(count('viewport'),priorDisposed,
    'revoked Child cannot send late Owner viewport requests')
})

test('native zoomend/moveend coalesce into ONE viewport after 500ms; start cancels immediately',async()=>{
  const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true)
  f.sendObject(f.parent,'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),
    kind:'map-session',ticket:'b'.repeat(64)})
  // The SDK loader polls asynchronously; a fixed 30ms timeout flakes under
  // Node's parallel 3k+ Desktop test workload. Wait for the *real* native
  // listener attachment, then assert the gesture timing independently.
  for(let attempt=0;attempt<100 && !f.nativeEvents.has('moveend');attempt++){
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  assert(f.nativeEvents.has('moveend'),'native SDK listener attached')
  assert(f.nativeEvents.has('zoomstart'))
  const count=kind=>f.sent.filter(item=>item.message.kind===kind).length
  const originalViewportCount=count('viewport')
  f.nativeEvents.get('movestart')()
  assert.equal(count('cancel'),1,'Owner request is cancelled before any debounce')
  f.nativeEvents.get('moveend')()
  f.nativeEvents.get('zoomend')()
  await new Promise(resolve=>setTimeout(resolve,250))
  assert.equal(count('viewport'),originalViewportCount,'no intermediate viewport during gesture quiet time')
  await new Promise(resolve=>setTimeout(resolve,340))
  assert.equal(count('viewport'),originalViewportCount+1,'paired native settle events become one viewport')
  assert.equal(count('camera'),originalViewportCount+1)
  f.nativeEvents.get('moveend')()
  f.events.get('pagehide')()
  await new Promise(resolve=>setTimeout(resolve,550))
  assert.equal(count('viewport'),originalViewportCount+1,'disposed Child must not emit stale viewport')
})

async function waitForChild(condition, reason) {
  for(let attempt=0;attempt<100&&!condition();attempt++) {
    await new Promise(resolve=>setTimeout(resolve,15))
  }
  assert(condition(),reason)
}

test('failed Child Session/SDK denies map rendering without Static fallback or ticket disclosure',async()=>{
  for(const options of [{sessionDenied:true},{sessionNetworkFailure:true},{sdkScriptError:true}]) {
    const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true,options)
    f.sendObject(f.parent,'https://gallery.example.net',init)
    f.sendObject(f.parent,'https://gallery.example.net',{
      version:1,generation:7,nonce:'a'.repeat(64),kind:'map-session',ticket:'b'.repeat(64)})
    await waitForChild(()=>f.sent.some(e=>e.message.kind==='map-failed'),'one map failure was delivered')
    assert.equal(f.moves.length,0,'failed Session/SDK cannot mount an active map')
    assert.equal(f.sent.filter(e=>e.message.kind==='map-failed').length,1)
    assert.match(f.messageTarget.textContent,/地点列表和照片墙仍可使用/)
    assert.doesNotMatch(f.messageTarget.textContent,/静态地图|静态底图/)
    if(options.sessionDenied||options.sessionNetworkFailure)
      assert.equal(f.scripts.length,0,'SDK must never load before map-session redemption')
    else assert.equal(f.scripts.length,1,'SDK failure follows a valid Session')
    assert(!JSON.stringify(f.sent).includes('b'.repeat(64)),'ticket never echoes to Parent')
    // No same-frame retries or stale SDK bootstraps after a failed redemption.
    const sent=f.sent.length, scripts=f.scripts.length
    f.sendObject(f.parent,'https://gallery.example.net',{
      version:1,generation:7,nonce:'a'.repeat(64),kind:'map-session',ticket:'c'.repeat(64)})
    f.sendObject(f.parent,'https://gallery.example.net',init)
    assert.equal(f.redeems.length,1,'failed Child must not redeem a second ticket')
    assert.equal(f.sent.length,sent,'failed Child must not revive a map channel')
    assert.equal(f.scripts.length,scripts,'failed Child must not reinject SDK')
    f.events.get('pagehide')?.()
  }
})

test('native map gestures cancel Owner queries synchronously and never after dispose',async()=>{
  const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true)
  f.sendObject(f.parent,'https://gallery.example.net',init)
  f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind:'map-session',ticket:'b'.repeat(64)})
  await waitForChild(()=>f.nativeEvents.has('moveend'),'SDK native listener attached')
  const count=()=>f.sent.filter(e=>e.message.kind==='cancel').length
  for(const kind of ['movestart','zoomstart']) {
    const callback=f.nativeEvents.get(kind)
    assert.equal(typeof callback,'function')
    const before=count()
    callback()
    assert.equal(count(),before+1,kind+' sends immediate Parent cancel')
  }
  f.events.get('pagehide')?.()
  const after=count()
  f.nativeEvents.get('movestart')?.()
  assert.equal(count(),after,'disposed SDK gestures are inert')
})

test('invalid Child map-only Session receipts never load third-party SDK',async()=>{
  for(const receipt of [
    {provider:'baidu-jsapi-4.0',runtime_enabled:false},
    {provider:'other-provider',runtime_enabled:true},
    {provider:'baidu-jsapi-4.0',runtime_enabled:true,owner_token:'forbidden'},
    {},
  ]) {
    const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true,
      {sessionReceipt:receipt})
    f.sendObject(f.parent,'https://gallery.example.net',init)
    f.sendObject(f.parent,'https://gallery.example.net',{
      version:1,generation:7,nonce:'a'.repeat(64),kind:'map-session',ticket:'b'.repeat(64)})
    await waitForChild(()=>f.sent.some(e=>e.message.kind==='map-failed'),'invalid Session rejected')
    assert.equal(f.scripts.length,0)
    assert.equal(f.moves.length,0)
    assert.equal(f.sent.filter(e=>e.message.kind==='map-failed').length,1)
    assert(!JSON.stringify(f.sent).includes('b'.repeat(64)))
    f.events.get('pagehide')?.()
  }
})

test('isolated Child never mixes numeric SDK Labels with current verified Parent photos', async () => {
  const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',true)
  const cellA={key:'c'.repeat(32),latitude:35,longitude:139,count:12}
  const cellB={key:'d'.repeat(32),latitude:36,longitude:140,count:5}
  const send=(kind,more={})=>f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind,...more})
  f.sendObject(f.parent,'https://gallery.example.net',init)
  send('cells',{cells:[cellA,cellB]})
  send('map-session',{ticket:'b'.repeat(64)})
  await waitForChild(()=>f.sent.some(e=>e.message.kind==='map-ready'),'SDK map-ready')
  assert.equal(f.labels.length,2)
  assert(f.labels.some(label=>label.text.includes('12张')))
  assert(f.labels.some(label=>label.text.includes('5张')),
    'native numeric fallback is preserved before any current Parent photo')
  send('photo-covers',{keys:[cellA.key]})
  assert.equal(f.labels.length,0,
    'one verified Parent photo owns the visible marker layer; no native labels mix in')
  send('photo-covers',{keys:[cellA.key,cellA.key]})
  send('photo-covers',{keys:['e'.repeat(32)]})
  send('photo-covers',{keys:[cellA.key],node_id:42})
  send('photo-covers',{keys:[cellA.key],generation:9})
  assert.equal(f.labels.length,0,
    'invalid, forged, duplicate, stale covers cannot disturb the current presentation')
  send('photo-covers',{keys:[]})
  assert.equal(f.labels.length,2,'Parent photo gone restores original SDK label')
  send('photo-covers',{keys:[cellA.key]})
  assert.equal(f.labels.length,0)
  f.nativeEvents.get('movestart')()
  assert.equal(f.labels.length,0,'camera gesture clears old keys and labels immediately')
  send('photo-covers',{keys:[]})
  assert.equal(f.labels.length,0,'stale empty cover update cannot resurrect revoked labels')
  send('cells',{cells:[{...cellB,key:'f'.repeat(32)}]})
  assert.equal(f.labels.length,1,'fresh Owner Cell snapshot restores numeric fallback')
  send('photo-covers',{keys:[cellA.key]})
  assert.equal(f.labels.length,1,'old anonymous keys cannot hide a new Cell')
  send('photo-covers',{keys:['f'.repeat(32)]})
  assert.equal(f.labels.length,0,'fresh visible photo owns every current native Label')
  f.events.get('pagehide')?.()
  assert.equal(f.labels.length,0)
})

test('isolated Child container resize cancels old Owner cells and debounces one fresh BD09 camera',async()=>{
  const f=childFixture('https://gallery.example.net','https://map-isolated.example.org',
    true,{resizeFixture:true})
  const send=(kind,more={})=>f.sendObject(f.parent,'https://gallery.example.net',{
    version:1,generation:7,nonce:'a'.repeat(64),kind,...more})
  const oldCell={key:'c'.repeat(32),latitude:35,longitude:139,count:12}
  f.sendObject(f.parent,'https://gallery.example.net',init)
  send('cells',{cells:[oldCell]})
  send('map-session',{ticket:'b'.repeat(64)})
  await waitForChild(()=>f.resizeObservers.length===1,'Child ResizeObserver attached')
  assert.equal(f.resizeObservers[0].element,f.messageTarget)
  const count=kind=>f.sent.filter(packet=>packet.message.kind===kind).length
  await waitForChild(()=>count('viewport')===1,'initial signed Owner Camera requested')
  assert.equal(count('cancel'),0)
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),0,'initial/no-op resize must never revoke current Cells')
  assert.equal(f.labels.length,1)
  const obsolete=f.labels[0]
  send('photo-covers',{keys:[oldCell.key]})
  assert.equal(f.labels.length,0,'cover can suppress its current numeric fallback')
  f.messageTarget.clientWidth=390
  f.messageTarget.clientHeight=844
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),1,'orientation immediately cancels obsolete Owner Range')
  assert.equal(f.labels.length,0)
  send('photo-covers',{keys:[]})
  assert.equal(f.labels.length,0,'stale cosmetic message cannot restore labels')
  const before=count('viewport')
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),1,'same dimensions cause no duplicate query')
  f.messageTarget.clientWidth=391
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),1,'rapid resize frames coalesce into one Owner cancel')
  await waitForChild(()=>count('viewport')===before+1,'resize reissued one camera Range')
  assert.equal(f.sent.filter(x=>x.message.kind==='viewport').at(-1).message.bounds.coordinate_space,
    'bd09ll')
  const newCell={...oldCell,key:'d'.repeat(32)}
  send('cells',{cells:[newCell]})
  assert.equal(f.labels.length,1,'fresh Cell receipt restores current numeric fallback')
  send('photo-covers',{keys:[oldCell.key]})
  assert.equal(f.labels.length,1,'revoked key cannot hide new Cell')
  f.messageTarget.clientWidth=899
  f.messageTarget.clientHeight=390
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),2,'short landscape also revokes stale pixel projection')
  f.messageTarget.clientWidth=900
  f.resizeObservers[0].fire()
  assert.equal(count('cancel'),2,'899/900 breakpoint cannot flood Parent cancellation')
  const beforeDispose=count('viewport')
  f.events.get('pagehide')?.()
  assert.equal(f.resizeObservers[0].disconnected,true)
  f.resizeObservers[0].fire()
  await new Promise(resolve=>setTimeout(resolve,550))
  assert.equal(count('viewport'),beforeDispose,'disposed Child cannot send late camera')
  assert.equal(count('cancel'),2)
  assert.equal(obsolete.click,null,'old numeric fallback remains detached')
})
