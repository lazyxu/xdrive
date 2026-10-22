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

function childFixture(parentOrigin='https://gallery.example.net',childOrigin='https://map-isolated.example.org',sdkEnabled=false) {
  const events = new Map(), sent=[], moves=[]
  const parent={postMessage(message,targetOrigin){sent.push({message,targetOrigin})}}
  const messageTarget={textContent:''}
  const scripts=[]
  const fakeSDK={
    Point:function Point(lng,lat){this.lng=lng;this.lat=lat},
    Label:function Label(){this.setStyle=()=>{};this.addEventListener=()=>{};this.removeEventListener=()=>{}},
    Map:function Map(){
      this.centerAndZoom=(point,zoom)=>moves.push({latitude:point.lat,longitude:point.lng,zoom})
      this.addEventListener=()=>{}
      this.addOverlay=()=>{}
      this.removeOverlay=()=>{}
      this.getBounds=()=>({getSouthWest:()=>new fakeSDK.Point(115,38),
        getNorthEast:()=>new fakeSDK.Point(117,40)})
      this.getCenter=()=>new fakeSDK.Point(116,39)
      this.getZoom=()=>8
    },
  }
  const env={window:{location:{origin:childOrigin},parent,
    ...(sdkEnabled?{BMap:fakeSDK}:{}),
    addEventListener(type,cb){events.set(type,cb)}},
    ...(sdkEnabled?{
      fetch:async()=>({ok:true,json:async()=>({provider:'baidu-jsapi-4.0',runtime_enabled:true})}),
      setTimeout,clearTimeout,
    }:{}),
    document:{
      getElementById(){return messageTarget},
      ...(sdkEnabled?{
        head:{appendChild(script){scripts.push(script);queueMicrotask(()=>script.onload?.())}},
        createElement(){return {remove(){},set src(value){this._src=value}}},
      }:{}),
      querySelector(selector){
      assert.equal(selector,'meta[name="xdrive-isolated-parent-origin"]')
      return {content:parentOrigin}
    }},URL,TextEncoder,Set,Array,Number,Object,JSON,Error}
  const context=vm.createContext(env)
  const code=new vm.Script(src,{filename:'deploy/baidu-isolated-child/child.js'})
  code.runInContext(context,{timeout:1500})
  return {events,sent,moves,scripts,messageTarget,parent,context,sendObject(source,origin,obj){
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
