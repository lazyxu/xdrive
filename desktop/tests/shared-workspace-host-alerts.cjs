'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Desktop workspace sync notices render from the shared Host-neutral app layer', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const shared = read('ui/shared/src/mui/WorkspaceHostAlerts.tsx')
  const exports = read('ui/shared/src/mui/index.tsx')

  assert.match(desktop, /<XDriveWorkspaceHostAlerts\b/)
  assert.match(exports, /export \* from '\.\/WorkspaceHostAlerts'/)
  assert.match(desktop, /lastError=\{status\?\.last_error\}/)
  assert.match(desktop, /paused=\{status\?\.paused\}/)
  assert.match(desktop, /hasConflicts=\{status\?\.has_conflict\}/)
  assert.match(desktop, /conflictCount=\{status\?\.conflict_count\}/)
  assert.match(shared, /if \(!lastError && !paused && !hasConflicts\) return null/)
  assert.match(shared, /view === 'files' \? 1\.5 : 2/)
  assert.doesNotMatch(desktop, /\{\(status\?\.last_error \|\| status\?\.paused \|\| status\?\.has_conflict\) \? \(/,
    'Desktop must not retain a second copy of the status banner JSX')
})

test('Host notices provide actions only when real Host callbacks are supplied', () => {
  const desktop = read('desktop/src/renderer/App.tsx')
  const shared = read('ui/shared/src/mui/WorkspaceHostAlerts.tsx')

  for (const action of ['onOpenDiagnostics', 'onResumeSync', 'onOpenConflicts']) {
    assert.match(shared, new RegExp('action=\\{' + action + ' \\? \\('))
    assert.match(desktop, new RegExp(action + '=\\{'))
  }
  assert.match(desktop, /onResumeSync=\{\(\) => void run\('pause'/)
  assert.match(desktop, /window\.xdriveDesktop\.agent\.setPaused\(false\)/)
  assert.match(shared, /disabled=\{resumeDisabled\}/)
  assert.match(shared, /恢复同步/)
  assert.match(shared, /处理冲突/)
  assert.match(shared, /运行诊断/)
  assert.doesNotMatch(shared, /window\.|document\.|fetch\s*\(|\.setPaused\(|backup\.cgi/,
    'Shared presentation must not call native Agent, DSM transport or browser APIs')
})
