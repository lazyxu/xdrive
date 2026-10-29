'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const repo=path.resolve(__dirname,'../..')
const modulePath=path.join(repo,'ui/shared/src/media-gallery-baidu-photo-focus.ts')
const moduleSource=fs.readFileSync(modulePath,'utf8')
const compiled=ts.transpileModule(moduleSource,{
  fileName:modulePath,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((compiled.diagnostics||[]).filter(
  d=>d.category===ts.DiagnosticCategory.Error),[])
const m={exports:{}}
new Function('exports','module','require',compiled.outputText)(m.exports,m,require)
const {
  xDriveBaiduOwnerPhotoFocusParams: params,
  xDriveValidBaiduOwnerPhotoFocus: valid,
  xDriveOwnerPhotoFocusSignalActive: active,
}=m.exports
const focus={
  coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
  node_id:42,node_revision:7,latitude:30.14,longitude:119.98,
}

test('Photo Info focus requires only canonical positive current Node/revision',()=>{
  assert.equal(params(42,7)?.toString(),'node_id=42&node_revision=7')
  assert.equal(params(Number.MAX_SAFE_INTEGER,7)?.get('node_id'),
    String(Number.MAX_SAFE_INTEGER))
  for(const bad of [0,-1,1.5,Number.NaN,Infinity,-Infinity,
    Number.MAX_SAFE_INTEGER+1,'42',null,undefined,{},[42]]){
    assert.equal(params(bad,7),null)
    assert.equal(params(42,bad),null)
  }
})

test('Photo Info focus accepts exact derived BD09 and current source identity',()=>{
  assert.equal(valid(focus,42,7),true)
  assert.equal(valid({...focus,latitude:-90,longitude:180},42,7),true)
  assert.equal(valid({...focus,latitude:90,longitude:-180},42,7),true)
  assert.equal(valid(focus,42,8),false)
  assert.equal(valid(focus,43,7),false)
})

test('Photo Info focus rejects all raw GPS, Owner, provider and JWT extensions',()=>{
  for(const extension of [
    {original_latitude:30.13}, {original_longitude:119.97},
    {owner_id:42}, {token:'private'}, {ak:'secret'},
    {url:'https://api.map.baidu.com'}, {source_node_id:42},
    {coordinateSpace:'wgs84ll'}, {metadata:{latitude:30.13}},
    {exif:{GPSLatitude:30.13}}, {capability:'map'}, {__proto__:null},
  ]){
    if(Object.keys(extension).length>0)
      assert.equal(valid({...focus,...extension},42,7),false)
  }
  assert.equal(valid({...focus,node_id:0},42,7),false)
  assert.equal(valid({...focus,node_revision:Number.MAX_SAFE_INTEGER+1},42,7),false)
  assert.equal(valid({...focus,coordinate_space:'wgs84ll'},42,7),false)
  assert.equal(valid({...focus,index_scope:'unscoped'},42,7),false)
  assert.equal(valid({...focus,latitude:90.01},42,7),false)
  assert.equal(valid({...focus,longitude:-180.01},42,7),false)
  assert.equal(valid({...focus,latitude:NaN},42,7),false)
  assert.equal(valid({...focus,longitude:Infinity},42,7),false)
  assert.equal(valid({...focus,latitude:'30.14'},42,7),false)
  assert.equal(valid({node_id:42,node_revision:7,latitude:30.14},42,7),false)
  assert.equal(valid(null,42,7),false)
  assert.equal(valid([],42,7),false)
})

test('Photo Info focus refuses absent, cancelled and Safari-unreadable signal',()=>{
  assert.equal(active(undefined),false)
  const controller=new AbortController()
  assert.equal(active(controller.signal),true)
  controller.abort()
  assert.equal(active(controller.signal),false)
  const denied=new AbortController()
  Object.defineProperty(denied.signal,'aborted',{
    get(){throw Error('Safari SecurityError')},
  })
  assert.equal(active(denied.signal),false)
  const legacy=new AbortController()
  Object.defineProperty(legacy.signal,'throwIfAborted',{value:undefined})
  assert.equal(active(legacy.signal),true)
})

test('Web Owner client uses original signed request, never SDK URL or unscoped fallback',()=>{
  const api=fs.readFileSync(path.join(repo,'web/src/api.ts'),'utf8')
  const start=api.indexOf('  mediaBaiduNativePhotoFocus(')
  const end=api.indexOf('  /** Signed runtime only: 8x8 bounded Owner BD09 aggregate',start)
  assert.ok(start>0 && end>start)
  const method=api.slice(start,end)
  assert.match(method,/xDriveBaiduOwnerPhotoFocusParams\(nodeID, revision\)/)
  assert.match(method,/xDriveOwnerPhotoFocusSignalActive\(signal\)/)
  assert.match(method,/this\.request<unknown>\(/)
  assert.match(method,/\/api\/v1\/media\/places\/baidu-jsapi\/photo-focus\?/)
  assert.match(method,/cache: 'no-store'/)
  assert.match(method,/xDriveValidBaiduOwnerPhotoFocus\(value, nodeID, revision\)/)
  assert.doesNotMatch(method,/api\.map\.baidu\.com|wgs84|window\.location|localStorage|sessionStorage|mediaItems\(|\.catch\(/)
})
