'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
const server = read('ui/shared/src/mui/BaiduServerAPIDetail.tsx')
const jsapi = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')

test('Server API is one always-open page, never the legacy config Accordion', () => {
  assert.match(page, /selectedPage === 'baidu-map' && selectedItem \? \(/)
  assert.match(page, /<XDriveBaiduServerAPIDetail/)
  assert.match(server, /data-xdrive-baidu-server-flat="true"/)
  assert.match(server, /dependency-baidu-map-status-header/)
  assert.match(server, /dependency-baidu-map-config-header/)
  assert.doesNotMatch(server, /Accordion|expandedSections|Collapse|setShowDetails/)
  assert.doesNotMatch(page, /selectedPage === 'baidu-map' && currentTab === 'config' &&/)
  assert.match(page, /pageActions=\{selectedPage !== 'overview' \? null : \(/)
  assert.match(server, /data-xdrive-baidu-server-refresh/)
  assert.match(server, /disabled=\{checking \|\| hasUnsavedEdits \|\| clearOpen\}/)
  assert.match(page, /setRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(page, /void source\.loadBaiduMapConfig\(\)\.then\(\(next\) =>/)
})

test('Server AK identity and Browser AK release authority remain separate', () => {
  assert.match(server, /XDriveSensitiveField label="Server AK"/)
  assert.match(server, /Browser AK/)
  assert.match(page, /<XDriveBaiduJSAPIDesiredPanel source=\{source\}/)
  assert.match(page, /mode="all"/)
  assert.match(page, /onDirtyChange=\{setBaiduJSAPIDirty\}/)
  assert.match(jsapi, /dependency-baidu-map-verify-header/)
  assert.doesNotMatch(page, /JSAPI 配置<\/Button>|JSAPI 检测<\/Button>/)
  assert.match(jsapi, /source\.saveBaiduJSAPIConfig\(/)
  assert.doesNotMatch(server, /verifyBaiduJSAPI4Loader|Browser AK.*onReveal|static.map|verifyBaiduMap\(/)
  assert.match(server, /不证明百度上游已接受 AK/)
  assert.match(server, /service\.health_state === 'failed' \|\| service\.status === 'unavailable'/)
  assert.doesNotMatch(server, /静态地图|Static Map/)
})

test('Server AK Save, masked reveal and explicit clear preserve privileges and CAS', () => {
  assert.match(page, /source\.saveBaiduMapConfig\(\{/)
  assert.match(page, /revision: baiduConfig\.revision/)
  assert.match(page, /if \(!baiduConfig\?\.editable/)
  assert.match(page, /const epoch = \+\+baiduConfigEpochRef\.current/)
  assert.match(page, /\+\+revealEpochRef\.current/)
  assert.match(page, /\+\+baiduConfigEpochRef\.current/)
  assert.match(page, /setClearConfirmOpen\(false\)/)
  assert.match(page, /setBaiduBusy\(false\)/)
  assert.match(page, /window\.setTimeout\(hideBaiduAK, seconds \* 1000\)/)
  assert.match(server, /onReveal=\{onRevealAK\} onHide=\{onHideAK\}/)
  assert.match(server, /onClearRequest/)
  assert.match(server, /<XDriveConfirmDialog open=\{clearOpen\}/)
  assert.match(server, /confirmIntent="danger"/)
  assert.match(server, /clearOpen\}\s+title="确认清除 Server API AK"/)
  assert.match(page, /onClearConfirm=\{\(\) => \{ void applyBaiduMap\(true\) \}\}/)
  assert.match(page, /草稿已保留，请核对配置，勿盲目重试/)
  assert.doesNotMatch(page, /setBaiduError\(err instanceof Error \? err\.message/)
})

test('Readonly refresh cannot overwrite edits or conflate post-save inventory failure with Save failure', () => {
  assert.match(page, /if \(baiduReadBusy \|\| baiduBusy \|\| refreshing \|\| hasUnsavedEdits \|\| revealingAK \|\| runtimeBusy\) return/)
  assert.match(page, /if \(epoch !== baiduConfigEpochRef\.current\) return/)
  assert.match(page, /const refreshBaiduServerAPI = \(\) =>/)
  assert.match(page, /const discardBaiduDraft = \(\) =>/)
  assert.match(page, /cachedSnapshotRef\.current = status/)
  assert.match(page, /if \(saved && epoch === baiduConfigEpochRef\.current\)/)
  assert.match(page, /配置已保存；当前服务状态重新检测失败/)
  assert.match(page, /\+\+baiduConfigEpochRef\.current/)
  assert.match(server, /当前无法确认已保存的 Server AK/)
  assert.match(server, /canReadConfig/)
  assert.doesNotMatch(server, /startBaidu|restartHost|docker\.sock|_BMapSecurityConfig/)
})

test('Web, Mobile Web and Desktop share parseable components and preserve original JSAPI', () => {
  for(const file of [
    'ui/shared/src/mui/ServiceDependenciesPage.tsx',
    'ui/shared/src/mui/BaiduServerAPIDetail.tsx',
    'ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx',
  ]) {
    const compiled = ts.transpileModule(read(file), {
      fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022 },
    })
    const failures=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error)
    assert.deepEqual(failures.map(d=>ts.flattenDiagnosticMessageText(d.messageText, '\n')),[])
  }
})
