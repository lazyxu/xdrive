'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
function loadTS(filename) {
  const mod = { exports: {} }
  const code = ts.transpileModule(read(filename), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 },
  })
  assert.equal((code.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length,0)
  new Function('module','exports','require',code.outputText)(mod,mod.exports,
    name => { throw Error('unexpected runtime dependency in pure Owner map contract: ' + name) })
  return mod.exports
}
const adapter = loadTS('ui/shared/src/synology-backup-adapter.ts')
const map = loadTS('ui/shared/src/media-gallery-owner-gps-viewport.ts')
const source = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const fallback = read('ui/shared/src/mui/MediaGalleryOwnerGPSOverview.tsx')

const world = {west:-180,south:-90,east:180,north:90}
const exact = {id:'place:3550:13970',name:'GPS place',
  sample_latitude:35.505,sample_longitude:139.706,
  latitude:35.505,longitude:139.706,coordinate_kind:'grid_cell_center',item_count:3}
const region = {...exact,id:'map-region:1',name:'照片区域 1',
  coordinate_kind:'map_region_sample'}
test('DSM WGS84 response is a strict bounded Owner viewport, never a partial Places card page',() => {
  const accepted = adapter.xDriveSynologyValidateOwnerMapOverview(
    {items:[exact],total_photo_count:3,aggregated:false},world)
  assert.equal(accepted.items[0].sample_latitude,35.505)
  assert.equal(accepted.total_photo_count,3)
  const aggregate = adapter.xDriveSynologyValidateOwnerMapOverview(
    {items:[region],total_photo_count:3,aggregated:true},world)
  assert.equal(aggregate.aggregated,true)
  assert.equal(map.xDriveOwnerGPSCanOpenPlace(aggregate,region),false)
  assert.equal(map.xDriveOwnerGPSCanOpenPlace(accepted,exact),true)
  for(const bad of [
    {items:[region],total_photo_count:3,aggregated:false},
    {items:[exact],total_photo_count:3,aggregated:true},
    {items:[exact],total_photo_count:2,aggregated:false},
    {items:[exact,exact],total_photo_count:6,aggregated:false},
    {items:[{...exact,sample_latitude:100,latitude:100}],total_photo_count:3,aggregated:false},
    {items:[{...exact,metadata:{gps:'secret'}}],total_photo_count:3,aggregated:false},
    {items:[{...exact,id:'place:00:13970'}],total_photo_count:3,aggregated:false},
    {items:[{...exact,sample_longitude:-170,longitude:-170}],total_photo_count:3,aggregated:false},
    {items:Array(65).fill(exact),total_photo_count:195,aggregated:false},
    {items:[],total_photo_count:1,aggregated:true},
    {items:[exact],total_photo_count:3,aggregated:false,owner_id:1},
  ]) assert.throws(()=>adapter.xDriveSynologyValidateOwnerMapOverview(bad,world))
  assert.deepEqual(adapter.xDriveSynologyValidateOwnerMapOverview(
    {items:[],total_photo_count:0,aggregated:true},world).items,[])
})

test('real GPS map offers bounded pan/zoom and only exact Owner place action',() => {
  assert.equal(map.xDriveOwnerGPSBoundsValid(world),true)
  assert.equal(map.xDriveOwnerGPSBoundsValid({...world,east:-180}),false)
  const point = map.xDriveOwnerGPSPoint(world,35.505,139.706)
  assert.ok(point.x>0.8 && point.x<0.9 && point.y>0.2 && point.y<0.4)
  const zoomed = map.xDriveOwnerGPSZoom(world,35.505,139.706)
  assert.equal(map.xDriveOwnerGPSBoundsValid(zoomed),true)
  assert.ok(zoomed.west<=139.706 && zoomed.east>=139.706)
  assert.ok(zoomed.south<=35.505 && zoomed.north>=35.505)
  const shifted = map.xDriveOwnerGPSPan(zoomed,0.12,-0.1)
  assert.ok(shifted.west < zoomed.west && shifted.south < zoomed.south)
  assert.equal(map.xDriveOwnerGPSZoom(world,NaN,0),null)
  assert.equal(map.xDriveOwnerGPSPan(world,Infinity,0),null)
  assert.equal(map.xDriveOwnerGPSPoint(zoomed,-50,139.706),null)
  assert.equal(map.xDriveOwnerGPSCanOpenPlace(
    {items:[exact],total_photo_count:3,aggregated:false},{...exact,item_count:5}),false)
})

test('the existing shared map only uses WGS84 fallback when no authenticated SDK Host is offered',() => {
  assert.match(source,/import \{ XDriveMediaGalleryOwnerGPSOverview \}/)
  assert.match(source,/!getBaiduJSAPI4Status && listPlacesMapOverview && onOpenPlace/)
  assert.match(source,/<XDriveMediaGalleryOwnerGPSOverview[\s\S]*?listPage=\{listPlacesMapOverview\}/)
  assert.match(fallback,/WGS84 GPS 位置概览/)
  assert.match(fallback,/经纬度坐标示意（无地图底图）/)
  assert.match(fallback,/xDriveOwnerGPSCanOpenPlace\(current, item\)/)
  assert.match(fallback,/if \(realPlace\) onOpenPlace\(item\)/)
  assert.match(fallback,/else moveTo\(xDriveOwnerGPSZoom\(/)
  assert.match(fallback,/controller\.abort\(\)/)
  assert.doesNotMatch(fallback,/BMap|AK|JWT|location\.href|PhotoKit|fetch\(/)
})
