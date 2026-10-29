'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.resolve(__dirname, '../..')
const cache = new Map()
function load(relative) {
  const filename = path.resolve(repo, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const original = fs.readFileSync(filename, 'utf8')
  const compiled = ts.transpileModule(original, {
    fileName:filename,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  const errors = (compiled.diagnostics || []).filter(
    d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], filename + ' must transpile')
  const module = {exports:{}}
  cache.set(filename,module)
  new Function('exports','module','require',compiled.outputText)(
    module.exports,module,name=>{
      if (!name.startsWith('./')) return require(name)
      return load(path.relative(repo,
        path.resolve(path.dirname(filename),name+'.ts')))
    })
  return module.exports
}
const { xDriveResolveBaiduOwnerPhotoFocusCamera: resolve } = load(
  'ui/shared/src/media-gallery-baidu-photo-focus-camera.ts')
const { xDriveValidBaiduNativeCameraSnapshot } = load(
  'ui/shared/src/media-gallery-baidu-native-camera-session.ts')

const selection = {nodeID:42,revision:7}
const account = {
  ownerScope:'fixture-owner-A',
  focusIntent:selection,
  photoScope:{albumKey:'manual:Family',
    filters:{sort_by:'captured',sort_dir:'desc',favorite:true}},
}
const focus = {
  coordinate_space:'bd09ll',index_scope:'owner_gps_auto_index',
  node_id:42,node_revision:7,latitude:30.14,longitude:119.98,
}
const go = (s=selection,old=account,read=async()=>({...focus}),
  current=()=>account,signal=new AbortController().signal,camera=null) =>
  resolve(s,old,read,current,signal,camera)

test('signed current Owner focus centers only a valid four-field BD09 Parent camera',async()=>{
  const result=await go()
  assert.deepEqual(result,{kind:'ready',
    camera:{coordinate_space:'bd09ll',latitude:30.14,
      longitude:119.98,zoom:16}})
  assert.equal(xDriveValidBaiduNativeCameraSnapshot(result.camera),true)
  assert.deepEqual(Object.keys(result.camera).sort(),
    ['coordinate_space','latitude','longitude','zoom'])
  assert.equal((await go(selection,account,async()=>focus,()=>account,
    new AbortController().signal,{
      coordinate_space:'bd09ll',latitude:30,longitude:118,zoom:18,
    })).camera.zoom,18)
  assert.equal((await go(selection,account,async()=>focus,()=>account,
    new AbortController().signal,{
      coordinate_space:'wgs84ll',latitude:30,longitude:118,zoom:99,
    })).camera.zoom,16)
})

test('no request is started under invalid selected identity or scope',async()=>{
  let invoked=0
  const read=async()=>{invoked++;return focus}
  for (const wrong of [
    {nodeID:0,revision:7},{nodeID:1.5,revision:7},
    {nodeID:42,revision:Infinity},{nodeID:42,revision:0},
    {nodeID:Number.MAX_SAFE_INTEGER+1,revision:7},
  ])assert.equal((await go(wrong,account,read)).kind,'invalid')
  for(const state of [
    {...account,ownerScope:''},
    {...account,ownerScope:'a'.repeat(1025)},
    {...account,focusIntent:{nodeID:43,revision:7}},
    {...account,focusIntent:{nodeID:42,revision:0}},
    {...account,focusIntent:null},
    {...account,photoScope:{albumKey:'',filters:{sort_by:'fake'}}},
    {...account,photoScope:{albumKey:'',filters:{unknown_flag:true}}},
    {...account,photoScope:{albumKey:'not-a-real-album',filters:{}}},
  ])assert.equal((await go(selection,state,read,()=>state)).kind,'invalid')
  assert.equal(invoked,0)
})

test('Owner / album / favorite membership changes prevent stale BD09 camera',async()=>{
  let deliver
  const pending = new Promise(resolve=>{deliver=resolve})
  let active=account
  const task=go(selection,account,async()=>pending,()=>active)
  active={ownerScope:'fixture-owner-B',photoScope:account.photoScope}
  deliver({...focus})
  assert.deepEqual(await task,{kind:'stale'})
  const changed={...account,photoScope:{
    albumKey:'manual:Family',filters:{sort_by:'captured',sort_dir:'desc'}}}
  assert.equal((await go(selection,account,async()=>focus,()=>changed)).kind,'stale')
  assert.equal((await go(selection,account,async()=>focus,()=>{throw Error('torn down')})).kind,'stale')
})

test('same Owner and album new-photo Viewer preempts an in-flight old focus',async()=>{
  let resolveOld
  const pending = new Promise(resolve=>{resolveOld=resolve})
  let active=account
  let launched=0
  const old=go(selection,account,async()=>{
    launched++
    return pending
  },()=>active)
  active={...account,focusIntent:{nodeID:43,revision:7}}
  resolveOld({...focus})
  assert.deepEqual(await old,{kind:'stale'})
  assert.equal(launched,1)

  // Even a revision change on the same Node invalidates the old result.
  const staleRevision={...account,focusIntent:{nodeID:42,revision:8}}
  assert.equal((await go(selection,account,async()=>focus,
    ()=>staleRevision)).kind,'stale')
  assert.equal((await go(selection,account,async()=>focus,
    ()=>({...account,focusIntent:null}))).kind,'stale')
})

test('live cancellation during and before read rejects results without fallback',async()=>{
  const early=new AbortController();early.abort()
  let count=0
  const read=async()=>{count++;return focus}
  assert.equal((await go(selection,account,read,()=>account,early.signal)).kind,'stale')
  assert.equal(count,0)
  const controller=new AbortController()
  let deliver
  const pending=new Promise(resolve=>{deliver=resolve})
  const task=go(selection,account,async()=>{count++;return pending},
    ()=>account,controller.signal)
  controller.abort()
  deliver({...focus})
  assert.equal((await task).kind,'stale')
  assert.equal(count,1)
  const safari=new AbortController()
  Object.defineProperty(safari.signal,'aborted',{get(){throw Error('Safari denial')}})
  assert.equal((await go(selection,account,read,()=>account,safari.signal)).kind,'stale')
  assert.equal(count,1)
})

test('wrong selected Node/revision and forged source/privacy fields fail closed',async()=>{
  for(const candidate of [
    {...focus,node_id:43},{...focus,node_revision:8},
    {...focus,coordinate_space:'wgs84ll'},
    {...focus,index_scope:'all_users'},
    {...focus,latitude:89},
    {...focus,longitude:181},
    {...focus,longitude:NaN},{...focus,latitude:Infinity},
    {...focus,original_latitude:30.13},{...focus,owner_id:999},
    {...focus,jwt:'secret'},
    {...focus,url:'https://api.map.baidu.com'},
    { ...focus,latitude:'30.14' },
    null,
  ])assert.equal((await go(selection,account,async()=>candidate)).kind,'invalid')
})

test('real Server error cannot turn into old camera or silently unscoped map',async()=>{
  let readCount=0
  const read=async(id,rev,signal)=>{
    readCount++
    assert.equal(id,42)
    assert.equal(rev,7)
    assert.equal(signal.aborted,false)
    throw new Error('signed Owner map photo focus unavailable')
  }
  const result=await go(selection,account,read)
  assert.deepEqual(result,{kind:'unavailable'})
  assert.equal(readCount,1)
  const source=fs.readFileSync(path.join(repo,
    'ui/shared/src/media-gallery-baidu-photo-focus-camera.ts'),'utf8')
  assert.doesNotMatch(source,/window\.|document\.|localStorage|sessionStorage|fetch\(|new BMap|api\.map\.baidu\.com/)
  assert.match(source,/currentOwnerScope\(owner, scopeKey, readCurrent\)/)
  assert.match(source,/xDriveValidBaiduOwnerPhotoFocus\(/)
  assert.match(source,/xDriveValidBaiduNativeCameraSnapshot\(camera\)/)
})
