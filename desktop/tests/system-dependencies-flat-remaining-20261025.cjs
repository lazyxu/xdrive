'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const page = read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
const nav = read('ui/shared/src/system-dependencies-navigation.ts')

test('six outstanding service details and global photo policy are flattened in shared TSX', () => {
  const out = ts.transpileModule(page, {fileName:'ServiceDependenciesPage.tsx',reportDiagnostics:true,
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((out.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error)
    .map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')),[])
  assert.match(page, /data-xdrive-flat-dependency-section=\{sectionTab\}/)
  assert.match(page, /data-xdrive-flat-dependency-toolbar/)
  assert.match(page, /\{\(\[sectionTab,/)
  assert.match(page, /!\['media-worker', 'photo-face'\]\.includes\(selectedPage\) \|\| tab === 'status'/)
  assert.doesNotMatch(page, /<Accordion|expandedSections|expandDependencySection|data-xdrive-unified-verify-toggle/)
  for (const id of ['media-worker','photo-face','photo-smart','photo-semantic','photo-creative','geonames']) {
    assert.match(nav, new RegExp("'"+id+"'"))
  }
  assert.match(page, /selectedPage === 'photo-auto'/)
})

test('one read-only status refresh, sticky drafts, deep links, explicit mutating operations', () => {
  assert.match(page, /pageActions=\{selectedPage !== 'overview' \? null : \(/)
  assert.match(page, /data-xdrive-flat-dependency-refresh=\{selectedPage\}/)
  assert.match(page, /disabled=\{loading \|\| refreshing \|\| unsavedRef\.current \|\| geoNamesBusy \|\| photoPolicyBusy \|\| runtimeBusy\}/)
  assert.match(page, /setRefreshID\(\(value\) => value \+ 1\)/)
  assert.match(page, /selectedPage === 'geonames'\) void refreshGeoNamesReadOnly\(\)/)
  assert.match(page, /selectedPage === 'photo-auto'\) void refreshPhotoPolicyReadOnly\(\)/)
  assert.match(page, /if \(!source\.loadGeoNamesConfig \|\| geoNamesBusy \|\| unsavedRef\.current\) return/)
  assert.match(page, /if \(!source\.loadPhotoAutoConfig \|\| photoPolicyBusy \|\| unsavedRef\.current\) return/)
  assert.match(page, /data-xdrive-geonames-readonly-revision/)
  assert.match(page, /onClick=\{\(\) => \{ void reloadGeoNames\(\) \}\}/)
  assert.match(page, /open=\{geoNamesDatasetConfirmOpen && currentEditor\}/)
  assert.match(page, /open=\{geoNamesRollbackConfirmOpen && currentEditor\}/)
  assert.match(page, /currentTab === 'history' && hasUnsavedEdits/)
  assert.match(page, /document\.getElementById\(`dependency-\$\{selectedPage\}-\$\{next\.tab\}-header`\)/)
})

test('manual model probe and trusted host configuration remain distinct', () => {
  assert.equal((page.match(/<XDrivePhotoHostDesiredPanel source=/g)||[]).length,1)
  assert.match(page, /section=\{selectedPage === 'photo-face' \? 'all' : 'verify'\}/)
  assert.match(page, /onDirtyChange=\{selectedPage === 'photo-face' \? setChildDirty : undefined\}/)
  assert.match(page, /<XDriveMediaWorkerConfigPanel source=\{source\} refreshID=\{refreshID\}/)
  const host = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  assert.match(host, /section !== 'verify' && section !== 'all'/)
  assert.match(host, /source\.loadPhotoHostPreflight\(\)/)
})

test('only one mutable Media/Photo Host panel instance per selected service', () => {
  assert.equal((page.match(/<XDriveMediaWorkerConfigPanel source=/g) || []).length, 1)
  assert.equal((page.match(/<XDrivePhotoHostDesiredPanel source=/g) || []).length, 1)
  assert.match(page, /selectedPage === 'media-worker' && currentTab === 'status'/)
  assert.match(page, /selectedPage === 'photo-face' && currentTab === 'status'/)
  assert.match(page, /section="all" onDirtyChange=\{setChildDirty\} onBusyChange=\{setRuntimeBusy\}/)
  assert.match(page, /onBusyChange=\{selectedPage === 'photo-face' \? setRuntimeBusy : undefined\}/)
  assert.match(page, /runtimeBusy\) return/)
  for (const file of ['MediaWorkerConfigPanel.tsx','PhotoHostDesiredPanel.tsx']) {
    const body = read('ui/shared/src/mui/'+file)
    assert.match(body, /section === 'history' \|\| section === 'all'/)
    assert.match(body, /onBusyChange\?\.\(loading \|\| busy/)
    assert.match(body, /return \(\) => onDirtyChange\?\.\(false\)/)
    assert.match(body, /\|\| busy \|\| dirty\) return/)
  }
  assert.match(read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx'), /dependency-media-worker-config-header/)
  assert.match(read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx'), /dependency-media-worker-history-header/)
  assert.match(read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx'), /dependency-photo-face-config-header/)
  assert.match(read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx'), /dependency-photo-face-history-header/)
})

test('media and photo host sections do not repeat verbose status in config and history', () => {
  const media = read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx')
  const photo = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  for (const [name, value] of [['MediaWorkerConfigPanel.tsx', media], ['PhotoHostDesiredPanel.tsx', photo]]) {
    const out = ts.transpileModule(value, {fileName:name,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
    assert.deepEqual((out.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error)
      .map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\\n')),[])
    assert.match(value, /\(section === 'verify' \|\| section === 'all'\) && \(<\>/)
    assert.match(value, /\(section === 'config' \|\| section === 'all'\) && \(/)
    assert.match(value, /\(section === 'history' \|\| section === 'all'\) &&/)
  }
  assert.match(media, /section === 'verify' && \(\s*<Button[^>]+disabled=/)
  assert.match(photo, /section === 'verify' && \(\s*<Button[^>]+onClick=/)
  assert.match(photo, /\(section === 'config' \|\| section === 'all'\) && \(\s*<XDriveStatusAlert/)
})

test('readonly refresh keeps accepted runtime config and never silently reapplies GeoNames data', () => {
  for (const name of ['MediaWorkerConfigPanel.tsx','PhotoHostDesiredPanel.tsx']) {
    const body=read('ui/shared/src/mui/'+name)
    assert.match(body, /const sourceChanged = configSourceRef\.current !== source/)
    assert.match(body, /if \(sourceChanged\) \{/)
    assert.match(body, /setConfig\(null\)/)
    assert.match(body, /\[source, (?:refreshID, section|section, refreshID)\]/)
  }
  assert.match(page, /currentTab === 'config' && <Stack spacing=\{1\.5\}\s+data-xdrive-geonames-config-maintenance/)
  assert.match(page, /data-xdrive-geonames-dataset-snapshots/)
  assert.match(page, /data-xdrive-geonames-readonly-revision/)
  assert.match(page, /const refreshGeoNamesReadOnly = async/)
  assert.match(page, /const reloadGeoNames = async/)
  assert.match(page, /onClick=\{\(\) => \{ void reloadGeoNames\(\) \}\}/)
})

test('Media Worker locally invalid values never enter a remotely uncertain Save', () => {
  const media = read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx')
  const save = media.slice(media.indexOf('  const save = async () => {'),
    media.indexOf('  const apply = async () => {'))
  const write = save.indexOf('source.saveMediaWorkerConfig({')
  const busy = save.indexOf('setBusy(true)')
  assert.ok(write > busy)
  for (const value of ['memory', 'cpu', 'pids']) {
    const guard = save.indexOf(`if (${value} === null)`)
    assert.ok(guard >= 0 && guard < busy,
      'all locally invalid values must exit before any write is in flight')
  }
  assert.equal((save.match(/throw new Error\('Worker /g) || []).length, 0)
  assert.match(save, /setError\('Worker 内存限额必须/)
  assert.match(save, /setError\('Worker CPU 限额必须/)
  assert.match(save, /setError\('Worker PID 上限必须/)
})


test('switching admin source masks former service notices and confirmation dialogs before effects run', () => {
  const photo = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const media = read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx')
  for (const source of [photo, media]) {
    assert.match(source, /const config = configOwner === source \? configState : null/)
    assert.match(source, /configSourceRef\.current === source && error/)
    assert.match(source, /configSourceRef\.current === source && notice/)
  }
  for (const name of ['confirmSave', 'confirmApply', 'confirmRollback'])
    assert.ok(photo.includes(`open={${name} && config !== null}`))
})

test('legacy verification links land on actual mounted runtime evidence', () => {
  const photo=read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const media=read('ui/shared/src/mui/MediaWorkerConfigPanel.tsx')
  const source=read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
  assert.match(photo, /dependency-photo-face-runtime-verify-header/)
  assert.match(media, /dependency-media-worker-runtime-verify-header/)
  assert.equal((source.match(/dependency-\$\{selectedPage\}-runtime-verify-header/g) || []).length, 2)
  assert.match(source, /next\.tab === 'verify' &&/)
  assert.match(source, /currentTab === 'verify' &&/)
  assert.match(source, /runtimeAnchor \?\? document\.getElementById/)
  assert.match(source, /dependency-\$\{selectedPage\}-\$\{currentTab\}-header/)
  assert.match(source, /dependency-\$\{selectedPage\}-\$\{next\.tab\}-header/)
})

test('generic deep links scroll once per selection and never steal focus after Save', () => {
  assert.match(page, /const lastAutoScrollRef = useRef</)
  assert.match(page, /lastAutoScrollRef\.current\?\.source === source/)
  assert.match(page, /lastAutoScrollRef\.current\.key === anchorKey/)
  assert.match(page, /lastAutoScrollRef\.current = \{ source, key: anchorKey \}/)
  assert.match(page, /if \(!target\) return/)
  assert.match(page, /\['caddy', 'database', 'storage', 'background-worker'\]\.includes\(selectedPage\)/)
  assert.match(page, /runtimeBusy\) return/)
})

test('Baidu JSAPI4 stays fully expanded with separately authorized Browser AK', () => {
  const jsapi = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const server = read('ui/shared/src/mui/BaiduServerAPIDetail.tsx')
  assert.equal((page.match(/<XDriveBaiduJSAPIDesiredPanel source=/g) || []).length, 1)
  assert.match(page, /mode="all"/)
  assert.match(jsapi, /mode: 'config' \| 'verify' \| 'all'/)
  assert.match(jsapi, /data-xdrive-baidu-jsapi4-flat-verify/)
  assert.match(jsapi, /dependency-baidu-map-verify-header/)
  assert.match(jsapi, /configOwner === source \? configState : null/)
  assert.match(jsapi, /xDriveCoreDependencyErrorMessage\(err, 'baidu-jsapi', 'save'\)/)
  assert.match(jsapi, /shownAK\?\.field === 'browser_ak'/)
  assert.match(jsapi, /window\.setTimeout\(hideAK, seconds \* 1000\)/)
  assert.match(jsapi, /<XDriveConfirmDialog open=\{confirmClear && config !== null\}/)
  assert.match(jsapi, /verifyBaiduJSAPI4Loader/)
  assert.match(server, /XDriveSensitiveField label="Server AK"/)
  assert.doesNotMatch(page, /JSAPI 配置<\/Button>|JSAPI 检测<\/Button>/)
  assert.doesNotMatch(jsapi, /<Accordion|<Collapse/)
})

test('legacy Baidu deep links expose signed release evidence instead of remounting the Browser AK editor', () => {
  const jsapi = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const compact = read('desktop/tests/system-dependencies-compact-details-sdv2.cjs')
  assert.match(page, /mode="all"/)
  assert.match(compact, /mode="all"/)
  assert.match(jsapi, /id="dependency-baidu-map-verify-header"/)
  assert.match(jsapi, /Server 签名发布、运行状态与手动 Loader 检测/)
  assert.match(jsapi, /config && mode !== 'verify'/)
  assert.match(jsapi, /mode !== 'config' &&/)
  assert.match(jsapi, /请查看下方签名发布与检测状态中的阻断原因/)
})

test('GeoNames and Photo Auto do not duplicate runtime summaries into config/history', () => {
  assert.match(page, /\{currentTab === 'verify' && <>\s*<Typography variant="subtitle2" fontWeight=\{700\}>GeoNames 地名索引/)
  assert.match(page, /\{currentTab === 'config' && <>\s*<Typography variant="subtitle2" fontWeight=\{700\}>全局自动分析调度/)
  for (const label of ['data-xdrive-geonames-replica-status', 'data-xdrive-geonames-readonly-revision',
    'data-xdrive-geonames-config-maintenance', 'data-xdrive-geonames-dataset-snapshots'])
    assert.ok(page.includes(label))
  assert.match(page, /currentTab === 'history' && source.loadGeoNamesRevisions/)
})
test('active source and service fence Baidu, GeoNames and photo policy before React effects run', () => {
  for (const [state,owner,key] of [
    ['baiduConfigState', 'baiduConfigOwner', 'baiduConfig'],
    ['geoNamesConfigState', 'geoNamesConfigOwner', 'geoNamesConfig'],
    ['photoPolicyState', 'photoPolicyOwner', 'photoPolicy']
  ]) {
    assert.ok(page.includes(state))
    assert.ok(page.includes(key+' = '+owner+'?.source === source && '+owner+'.page === selectedPage'))
  }
  assert.match(page, /const currentEditor = editorIdentityRef\.current\.source === source &&/)
  assert.match(page, /clearOpen=\{clearConfirmOpen && currentEditor\}/)
  assert.match(page, /open=\{photoRollbackConfirmOpen && currentEditor\}/)
  assert.match(page, /open=\{geoNamesDatasetConfirmOpen && currentEditor\}/)
  assert.match(page, /geoNamesRevisions = geoNamesConfigOwner\?\.source === source/)
  assert.match(page, /photoRevisions = photoPolicyOwner\?\.source === source/)
})
test('JSAPI disallows no-op Save and concurrent Loader checks', () => {
  const panel = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  assert.match(panel, /activeSourceRef\.current === source && error/)
  assert.match(panel, /\(clearAK \? !config\.configured : !dirty\)/)
  assert.match(panel, /disabled=\{busy \|\| refreshing \|\| probeBusy \|\| revealingAK \|\| !dirty\}/)
  assert.match(panel, /probeBusy \|\| busy \|\| refreshing \|\| revealingAK \|\| dirty/)
  assert.match(panel, /setProbeResult\(null\)\s*setProbeError\(''\)/)
})

test('one Baidu status refresh updates Server API and JSAPI without discarding drafts', () => {
  const jsapi = read('ui/shared/src/mui/BaiduJSAPIDesiredPanel.tsx')
  const snap = read('ui/shared/src/mui/BaiduJSAPIConfigSnapshot.tsx')
  const server = read('ui/shared/src/mui/BaiduServerAPIDetail.tsx')
  assert.match(page, /onRefreshStatus=\{refreshBaiduServerAPI\}/)
  assert.match(page, /mode="all" refreshID=\{refreshID\}/)
  assert.match(page, /onBusyChange=\{setRuntimeBusy\}/)
  assert.match(page, /otherBusy=\{runtimeBusy\}/)
  assert.match(page, /hasUnsavedEdits \|\| revealingAK \|\| runtimeBusy\) return/)
  assert.match(jsapi, /refreshID = 0/)
  assert.match(jsapi, /\[source, refreshID, hideAK\]/)
  assert.match(jsapi, /const sourceChanged = loadedSourceRef\.current !== source/)
  assert.match(jsapi, /if \(sourceChanged\) \{/)
  assert.match(jsapi, /setConfigOwner\(null\)/)
  assert.match(jsapi, /onBusyChange\?\.\(reading \|\| refreshing \|\| busy \|\| probeBusy \|\| revealingAK\)/)
  assert.match(jsapi, /showRefresh=\{mode !== 'all'\}/)
  assert.match(snap, /showRefresh && \(/)
  assert.match(jsapi, /重新检测 Browser AK 状态失败；保留上次成功读取的配置/)
  assert.match(server, /const checking = loading \|\| refreshing \|\| busy \|\| otherBusy \|\| revealingAK/)
})

test('Photo Host Save refreshes history only in the mounted all-page editor', () => {
  const host = read('ui/shared/src/mui/PhotoHostDesiredPanel.tsx')
  const save = host.slice(host.indexOf('  const save = async () => {'),
    host.indexOf('  const applyHost = async () => {'))
  assert.match(save, /if \(section === 'all' && source\.loadPhotoHostRevisions\)/)
  assert.doesNotMatch(save, /section === 'history'/,
    'Save is only reachable from config/all; history-only is a separate readonly view')
  assert.match(save, /const updated = await source\.loadPhotoHostRevisions\(\)\.catch\(\(\) => null\)/)
  assert.match(save, /setNotice\('期望启停修订已保存并审计/)
  assert.match(save, /setHistoryError\('配置已保存，历史读取暂不可用/)
});
