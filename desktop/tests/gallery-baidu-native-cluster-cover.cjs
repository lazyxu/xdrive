'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const file='ui/shared/src/media-gallery-baidu-native-cluster-covers.ts'
function compile(filename){
  const src=fs.readFileSync(path.join(root,filename),'utf8')
  const output=ts.transpileModule(src,{fileName:filename,reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}})
  assert.deepEqual(output.diagnostics??[],[])
  const mod={exports:{}}
  new Function('module','exports','require',output.outputText)(mod,mod.exports,()=>{
    throw Error('map presentation helpers may not have runtime dependencies')})
  return mod.exports
}
const {xDriveProjectBaiduNativeClusterCovers:project}=compile(file)
const api={Point:class Point{constructor(lng,lat){this.lng=lng;this.lat=lat}}}
const map={pointToPixel:p=>({x:p.lng*4-300,y:p.lat*4})}
const place=(id,count,nodeID)=>({id,name:id,item_count:count,cover_node_id:nodeID})
const geo=(...items)=>({type:'FeatureCollection',features:items.map(([id,lng,lat,count])=>({
  type:'Feature',id,
  geometry:{type:'Point',coordinates:[lng,lat]},
  properties:{place_id:id,photo_count:count},
}))})
const cluster=(id,lng,lat,count,bbox)=>({
  clusterId:id,point:{lng,lat},pointCount:count,isCluster:true,bbox,
})
const frame=(clusters,singles=[],zoom=8)=>({type:'change',value:{clusters,singles,zoom}})

test('official SDK cluster count is points; Owner count is sum of actual photos',()=>{
  const owner=[place('place:1:1',2,101),place('place:1:2',15,102),
    place('place:2:2',3,103)]
  const points=geo(['place:1:1',139,35,2],['place:1:2',140,36,15],
    ['place:2:2',160,35,3])
  const pins=project(frame([cluster(4,139.5,35.5,2,[138,34,141,37])]),
    points,owner,map,api,650,550)
  assert.deepEqual(pins,[{
    id:'4:2',placeID:'place:1:2',nodeID:102,
    placeCount:2,photoCount:17,name:'place:1:2',x:258,y:142,
  }])
  assert.notEqual(pins[0].photoCount,pins[0].placeCount)
})

test('SDK single regions show Owner photo cover at LOW zoom without local clustering',()=>{
  const id='map-region:-180:-85:180:85:3:2'
  const owner=[place(id,42,101)]
  const feature=geo([id,139,35,42]).features[0]
  const pins=project(frame([],[feature],3),{type:'FeatureCollection',
    features:[feature]},owner,map,api,650,550)
  assert.equal(pins.length,1)
  assert.equal(pins[0].placeCount,1)
  assert.equal(pins[0].photoCount,42)
})

test('bounded SDK bbox cannot claim unverified photo membership',()=>{
  const native=cluster(1,139.5,35.5,2,[138,34,141,37])
  const positions=geo(['place:1:1',139,35,4])
  const owner=[place('place:1:1',4,21)]
  assert.deepEqual(project(frame([native]),positions,owner,map,api,650,550),[],
    'SDK pointCount=2 but only one real Owner feature is verified')
  assert.deepEqual(project(frame([{...native,bbox:null}]),positions,owner,
    map,api,650,550),[])
  assert.deepEqual(project(frame([native]),positions,[place('place:1:1',5,21)],
    map,api,650,550),[])
  assert.deepEqual(project(frame([native]),positions,owner,map,api,650,550),[])
  const extra=geo(['place:1:1',139,35,4],['place:1:2',140,36,3])
  const both=[place('place:1:1',4,21),place('place:1:2',3,22)]
  assert.equal(project(frame([native]),extra,both,map,api,650,550)[0].photoCount,7)
  assert.deepEqual(project(frame([native],[],17),extra,both,map,api,650,550),[])
  assert.deepEqual(project(frame([native,cluster(2,140,36,2,[139,34,141,37])]),
    extra,both,map,api,650,550),[],
    'overlapping SDK bbox cannot prove native membership, keep SDK bubble')
})

test('date-line cluster accepts both sides and sums actual photo counts',()=>{
  const sdk=frame([cluster(6,180,35,2,[179,34,-179,36])])
  const owner=[place('place:179:1',2,81),place('place:-179:1',9,82)]
  const points=geo(['place:179:1',179.5,35,2],['place:-179:1',-179.5,35,9])
  const projector={pointToPixel:p=>({x:p.lng+30,y:p.lat*4})}
  const pins=project(sdk,points,owner,projector,api,650,550)
  assert.equal(pins.length,1)
  assert.equal(pins[0].nodeID,82)
  assert.equal(pins[0].photoCount,11)
})

test('bounded source and native SDK marker projection never process 100k cells',()=>{
  const owners=[],items=[],clusters=[]
  for(let i=0;i<64;i++){
    const id='place:3:'+i,lng=138+i/20,lat=34+i/100
    owners.push(place(id,100+i,1000+i))
    items.push([id,lng,lat,100+i])
  }
  // Each valid cluster must represent precisely two of the supplied features.
  for(let i=0;i<32;i++){
    const lng=138+i*2/20,lat=34+i*2/100
    clusters.push(cluster(i,lng,lat,2,[lng-0.001,lat-0.001,lng+0.055,lat+0.02]))
  }
  let projections=0
  const projection={pointToPixel(p){projections++;return {
    x:(p.lng-130)*80+80,y:(p.lat-28)*90}}}
  const pins=project(frame(clusters),geo(...items),owners,projection,api,650,550)
  assert.ok(pins.length<=12)
  assert.ok(projections<=32)
  const oversized=geo(...Array.from({length:65},(_,i)=>[
    'place:65:'+i,139+i/1000,35+i/1000,1]))
  assert.deepEqual(project(frame(clusters),oversized,owners,projection,api,650,550),[],
    'oversized client input fails closed without creating another 100k SDK index')
})

test('map uses native ClusterLayer.change and bounded Owner service',()=>{
  const ui=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'),'utf8')
  assert.match(ui,/runtime\.layer\.addEventListener\('change', onNativeClusters\)/)
  assert.ok(ui.indexOf("runtime.layer.addEventListener('change', onNativeClusters)") <
    ui.indexOf('runtime.layer.setData(collection)'))
  assert.match(ui,/fitViewOnClick: true/)
  assert.match(ui,/clusterIconSize: \(\) => \[64, 64\]/)
  assert.match(ui,/data-xdrive-baidu-native-cluster-cover/)
  assert.match(ui,/pointerEvents: 'none'/)
  assert.match(ui,/pin\.photoCount\.toLocaleString/)
  assert.match(ui,/listPlacesMapOverview\(bounds, detail, controller.signal\)/)
  assert.match(ui,/runtime\.map\.addEventListener\('movestart', stopOnGesture\)/)
  assert.match(ui,/runtime\.map\.addEventListener\('zoomstart', stopOnGesture\)/)
  assert.match(ui,/runtime\.map\.removeEventListener\('movestart', stopOnGesture\)/)
  assert.match(ui,/runtime\.map\.removeEventListener\('zoomstart', stopOnGesture\)/)
  assert.doesNotMatch(ui,/getLeaves\(|new BMapLib\.MarkerClusterer/)
})
