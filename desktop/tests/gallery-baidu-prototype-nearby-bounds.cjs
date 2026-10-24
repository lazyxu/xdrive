'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const Module=require('node:module')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const name='ui/shared/src/media-gallery-baidu-native-query-bounds.ts'
const parsed=ts.transpileModule(fs.readFileSync(path.join(root,name),'utf8'),
  {fileName:name,reportDiagnostics:true,
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
assert.deepEqual(parsed.diagnostics||[],[])
const mod=new Module(name,module)
mod.filename=path.join(root,name)
mod.paths=module.paths
mod._compile(parsed.outputText,mod.filename)
const {xDriveBaiduPrototypeCameraQueryBounds:camera,
  xDriveBaiduPrototypeNearbyActionBounds:nearby,
  xDriveBaiduPrototypeOverviewQueryBounds:overview}=mod.exports
const frame=(west,south,east,north)=>({
  getSouthWest:()=>({lng:west,lat:south}),
  getNorthEast:()=>({lng:east,lat:north}),
})
test('invalid or missing provider bounds cannot expand prototype queries to the world',()=>{
  for(const raw of [null,undefined,{},frame(1,1,1,2),
    frame(119,30,120,30),frame(-180,-85,180,85),
    frame(NaN,30,120,32),frame(-181,30,120,32),
    {getSouthWest(){throw Error('malicious SDK')},getNorthEast(){return {lng:2,lat:3}}},
  ]) {
    assert.equal(camera(raw),null)
    assert.equal(nearby(raw,19),null)
  }
})
test('camera WGS84 envelope is conservative and never silently exact BD09 membership',()=>{
  const bounds=camera(frame(119.9,30.1,120.1,30.3))
  assert.ok(bounds)
  assert.ok(bounds.west<119.9&&bounds.east>120.1)
  assert.ok(bounds.south<30.1&&bounds.north>30.3)
  assert.equal(nearby(frame(119.9,30.1,120.1,30.3),14),null)
  assert.deepEqual(nearby(frame(119.9,30.1,120.1,30.3),17),bounds)
  assert.equal(nearby(frame(119.9,30.1,120.1,30.3),22),null)
  assert.equal(nearby(frame(-10,-10,10,10),17),null)
})
test('date-line viewport retains west > east and never uses WORLD as a fallback',()=>{
  const bounds=nearby(frame(179.8,5,-179.8,5.2),18)
  assert.ok(bounds)
  assert.ok(bounds.west>bounds.east)
  assert.ok(bounds.north>5.2&&bounds.south<5)
  assert.ok(bounds.west>179&&bounds.east< -179)
})
test('Gallery maps only validated nearby envelope, never BD09 as original WGS84',()=>{
  const src=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'),'utf8')
  assert.match(src,/data-xdrive-baidu-prototype-nearby/)
  assert.match(src,/xDriveBaiduPrototypeOverviewQueryBounds\(runtime\.map\.getBounds\?\.\(\), zoom\)/)
  assert.match(src,/if \(!bounds\) \{/)
  assert.match(src,/xDriveBaiduPrototypeNearbyActionBounds/)
  assert.doesNotMatch(src,/viewportPhotosRef\.current\(runtime\.map\.getBounds\?\.\(\)\)/)
})

test('low zoom real world camera is a deliberate bounded Owner overview, not invalid fallback',()=>{
  const world=frame(-180,-85,180,85)
  assert.deepEqual(overview(world,3),{west:-180,south:-85,east:180,north:85})
  assert.deepEqual(overview(world,4),{west:-180,south:-85,east:180,north:85})
  assert.equal(overview(world,5),null)
  assert.equal(overview(world,18),null)
  assert.equal(overview(world,NaN),null)
  // A missing/throwing malformed SDK camera MUST NOT become a worldwide
  // query, even at a level where a genuine world view would be valid.
  for(const raw of [null,undefined,{},frame(-181,-85,180,85),
    frame(-180,-90,180,85),frame(-180,-85,180,86),
    {getSouthWest(){throw Error('hostile SDK')},getNorthEast(){return {lng:180,lat:85}}}
  ])assert.equal(overview(raw,3),null)
})
test('ordinary panning continues to request conservative bounded areas',()=>{
  const raw=frame(119.9,30.1,120.1,30.3)
  assert.deepEqual(overview(raw,4),camera(raw))
  assert.deepEqual(overview(raw,18),camera(raw))
  assert.equal(nearby(frame(-180,-85,180,85),18),null)
})
test('old overview errors have a bounded retry while automatic GPS mode remains active',()=>{
  const src=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'),'utf8')
  assert.match(src,/const \[overviewRetry, setOverviewRetry\] = useState\(0\)/)
  assert.match(src,/data-xdrive-baidu-prototype-retry/)
  assert.match(src,/onClick=\{\(\) => setOverviewRetry\(n => n \+ 1\)\}/)
  assert.match(src,/\[runtime, listPlacesMapOverview, overviewRetry\]/)
  assert.match(src,/disabled=\{!runtime \|\| dataLoading\}/)
})
