'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function compile(file) {
  const out = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((out.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return out.outputText
}
function load(file, resolve = name => { throw new Error('Unexpected import ' + name) }) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compile(file))(module, module.exports, resolve)
  return module.exports
}
const createHost = load('web/src/browserWorkspaceHost.ts').createXDriveBrowserWorkspaceHost
const routes = load('ui/shared/src/mui/WorkspaceRoute.ts')
const jsx = (type, props) => ({ type, props: props || {} })
const outlet = load('ui/shared/src/mui/XDriveAppPageOutlet.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === './WorkspaceRoute') return routes
  if (!name.startsWith('./')) throw new Error('Unexpected unscoped Host route dependency: ' + name)
  return new Proxy({}, { get(_obj, key) {
    if (key === '__esModule') return true
    if (key === 'default') return name.slice(2)
    return String(key)
  } })
}).XDriveAppPageOutlet
const render = (host, view) => {
  const r = outlet({ host, view })
  return r.type === 'Fragment' ? r.props.children : r
}
const quota = { load: async () => ({ quota: {} }) }
const storage = { load: async () => ({ browserStorage: {} }) }
const media = { list: async () => [] }
const events = []
const task = {
  transfers: [], operations: [],
  globalTasksEnabled: true,
  mediaSelectionJobPort: media,
  onBackgroundScopeChange: scope => events.push(scope),
}
const make = adminRoleVerified => createHost({
  cloudStorage: quota,
  localStorage: storage,
  adminRoleVerified,
  taskCenter: task,
})

test('Browser shows Mine TaskCenter but denies unverified global/admin capability', () => {
  const host = make(false)
  assert.equal(host.platform, 'web')
  assert.equal(host.adminRoleVerified, false)
  assert.equal(host.services.taskCenterPage, task)
  assert.equal(render(host, 'transfers').type, 'XDriveTaskCenterPage')
  assert.equal(render(host, 'transfers').props.backgroundScope, 'mine')
  assert.equal(render(host, 'transfers').props.mediaSelectionJobPort, media)
  for (const denied of ['global-tasks', 'admin-users', 'admin-maintenance']) {
    assert.equal(render(host, denied).type, 'XDriveStatePanel')
  }
  assert.match(render(host, 'global-tasks').props.message, /xDrive Server/)
})
test('Verified Server role sees global scope without Mine-only media/Files or native controls', () => {
  const host = make(true)
  assert.equal(host.adminRoleVerified, true)
  assert.deepEqual(Object.keys(host.services).sort(), ['cloudStorage', 'localStorage', 'taskCenterPage'])
  const view = render(host, 'global-tasks')
  assert.equal(view.type, 'XDriveTaskCenterPage')
  assert.equal(view.props.backgroundScope, 'global')
  assert.equal(view.props.mediaSelectionJobPort, undefined)
  assert.equal(view.props.onBackgroundScopeChange, task.onBackgroundScopeChange)
  assert.equal(render(host, 'files').type, 'XDriveStatePanel')
  assert.equal(render(host, 'admin-users').type, 'XDriveStatePanel')
  assert.deepEqual(events, [])
})
test('Browser still owns route identity, Owner task focus, real transport and durable controls', () => {
  const app = read('web/src/App.tsx')
  const adapter = read('web/src/browserWorkspaceHost.ts')
  assert.match(app, /profile\?\.username === username &&\s*profile\?\.role === 'admin'/)
  assert.match(app, /taskCenter: \{\s*\.\.\.taskCenter\.pageProps/)
  assert.match(app, /setAppView\(scope === 'global' \? 'global-tasks' : 'transfers'\)/)
  assert.match(app, /mediaSelectionJobPort,/)
  assert.match(app, /operationFocusID: filesOperationFocus\?\.operationID/)
  assert.match(app, /backgroundFocusTaskID: taskCenterFocus\?\.taskID/)
  assert.match(app, /backgroundTaskPort = useMemo/)
  assert.match(app, /api\.controlBackgroundTask\(/)
  assert.match(app, /backgroundTasksLifecycleKey: `\$\{profile\?\.id \?\? ''\}:\$\{username\}`/)
  assert.match(app, /xDriveWebAppViewer\(route\.app\)/)
  assert.match(app, /data-xdrive-pwa-upload-resume-picker/)
  assert.doesNotMatch(app, /<XDriveTaskCenterPage\b/)
  assert.doesNotMatch(adapter, /fetch\s*\(|window\.|xdriveDesktop|backup\.cgi|localBackupClient:/)
})
