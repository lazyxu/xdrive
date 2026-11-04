'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const loadContract=filename=>{
  const input=fs.readFileSync(path.join(root,filename),'utf8')
  const result=ts.transpileModule(input,{fileName:filename,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0)
  const mod={exports:{}}
  new Function('module','exports','require',result.outputText)(mod,mod.exports,
    name=>{throw Error('unexpected dependency: '+name)})
  return mod.exports
}
const adapter=loadContract('ui/shared/src/synology-backup-adapter.ts')
const world={west:-180,south:-90,east:180,north:90}
const exact={id:'place:3550:13970',name:'GPS place',sample_latitude:35.505,
  sample_longitude:139.706,latitude:35.505,longitude:139.706,
  coordinate_kind:'grid_cell_center',item_count:3}
const region={...exact,id:'map-region:1',name:'照片区域 1',
  coordinate_kind:'map_region_sample'}
test('DSM Owner GPS data API validation remains bounded for client compatibility',()=>{
  const accepted=adapter.xDriveSynologyValidateOwnerMapOverview({
    items:[exact],total_photo_count:3,aggregated:false},world)
  assert.equal(accepted.total_photo_count,3)
  assert.equal(accepted.items[0].sample_latitude,35.505)
  const aggregated=adapter.xDriveSynologyValidateOwnerMapOverview({
    items:[region],total_photo_count:3,aggregated:true},world)
  assert.equal(aggregated.aggregated,true)
  for(const bad of [
    {items:[region],total_photo_count:3,aggregated:false},
    {items:[exact],total_photo_count:3,aggregated:true},
    {items:[exact],total_photo_count:2,aggregated:false},
    {items:[exact,exact],total_photo_count:6,aggregated:false},
    {items:[{...exact,sample_latitude:100,latitude:100}],total_photo_count:3,aggregated:false},
    {items:[{...exact,metadata:{gps:'secret'}}],total_photo_count:3,aggregated:false},
    {items:Array(65).fill(exact),total_photo_count:195,aggregated:false},
    {items:[],total_photo_count:1,aggregated:true},
    {items:[exact],total_photo_count:3,aggregated:false,owner_id:1},
  ]) assert.throws(()=>adapter.xDriveSynologyValidateOwnerMapOverview(bad,world))
  assert.deepEqual(adapter.xDriveSynologyValidateOwnerMapOverview({
    items:[],total_photo_count:0,aggregated:true},world).items,[])
})