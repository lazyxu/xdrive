'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = 'ui/shared/src/mui/OverviewSharedModels.ts'
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const compiled = ts.transpileModule(read(filename), {
  fileName: filename, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  mod, mod.exports, name => {
    if (name === '../background-tasks') return {
      xDriveBackgroundTaskKindLabel: kind => '后台:' + kind,
      xDriveBackgroundTaskStateLabel: state => '状态:' + state,
    }
    if (name === '../file-operations') return {
      xDriveFileOperationTypeLabel: type => '文件:' + type,
    }
    if (name === '../transfers') return {
      xDriveTransferKindLabel: kind => '传输:' + kind,
      xDriveTransferRootTasks: tasks => tasks,
    }
    throw Error('Unexpected shared activity dependency: ' + name)
  },
)
const activity = mod.exports.xDriveOverviewActivity
test('Web and Desktop get identical ordered failures without changing Owner task receipts', () => {
  const transfers = [{ kind: 'upload', file_name: 'a.jpg', error: 'offline', state: 'failed' }]
  const fileOperations = [{ type: 'copy', error: 'permission', status: 'failed' }]
  const backgroundTasks = [{ domain: 'sync_run', kind: 'source.sync', source_name: 'NAS',
    error: 'timeout', state: 'failed', updated_at: '2026-10-29T09:00:00Z' }]
  const snapshot = [transfers.slice(), fileOperations.slice(), backgroundTasks.slice()]
  const result = activity({ transfers, fileOperations, backgroundTasks })
  assert.deepEqual(result.alerts.map(x => x.key),
    ['transfer-failed', 'operation-failed', 'background-failed'])
  assert.deepEqual(result.alerts.map(x => x.title),
    ['传输失败', '文件操作失败', '同步任务失败'])
  assert.match(result.alerts[0].message, /传输:upload · a.jpg · offline/)
  assert.match(result.alerts[1].message, /文件:copy · permission/)
  assert.match(result.alerts[2].message, /后台:source.sync · NAS · timeout/)
  assert.equal(result.failedSync, true)
  assert.equal(result.runningSync, false)
  assert.deepEqual([transfers, fileOperations, backgroundTasks], snapshot)
})
test('last completed sync wins, and a partial sync remains a warning independently of queue order', () => {
  const backgroundTasks = [
    { kind: 'source.sync', source_name: 'Older', state: 'completed',
      finished_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z' },
    { kind: 'source.sync', source_name: 'Recent', state: 'partial',
      finished_at: '2026-10-29T10:00:00Z', updated_at: '2026-10-29T10:00:00Z' },
    { kind: 'unrelated', domain: 'sync_run', state: 'running' },
  ]
  const result = activity({ transfers: [], fileOperations: [], backgroundTasks })
  assert.equal(result.failedSync, true)
  assert.equal(result.runningSync, true)
  assert.ok(result.recentActivity.startsWith('后台:source.sync · Recent · 状态:partial'))
  assert.equal(result.alerts.length, 0)
})
test('both rendered Homes share activity while Desktop keeps native-only disk and conflict warnings', () => {
  const web = read('web/src/WebOverviewPage.tsx')
  const desktop = read('ui/shared/src/mui/OverviewPage.tsx')
  assert.match(web, /xDriveOverviewActivity\(\{/)
  assert.match(desktop, /xDriveOverviewActivity\(\{/)
  assert.match(desktop, /alerts\.push\(\.\.\.activityAlerts\)/)
  assert.match(desktop, /title: '本地磁盘空间不足'/)
  assert.match(desktop, /title: '有冲突需要处理'/)
  assert.match(web, /failedSync \? '需要处理' : runningSync \? '同步中' : '正常'/)
  assert.match(web, /xDriveCreateOverviewDisposableReadScope/)
})
