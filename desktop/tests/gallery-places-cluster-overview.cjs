'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
const read=file=>fs.readFileSync(path.join(root,file),'utf8')

function mountChild() {
  const events=new Map(),sent=[],fit=[],moves=[],overlays=[]
  const parent={postMessage(message,origin){sent.push({message,origin})}}
  const fakeSDK={
    Point:function Point(lng,lat){this.lng=lng;this.lat=lat},
    Label:function Label(label){this.label=label;this.setStyle=()=>{}
      this.addEventListener=(event,callback)=>{if(event==='click')this.click=callback}
      this.removeEventListener=()=>{}},
    Map:function Map(){
      this.centerAndZoom=(p,z)=>moves.push({lat:p.lat,lng:p.lng,zoom:z})
      this.setViewport=(points,options)=>fit.push({points:points.map(p=>({lat:p.lat,lng:p.lng})),options})
      this.enableScrollWheelZoom=()=>{}
      this.enableDoubleClickZoom=()=>{}
      this.enablePinchToZoom=()=>{}
      this.addEventListener=()=>{}
      this.addOverlay=label=>overlays.push(label)
      this.removeOverlay=label=>{const i=overlays.indexOf(label);if(i>=0)overlays.splice(i,1)}
      this.getBounds=()=>({getSouthWest:()=>new fakeSDK.Point(-180,-85),
        getNorthEast:()=>new fakeSDK.Point(180,85)})
      this.getCenter=()=>new fakeSDK.Point(10,20)
      this.getZoom=()=>3
    }
  }
  const status={textContent:''}
  const env={window:{location:{origin:'https://map-isolated.example.org'},parent,
      BMap:fakeSDK,addEventListener(name,handler){events.set(name,handler)}},
    document:{getElementById(){return status},
      querySelector(){return {content:'https://gallery.example.net'}},
      createElement(){return {remove(){},set src(value){this._src=value}}},
      head:{appendChild(script){queueMicrotask(()=>script.onload?.())}}},
    fetch:async()=>({ok:true,json:async()=>({provider:'baidu-jsapi-4.0',runtime_enabled:true})}),
    setTimeout,clearTimeout,URL,TextEncoder,Set,Array,Number,Object,JSON,Error}
  const context=vm.createContext(env)
  new vm.Script(read('deploy/baidu-isolated-child/child.js')).runInContext(context,{timeout:1500})
  return {events,sent,fit,moves,overlays,parent,context,
    send(message){
      context.incoming=JSON.stringify(message)
      const data=vm.runInContext('JSON.parse(incoming)',context)
      events.get('message')?.({source:parent,origin:'https://gallery.example.net',data})
    }}
}
const nonce='a'.repeat(64),gen=7
const envelope=(kind,extra={})=>({version:1,generation:gen,nonce,kind,...extra})
const cell=(key,latitude,longitude,count)=>({key:key.repeat(32),latitude,longitude,count})

test('Places overview fits all approved world clusters once, rather than the first location',async()=>{
  const f=mountChild()
  f.send(envelope('cells',{cells:[]}))
  assert.equal(f.sent.filter(x=>x.message.kind==='ready').length,1)
  f.send(envelope('cells',{cells:[
    cell('a',35.68,139.7,15),cell('b',40.71,-74.01,7)
  ]}))
  f.send(envelope('map-session',{ticket:'b'.repeat(64)}))
  await new Promise(resolve=>setTimeout(resolve,40))
  assert.equal(f.fit.length,1,'both approved region samples should be fitted')
  assert.deepEqual(JSON.parse(JSON.stringify(f.fit[0].points)),[
    {lat:35.68,lng:139.7},{lat:40.71,lng:-74.01}
  ])
  assert.equal(f.overlays.length,2,'both count markers should be displayed')
  assert.match(f.overlays[0].label,/15/)
  f.overlays[0].click()
  const selected=f.sent.filter(x=>x.message.kind==='activate-cell')
  assert.equal(selected.length,1)
  assert.equal(selected[0].message.key,'a'.repeat(32),
    'the Child only returns an anonymous cell key')
  f.send(envelope('cells',{cells:[cell('c',35.7,139.8,5)]}))
  assert.equal(f.fit.length,1,'viewport updates may not reset the user camera')
  const camera={coordinate_space:'bd09ll',latitude:36,longitude:140,zoom:12}
  f.send(envelope('restore-camera',{camera}))
  assert.deepEqual(f.moves.at(-1),{lat:36,lng:140,zoom:12})
  f.events.get('pagehide')()
})

test('Gallery Places mounts its map without waiting for Facets and preserves Owner gating',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  assert.match(gallery,/\{showPlacesIndex \? \(/)
  assert.match(gallery,/component="details" data-xdrive-places-list/)
  assert.match(map,/data-xdrive-places-map-options/)
  assert.match(surface,/data-xdrive-places-cluster-overview/)
  assert.match(surface,/queryCells\(world\)\.then\(ok =>/)
  assert.match(surface,/listOwnerCells\(bounds,request.signal\)/)
  assert.match(surface,/xDriveSelectBaiduNativeCell/)
  assert.match(map,/initialCamera=\{nativeRestoreRef\.current\?\?undefined\}/)
})
