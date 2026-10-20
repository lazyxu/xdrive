'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

test('SD-UX-V1 shared page preserves typed React source, one default detail section and on-demand evidence', () => {
  const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  const compiled = ts.transpileModule(page, {
    fileName: 'ServiceDependenciesPage.tsx', reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 },
  })
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  assert.match(page, /sectionTab === \(currentTab === 'verify' \? 'status' : currentTab\)/)
  assert.doesNotMatch(page, /sectionTab === 'status' \|\| sectionTab === 'config' \|\|/)
  assert.match(page, /data-xdrive-service-lifecycle/)
  assert.match(page, /data-xdrive-service-evidence-toggle aria-expanded=\{showLifecycleEvidence\}/)
  assert.match(page, /showLifecycleEvidence && \(/)
  assert.match(page, /data-xdrive-baidu-static-unverified-hint/)
  assert.match(page, /data-xdrive-unified-detail-intro/)
  assert.match(page, /unsavedRef\.current/)
  assert.match(page, /onClick=\{\(\) => \{ void verifyBaiduMap\(\) \}\}/)
  assert.match(page, /XDriveBaiduJSAPIDesiredPanel source=\{source\} mode=\{currentTab\}/)
})

test('Baidu six authoritative Server fields are technical disclosure only in Verify, not a duplicate in Config', () => {
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const state = read('ui/shared/src/mui/BaiduJSAPIConfigSnapshot.tsx')
  const server = read('internal/api/baidu_jsapi_config.go')
  for (const [name, code] of [['BaiduJSAPIDesiredPanel.tsx',panel],['BaiduJSAPIConfigSnapshot.tsx',state]]) {
    const result=ts.transpileModule(code,{fileName:name,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,
        target:ts.ScriptTarget.ES2022}})
    assert.deepEqual((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
      .map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
  }
  assert.match(panel, /config && mode === 'verify' && \(/)
  assert.match(panel, /config && mode === 'config' \? \(/)
  assert.match(panel, /XDriveBaiduJSAPIConfigSnapshot config=\{config\}/)
  assert.equal((panel.match(/XDriveBaiduJSAPIConfigSnapshot config=/g)||[]).length, 1)
  assert.match(state, /data-xdrive-baidu-jsapi4-technical-toggle aria-expanded=\{detailsOpen\}/)
  assert.match(state, /detailsOpen && \(/)
  assert.match(state, /data-xdrive-baidu-jsapi4-six-field-state/)
  for (const field of ['configured','desired_enabled','runtime_enabled',
    'activation_state','release_blockers','requires_restart']) {
    assert.match(state,new RegExp("key: '"+field+"'"))
    assert.match(server,new RegExp('json:"'+field+'"'))
  }
  assert.match(state, /Server 实际状态/)
  assert.doesNotMatch(state, /onChange|TextField|Switch|browser_ak\s*:/)
  assert.match(panel, /type="password"/)
  assert.match(panel, /if \(busy \|\| refreshing \|\| dirty/)
  assert.match(panel, /data-xdrive-baidu-jsapi4-live-probe/)
  assert.doesNotMatch(panel, /fetch\(|window\._BMapSecurityConfig|\.src\s*=/)
})

test('one real shared UI applies to Web/Mobile Web and Desktop without extra admin route', () => {
  const web=read('web/src/App.tsx')
  const desktop=read('desktop/src/renderer/App.tsx')
  const page=read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(web, /XDriveServiceDependenciesPage/)
  assert.match(desktop, /XDriveServiceDependenciesPage/)
  assert.match(page, /XDriveBaiduJSAPIDesiredPanel/)
  assert.match(page, /XDriveStoredCredentialField/)
  assert.doesNotMatch(page, /docker\.sock/)
})

test('A3h thumbnail cluster markers are a pending explicit P0, not already-delivered numeric circles', () => {
  const roadmap=read('docs/gallery-places-ios27-roadmap.md')
  const rules=read('AGENTS.md')
  const native=read('ui/shared/src/media-gallery-baidu-jsapi4-cells.ts')
  assert.match(roadmap, /P0-Places-A3h/)
  assert.match(roadmap, /明确未完成/)
  assert.match(roadmap, /一张真实代表封面/)
  assert.match(roadmap, /100k PhotoAssets\/GPS/)
  assert.match(rules, /SD-UX-V1/)
  assert.match(rules, /P0-Places-A3h/)
  assert.match(native, /new this\.ns\.Label\(cell\.photo_count\.toLocaleString/)
})
