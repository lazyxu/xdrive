'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const parent = () => read('ui/shared/src/mui/ServiceDependenciesPage.tsx')
const detail = () => read('ui/shared/src/mui/CoreDependencyDetail.tsx')
const db = () => read('ui/shared/src/mui/PostgresPoolConfigPanel.tsx')
const worker = () => read('ui/shared/src/mui/SourceWorkerConfigPanel.tsx')

test('PG, storage and Worker share a flat all-expanded detail without new backend operations', () => {
  const page = parent(), core = detail()
  assert.match(page, /<XDriveCoreDependencyDetail/)
  assert.match(page, /\['database', 'storage', 'background-worker'\]\.includes\(selectedPage\)/)
  assert.match(page, /selectedPage === 'baidu-map' && selectedItem \? \(/)
  assert.match(page, /<XDriveBaiduServerAPIDetail/)
  assert.match(core, /data-xdrive-core-dependency-flat/)
  assert.doesNotMatch(core, /Accordion|collapse|showHistory|setHistoryOpen/)
  assert.match(core, /id=\{`dependency-\$\{service\.id\}-config-header`\}/)
  assert.match(core, /section="all" singlePage onDirtyChange=\{onDirtyChange\}/)
  assert.match(core, /service\.id === 'database'/)
  assert.match(core, /const isStorage = service\.id === 'storage'/)
  assert.doesNotMatch(core, /startPostgres|startStorage|restartWorker|docker\.sock|applyStorage/)
})

test('one refresh rereads inventory plus local config, but cannot destroy dirty or saving edits', () => {
  const page = parent(), core = detail(), pg = db(), wk = worker()
  assert.match(page, /pageActions=\{selectedPage !== 'overview' \? null : \(/)
  assert.match(core, /const controlsLocked = refreshing \|\| hasUnsavedEdits \|\| editorBusy/)
  assert.match(core, /if \(controlsLocked\) return/)
  assert.match(core, /setConfigRefreshID\(\(id\) => id \+ 1\)/)
  assert.match(core, /onRefreshStatus\(\)/)
  assert.match(pg, /singlePage && isDraftDirty/)
  assert.match(wk, /singlePage && isDraftDirty/)
  assert.match(pg, /onBusyChange\?\.\(busy \|\| loading\)/)
  assert.match(wk, /onBusyChange\?\.\(busy \|\| loading\)/)
  assert.match(pg, /onClick=\{\(\) => setDraft\(asDraft\(config\.desired\)\)\}/)
  assert.match(wk, /onClick=\{\(\) => setDraft\(valuesToDraft\(config\.desired\)\)\}/)
})

test('PostgreSQL live pool Save and Worker safe-boundary Save retain revision CAS and audit rollback', () => {
  const pg = db(), wk = worker()
  assert.match(pg, /source\.savePostgresPoolConfig\(\{ revision: config\.revision, desired \}\)/)
  assert.match(wk, /source\.saveSourceWorkerConfig\(\{ revision: config\.revision, desired \}\)/)
  assert.match(pg, /rollbackPostgresPool\(\{ revision: config\.revision, target_revision: historic\.revision \}\)/)
  assert.match(wk, /target_revision: targetRevision\.revision/)
  assert.match(pg, /<XDriveConfirmDialog open=\{confirmRollback\}/)
  assert.match(wk, /<XDriveConfirmDialog open=\{confirmRollback\}/)
  assert.match(pg, /isDraftDirty \|\| historyLoading/)
  assert.match(wk, /isDraftDirty \|\| historyLoading/)
  assert.match(pg, /section === 'history' \|\| section === 'all'/)
  assert.match(wk, /section === 'history' \|\| section === 'all'/)
  assert.match(pg, /单独核验|另行核验/)
  assert.match(wk, /已观测在线 Worker/)
})

test('storage remains a bounded readonly readiness check, not a filesystem write', () => {
  const core = detail()
  assert.match(core, /仅检查当前 Server 的存储后端是否就绪/)
  assert.match(core, /不执行文件读写、迁移、恢复或清理/)
  assert.match(core, /service\.health_state === 'ready'/)
  assert.match(core, /xDriveDashboardAssessment\(service\)/)
  assert.match(core, /xDriveSystemDependencyOverviewSignals\(service\)/)
  assert.match(core, /assessment.state !== 'healthy' && service.detail/)
  assert.match(core, /data-xdrive-core-status-reason/)
  assert.match(core, /id=\{`dependency-\$\{service\.id\}-verify-header`\}/)
  assert.match(core, /onRefreshStatus\(\)/)
})

test('shared TSX for Web/Mobile/Desktop remains parseable', () => {
  for (const file of [
    'ui/shared/src/mui/ServiceDependenciesPage.tsx',
    'ui/shared/src/mui/CoreDependencyDetail.tsx',
    'ui/shared/src/mui/PostgresPoolConfigPanel.tsx',
    'ui/shared/src/mui/SourceWorkerConfigPanel.tsx',
  ]) {
    const out = ts.transpileModule(read(file), {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext },
    })
    assert.equal((out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length,
      0, 'TSX parse error in ' + file)
  }
})
