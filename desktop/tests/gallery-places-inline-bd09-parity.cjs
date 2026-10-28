const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const parent = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const shared = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
const inline = read('ui/shared/src/media-gallery-baidu-inline-map-host.ts')
const entry = read('ui/shared/src/media-gallery-baidu-map-entry.ts')

test('both map choices render exactly one trusted /cells/Wall/Viewer surface', () => {
  assert.match(parent, /mode=\{mapMode === 'prototype' \? 'inline' : 'isolated'\}/)
  assert.match(parent, /getInlinePrototypeConfig=\{getBaiduJSAPIPrototype\}/)
  assert.match(parent, /getInlineSignedStatus=\{getBaiduJSAPI4Status\}/)
  assert.match(parent, /mintChildTicket=\{mintBaiduIsolatedChildTicket\}/)
  assert.match(parent, /listOwnerCells=\{listBaiduNativeCells\}/)
  assert.match(parent, /onOpenCell=\{onOpenBaiduNativeCell\}/)
  assert.match(parent, /onOpenViewport=\{onOpenBaiduNativeViewport\}/)
  assert.match(parent, /mapPhotoScope=\{mapPhotoScope\}/)
  assert.match(shared, /const frame = mode === 'inline'/)
  assert.match(shared, /xDriveMountBaiduInlineMap<MediaBaiduNativeCellSelection>/)
  assert.match(shared, /xDriveMountBaiduIsolatedFrame<MediaBaiduNativeCellSelection>/)
  assert.match(shared, /listOwnerCells\(bounds,request.signal,/)
  assert.match(shared, /data-xdrive-places-trusted-photo-cover-pins/)
  assert.match(shared, /data-xdrive-places-map-photo-summary/)
  assert.doesNotMatch(shared,
    /data-xdrive-places-photo-collection-strip|data-xdrive-places-map-photo-strip-shell|data-xdrive-places-collection-thumb/)
  assert.match(shared, /data-xdrive-places-full-camera-wall/)
  assert.match(parent, /data-xdrive-places-map-photo-filters/)
  assert.doesNotMatch(parent, /XDriveMediaGalleryBaiduPrototypeMap/)
  assert.doesNotMatch(parent, /listPlacesMapOverview\(/)
  assert.doesNotMatch(parent, /xDriveConvertBaiduJSAPI4MarkerWindow/)
  assert.match(entry, /const requiresIsolated = false/)
})

test('inline SDK host cannot intentionally send WGS84 or private media to the provider', () => {
  assert.match(inline, /loadBaiduJSAPI4/)
  assert.match(inline, /getPrototypeConfig/)
  assert.match(inline, /getSignedStatus/)
  assert.doesNotMatch(inline, /mintMapOnlySession/)
  assert.match(inline, /replaceAuthorizedCells\(next\)/)
  assert.match(inline, /xDriveValidBaiduNativeCameraSnapshot/)
  assert.doesNotMatch(inline, /\.translate\(|listPlacesMapOverview\(|mintMapOnlySession|\/media\/items/)
  assert.doesNotMatch(inline, /PhotoAsset|Bearer|JWT|image_url|mediaURL/)
  assert.match(shared, /mintChildTicket\(lifetime.signal\)/)
  assert.match(shared, /receipt.child_origin!==childOrigin/)
  assert.match(shared, /bootstrapMapSession\(receipt.ticket\)/)
})

function buildInlineFixture(config = {}) {
  const compile = ts.transpileModule(inline, {fileName:'media-gallery-baidu-inline-map-host.ts',
    reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((compile.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error), [])
  const timers = new global.Map()
  let timerID = 0
  const setTimer = fn => {const id=++timerID;timers.set(id,fn);return id}
  const clearTimer = id => timers.delete(id)
  const flushTimers = () => {
    for (const [id,fn] of [...timers]) {timers.delete(id);fn()}
  }

  class Point {
    constructor(lng,lat) {this.lng=lng;this.lat=lat}
  }
  class Label {
    constructor(text,config) {this.text=text;this.config=config;this.click=null}
    setStyle(value) {this.style=value}
    addEventListener(name,click) {if(name==='click')this.click=click}
    removeEventListener(name) {if(name==='click')this.click=null}
    trigger() {this.click?.()}
  }
  class Map {
    constructor() {this.events=new global.Map();this.labels=[];this.moves=[];this.camera=new Point(0,20);this.zoom=3}
    centerAndZoom(p,z) {this.camera=p;this.zoom=z;this.moves.push(['center',p,z])}
    setViewport(pts) {this.moves.push(['fit',pts])}
    getBounds() {return {getSouthWest:()=>new Point(100,20),getNorthEast:()=>new Point(122,42)}}
    getCenter() {return this.camera}
    getZoom() {return this.zoom}
    destroy() {disposed++}
    pointToPixel(p) {return {x:p.lng+100,y:p.lat+100}}
    addOverlay(label) {this.labels.push(label)}
    removeOverlay(label) {this.labels=this.labels.filter(x=>x!==label)}
    addEventListener(name,fn) {this.events.set(name,fn)}
    removeEventListener(name) {this.events.delete(name)}
    fire(name) {this.events.get(name)?.()}
  }
  let grants=0, browserConfigs=0, disposed=0
  const map = new Map()
  const mocks={
    './mui/MediaGalleryBaiduPrototypeMap': {
      async loadBaiduJSAPI4(document, browserAK, capabilities) {
        assert.equal(capabilities,'authorized-cells')
        assert.equal(browserAK,'test-browser-ak')
        return {Map:class {constructor(){return map}},Point,Label}
      },
    },
    './media-gallery-baidu-native-camera-session':{
      xDriveValidBaiduNativeCameraSnapshot(value) {
        return value?.coordinate_space==='bd09ll' &&
          Number.isFinite(value.latitude) && Math.abs(value.latitude)<=85 &&
          Number.isFinite(value.longitude) && Math.abs(value.longitude)<=180 &&
          Number.isInteger(value.zoom) && value.zoom>=3 && value.zoom<=18
      },
    },
  }
  const module={exports:{}}
  new Function('require','module','exports','setTimeout','clearTimeout',compile.outputText)(
    id=>{assert.ok(id in mocks,id);return mocks[id]},module,module.exports,setTimer,clearTimer)
  const cells=[]
  const clicks=[],cancels=[],viewports=[],cameras=[],projected=[]
  const canvas={
    tagName:'DIV',style:{},clientWidth:640,clientHeight:480,remove() {this.removed=true},
  }
  const resizeObservers=[]
  class ResizeObserverFixture {
    constructor(callback) {
      this.callback=callback
      this.disconnected=false
      resizeObservers.push(this)
    }
    observe(element) { assert.equal(element,canvas);this.element=element }
    disconnect() { this.disconnected=true }
    fire() { if(!this.disconnected)this.callback([]) }
  }
  const doc={
    defaultView:{location:{protocol:'https:'},
      ...(config.withResizeObserver ? {ResizeObserver:ResizeObserverFixture} : {})},
    createElement(tag) {assert.equal(tag,'div');return canvas},
  }
  const host={ownerDocument:doc,appendChild(child){assert.equal(child,canvas)}}
  const options={
    parentWindow:doc.defaultView,host,
    getSignedStatus:async signal=>{
      assert.equal(signal.aborted,false)
      grants++
      return {provider:'baidu-jsapi-4.0',enabled:true,
        activation_state:'authorized_signed_release'}
    },
    getPrototypeConfig:async signal=>{
      assert.equal(signal.aborted,false)
      browserConfigs++
      return {provider:'baidu-jsapi-4.0',browser_ak:'test-browser-ak'}
    },
    onActivateCell:selection=>clicks.push(selection),
    onCancel:()=>cancels.push(true),
    onViewport:bounds=>viewports.push(bounds),
    onCamera:camera=>cameras.push(camera),
    onProjectedCells:frame=>projected.push(frame),
    onReady:()=>cells.push('channel-ready'),
    onMapReady:()=>cells.push('map-ready'),
    onMapFailure:()=>cells.push('failed'),
  }
  return {host:module.exports.xDriveMountBaiduInlineMap(options),options,
    map,canvas,cells,clicks,cancels,viewports,cameras,projected,
    resizeObservers,flushTimers,grantCount:()=>grants,browserConfigCount:()=>browserConfigs,disposed:()=>disposed}
}

test('authenticated inline map retains exact Cell identities; gesture invalidates stale clicks', async () => {
  const f=buildInlineFixture()
  assert.ok(f.host)
  await Promise.resolve()
  assert.deepEqual(f.cells,['channel-ready'])
  assert.equal(f.grantCount(),0)
  const selection={cell_x:3,cell_y:4,node_id:75,node_revision:1,asset_id:33,photo_count:9}
  const original={latitude:30,longitude:119,count:9,selection}
  assert.equal(f.host.replaceAuthorizedCells([original]),true)
  assert.equal(f.map.labels.length,0)
  assert.equal(f.host.replaceAuthorizedCells([{...original,latitude:100}]),false)
  assert.equal(f.host.replaceAuthorizedCells([original]),true)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),true)
  assert.equal(f.grantCount(),1)
  assert.equal(f.browserConfigCount(),1)
  assert.deepEqual(f.cells,['channel-ready','map-ready'])
  assert.equal(f.map.labels.length,1)
  assert.ok(f.projected.some(x=>x.cells.length===1))
  const stale=f.map.labels[0]
  stale.trigger()
  assert.deepEqual(f.clicks,[selection])
  f.map.fire('movestart')
  assert.equal(f.cancels.length,1)
  stale.trigger()
  assert.equal(f.clicks.length,1)
  assert.equal(f.map.labels.length,0)
  assert.equal(f.host.replaceAuthorizedCells([original]),true)
  assert.equal(f.map.labels.length,1)
  f.map.fire('moveend')
  f.flushTimers()
  assert.equal(f.viewports.length,1)
  assert.equal(f.viewports[0].coordinate_space,'bd09ll')
  assert.ok(f.cameras.length>0)
  assert.equal(f.host.restoreCamera({coordinate_space:'bd09ll',latitude:31,longitude:118,zoom:12}),true)
  assert.equal(f.host.restoreCamera({coordinate_space:'wgs84',latitude:31,longitude:118,zoom:12}),false)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),true)
  assert.equal(f.grantCount(),2)
  assert.equal(f.browserConfigCount(),2)
  f.host.dispose()
  assert.equal(f.canvas.removed,true)
  assert.equal(f.disposed(),1)
  assert.equal(f.host.replaceAuthorizedCells([original]),false)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),false)
})

test('standalone inline status uses signed release while isolated keeps an Origin gate', () => {
  const status=read('internal/api/baidu_jsapi_config.go')
  assert.match(status,/func baiduJSAPI4RuntimeStatus\(signed bool, childOrigin string\)/)
  assert.match(status,/releaseErr == nil, s\.approvedBaiduIsolatedChildOrigin\(\)/)
  assert.match(parent,/signed && \(mapMode === 'prototype' \|\| child !== ''\)/)
  assert.match(parent,/mapMode === 'prototype' \|\| childOrigin !== ''/)
  assert.match(parent,/isolated_origin_unavailable/)
  assert.doesNotMatch(inline,/!status\.isolated_child_origin\?\.startsWith/)
})

test('inline host matches isolated Child fallback when native setViewport is absent', async () => {
  const f=buildInlineFixture()
  assert.ok(f.host)
  f.map.setViewport=undefined
  const one={latitude:25,longitude:115,count:2,
    selection:{cell_x:1,cell_y:1,asset_id:11,node_id:21,node_revision:1,photo_count:2}}
  const two={latitude:35,longitude:125,count:3,
    selection:{cell_x:2,cell_y:2,asset_id:12,node_id:22,node_revision:1,photo_count:3}}
  assert.equal(f.host.replaceAuthorizedCells([one,two]),true)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),true)
  const [operation,point,zoom]=f.map.moves.at(-1)
  assert.equal(operation,'center')
  assert.equal(point.lng,120)
  assert.equal(point.lat,30)
  assert.equal(zoom,3)
  assert.equal(f.map.labels.length,2)
  f.host.dispose()
})

test('shared trusted Parent distinguishes inline SDK and isolated Child failures', () => {
  assert.match(shared,/mode === 'inline'[\s\S]*?'同页地图 SDK 不可用；地点列表与照片墙仍可使用。'/)
  assert.match(shared,/动态地图隔离会话不可用；地点列表与照片墙仍可使用。/)
})

test('inline native labels yield as a whole to current trusted React photo covers', async () => {
  const f=buildInlineFixture()
  assert.ok(f.host)
  const first={cell_x:1,cell_y:2,node_id:41,node_revision:6,asset_id:31,photo_count:12}
  const second={cell_x:3,cell_y:4,node_id:43,node_revision:6,asset_id:33,photo_count:5}
  const cells=[
    {latitude:31,longitude:119,count:12,selection:first},
    {latitude:32,longitude:120,count:5,selection:second},
  ]
  assert.equal(f.host.replaceAuthorizedCells(cells),true)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),true)
  assert.equal(f.map.labels.length,2)
  const nativeSecond=f.map.labels.find(label=>/5张/.test(label.text))
  assert.ok(nativeSecond)
  nativeSecond.trigger()
  assert.deepEqual(f.clicks,[second],
    'without trusted photo covers, complete native Cell fallback remains clickable')
  const projections=f.projected.length
  assert.equal(f.host.setPhotoCoverSelections([first]),true)
  assert.equal(f.map.labels.length,0,
    'a verified Parent photo suppresses ALL mixed native numeric labels')
  assert.equal(f.projected.length,projections,
    'cosmetic suppression must not clear and re-publish the React photo cover')
  assert.equal(f.host.setPhotoCoverSelections([{...first}]),false)
  assert.equal(f.host.setPhotoCoverSelections([first,first]),false)
  assert.equal(f.map.labels.length,0,'invalid or duplicate selection cannot alter the current Parent presentation')
  assert.equal(f.host.setPhotoCoverSelections([]),true)
  assert.equal(f.map.labels.length,2,'React cover removed: native fallback restored')
  assert.equal(f.host.setPhotoCoverSelections([first]),true)
  f.map.fire('movestart')
  assert.equal(f.map.labels.length,0,'pan immediately clears obsolete cells')
  assert.equal(f.host.setPhotoCoverSelections([first]),false)
  assert.equal(f.host.replaceAuthorizedCells([cells[0]]),true)
  assert.equal(f.map.labels.length,1,'fresh Owner receipt resets suppression')
  assert.equal(f.host.setPhotoCoverSelections([first]),true)
  assert.equal(f.map.labels.length,0)
  f.host.dispose()
  assert.equal(f.host.setPhotoCoverSelections([]),false)
})

test('inline responsive map size change revokes stale photo pixels and re-queries the current Owner camera',async()=>{
  const f=buildInlineFixture({withResizeObserver:true})
  const selection={cell_x:1,cell_y:1,asset_id:71,node_id:81,node_revision:3,photo_count:4}
  const cell={latitude:31,longitude:119,count:4,selection}
  assert.equal(f.host.replaceAuthorizedCells([cell]),true)
  assert.equal(await f.host.beginAuthorizedInlineSession(new AbortController().signal),true)
  assert.equal(f.resizeObservers.length,1)
  assert.equal(f.resizeObservers[0].element,f.canvas)
  assert.equal(f.projected.at(-1).width,640)
  assert.equal(f.projected.at(-1).height,480)
  const oldLabel=f.map.labels[0]
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,0,'first ResizeObserver notification is not navigation')
  f.canvas.clientWidth=390
  f.canvas.clientHeight=844
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,1,'orientation instantly revokes old accepted /cells')
  assert.equal(f.map.labels.length,0,'no numeric labels from the old camera')
  assert.deepEqual(f.projected.at(-1),{width:0,height:0,cells:[]},
    'old projection is revoked before the next frame can render')
  oldLabel.trigger()
  assert.deepEqual(f.clicks,[],'old SDK Label cannot reopen stale Owner photos')
  assert.equal(f.host.setPhotoCoverSelections([selection]),false)
  const before=f.viewports.length
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,1,'identical dimensions must not churn Owner queries')
  f.canvas.clientWidth=391
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,1,
    'multiple resize frames coalesce without repeated Owner cancellation')
  f.flushTimers()
  assert.equal(f.viewports.length,before+1,
    'one debounced fresh authorized camera Range after resize')
  assert.equal(f.viewports.at(-1).coordinate_space,'bd09ll')
  assert.equal(f.host.replaceAuthorizedCells([cell]),true)
  assert.equal(f.projected.at(-1).width,391)
  assert.equal(f.projected.at(-1).height,844)
  f.canvas.clientWidth=899
  f.canvas.clientHeight=390
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,2,'short landscape also revokes old pixel positions')
  f.canvas.clientWidth=900
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,2,'crossing 899/900 does not spam cancel')
  f.flushTimers()
  assert.equal(f.viewports.length,before+2)
  f.host.dispose()
  assert.equal(f.resizeObservers[0].disconnected,true)
  const finalCount=f.cancels.length
  f.resizeObservers[0].fire()
  assert.equal(f.cancels.length,finalCount,'no resize callback after disposal')
})
