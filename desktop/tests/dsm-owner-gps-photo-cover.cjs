'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const loaded = new Map()
function loadTS(filename) {
  if (loaded.has(filename)) return loaded.get(filename)
  const code = ts.transpileModule(read(filename), {
    fileName:filename, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length,0)
  const mod={exports:{}}
  new Function('module','exports','require',code.outputText)(mod,mod.exports,name=>{
    if (name === './media-gallery-owner-gps-viewport')
      return loadTS('ui/shared/src/media-gallery-owner-gps-viewport.ts')
    throw new Error('unexpected map runtime dependency: '+name)
  })
  loaded.set(filename,mod.exports)
  return mod.exports
}
const policy=loadTS('ui/shared/src/media-gallery-owner-gps-cover.ts')
const exact={id:'place:3550:13970',name:'Tokyo',latitude:35.5,longitude:139.7,
  sample_latitude:35.5,sample_longitude:139.7,coordinate_kind:'grid_cell_center',
  item_count:4}
const region={...exact,id:'map-region:1',coordinate_kind:'map_region_sample'}
const page={items:[exact],total_photo_count:4,aggregated:false}
const aggregate={items:[region],total_photo_count:8,aggregated:true}

test('only current signed exact Owner GPS places acquire photo-cover candidates',()=>{
  assert.deepEqual(policy.xDriveOwnerGPSCoverCandidates(page).map(x=>x.id),[exact.id])
  assert.deepEqual(policy.xDriveOwnerGPSCoverCandidates(aggregate),[])
  assert.deepEqual(policy.xDriveOwnerGPSCoverCandidates(
    {...page,items:Array(65).fill(exact)}),[])
  const several=Array.from({length:64},(_,i)=>({...exact,id:'place:3550:'+i,
    item_count:i+1}))
  assert.equal(policy.xDriveOwnerGPSCoverCandidates(
    {items:several,total_photo_count:2080,aggregated:false}).length,64)
})

test('cover never trusts an unverified map cover_node_id, only exact Owner Range',async()=>{
  const controller=new AbortController()
  const calls=[]
  const readRange=async (limit,offset,query,signal)=>{
    calls.push(['range',limit,offset,query.place,signal===controller.signal])
    return {limit:1,offset:0,total_count:3,items:[{
      node:{id:29,revision:4},metadata:{has_thumbnail:true}}]}
  }
  const thumb=async (id,signal,rev)=>{
    calls.push(['thumbnail',id,rev,signal===controller.signal])
    return 'blob:verified-owner-cover'
  }
  const actual=await policy.xDriveLoadOwnerGPSPhotoCover(
    {...exact,cover_node_id:99999},readRange,thumb,controller.signal)
  assert.equal(actual,'blob:verified-owner-cover')
  assert.deepEqual(calls,[['range',1,0,exact.id,true],['thumbnail',29,4,true]])
  assert.equal(await policy.xDriveLoadOwnerGPSPhotoCover(region,readRange,thumb,controller.signal),null)
  assert.equal(calls.length,2)
})

test('mismatched counts, missing derivatives and revocation never paint old Owner cover',async()=>{
  const signal=new AbortController()
  let reads=0,thumbs=0
  const item={node:{id:29,revision:4},metadata:{has_thumbnail:true}}
  for(const fake of [
    {limit:1,offset:0,total_count:5,items:[item]},
    {limit:1,offset:0,total_count:0,items:[]},
    {limit:1,offset:0,total_count:3,items:[{...item,metadata:{has_thumbnail:false}}]},
    {limit:1,offset:1,total_count:3,items:[item]},
  ]){
    const url=await policy.xDriveLoadOwnerGPSPhotoCover(exact,async()=>{reads++;return fake},
      async()=>{thumbs++;return 'blob:should-not-load'},signal.signal)
    assert.equal(url,null)
  }
  assert.equal(reads,4);assert.equal(thumbs,0)
  signal.abort()
  assert.equal(await policy.xDriveLoadOwnerGPSPhotoCover(exact,async()=>{reads++;return null},
    async()=>{thumbs++;return 'blob:no'},signal.signal),null)
  assert.equal(reads,4)
})

test('shared DSM fallback owns and revokes only scoped Blob cover leases',()=>{
  const map=read('ui/shared/src/mui/MediaGalleryOwnerGPSOverview.tsx')
  const parent=read('ui/shared/src/mui/MediaGallery.tsx')
  const host=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(map,/xDriveOwnerGPSCoverCandidates\(current\)/)
  assert.match(map,/void Promise\.all\(\[worker\(\),worker\(\)\]\)/)
  assert.match(map,/controller\.abort\(\)/)
  assert.match(map,/URL\.revokeObjectURL\(url\)/)
  assert.match(map,/data-xdrive-owner-gps-cover=\{item\.id\}/)
  assert.match(parent,/xDriveLoadOwnerGPSPhotoCover\(place, source\.listItemRange, source\.loadThumbnail, signal\)/)
  assert.match(host,/loadCover=\{loadPlacesMapCover\}/)
  assert.doesNotMatch(map,/BMap|JWT|location\.href|fetch\(/)
})
