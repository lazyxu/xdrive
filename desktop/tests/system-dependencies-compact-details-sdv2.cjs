'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
const snapshot = read('ui/shared/src/mui/BaiduJSAPIConfigSnapshot.tsx')
const nav = read('ui/shared/src/system-dependencies-navigation.ts')

test('SD-UX-V2 source compiles on all shared UI surfaces', () => {
  for (const [filename, value] of [
    ['ServiceDependenciesPage.tsx', page], ['BaiduJSAPIDesiredPanel.tsx', panel],
    ['BaiduJSAPIConfigSnapshot.tsx', snapshot],
  ]) {
    const out = ts.transpileModule(value, { fileName: filename, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022 } })
    assert.deepEqual((out.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
      .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
  }
})
test('one service title and four honest axes, with verbose hints only after disclosure', () => {
  const serviceRow = page.slice(page.indexOf('function ServiceRow('),
    page.indexOf('const serviceOverviewIcons'))
  assert.ok(serviceRow.startsWith('function ServiceRow('))
  assert.doesNotMatch(serviceRow, /component="h3"/)
  assert.doesNotMatch(serviceRow, /\{service.label\}/)
  assert.match(serviceRow, /data-xdrive-service-lifecycle/)
  assert.match(serviceRow, /data-xdrive-service-evidence-toggle aria-expanded=\{showLifecycleEvidence\}/)
  assert.match(serviceRow, /\{showLifecycleEvidence && \(\s*<Box data-xdrive-service-extra-evidence/)
  assert.match(serviceRow, /data-xdrive-service-config-mode/)
  assert.match(serviceRow, /service.id !== 'baidu-map'/)
  assert.match(page, /\{selectedPage === 'photo-auto' && \(\s*<Typography/)
  assert.match(page, /data-xdrive-unified-detail-intro/)
  assert.match(page, /selectedTabs\.filter\(\(tab\) => tab !== 'verify'\)/)
  for (const name of ['database','storage','background-worker','caddy','media-worker',
    'photo-face','photo-smart','photo-semantic','photo-creative','baidu-map','geonames']) {
    assert.ok(nav.includes("'"+name+"'"), 'must share rule for '+name)
  }
})
test('Server AK and signed dynamic JSAPI4 remain separate authorities', () => {
  assert.match(read('ui/shared/src/mui/BaiduServerAPIDetail.tsx'), /XDriveSensitiveField label="Server AK"/)
  assert.match(page, /<XDriveBaiduJSAPIDesiredPanel source=\{source\}/)
  assert.match(page, /mode=\{currentTab === 'verify' \? 'verify' : 'config'\}/)
  assert.doesNotMatch(page, /data-xdrive-baidu-static-unverified-hint|固定 128×128|verifyBaiduMap\(/)
  assert.equal((panel.match(/XDriveBaiduJSAPIConfigSnapshot config=/g) || []).length, 1)
  assert.match(snapshot, /detailsOpen && \(/)
  assert.match(snapshot, /data-xdrive-baidu-jsapi4-six-field-state/)
  assert.doesNotMatch(snapshot, /onChange|TextField|Switch/)
  assert.doesNotMatch(page, /window.location.reload\(\)/)
})
