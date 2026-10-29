'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8')
function load(file, resolve = name => { throw new Error('Unexpected dependency ' + name) }) {
  const compiled = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((compiled.diagnostics || [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, resolve)
  return module.exports
}
const createHost = load('web/src/browserWorkspaceHost.ts').createXDriveBrowserWorkspaceHost
const routes = load('ui/shared/src/mui/WorkspaceRoute.ts')
const jsx = (type, props) => ({ type, props: props || {} })
const outlet = load('ui/shared/src/mui/XDriveAppPageOutlet.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === './WorkspaceRoute') return routes
  if (!name.startsWith('./')) throw new Error('Unexpected privileged outlet import ' + name)
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
const api = {}
const servicePort = { operationScope: 'web:https://example.test:42' }
const updatePort = { getState: async () => ({}) }
const backupPort = { read: async () => [] }
const onUnsavedChange = () => {}
const onLocationChange = () => {}
const onOpenStorage = () => {}
const onOpenTaskCenter = () => {}
const onRunStorageMaintenance = () => {}
const props = {
  cloudStorage: { load: async () => ({ quota: {} }) },
  localStorage: { load: async () => ({ browserStorage: {} }) },
  adminServices: {
    source: servicePort, diagnosticScope: 'web:42',
    onUnsavedChange, location: { service: 'caddy' }, onLocationChange,
  },
  adminMaintenance: {
    updatePort, backupPort, onOpenStorage, unavailableLabel: 'Web/API',
    initialChannel: 'master',
  },
  adminStorage: {
    api, scope: 'global', focusSection: 'backups',
    onOpenTaskCenter, onRunStorageMaintenance,
  },
}
test('unverified Browser Host never publishes admin mutations, even if ports supplied', () => {
  const host = createHost({ ...props, adminRoleVerified: false })
  assert.equal(host.adminRoleVerified, false)
  for (const key of ['adminServicesPage', 'adminMaintenancePage', 'adminStoragePage']) {
    assert.equal(host.services[key], undefined)
  }
  for (const route of ['admin-services', 'admin-maintenance', 'admin-storage']) {
    const result = render(host, route)
    assert.equal(result.type, 'XDriveStatePanel')
    assert.match(result.props.message, /xDrive Server/)
  }
})
test('verified Browser pages reuse existing Server operation ports and deep-link state', () => {
  const host = createHost({ ...props, adminRoleVerified: true })
  const services = render(host, 'admin-services')
  assert.equal(services.type, 'XDriveServiceDependenciesPage')
  assert.equal(services.props.source, servicePort)
  assert.equal(services.props.onUnsavedChange, onUnsavedChange)
  assert.equal(services.props.onLocationChange, onLocationChange)
  assert.deepEqual(services.props.location, { service: 'caddy' })
  const maintenance = render(host, 'admin-maintenance')
  assert.equal(maintenance.type, 'XDriveSystemMaintenancePage')
  assert.equal(maintenance.props.backupPort, backupPort)
  assert.equal(maintenance.props.updatePort, updatePort)
  assert.equal(maintenance.props.onOpenStorage, onOpenStorage)
  const storage = render(host, 'admin-storage')
  assert.equal(storage.type, 'GlobalStorageStatsPage')
  assert.equal(storage.props.api, api)
  assert.equal(storage.props.scope, 'global')
  assert.equal(storage.props.onOpenTaskCenter, onOpenTaskCenter)
  assert.equal(storage.props.onRunStorageMaintenance, onRunStorageMaintenance)
  assert.equal(render(host, 'files').type, 'XDriveStatePanel')
})
test('Web does not replace the unsaved Dependencies guard or scoped Owner API', () => {
  const web = read('web/src/App.tsx')
  const browserHost = read('web/src/browserWorkspaceHost.ts')
  assert.match(web, /adminServices: serverAdminVerified \?/)
  assert.match(web, /adminMaintenance: serverAdminVerified \?/)
  assert.match(web, /adminStorage: serverAdminVerified \?/)
  assert.match(web, /onUnsavedChange: setSystemDependenciesDraftDirty/)
  assert.match(web, /location: adminServicesLocation/)
  assert.match(web, /onLocationChange: \(next, options\) => launchWebApp\(/)
  assert.match(web, /xDriveSystemDependenciesNeedsExitConfirmation/)
  assert.match(web, /onRunStorageMaintenance: runStorageMaintenance/)
  assert.match(web, /api\.adminSaveCaddyConfiguration\(/)
  assert.match(web, /data-xdrive-pwa-upload-resume-picker/)
  assert.doesNotMatch(web, /<XDriveServiceDependenciesPage\b|<XDriveSystemMaintenancePage\b|<StorageStatsPanel\b/)
  assert.doesNotMatch(browserHost, /fetch\s*\(|xdriveDesktop|backup\.cgi|localBackupClient:/)
})
