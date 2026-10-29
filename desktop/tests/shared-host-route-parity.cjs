'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function compile(file) {
  const transpiled = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (transpiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return transpiled.outputText
}
const moduleRoute = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/WorkspaceRoute.ts'))(
    moduleRoute, moduleRoute.exports, name => {
      throw new Error('Unexpected runtime WorkspaceRoute dependency: ' + name)
    },
  )
const route = moduleRoute.exports
const element = (type, props, key) => ({ type, props: props || {}, key })
const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' }
const moduleOutlet = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/XDriveAppPageOutlet.tsx'))(
    moduleOutlet, moduleOutlet.exports, name => {
      if (name === 'react/jsx-runtime') return runtime
      if (name === './WorkspaceRoute') return route
      if (!name.startsWith('./')) throw new Error('Unexpected dispatcher dependency: ' + name)
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
const Outlet = moduleOutlet.exports.XDriveAppPageOutlet
function render(host, view) {
  const result = Outlet({ host, view, revision: 3 })
  return result.type === 'Fragment' ? result.props.children : result
}

// Intentionally supply genuine-domain-shaped ports, not a localBackupClient
// fallback. Both Hosts get exactly the SAME port objects for each shared page.
const services = {
  overviewPage: { port: {} },
  galleryPage: { source: {} },
  remotePullPage: { source: {} },
  deviceBackupPage: { source: {} },
  conflictsPage: { conflicts: [] },
  diagnosticsPage: { status: null },
  taskCenterPage: { transfers: [], operations: [] },
  cloudStorage: { load() {} },
  localStorage: { load() {} },
  adminMaintenancePage: { source: {} },
  adminUsersPage: { source: {} },
  adminAuditPage: { source: {} },
  adminStoragePage: { source: {} },
  adminServicesPage: { source: {} },
}
const expected = {
  overview: 'XDriveOverviewPage',
  gallery: 'XDriveMediaGalleryPage',
  'device-backup': 'XDriveDeviceBackupPage',
  'remote-pull': 'XDriveSourceManager',
  transfers: 'XDriveTaskCenterPage',
  'global-tasks': 'XDriveTaskCenterPage',
  'local-storage': 'XDriveLocalStoragePage',
  'cloud-storage': 'XDriveCloudStoragePage',
  conflicts: 'XDriveConflictsPage',
  diagnostics: 'XDriveDiagnosticsPage',
  'admin-users': 'AdminUsersPage',
  'admin-audit': 'AdminAuditPage',
  'admin-storage': 'GlobalStorageStatsPage',
  'admin-services': 'XDriveServiceDependenciesPage',
  'admin-maintenance': 'XDriveSystemMaintenancePage',
}
const host = platform => ({
  platform, adminRoleVerified: true, services,
  unavailableMessage: view => platform + ': unsupported ' + view,
})

test('the canonical registry covers every non-Files route exactly once', () => {
  assert.equal(new Set(route.XDRIVE_APP_WORKSPACE_ROUTES).size,
    route.XDRIVE_APP_WORKSPACE_ROUTES.length)
  assert.deepEqual([...route.XDRIVE_SHARED_HOST_PAGE_ROUTES].sort(),
    route.XDRIVE_APP_WORKSPACE_ROUTES.filter(view => view !== 'files').sort())
  assert.deepEqual(Object.keys(expected).sort(), [...route.XDRIVE_SHARED_HOST_PAGE_ROUTES].sort())
})

test('all shared pages render the same actual MUI page type on Desktop and DSM', () => {
  for (const view of route.XDRIVE_SHARED_HOST_PAGE_ROUTES) {
    const desktop = render(host('desktop'), view)
    const dsm = render(host('synology'), view)
    assert.equal(desktop.type, expected[view], 'Desktop route: ' + view)
    assert.equal(dsm.type, expected[view], 'DSM route: ' + view)
    // The Host may change refresh policy, but must not switch page component.
    assert.equal(desktop.type, dsm.type)
  }
})

test('both Hosts deny every admin route without verified Server admin role', () => {
  for (const view of route.XDRIVE_APP_WORKSPACE_ROUTES.filter(
    route.xDriveWorkspaceRouteRequiresAdmin
  )) {
    for (const platform of ['desktop', 'synology']) {
      const result = render({ ...host(platform), adminRoleVerified: false }, view)
      assert.equal(result.type, 'XDriveStatePanel', platform + '/' + view)
      assert.match(result.props.message, /xDrive Server/)
    }
  }
})

test('missing authorized sources stay visible as truthful unavailable states', () => {
  for (const view of route.XDRIVE_SHARED_HOST_PAGE_ROUTES) {
    for (const platform of ['desktop', 'synology']) {
      const absent = { ...host(platform), services: {} }
      const result = render(absent, view)
      assert.equal(result.type, 'XDriveStatePanel', platform + '/' + view)
      assert.equal(result.props.message, platform + ': unsupported ' + view)
    }
  }
})

test('shared route dispatcher cannot reach native IPC or the DSM CGI', () => {
  const source = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|backup\.cgi|fetch\s*\(/)
  assert.doesNotMatch(read('ui/shared/src/mui/WorkspaceRoute.ts'), /window\.xdriveDesktop/)
})

test('backup-only Owner read surfaces require explicit Host opt-in, never a platform label', () => {
  const client = { ownerFilesRoot: async () => ({ id: 1, name: 'Owner' }) }
  // Merely acquiring a local Agent read client is insufficient on Desktop OR DSM.
  for (const platform of ['desktop', 'synology']) {
    const absent = { platform, adminRoleVerified: false,
      services: { localBackupClient: client } }
    for (const view of ['overview', 'device-backup', 'transfers', 'files']) {
      assert.equal(render(absent, view).type, 'XDriveStatePanel',
        platform + '/' + view + ' must not infer NAS Owner capability')
    }
    const enabled = { ...absent, services: {
      ...absent.services, ownerBackupReadFallback: true,
    } }
    assert.equal(render(enabled, 'overview').type, 'XDriveHomePage')
    assert.equal(render(enabled, 'device-backup').type, 'XDriveDeviceBackupPage')
    assert.equal(render(enabled, 'transfers').type, 'XDriveTaskCenterPage')
    assert.equal(render(enabled, 'files').type, 'XDriveStatePanel',
      'backup-only read capability must never grant Owner Files privileges')
  }
})

test('Host-owned cloud storage refresh policy is independent of the platform string', () => {
  for (const platform of ['desktop', 'synology']) {
    const base = { platform, services: { cloudStorage: { load() {} } } }
    assert.equal(render(base, 'cloud-storage').props.clearOnRefresh, false)
    const enabled = { ...base, services: {
      ...base.services, cloudStorageRefresh: { clearOnRefresh: true },
    } }
    assert.equal(render(enabled, 'cloud-storage').props.clearOnRefresh, true)
  }
  const source = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
  assert.doesNotMatch(source, /host\\.platform\\s*===\\s*['"]synology['"]/,
    'shared page selection and refresh behavior must follow real Host ports')
})
