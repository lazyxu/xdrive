'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Shared workspace route outlet owns authenticated Host sync notices', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const route = read('ui/shared/src/mui/XDriveAppRouteContent.tsx')
  const adapter = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
  const shared = read('ui/shared/src/mui/WorkspaceHostAlerts.tsx')
  const exports = read('ui/shared/src/mui/index.tsx')

  assert.match(desktop, /workspaceAlerts:\s*\{/)
  assert.match(adapter, /readonly workspaceAlerts\?: Omit<XDriveWorkspaceHostAlertsProps, 'view'>/)
  assert.match(route, /host\.services\?\.workspaceAlerts/)
  assert.match(route, /<XDriveWorkspaceHostAlerts\b/)
  assert.match(exports, /export \* from '\.\/WorkspaceHostAlerts'/)
  assert.doesNotMatch(desktop, /<XDriveWorkspaceHostAlerts\b/,
    'Desktop must only provide the state/operation port, not route-adjacent JSX')
  assert.match(desktop, /lastError: status\?\.last_error/)
  assert.match(desktop, /paused: status\?\.paused/)
  assert.match(desktop, /hasConflicts: status\?\.has_conflict/)
  assert.match(desktop, /conflictCount: status\?\.conflict_count/)
  assert.match(shared, /if \(!lastError && !paused && !hasConflicts\) return null/)
  assert.match(shared, /view === 'files' \? 1\.5 : 2/)
  assert.doesNotMatch(desktop, /\{\(status\?\.last_error \|\| status\?\.paused \|\| status\?\.has_conflict\) \? \(/)
})

test('Shared Host notices never fabricate native actions', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const shared = read('ui/shared/src/mui/WorkspaceHostAlerts.tsx')
  for (const action of ['onOpenDiagnostics', 'onResumeSync', 'onOpenConflicts']) {
    assert.match(shared, new RegExp('action=\\{' + action + ' \\? \\('))
    assert.match(desktop, new RegExp(action + ':\\s*'))
  }
  assert.match(desktop, /onResumeSync: \(\) => void run\('pause'/)
  assert.match(desktop, /window\.xdriveDesktop\.agent\.setPaused\(false\)/)
  assert.match(shared, /disabled=\{resumeDisabled\}/)
  assert.match(shared, /恢复同步/)
  assert.match(shared, /处理冲突/)
  assert.match(shared, /运行诊断/)
  assert.doesNotMatch(shared, /window\.|document\.|fetch\s*\(|\.setPaused\(|backup\.cgi/,
    'Host-neutral notices may not use Electron, DSM or Browser transport')
})
