'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname,'../..')
const read = p => fs.readFileSync(path.join(root,p),'utf8')
const file='ui/shared/src/media-gallery-baidu-coverage.ts'
const compiled=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
assert.deepEqual((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
const module_={exports:{}}
new Function('module','exports',compiled.outputText)(module_,module_.exports)
const validate=module_.exports.xDriveValidBaiduMapCoverageReasons
const sameTotals=module_.exports.xDriveBaiduMapCoverageReasonTotalsMatch
const good={scope:'indexed_ready_photoassets',valid_gps_assets:9,
  eligible_bd09_assets:2,not_eligible_bd09_assets:7,
  consent_unavailable_assets:0,consent_source_changed_assets:0,
  derived_missing_assets:6,derived_invalid_assets:1,
  map_runtime_verified:false}
test('reason counts are complete, exclusive, Owner-private and never guessed',()=>{
  assert.deepEqual(validate(good),good)
  for(const bad of [
    null,{}, {...good,derived_invalid_assets:2},
    {...good,derived_missing_assets:-1},{...good,derived_missing_assets:1.5},
    {...good,valid_gps_assets:0},{...good,eligible_bd09_assets:10},
    {...good,consent_source_changed_assets:undefined},
    {...good,consent_unavailable_assets:1},
    {...good,consent_source_changed_assets:1},
    {...good,owner_id:10},{...good,latitude:39.9},{...good,asset_id:3},
    {...good,map_runtime_verified:true},
  ]) assert.equal(validate(bad),null)
})
test('two Owner-only snapshots must have matching validated total counts',()=>{
  const coverage = {
    scope:'indexed_ready_photoassets',
    valid_gps_assets:9,eligible_bd09_assets:2,not_eligible_bd09_assets:7,
    source_outside_camera_latitude_assets:0,map_runtime_verified:false,
  }
  assert.equal(sameTotals(coverage,good),true)
  assert.equal(sameTotals({...coverage,valid_gps_assets:10,not_eligible_bd09_assets:8},good),false)
  assert.equal(sameTotals({...coverage,eligible_bd09_assets:3,not_eligible_bd09_assets:6},good),false)
  assert.equal(sameTotals({...coverage,owner_id:10},good),false)
  assert.equal(sameTotals(coverage,{...good,derived_invalid_assets:2}),false)
  assert.equal(sameTotals(null,good),false)
})
test('Web/Mobile/Agent/Electron carry the optional cancelable Owner-only breakdown',()=>{
  const required=[
    ['web/src/api.ts','/api/v1/media/places/baidu-jsapi/coverage-reasons'],
    ['web/src/mediaGalleryAdapter.ts','api.mediaBaiduMapCoverageReasons(signal)'],
    ['ui/shared/src/mui/MediaGalleryAdapter.ts','getBaiduMapCoverageReasons'],
    ['ui/shared/src/mui/MediaGallery.tsx','getBaiduMapCoverageReasons={source.getBaiduMapCoverageReasons}'],
    ['ui/shared/src/mui/MediaGalleryPlacesMap.tsx','getReasons={getBaiduMapCoverageReasons}'],
    ['desktop/src/renderer/mediaGalleryAdapter.ts','agent.getMediaBaiduMapCoverageReasons(requestID)'],
    ['desktop/src/preload/index.cts','agent:get-media-baidu-map-coverage-reasons'],
    ['desktop/src/main/index.cts','agent:get-media-baidu-map-coverage-reasons'],
    ['desktop/src/main/agent_client.cts','/v1/media/places/baidu-coverage-reasons'],
    ['cmd/xdrive-agent/desktop_ipc.go','GET /v1/media/places/baidu-coverage-reasons'],
    ['cmd/xdrive-agent/desktop_ipc_media_baidu_map_coverage.go','CloudMediaBaiduMapCoverageReasons'],
    ['cmd/xdrive-agent/cloud_media_baidu_map_coverage.go','cli.MediaBaiduMapCoverageReasons(ctx)'],
    ['internal/client/media_baidu_map_coverage_reasons.go','/api/v1/media/places/baidu-jsapi/coverage-reasons'],
  ]
  for(const [path,needle] of required)
    assert.ok(read(path).includes(needle),path+' missing '+needle)
  const ui=read('ui/shared/src/mui/MediaGalleryMapGPSCoverage.tsx')
  assert.match(ui,/inFlight.current\?\.abort\(\)/)
  assert.match(ui,/ownerRef.current !== owner/)
  assert.match(ui,/getReasons\(controller.signal\)/)
  assert.match(ui,/coverage.not_eligible_bd09_assets > 0/)
  assert.match(ui,/if \(!needReasons \|\| !getReasons\) return/)
  assert.match(ui,/xDriveBaiduMapCoverageReasonTotalsMatch\(coverage, reasons\)/)
  assert.match(ui,/reasonPhase:!reasons \? 'unavailable' : sameTotals \? 'ready' : 'changed'/)
  assert.match(ui,/不代表这些分类都是 0 张/)
  assert.doesNotMatch(ui,/授权未生效或已撤销|授权来源已改变/)
  assert.doesNotMatch(ui,/不会自动向百度发送这些坐标/)
  assert.match(ui,/会在后台自动向百度发送当前 GPS 坐标进行转换/)
  assert.match(ui,/服务关闭或未配置时不会发送/)
  assert.match(ui,/百度地图服务启用并配置 Server AK 后会自动处理，无需逐张授权/)
  assert.match(ui,/xDriveBaiduMapCoverageReasonTotalsMatch\(coverage, reasons\)/)
  assert.doesNotMatch(read('deploy/baidu-isolated-child/child.js'),/consent_unavailable_assets/)
})
