'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8')
function loadPure(filename) {
  const result = ts.transpileModule(read(filename), {
    fileName:filename, reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  assert.equal((result.diagnostics||[]).filter(x=>
    x.category===ts.DiagnosticCategory.Error).length,0)
  const module={exports:{}}
  new Function('module','exports','require',result.outputText)(module,module.exports,
    name=>{throw Error('unexpected runtime dependency in WGS84 basemap plan: '+name)})
  return module.exports
}
const geo=loadPure('ui/shared/src/media-gallery-owner-gps-tiles.ts')
const source=read('ui/shared/src/mui/MediaGalleryOwnerGPSOverview.tsx')
const world={west:-180,east:180,south:-90,north:90}
const japan={west:139.4,east:140,south:35.4,north:35.9}

test('a Web Mercator basemap requests at most 32 visible XYZ raster tiles, never prefetch',()=>{
  for(const [bounds,width,height] of [
    [world,960,540], [japan,900,540], [japan,3840,2160],
    [{west:-10,east:20,south:35,north:64},375,670],
  ]){
    const plan=geo.xDriveOwnerGPSBasemapPlan(bounds,width,height)
    assert.ok(plan)
    assert.ok(plan.tiles.length>0 && plan.tiles.length<=32)
    assert.ok(plan.zoom>=0 && plan.zoom<=17)
    assert.ok(plan.tiles.every(tile=>tile.z===plan.zoom &&
      tile.x>=0 && tile.x<2**plan.zoom &&
      tile.y>=0 && tile.y<2**plan.zoom &&
      tile.size>0 && tile.url===
        'https://tile.openstreetmap.org/'+tile.z+'/'+tile.x+'/'+tile.y+'.png'))
    assert.ok(plan.tiles.every(tile=>tile.left+tile.size>0 &&
      tile.left<width && tile.top+tile.size>0 && tile.top<height))
  }
  assert.equal(geo.xDriveOwnerGPSBasemapPlan(world,0,540),null)
  assert.equal(geo.xDriveOwnerGPSBasemapPlan({...world,west:200},960,540),null)
  assert.equal(geo.xDriveOwnerGPSBasemapPlan(world,Infinity,540),null)
})

test('real Owner WGS84 representative pins use the exact same tile projection',()=>{
  const plan=geo.xDriveOwnerGPSBasemapPlan(japan,1000,620)
  assert.ok(plan)
  const point=geo.xDriveOwnerGPSTilePoint(japan,plan,35.65,139.7)
  assert.ok(point)
  assert.ok(Math.abs(point.x-0.5)<0.000001)
  assert.ok(Math.abs(point.y-0.5)<0.002)
  assert.equal(geo.xDriveOwnerGPSTilePoint(japan,plan,70,139.7),null)
  assert.equal(geo.xDriveOwnerGPSTilePoint(japan,plan,35.6,NaN),null)
  assert.equal(geo.xDriveOwnerGPSTilePoint(japan,plan,35.6,-180),null)
  // Real polar photos must not be drawn at a falsely clamped tile latitude.
  const globalPlan=geo.xDriveOwnerGPSBasemapPlan(world,960,540)
  assert.equal(geo.xDriveOwnerGPSTilePoint(world,globalPlan,86.5,0),null)
  assert.equal(geo.xDriveOwnerGPSTilePoint(world,globalPlan,-86.5,0),null)
  assert.ok(geo.xDriveOwnerGPSTilePoint(world,globalPlan,84.0,0))
})

test('zoom/drag preserve the authentic WGS84 Owner camera, never BD-09 or file IDs',()=>{
  const zoomed=geo.xDriveOwnerGPSTileZoom(japan,0.5)
  assert.ok(zoomed)
  assert.ok(zoomed.east-zoomed.west<japan.east-japan.west)
  assert.ok(zoomed.north-zoomed.south<japan.north-japan.south)
  const shifted=geo.xDriveOwnerGPSTilePan(zoomed,0.1,0.1)
  assert.ok(shifted)
  assert.ok(shifted.west<zoomed.west)
  assert.ok(shifted.north>zoomed.north)
  assert.equal(geo.xDriveOwnerGPSTileZoom(japan,0),null)
  assert.equal(geo.xDriveOwnerGPSTilePan(world,NaN,0),null)
  const extreme=geo.xDriveOwnerGPSTileZoom(world,100)
  assert.ok(extreme && extreme.west>=-180 && extreme.east<=180 &&
    extreme.south>=-90 && extreme.north<=90)
})

test('raster tiles are explicit opt-in, with OSM attribution and denial fallback',()=>{
  assert.match(source,/const tilesEnabled = Boolean\(scope\) && tileOwner === scope/)
  assert.match(source,/setTileOwner\(tilesEnabled \? '' : scope\)/)
  assert.match(source,/xDriveOwnerGPSBasemapPlan\(bounds, canvasSize\.width, canvasSize\.height\)/)
  assert.match(source,/xDriveOwnerGPSTilePoint\(bounds, tilePlan, latitude, longitude\)/)
  assert.match(source,/xDriveOwnerGPSTilePan\(bounds, dx, dy\)/)
  assert.match(source,/xDriveOwnerGPSTileZoom\(bounds, factor\)/)
  assert.match(source,/component="img" src=\{tile\.url\} alt=""/)
  assert.match(source,/loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/)
  assert.match(source,/© OpenStreetMap contributors/)
  assert.match(source,/data-xdrive-owner-gps-tile-attribution/)
  assert.match(source,/data-xdrive-owner-gps-tile-failed/)
  assert.match(source,/经纬度坐标示意（无地图底图）/)
  assert.match(source,/墨卡托底图不显示纬度高于 85\.05° 的极地照片/)
  assert.match(source,/xDriveOwnerGPSCanOpenPlace\(current, item\)/)
  assert.doesNotMatch(source,/BMap|JWT|location\.href|fetch\(/)
})
