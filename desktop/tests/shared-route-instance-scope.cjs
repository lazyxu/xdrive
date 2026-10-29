'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const renderer = require('react-test-renderer')

const file = path.resolve(__dirname, '../../ui/shared/src/mui/XDriveAppRouteContent.tsx')
const source = fs.readFileSync(file, 'utf8')
const transpiled = ts.transpileModule(source, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
})
const errors = (transpiled.diagnostics ?? [])
  .filter(item => item.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')), [])

const events = []
// Mount the REAL shared route/content component, but replace the massive
// page dependencies with an observer that records actual React lifetimes.
function PageOutlet({ host, view, revision }) {
  React.useEffect(() => {
    events.push(`mount:${host.platform}:${view}:${revision}`)
    return () => events.push(`unmount:${host.platform}:${view}:${revision}`)
  }, [])
  return React.createElement('page', { view, revision })
}
function WorkspaceContent({ children }) {
  return React.createElement('content', null, children)
}
const mockModules = {
  'react/jsx-runtime': require('react/jsx-runtime'),
  './WorkspaceContent': { XDriveWorkspaceContent: WorkspaceContent },
  './XDriveAppPageOutlet': { XDriveAppPageOutlet: PageOutlet },
  './WorkspaceRoute': {
    xDriveIsSharedHostPageRoute: value => value !== 'files',
    xDriveWorkspacePresentation: value => value === 'files' ? 'files' : 'page',
  },
}
const compiledModule = { exports: {} }
new Function('module', 'exports', 'require', transpiled.outputText)(
  compiledModule, compiledModule.exports,
  name => {
    if (!(name in mockModules)) throw new Error('Unexpected import in shared RouteContent: ' + name)
    return mockModules[name]
  },
)
const RouteContent = compiledModule.exports.XDriveAppRouteContent

const desktopAdmin = { platform: 'desktop', adminRoleVerified: true, services: {} }
const desktopOwner = { platform: 'desktop', adminRoleVerified: false, services: {} }
const dsm = { platform: 'synology', adminRoleVerified: false, services: {} }
const ui = (host, view, revision = 0, children) =>
  React.createElement(RouteContent, { host, view, revision }, children)

test('Mine -> Global Tasks -> Mine remounts even when React page component type is identical', () => {
  events.length = 0
  let app
  renderer.act(() => { app = renderer.create(ui(desktopAdmin, 'transfers')) })
  renderer.act(() => { app.update(ui(desktopAdmin, 'global-tasks')) })
  renderer.act(() => { app.update(ui(desktopAdmin, 'transfers')) })
  assert.deepEqual(events, [
    'mount:desktop:transfers:0',
    'unmount:desktop:transfers:0',
    'mount:desktop:global-tasks:0',
    'unmount:desktop:global-tasks:0',
    'mount:desktop:transfers:0',
  ])
  renderer.act(() => app.unmount())
})

test('DSM same-route refresh retires stale Gallery instance, but unchanged rerenders do not', () => {
  events.length = 0
  let app
  renderer.act(() => { app = renderer.create(ui(dsm, 'gallery', 0)) })
  renderer.act(() => { app.update(ui(dsm, 'gallery', 0)) })
  assert.deepEqual(events, ['mount:synology:gallery:0'])
  renderer.act(() => { app.update(ui(dsm, 'gallery', 1)) })
  assert.deepEqual(events, [
    'mount:synology:gallery:0',
    'unmount:synology:gallery:0',
    'mount:synology:gallery:1',
  ])
  renderer.act(() => app.unmount())
})

test('verified Server-admin role change retires the previous page instance', () => {
  events.length = 0
  let app
  renderer.act(() => { app = renderer.create(ui(desktopOwner, 'diagnostics', 0)) })
  renderer.act(() => { app.update(ui(desktopAdmin, 'diagnostics', 0)) })
  assert.deepEqual(events, [
    'mount:desktop:diagnostics:0',
    'unmount:desktop:diagnostics:0',
    'mount:desktop:diagnostics:0',
  ])
  renderer.act(() => app.unmount())
})

test('Desktop Files stays a transitional Host controller; DSM Files uses shared outlet', () => {
  events.length = 0
  const oldFiles = React.createElement('desktop-files', null, 'real native controller')
  let app
  renderer.act(() => { app = renderer.create(ui(desktopOwner, 'files', 0, oldFiles)) })
  assert.deepEqual(events, [])
  assert.equal(app.root.findAllByType('desktop-files').length, 1)
  renderer.act(() => { app.update(ui(dsm, 'files', 0)) })
  assert.deepEqual(events, ['mount:synology:files:0'])
  renderer.act(() => { app.update(ui(dsm, 'files', 1)) })
  assert.deepEqual(events, [
    'mount:synology:files:0',
    'unmount:synology:files:0',
    'mount:synology:files:1',
  ])
  renderer.act(() => app.unmount())
})

test('Host service identity and durable task functions are untouched by route remount', () => {
  events.length = 0
  let durableInvocations = 0
  const persistentStart = () => durableInvocations++
  const host = {
    platform: 'desktop', adminRoleVerified: false,
    services: { startBackup: persistentStart },
  }
  let app
  renderer.act(() => { app = renderer.create(ui(host, 'transfers')) })
  renderer.act(() => { app.update(ui(host, 'gallery')) })
  renderer.act(() => { app.update(ui(host, 'gallery', 1)) })
  assert.equal(host.services.startBackup, persistentStart)
  assert.equal(durableInvocations, 0, 'page remount must not start or cancel Agent jobs')
  renderer.act(() => app.unmount())
})

test('Files without a legacy controller uses the shared outlet on either Host', () => {
  events.length = 0
  let app
  renderer.act(() => { app = renderer.create(ui(desktopOwner, 'files')) })
  assert.deepEqual(events, ['mount:desktop:files:0'])
  renderer.act(() => { app.update(ui(dsm, 'files')) })
  assert.deepEqual(events, [
    'mount:desktop:files:0',
    'unmount:desktop:files:0',
    'mount:synology:files:0',
  ])
  renderer.act(() => app.unmount())
})
