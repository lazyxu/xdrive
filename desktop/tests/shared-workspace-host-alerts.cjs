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

test('real Host notice presentation never creates an action without a Host callback', () => {
  const ts = require('typescript')
  const source = read('ui/shared/src/mui/WorkspaceHostAlerts.tsx')
  const fileName = 'WorkspaceHostAlerts.tsx'
  const compiled = ts.transpileModule(source, {
    fileName, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(item => item.category === ts.DiagnosticCategory.Error)
    .map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const dependencies = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@mui/material': { Button: 'Button', Stack: 'Stack' },
    './StatusAlert': { XDriveStatusAlert: 'StatusAlert' },
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, name => {
      assert.ok(Object.hasOwn(dependencies, name), 'unapproved notice dependency: ' + name)
      return dependencies[name]
    },
  )
  const render = mod.exports.XDriveWorkspaceHostAlerts
  assert.equal(render({ view: 'files' }), null)
  const bare = render({
    view: 'files', lastError: 'real failure', paused: true,
    hasConflicts: true, conflictCount: 4,
  })
  assert.equal(bare.type, 'Stack')
  assert.equal(bare.props.sx.mx, 1.5, 'Files retains its edge-to-edge margin')
  const notices = bare.props.children.filter(Boolean)
  assert.deepEqual(notices.map(item => item.type),
    ['StatusAlert', 'StatusAlert', 'StatusAlert'])
  assert.deepEqual(notices.map(item => item.props.tone), ['bad', 'warning', 'warning'])
  assert.ok(notices.every(item => item.props.action === undefined),
    'a status alone must never grant resume/diagnostic/conflict operations')
  let nativeCalls = 0
  const diagnostics = () => { nativeCalls++ }
  const resume = () => { nativeCalls++ }
  const conflicts = () => { nativeCalls++ }
  const active = render({
    view: 'overview', lastError: 'real failure', paused: true,
    hasConflicts: true, conflictCount: 4, resumeDisabled: true,
    onOpenDiagnostics: diagnostics, onResumeSync: resume, onOpenConflicts: conflicts,
  })
  assert.equal(active.props.sx.mx, 0)
  const buttons = active.props.children.filter(Boolean).map(item => item.props.action)
  assert.deepEqual(buttons.map(item => item.type), ['Button', 'Button', 'Button'])
  assert.strictEqual(buttons[0].props.onClick, diagnostics)
  assert.strictEqual(buttons[1].props.onClick, resume)
  assert.strictEqual(buttons[2].props.onClick, conflicts)
  assert.equal(buttons[1].props.disabled, true,
    'Desktop busy state still disables Resume')
  assert.equal(nativeCalls, 0, 'rendering must never start a durable Agent operation')
})
