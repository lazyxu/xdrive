'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')

function compile(file) {
  const result = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  })
  assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return result.outputText
}
function load(file, resolve = name => { throw new Error('Unexpected module ' + name) }) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compile(file))(module, module.exports, resolve)
  return module.exports
}
const browser = load('web/src/browserWorkspaceHost.ts')
const registry = load('ui/shared/src/mui/WorkspaceRoute.ts')
const element = (type, props) => ({ type, props: props || {} })
const outlet = load('ui/shared/src/mui/XDriveAppPageOutlet.tsx', name => {
  if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' }
  if (name === './WorkspaceRoute') return registry
  if (!name.startsWith('./')) throw new Error('Unexpected native I/O ' + name)
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

test('Browser Files uses the shared outlet without authorizing unrelated Host actions', () => {
  const original = browser.createXDriveBrowserWorkspaceHost({
    cloudStorage: { load: async () => ({ quota: {} }) },
    localStorage: { load: async () => ({ browserStorage: {} }) },
  })
  const sentinel = { type: 'WebFileExplorer', props: { ownerScoped: true } }
  const scoped = browser.xDriveBrowserFilesRouteHost(original, sentinel)
  assert.notStrictEqual(scoped, original)
  assert.equal(scoped.platform, 'web')
  assert.equal(scoped.adminRoleVerified, original.adminRoleVerified)
  assert.equal(scoped.services.filesControllerContent, sentinel)
  assert.equal(original.services.filesControllerContent, undefined)
  assert.strictEqual(scoped.services.cloudStorage, original.services.cloudStorage)
  assert.strictEqual(scoped.services.localStorage, original.services.localStorage)
  assert.strictEqual(render(scoped, 'files'), sentinel)
  assert.equal(render(original, 'files').type, 'XDriveStatePanel')
  for (const route of ['global-tasks','admin-users','admin-services']) {
    assert.equal(render(scoped, route).type, 'XDriveStatePanel')
  }
  assert.throws(() => browser.xDriveBrowserFilesRouteHost({
    ...original, platform: 'synology',
  }, sentinel), /Web Host/)
})

test('Browser Files keeps all original Owner-scoped navigation, Viewer and upload props', () => {
  const app = read('web/src/App.tsx')
  const host = read('web/src/browserWorkspaceHost.ts')
  const outletSource = read('ui/shared/src/mui/XDriveAppPageOutlet.tsx')
  assert.match(app, /appView === 'files' \? \(\s*<XDriveAppPageOutlet/)
  assert.match(app, /xDriveBrowserFilesRouteHost\(browserWorkspaceHost, \(/)
  assert.equal((app.match(/<WebFileExplorer\b/g) || []).length, 1)
  for (const mark of [
    'suspendBackgroundThumbnails={viewerActive}',
    'navigationSessionStorageKey={`xdrive.files.navigation_session.v1:',
    'initialDirectoryID={route.app === \'files\'',
    'initialRevealNodeID={route.app === \'files\'',
    'onOperationQueued={rememberFilesOperation}',
    'onDirectoryChange={(nodeID) => {',
    'onOpenQuickLook={openWebQuickLook}',
    'onOpenFile={openWebFile}',
    'onError={handleError}',
    'data-xdrive-pwa-upload-resume-picker',
    'xDriveWebAppViewer(route.app)',
  ]) {
    assert.ok(app.includes(mark), 'Files Host lost ' + mark)
  }
  assert.match(outletSource, /services\.filesControllerContent/)
  assert.doesNotMatch(host, /ipcRenderer|xdriveDesktop|backup\.cgi|fetch\s*\(/)
})
