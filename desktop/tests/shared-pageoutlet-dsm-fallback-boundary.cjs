'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
function transpile(file) {
  const filename = path.join(root, file)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return compiled.outputText
}
// Execute actual exported WorkspaceRoute predicates so the test exercises the
// real admin/Owner gate, never a copied allowlist or regex-only approximation.
const routeMod = { exports: {} }
new Function('module', 'exports', 'require',
  transpile('ui/shared/src/mui/WorkspaceRoute.ts'))(
    routeMod, routeMod.exports, () => { throw new Error('Unexpected WorkspaceRoute runtime import') },
  )
const route = routeMod.exports

// A lightweight JSX runtime records the actual shared dispatcher tree without
// mounting 100k media/tables or invoking platform-specific backend adapters.
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' }
const outletMod = { exports: {} }
new Function('module', 'exports', 'require',
  transpile('ui/shared/src/mui/XDriveAppPageOutlet.tsx'))(
    outletMod, outletMod.exports,
    name => {
      if (name === 'react/jsx-runtime') return runtime
      if (name === './WorkspaceRoute') return route
      if (!name.startsWith('./')) throw new Error('Unexpected shared UI module: ' + name)
      const source = name.slice(2)
      return new Proxy({}, {
        get(_target, symbol) {
          if (symbol === '__esModule') return true
          if (symbol === 'default') return source
          return String(symbol)
        },
      })
    },
  )
const Outlet = outletMod.exports.XDriveAppPageOutlet

function render(host, view) {
  const result = Outlet({ host, view, revision: 2 })
  return result.type === 'Fragment' ? result.props.children : result
}
const client = { authenticatedDSMClient: true }
const reasons = view => '真实 Host 接口不可用：' + view
const desktop = { platform: 'desktop', services: { localBackupClient: client }, unavailableMessage: reasons }
const synology = { platform: 'synology', services: { localBackupClient: client }, unavailableMessage: reasons }

test('Desktop must not mount any DSM-only fallback despite receiving a backup client', () => {
  for (const view of ['overview', 'files', 'device-backup', 'transfers', 'diagnostics']) {
    const page = render(desktop, view)
    assert.equal(page.type, 'XDriveStatePanel', view)
    assert.equal(page.props.message, reasons(view), 'unsupported actions must be truthful')
  }
})

test('DSM retains authorized read-only fallbacks through its real local client', () => {
  for (const [view, expected] of [
    ['overview', 'XDriveHomePage'],
    ['files', 'XDriveSynologyOwnerFilesPage'],
    ['device-backup', 'XDriveDeviceBackupPage'],
    ['transfers', 'XDriveTaskCenterPage'],
    ['diagnostics', 'XDriveSynologyDiagnosticsPanel'],
  ]) {
    const page = render(synology, view)
    assert.equal(page.type, expected, view)
    if (view === 'files') assert.strictEqual(page.props.client, client)
  }
})

test('new Desktop domain port is preferred over a DSM local fallback, but cannot grant admin', () => {
  const host = {
    ...desktop,
    services: {
      ...desktop.services,
      overviewPage: { port: {} },
      galleryPage: { source: {} },
      taskCenterPage: { transfers: [], operations: [] },
    },
  }
  assert.equal(render(host, 'overview').type, 'XDriveOverviewPage')
  assert.equal(render(host, 'gallery').type, 'XDriveMediaGalleryPage')
  assert.equal(render(host, 'transfers').type, 'XDriveTaskCenterPage')
  assert.equal(render(host, 'global-tasks').type, 'XDriveStatePanel')
  assert.match(render(host, 'global-tasks').props.message, /管理员身份/)
  assert.equal(render({ ...host, adminRoleVerified: true }, 'global-tasks').type, 'XDriveTaskCenterPage')
})

test('DSM is not granted an unsupported Gallery/Admin page or Server role by CGI availability', () => {
  assert.equal(render(synology, 'gallery').type, 'XDriveStatePanel')
  assert.equal(render(synology, 'admin-users').type, 'XDriveStatePanel')
  assert.match(render(synology, 'admin-users').props.message, /管理员身份/)
  assert.equal(render({ ...synology, adminRoleVerified: true }, 'admin-users').type, 'XDriveStatePanel')
  const unknown = render(synology, 'unknown-do-not-route')
  assert.equal(unknown.type, 'XDriveStatePanel')
  assert.equal(unknown.props.message, '未知的 xDrive 页面。')
})
