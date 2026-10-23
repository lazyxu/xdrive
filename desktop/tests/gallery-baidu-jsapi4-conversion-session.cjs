'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/media-gallery-baidu-jsapi4-markers.ts')
const source = fs.readFileSync(file, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS },
  fileName:file, reportDiagnostics:true,
})
assert.deepEqual(compiled.diagnostics || [], [])
const moduleObject = {exports:{}}
new Function('module','exports','require',compiled.outputText)(moduleObject,moduleObject.exports, () => {
  throw Error('conversion controller must not import a network/SDK dependency')
})
const {
  XDriveBaiduJSAPI4ConversionSession,
  xDriveConvertBaiduJSAPI4MarkerWindow,
} = moduleObject.exports
const mk = (id, lat, lng, count=1) => ({
  placeID:id,latitude:lat,longitude:lng,photoCount:count,
})
const ready = (...markers) => ({
  kind:'ready', markers,
  totalPhotoCount:markers.reduce((sum,m)=>sum+m.photoCount,0),
})
const point=(lng,lat)=>({lng,lat})
const sdk=()=> {
  const calls=[]
  const convertor={translate(points,from,to,callback) {
    assert.equal(from,1)
    assert.equal(to,5)
    calls.push({at:Date.now(),points:points.map(p=>({...p}))})
    callback({status:0,points:points.map(p=>({lng:p.lng+0.004,lat:p.lat+0.003}))})
  }}
  return {convertor,calls}
}
const convert=(session,convertor,...markers) =>
  xDriveConvertBaiduJSAPI4MarkerWindow(ready(...markers),
    convertor,point,undefined,session)

test('WGS84 pair is converted once across revisits and photo-count changes',async()=>{
  const session = new XDriveBaiduJSAPI4ConversionSession().useScope('owner:A')
  const {convertor,calls}=sdk()
  const one=mk('place:3568:13970',35.68,139.70,3)
  const first=await convert(session,convertor,one)
  const second=await convert(session,convertor,{...one,photoCount:9})
  assert.equal(calls.length,1)
  assert.deepEqual(first.features[0].geometry.coordinates,
    [one.longitude+0.004,one.latitude+0.003])
  assert.equal(second.features[0].properties.photo_count,9)
  assert.deepEqual(second.features[0].geometry.coordinates,
    first.features[0].geometry.coordinates)
  assert.equal(session.audit().cache_entries,1)
  assert.equal(session.audit().cache_hits,1)
  assert.equal(session.audit().method_calls,1)
  assert.equal(session.audit().submitted_points,1)
  assert.equal(session.audit().converted_points,1)
  assert.equal(session.audit().cache_hit_rate_percent,50)
  assert.equal(session.audit().entry,'places-prototype')
  assert.match(session.audit().anonymous_session,/^(?:|[0-9a-f-]{36})$/)
})

test('same GPS from two genuine place representatives only costs one point',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:A')
  const {convertor,calls}=sdk()
  const items=[
    mk('place:3568:13970',35.68,139.70,1),
    mk('map-region:q:-180:-85:180:85:0:0',35.68,139.70,4),
  ]
  const result=await convert(session,convertor,...items)
  assert.equal(calls.length,1)
  assert.equal(calls[0].points.length,1)
  assert.equal(result.features.length,2)
  assert.equal(result.features[1].properties.photo_count,4)
})

test('source GPS changed under the same ID invalidates old derived coordinates',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:A')
  const {convertor,calls}=sdk()
  const id='place:3568:13970'
  await convert(session,convertor,mk(id,35.68,139.70))
  await convert(session,convertor,mk(id,35.681,139.701))
  assert.equal(calls.length,2)
  assert.ok(calls[1].at-calls[0].at>=990,'must leave at least 1 second between calls')
  assert.equal(session.audit().cache_entries,1,'old pair must be removed')
  assert.equal(session.audit().peak_method_calls_per_second,1)
})

test('LRU caps coordinates independently from view count, no on-disk cache',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession(2).useScope('owner:A')
  const {convertor,calls}=sdk()
  await convert(session,convertor,
    mk('place:1:1',1,1),mk('place:2:2',2,2))
  await convert(session,convertor,mk('place:3:3',3,3))
  assert.equal(calls.length,2)
  assert.equal(session.audit().cache_entries,2)
  const summary=JSON.stringify(session.audit())
  assert.doesNotMatch(summary,/owner:A|139\.70|latitude|longitude|browser_ak|access_token/)
  assert.equal(session.audit().submitted_points,3)
  assert.equal(session.audit().converted_points,3)
})

test('queued stale viewport never invokes Convertor after cancellation',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:A')
  let release
  let dispatched=0
  const convertor={translate(points,from,to,cb){
    dispatched++
    release=()=>cb({status:0,points:points.map(p=>({lng:p.lng,lat:p.lat}))})
  }}
  const a=session.translate(convertor,[point(1,1)])
  await Promise.resolve()
  assert.equal(dispatched,1)
  const controller=new AbortController()
  const stale=session.translate(convertor,[point(2,2)],controller.signal)
  controller.abort()
  release()
  await a
  await assert.rejects(stale,/cancelled/)
  assert.equal(dispatched,1)
  assert.equal(session.audit().cancelled,1)
})

test('scope change clears cache, old in-flight reply cannot re-populate new owner',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:A')
  let release
  const convertor={translate(points,from,to,cb) {
    release=()=>cb({status:0,points})
  }}
  const old=session.translate(convertor,[point(130,35)])
  await Promise.resolve()
  session.useScope('owner:B')
  release()
  await assert.rejects(old,/cancelled/)
  assert.equal(session.audit().cache_entries,0)
  assert.equal(session.audit().method_calls,0)
  assert.equal(session.audit().cancelled,0,
    'old Owner cancellation must not appear in the new anonymous audit session')
  const {convertor:next,calls}=sdk()
  await session.translate(next,[point(130,35)])
  assert.equal(calls.length,1)
  assert.equal(session.audit().cache_entries,1)
  session.clear()
  assert.equal(session.audit().cache_entries,0)
})

test('isolated dynamic Child waits for quiet viewport and Owner session cache clears on account change',()=>{
  const child=fs.readFileSync(path.join(root,
    'deploy/baidu-isolated-child/child.js'),'utf8')
  const web=fs.readFileSync(path.join(root,'web/src/App.tsx'),'utf8')
  const desktop=fs.readFileSync(path.join(root,'desktop/src/renderer/App.tsx'),'utf8')
  assert.match(child,/map\.addEventListener\('movestart', stopViewport\)/)
  assert.match(child,/map\.addEventListener\('zoomend', scheduleViewport\)/)
  assert.match(child,/viewportTimer = setTimeout\(\(\) => \{/)
  assert.match(child,/\}, 500\)/)
  assert.match(web,/xDriveClearBaiduConversionSession\(\)/)
  assert.match(desktop,/xDriveClearBaiduConversionSession\(\)/)
  assert.doesNotMatch(source,/(?:window\.localStorage|window\.sessionStorage|indexedDB\s*\.|navigator\.sendBeacon\s*\()/)
})

test('cancelled after dispatch retains physical slot until callback; no phantom quota refund',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:C')
  let release
  let active=0,peak=0
  const starts=[]
  const convertor={translate(points,from,to,callback) {
    starts.push(Date.now())
    active++
    peak=Math.max(peak,active)
    if(starts.length===1) {
      release=()=>{active--;callback({status:0,points})}
    } else {
      active--;callback({status:0,points})
    }
  }}
  const abort=new AbortController()
  const first=session.translate(convertor,[point(1,1)],abort.signal)
  await Promise.resolve()
  assert.equal(starts.length,1)
  abort.abort()
  const next=session.translate(convertor,[point(2,2)])
  await new Promise(resolve=>setTimeout(resolve,80))
  assert.equal(starts.length,1,'cancelled charged request still occupies slot')
  release()
  await assert.rejects(first,/cancelled/)
  await next
  assert.equal(starts.length,2)
  assert.equal(peak,1)
  assert.ok(starts[1]-starts[0]>=990)
  assert.equal(session.audit().method_calls,2,
    'both submitted provider method invocations are counted')
})

test('provider callback timeout poisons remaining document gate rather than assuming in-flight refund',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:D')
  let calls=0
  const convertor={translate(){calls++}}
  await assert.rejects(session.translate(convertor,[point(1,1)]),/timeout/)
  await assert.rejects(session.translate(convertor,[point(2,2)]),/unavailable/)
  assert.equal(calls,1)
  assert.equal(session.audit().method_calls,1)
  assert.equal(session.audit().submitted_points,1)
  assert.equal(session.audit().converted_points,0)
  assert.equal(session.audit().failed,2)
})

test('source change while Convertor is in-flight rejects stale provider result',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:E')
  const original=mk('place:3568:13970',35.68,139.70)
  const moved=mk('place:3568:13970',35.69,139.71)
  session.observeSource(original)
  let release
  const sdkPending={translate(points,from,to,callback) {
    release=()=>callback({status:0,points:points.map(p=>({...p}))})
  }}
  const first=session.translate(sdkPending,[point(original.longitude,original.latitude)])
  await Promise.resolve()
  session.observeSource(moved)
  release()
  await assert.rejects(first,/cancelled/)
  assert.equal(session.audit().cache_entries,0,
    'late official callback cannot reinsert original source coordinate')
  const {convertor}=sdk()
  const second=await session.translate(convertor,[point(moved.longitude,moved.latitude)])
  assert.deepEqual(second,[{
    lng:moved.longitude+0.004,lat:moved.latitude+0.003,
  }])
  assert.equal(session.audit().cache_entries,1)
})

test('malformed or unbounded source point arrays never reach official SDK',async()=>{
  const session=new XDriveBaiduJSAPI4ConversionSession().useScope('owner:F')
  const {convertor,calls}=sdk()
  for (const invalid of [
    [],[point(NaN,1)],[point(1,Infinity)],[point(200,1)],
    Array.from({length:11},()=>point(1,1)),
  ]) await assert.rejects(session.translate(convertor,invalid),/unavailable/)
  assert.equal(calls.length,0)
})
