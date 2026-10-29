'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
function compile(pathname) {
  const out = ts.transpileModule(read(pathname), {
    fileName: pathname, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return out.outputText
}
const hostModule = { exports: {} }
new Function('module', 'exports', 'require',
  compile('web/src/browserWorkspaceHost.ts'))(
  hostModule, hostModule.exports, name => {
    throw new Error('Unexpected native/Web Host runtime import: ' + name)
  },
)
const makeHost = hostModule.exports.createXDriveBrowserWorkspaceHost
const routeModule = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/WorkspaceRoute.ts'))(
  routeModule, routeModule.exports, name => {
    throw new Error('Unexpected WorkspaceRoute dependency: ' + name)
  },
)
const element = (type, props) => ({ type, props: props || {} })
const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' }
const outletModule = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/XDriveAppPageOutlet.tsx'))(
  outletModule, outletModule.exports, name => {
    if (name === 'react/jsx-runtime') return runtime
    if (name === './WorkspaceRoute') return routeModule.exports
    if (!name.startsWith('./')) throw new Error('Unscoped outlet dependency: ' + name)
    return new Proxy({}, { get(_obj, prop) {
      if (prop === '__esModule') return true
      if (prop === 'default') return name.slice(2)
      return String(prop)
    } })
  },
)
const render = (host, view) => {
  const el = outletModule.exports.XDriveAppPageOutlet({ host, view })
  return el.type === 'Fragment' ? el.props.children : el
}

test('Browser Host is explicit, limited to real storage ports and cannot grant admin/Agent', () => {
  const cloud = { load: async () => ({ quota: { physical_used_bytes: 0, quota_bytes: 0 } }) }
  const local = { load: async () => ({ browserStorage: { supported: false, clear_supported: false } }) }
  const host = makeHost({ cloudStorage: cloud, localStorage: local })
  assert.equal(host.platform, 'web')
  assert.equal(host.adminRoleVerified, false)
  assert.equal(host.services.cloudStorage, cloud)
  assert.equal(host.services.localStorage, local)
  assert.deepEqual(Object.keys(host.services).sort(), ['cloudStorage', 'localStorage'])
  const cloudPage = render(host, 'cloud-storage')
  assert.equal(cloudPage.type, 'XDriveCloudStoragePage')
  assert.equal(cloudPage.props.source, cloud)
  assert.equal(cloudPage.props.clearOnRefresh, false)
  const localPage = render(host, 'local-storage')
  assert.equal(localPage.type, 'XDriveLocalStoragePage')
  assert.equal(localPage.props.source, local)
  for (const view of ['overview','files','device-backup','transfers','diagnostics','admin-users','global-tasks']) {
    const page = render(host, view)
    assert.equal(page.type, 'XDriveStatePanel', 'Browser denied ' + view)
  }
  assert.match(render(host, 'admin-users').props.message, /xDrive Server/)
})

test('Web keeps native Browser sources and PWA lifecycle while delegating storage JSX', () => {
  const web = read('web/src/App.tsx')
  const adapter = read('web/src/browserWorkspaceHost.ts')
  const types = read('ui/shared/src/mui/WorkspaceHostAdapter.ts')
  assert.match(types, /'desktop' \| 'synology' \| 'web'/)
  assert.match(web, /createXDriveBrowserWorkspaceHost\(\{/)
  assert.match(web, /<XDriveAppPageOutlet host=\{browserWorkspaceHost\} view=\{appView\}/)
  assert.doesNotMatch(web, /<XDriveLocalStoragePage\b|<XDriveCloudStoragePage\b/)
  assert.match(web, /clearBrowserCache: clearWebBrowserCache/)
  assert.match(web, /createXDriveCloudStorageDataSource/)
  assert.match(web, /xDriveWebAppViewer\(route\.app\)/)
  assert.match(web, /data-xdrive-pwa-upload-resume-picker/)
  assert.match(web, /xDriveSystemDependenciesNeedsExitConfirmation/)
  assert.doesNotMatch(adapter, /localBackupClient|ownerFilesPage|xdriveDesktop|backup\.cgi|fetch\s*\(/)
})
