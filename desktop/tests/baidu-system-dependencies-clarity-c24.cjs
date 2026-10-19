'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const parent = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
const jsapi = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')

for (const [name, source] of [['ServiceDependenciesPage.tsx', parent], ['BaiduJSAPIDesiredPanel.tsx', jsapi]]) {
  test('Baidu diagnostics preserve parsable original React TypeScript: '+name, () => {
    const result = ts.transpileModule(source, { fileName: name, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022 } })
    const errors = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'))
  })
}

test('Static Map config editing and authenticated online evidence are distinct in the shared panel', () => {
  assert.match(parent, /currentTab === 'config' \? '百度地图 Server AK' : '静态地图 · 在线生效验证'/)
  assert.match(parent, /currentTab === 'config' && baiduConfig && \(/)
  assert.match(parent, /data-xdrive-baidu-static-unverified-hint/)
  assert.match(parent, /service\.id === 'baidu-map' && service\.status === 'unknown'/)
  assert.match(parent, /service\.health_state === 'not-checked'/)
  assert.match(parent, /label: '待人工在线验证'/)
  assert.match(parent, /验证当前 AK 在线生效/)
  assert.match(parent, /消耗一次 API 配额/)
  assert.match(parent, /currentTab === 'verify' && \(/)
  assert.match(parent, /currentTab === 'config' && baiduConfig && \(\s*<XDriveStoredCredentialField/)
  assert.doesNotMatch(parent, /currentTab === 'verify' && baiduConfig && \(\s*<XDriveStoredCredentialField/)
})

test('JSAPI Browser AK configuration is separate from signed production release evidence', () => {
  assert.match(jsapi, /mode === 'config' \? '百度 JSAPI 4\.0 · Browser AK' : '动态地图 · Server 发布授权'/)
  assert.match(jsapi, /config && mode === 'config'/)
  assert.match(jsapi, /data-xdrive-baidu-jsapi4-release-state/)
  assert.match(jsapi, /data-xdrive-baidu-jsapi4-release-blockers/)
  assert.match(jsapi, /config\.release_blockers\.map\(reason =>/)
  assert.match(jsapi, /data-xdrive-baidu-jsapi4-missing-blocker-evidence/)
  assert.match(jsapi, /不需要再次填写已保存的 AK/)
  assert.match(jsapi, /未放行时不会试探加载脚本/)
  assert.doesNotMatch(jsapi, /fetch\(|window\._BMapSecurityConfig|_BMapService\/api\?v=4\.0/)
  assert.match(read('internal/api/baidu_jsapi_config.go'),
    /ReleaseBlockers:\s+s\.baiduJSAPI4ReleaseBlockers\(cfg, approved\)/)
  assert.match(read('internal/baidumapjsapi/resource_policy.go'), /reviewedJSAPI4ChildResourceCount = 0/)
  assert.match(read('internal/baidumapjsapi/release_attestation.go'), /jsapi4PinnedProductionPublicKey = ""/)
})
