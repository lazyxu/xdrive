'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function compile(file) {
  const js = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((js.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  return js.outputText
}
const routes = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/WorkspaceRoute.ts'))(
    routes, routes.exports, name => {
      throw new Error('Unexpected WorkspaceRoute runtime dependency: ' + name)
    },
  )

const priorityEvents = []
const priority = page => priorityEvents.push(page)
const moduleRef = { exports: {} }
new Function('module', 'exports', 'require',
  compile('ui/shared/src/mui/WorkspaceNavigationState.ts'))(
    moduleRef, moduleRef.exports, name => {
      if (name === 'react') return React
      if (name === './WorkspaceRoute') return routes.exports
      if (name === './ViewerForegroundPriority')
        return { xDriveEnterForegroundPage: priority }
      throw new Error('Unexpected shared navigation dependency: ' + name)
    },
  )
const {
  xDriveNextWorkspaceNavigationState: next,
  useXDriveWorkspaceNavigationState: useNavigation,
} = moduleRef.exports

test('route admission rejects unsupported settings routes and unverified admin', () => {
  const initial = { selected: 'overview', pageRevision: 0 }
  assert.equal(next(initial, 'settings', false), null)
  assert.equal(next(initial, 'invented', true), null)
  assert.equal(next(initial, 'admin-storage', false), null)
  assert.deepEqual(next(initial, 'gallery', false),
    { selected: 'gallery', pageRevision: 0 })
  assert.deepEqual(next(initial, 'admin-storage', true),
    { selected: 'admin-storage', pageRevision: 0 })
})

test('same-route reentry remounts the page without changing route scope', () => {
  const one = next({ selected: 'files', pageRevision: 0 }, 'files', false)
  assert.deepEqual(one, { selected: 'files', pageRevision: 1 })
  assert.deepEqual(next(one, 'files', false),
    { selected: 'files', pageRevision: 2 })
  assert.deepEqual(next(one, 'gallery', false),
    { selected: 'gallery', pageRevision: 0 })
})

function harness(initialRole = false) {
  const control = { current: null }
  function Component({ verified }) {
    control.current = useNavigation({
      platform: 'synology', adminRoleVerified: verified,
    })
    return React.createElement('route-state', {
      view: control.current.selected,
      revision: control.current.pageRevision,
    })
  }
  let app
  Renderer.act(() => {
    app = Renderer.create(React.createElement(Component, { verified: initialRole }))
  })
  return {
    control,
    renderRole: verified => Renderer.act(() => app.update(
      React.createElement(Component, { verified }))),
    close: () => Renderer.act(() => app.unmount()),
  }
}

test('rapid route changes use latest intent, never stale closure or privileged bypass', () => {
  priorityEvents.length = 0
  const h = harness()
  Renderer.act(() => {
    assert.equal(h.control.current.navigate('files'), true)
    assert.equal(h.control.current.navigate('gallery'), true)
    assert.equal(h.control.current.navigate('admin-users'), false)
  })
  assert.equal(h.control.current.selected, 'gallery')
  assert.equal(h.control.current.pageRevision, 0)
  assert.deepEqual(priorityEvents, ['synology:files', 'synology:gallery'])
  Renderer.act(() => {
    assert.equal(h.control.current.navigate('gallery'), true)
  })
  assert.equal(h.control.current.pageRevision, 1)
  assert.deepEqual(priorityEvents, ['synology:files', 'synology:gallery'],
    'same-route page remount cannot cancel durable work by firing a fake route change')
  h.close()
})

test('loss of verified Server-admin role retires privileged navigation', () => {
  priorityEvents.length = 0
  const h = harness(true)
  Renderer.act(() => {
    h.control.current.navigate('admin-services')
  })
  assert.equal(h.control.current.selected, 'admin-services')
  h.renderRole(false)
  assert.equal(h.control.current.selected, 'overview')
  assert.deepEqual(priorityEvents, ['synology:admin-services', 'synology:overview'])
  h.close()
})

test('DSM only mounts the canonical app and consumes the shared controller', () => {
  const dsm = read('web/src/synology.tsx')
  const index = read('ui/shared/src/mui/index.tsx')
  assert.match(dsm, /useXDriveWorkspaceNavigationState\(/)
  assert.match(dsm, /revision=\{pageRevision\}/)
  assert.match(dsm, /<XDriveApp\b/)
  assert.doesNotMatch(dsm, /xDriveEnterForegroundPage\(/)
  assert.doesNotMatch(dsm, /<XDriveAppPageOutlet\b|<XDriveAppRouteContent\b/)
  assert.match(index, /export \* from '\.\/WorkspaceNavigationState'/)
})
