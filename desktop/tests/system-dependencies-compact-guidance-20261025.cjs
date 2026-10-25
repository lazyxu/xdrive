'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const page = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ServiceDependenciesPage.tsx'), 'utf8')
const browser = fs.readFileSync(path.join(root, 'desktop/scripts/system-dependencies-real-chromium.cjs'), 'utf8')

test('overview capability help stays compact and retains eleven guarded contracts', () => {
  assert.match(page, /data-xdrive-system-dependencies-capability-matrix/)
  assert.match(page, /p: showCapabilityMatrix \? \{ xs: 1\.25, sm: 1\.5 \} : 0\.5/)
  assert.match(page, /aria-expanded=\{showCapabilityMatrix\}/)
  assert.match(page, /aria-controls="xdrive-system-dependency-capability-rows"/)
  assert.match(page, /\{showCapabilityMatrix && \(<>/)
  assert.match(page, /显示 11 项配置能力/)
  assert.match(page, /隐藏配置能力/)
  assert.match(page, /XDRIVE_SYSTEM_DEPENDENCY_CAPABILITIES\[item\.id\]/)
  assert.match(page, /xDriveSystemDependencyAvailableTargets\(/)
  assert.match(page, /navigateTo\(configTarget\)/)
  assert.match(page, /navigateTo\(verifyTarget\)/)
  assert.match(page, /不代表服务运行、已应用或全实例生效/)
})

test('GeoNames collapses nonessential explanations but never status or guarded operations', () => {
  assert.match(page, /data-xdrive-geonames-read-scope/)
  assert.match(page, /data-xdrive-geonames-index-guidance/)
  assert.match(page, /component="details"/)
  assert.match(page, /component="summary"/)
  assert.match(page, /不会热加载或切换数据集/)
  assert.match(page, /不证明持久目标修订、其他 Server 副本/)
  for (const key of [
    'data-xdrive-geonames-replica-status', 'data-xdrive-geonames-config-maintenance',
    'data-xdrive-geonames-dataset-snapshots', 'data-xdrive-geonames-readonly-revision',
    "currentTab === 'history' && source.loadGeoNamesRevisions",
    'geoNamesRollbackConfirmOpen && currentEditor', 'geoNamesDatasetConfirmOpen && currentEditor',
  ]) assert.ok(page.includes(key), 'GeoNames state or guarded operation missing: ' + key)
  assert.match(browser, /matrix expands all eleven service capabilities/)
  assert.match(browser, /full GeoNames evidence scope expands on demand/)
  assert.match(browser, /noOverflow\(page\)/)
  for (const forbidden of ['docker.sock', 'window.fetch(', 'adminStopHost', 'adminRestartHost'])
    assert.ok(!page.includes(forbidden), 'unsupported privilege found: ' + forbidden)
})
