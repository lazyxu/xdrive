'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')

function compile(file) {
  const out = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  const errors = (out.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return out.outputText
}
const makeModule = (file, resolve) => {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compile(file))(
    module, module.exports, resolve,
  )
  return module.exports
}
const hostModule = makeModule('web/src/browserWorkspaceHost.ts', name => {
  throw new Error('Unexpected runtime Host module: ' + name)
})
const routes = makeModule('ui/shared/src/mui/WorkspaceRoute.ts', name => {
  throw new Error('Unexpected runtime route module: ' + name)
})
const jsx = (type, props) => ({ type, props: props || {} })
const outlet = makeModule('ui/shared/src/mui/XDriveAppPageOutlet.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === './WorkspaceRoute') return routes
  if (!name.startsWith('./')) throw new Error('Unexpected native outlet module: ' + name)
  return new Proxy({}, { get(_target, key) {
    if (key === '__esModule') return true
    if (key === 'default') return name.slice(2)
    return String(key)
  } })
})
const render = (host, view) => {
  const result = outlet.XDriveAppPageOutlet({ host, view })
  return result.type === 'Fragment' ? result.props.children : result
}

test('Browser adds only exact Owner backup reads and Server pull ports to storage Host', () => {
  const quota = { load: async () => ({ quota: { physical_used_bytes: 0, quota_bytes: 0 } }) }
  const browser = { load: async () => ({ browserStorage: { supported: false, clear_supported: false } }) }
  const backup = { list: async () => ({ devices: [] }) }
  const adapter = { sourceOverview: async () => [] }
  const onError = () => {}
  const changed = () => {}
  const ports = {
    cloudStorage: quota,
    localStorage: browser,
    deviceBackup: { source: backup, initialSourceID: 13 },
    remotePull: {
      adapter, initialSourceID: 21,
      defaultTargetNodeID: 31, defaultTargetLabel: '我的文件',
      defaultTargetPath: '相册/当前', onSelectedSourceChange: changed, onError,
    },
  }
  const host = hostModule.createXDriveBrowserWorkspaceHost(ports)
  assert.equal(host.platform, 'web')
  assert.equal(host.adminRoleVerified, false)
  assert.deepEqual(Object.keys(host.services).sort(), [
    'cloudStorage', 'deviceBackupPage', 'localStorage', 'remotePullPage',
  ])
  assert.equal(host.services.deviceBackupPage.source, backup)
  assert.equal(host.services.deviceBackupPage.initialSourceID, 13)
  assert.equal(host.services.remotePullPage.adapter, adapter)
  assert.equal(host.services.remotePullPage.directionFilter, 'pull')
  assert.equal(host.services.remotePullPage.initialSourceID, 21)
  assert.equal(host.services.remotePullPage.onSelectedSourceChange, changed)
  assert.equal(host.services.remotePullPage.onError, onError)
  const devices = render(host, 'device-backup')
  assert.equal(devices.type, 'XDriveDeviceBackupPage')
  assert.equal(devices.props.source, backup)
  assert.equal(devices.props.initialSourceID, 13)
  const pull = render(host, 'remote-pull')
  assert.equal(pull.type, 'XDriveSourceManager')
  assert.equal(pull.props.directionFilter, 'pull')
  assert.equal(pull.props.defaultTargetPath, '相册/当前')
  for (const denied of ['files', 'overview', 'transfers', 'admin-users', 'global-tasks']) {
    assert.equal(render(host, denied).type, 'XDriveStatePanel', denied)
  }
  assert.match(render(host, 'admin-users').props.message, /xDrive Server/)
})

test('Browser retains legacy source direction, Viewer return and Owner scope', () => {
  const app = read('web/src/App.tsx')
  const host = read('web/src/browserWorkspaceHost.ts')
  assert.match(app, /appView === 'device-backup' \? \(\s*<XDriveAppPageOutlet/)
  assert.match(app, /appView === 'remote-pull' \? \(\s*route\.app === 'sync-folders'/)
  assert.match(app, /data-xdrive-legacy-source-quiet-redirect/)
  assert.match(app, /isRemotePullRoute && remotePullSourceID !== sourceID/)
  assert.match(app, /launchWebApp\(\{ app: 'remote-pull', params: \{ source: sourceID \} \}, \{ replace: true \}\)/)
  assert.match(app, /createXDriveSourceManagerAdapter\(api\)/)
  assert.match(app, /api\.deviceBackupsPage\(/)
  assert.match(app, /xDriveWebAppViewer\(route\.app\)/)
  assert.match(app, /data-xdrive-pwa-upload-resume-picker/)
  assert.doesNotMatch(app, /<XDriveDeviceBackupPage\b|<XDriveSourceManager\b/)
  assert.doesNotMatch(host, /xdriveDesktop|ownerFilesPage:|localBackupClient:|ownerBackupReadFallback:|backup\.cgi|fetch\s*\(/)
  assert.match(host, /directionFilter: 'pull' as const/)
})
