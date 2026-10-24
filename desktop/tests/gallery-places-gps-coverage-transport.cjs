'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const name='ui/shared/src/media-gallery-baidu-coverage.ts'
const js=ts.transpileModule(read(name), {fileName:name,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
assert.deepEqual((js.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error), [])
const mod={exports:{}}
new Function('module','exports',js.outputText)(mod,mod.exports)
const validate=mod.exports.xDriveValidBaiduMapCoverage
const counts={scope:'indexed_ready_photoassets',valid_gps_assets:100,
  eligible_bd09_assets:79,not_eligible_bd09_assets:21,
  source_outside_camera_latitude_assets:2,map_runtime_verified:false}
test('coverage accepts only coherent Owner aggregates, never coordinates or partial results',()=>{
  assert.deepEqual(validate(counts),counts)
  assert.deepEqual(validate({...counts,valid_gps_assets:0,eligible_bd09_assets:0,
    not_eligible_bd09_assets:0,source_outside_camera_latitude_assets:0}),
    {...counts,valid_gps_assets:0,eligible_bd09_assets:0,
      not_eligible_bd09_assets:0,source_outside_camera_latitude_assets:0})
  for(const bad of [
    {...counts,not_eligible_bd09_assets:22},
    {...counts,eligible_bd09_assets:-1},
    {...counts,valid_gps_assets:0},
    {...counts,valid_gps_assets:1.5},
    {...counts,source_outside_camera_latitude_assets:110},
    {...counts,map_runtime_verified:true},
    {...counts,scope:'all-account-gps'},
    {...counts,owner_id:7},
    {...counts,source_latitude:39.9},
    {...counts,browser_ak:'public'},
  ]) assert.equal(validate(bad),null)
})
test('P0-01 coverage interpretation is separate from map release or provider consent',()=>{
  const state=mod.exports.xDriveBaiduMapCoverageState
  assert.equal(state(null),'unverified')
  assert.equal(state({...counts,map_runtime_verified:true}),'unverified')
  assert.equal(state({...counts,valid_gps_assets:0,eligible_bd09_assets:0,
    not_eligible_bd09_assets:0,source_outside_camera_latitude_assets:0}),'no-valid-gps')
  assert.equal(state({...counts,eligible_bd09_assets:0,
    not_eligible_bd09_assets:100}),'none-displayable')
  assert.equal(state(counts),'partial')
  assert.equal(state({...counts,eligible_bd09_assets:100,
    not_eligible_bd09_assets:0}),'complete')
  const ui=read('ui/shared/src/mui/MediaGalleryMapGPSCoverage.tsx')
  assert.match(ui,/xDriveBaiduMapCoverageState\(current\.data\)/)
  assert.match(ui,/data-xdrive-map-gps-coverage-explanation/)
  assert.match(ui,/不会自动向百度发送这些坐标/)
  assert.match(ui,/这不代表百度动态地图已运行成功/)
})

test('Web Mobile and Desktop use the original read-only Owner endpoint and cancellation',()=>{
  const required=[
    ['web/src/api.ts','/api/v1/media/places/baidu-jsapi/coverage'],
    ['web/src/mediaGalleryAdapter.ts','api.mediaBaiduMapCoverage(signal)'],
    ['desktop/src/renderer/mediaGalleryAdapter.ts','agent.getMediaBaiduMapCoverage(requestID)'],
    ['desktop/src/preload/index.cts','agent:get-media-baidu-map-coverage'],
    ['desktop/src/main/index.cts','agent:get-media-baidu-map-coverage'],
    ['desktop/src/main/agent_client.cts','/v1/media/places/baidu-coverage'],
    ['cmd/xdrive-agent/desktop_ipc.go','GET /v1/media/places/baidu-coverage'],
    ['cmd/xdrive-agent/desktop_ipc_media_baidu_map_coverage.go','r.URL.RawQuery != ""'],
    ['internal/client/media_baidu_map_coverage.go','/api/v1/media/places/baidu-jsapi/coverage'],
    ['ui/shared/src/mui/MediaGalleryPlacesMap.tsx','<XDriveMediaGalleryMapGPSCoverage'],
  ]
  for(const [name,code] of required) assert.ok(read(name).includes(code),name+' needs '+code)
  const ui=read('ui/shared/src/mui/MediaGalleryMapGPSCoverage.tsx')
  assert.ok(ui.includes('inFlight.current?.abort()'))
  assert.ok(ui.includes('ownerRef.current !== owner'))
  assert.ok(ui.includes('不代表 0 张照片'))
  assert.ok(!read('deploy/baidu-isolated-child/child.js').includes('eligible_bd09_assets'))
})
