'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
function load(file, resolve = name => { throw new Error('Unexpected module: ' + name) }) {
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
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputText)(module, module.exports, resolve)
  return module.exports
}
const createHost = load('web/src/browserWorkspaceHost.ts').createXDriveBrowserWorkspaceHost
const routes = load('ui/shared/src/mui/WorkspaceRoute.ts')
const jsx = (type, props) => ({ type, props: props || {} })
const outlet = load('ui/shared/src/mui/XDriveAppPageOutlet.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === './WorkspaceRoute') return routes
  if (!name.startsWith('./')) throw new Error('Unscoped route dependency: ' + name)
  return new Proxy({}, { get(_target, key) {
    if (key === '__esModule') return true
    if (key === 'default') return name.slice(2)
    return String(key)
  } })
}).XDriveAppPageOutlet
const render = (host, view) => {
  const result = outlet({ host, view })
  return result.type === 'Fragment' ? result.props.children : result
}
const api = { adminUsers: async () => [], adminAuditRange: async () => ({ items: [] }) }
const onChanged = () => {}
const make = verified => createHost({
  cloudStorage: { load: async () => ({ quota: {} }) },
  localStorage: { load: async () => ({ browserStorage: {} }) },
  adminRoleVerified: verified,
  adminUsers: { api, currentUserID: 11, focusUserID: 19, onChanged },
  adminAudit: { api },
})
test('Browser admin capabilities are absent until current Server role is verified', () => {
  const ordinary = make(false)
  assert.equal(ordinary.platform, 'web')
  assert.equal(ordinary.adminRoleVerified, false)
  assert.equal(ordinary.services.adminUsersPage, undefined)
  assert.equal(ordinary.services.adminAuditPage, undefined)
  for (const route of ['admin-users', 'admin-audit', 'global-tasks']) {
    const result = render(ordinary, route)
    assert.equal(result.type, 'XDriveStatePanel')
    assert.match(result.props.message, /xDrive Server/)
  }
})
test('Verified Browser users and audit use exactly the existing scoped Server API', () => {
  const host = make(true)
  assert.equal(host.adminRoleVerified, true)
  const users = render(host, 'admin-users')
  assert.equal(users.type, 'AdminUsersPage')
  assert.equal(users.props.api, api)
  assert.equal(users.props.currentUserID, 11)
  assert.equal(users.props.focusUserID, 19)
  assert.equal(users.props.onChanged, onChanged)
  const audit = render(host, 'admin-audit')
  assert.equal(audit.type, 'AdminAuditPage')
  assert.equal(audit.props.api, api)
  for (const route of ['files', 'admin-storage', 'admin-services']) {
    assert.equal(render(host, route).type, 'XDriveStatePanel')
  }
})
test('Web keeps current Owner /me identity and deep links; no extra native admin RPC', () => {
  const web = read('web/src/App.tsx')
  const browserHost = read('web/src/browserWorkspaceHost.ts')
  assert.match(web, /profile\?\.username === username &&\s*profile\?\.role === 'admin'/)
  assert.match(web, /focusedAdminUserID = route\.app === 'admin-users' \? route\.params\.user/)
  assert.match(web, /currentUserID: profile\.id/)
  assert.match(web, /onChanged: \(\) => \{ void refreshQuota\(\) \}/)
  assert.match(web, /adminUsers: serverAdminVerified && profile \?/)
  assert.match(web, /adminAudit: serverAdminVerified \? \{ api \} : undefined/)
  assert.match(web, /<XDriveAppPageOutlet host=\{browserWorkspaceHost\} view=\{appView\}/)
  assert.doesNotMatch(web, /<AdminUsersPanel\b|<AdminAuditPanel\b/)
  assert.match(web, /xDriveSystemDependenciesNeedsExitConfirmation/)
  assert.match(web, /xDriveWebAppViewer\(route\.app\)/)
  assert.doesNotMatch(browserHost, /window\.|fetch\s*\(|xdriveDesktop|backup\.cgi|localBackupClient:/)
})
