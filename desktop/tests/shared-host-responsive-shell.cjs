'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' }

function loadProduction(relative, dependencies) {
  const filename = path.join(root, relative)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.deepEqual((compiled.diagnostics ?? [])
    .filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, name => {
      assert.ok(Object.hasOwn(dependencies, name), 'unapproved production dependency: ' + name)
      return dependencies[name]
    },
  )
  return mod.exports
}

const app = loadProduction('ui/shared/src/mui/XDriveApp.tsx', {
  'react': { useLayoutEffect() {} },
  'react/jsx-runtime': jsxRuntime,
  './ViewerForegroundPriority': { xDriveEnterForegroundPage() {} },
  './WorkspaceShell': { XDriveWorkspaceShell: 'WorkspaceShell' },
  './WorkspaceSidebar': { XDriveWorkspaceSidebar: 'WorkspaceSidebar' },
  './XDriveAppRouteContent': { XDriveAppRouteContent: 'RouteContent' },
  './WorkspaceRoute': { xDriveWorkspaceNavigationAllowed() { return true } },
}).XDriveApp

const routeContent = loadProduction('ui/shared/src/mui/XDriveAppRouteContent.tsx', {
  'react/jsx-runtime': jsxRuntime,
  './WorkspaceRouteSurface': { XDriveWorkspaceRouteSurface: 'RouteSurface' },
  './XDriveAppPageOutlet': { XDriveAppPageOutlet: 'PageOutlet' },
  './WorkspaceRoute': {
    xDriveIsSharedHostPageRoute: view => view !== 'files',
    xDriveWorkspacePresentation: view => view === 'files' ? 'files' : 'page',
  },
}).XDriveAppRouteContent

function renderApp(platform, extras = {}) {
  return app({
    host: { platform, adminRoleVerified: false },
    view: 'overview',
    sidebar: { ariaLabel: 'xDrive', navAriaLabel: 'xDrive 功能导航' },
    onNavigate() {},
    ...extras,
  })
}
function child(tree, type) {
  const matches = [tree.props.children].flat().filter(node => node && node.type === type)
  assert.equal(matches.length, 1, 'one shared ' + type)
  return matches[0]
}

test('Desktop and DSM render the same responsive shell, sidebar and default page spacing', () => {
  const desktop = renderApp('desktop')
  const dsm = renderApp('synology')
  for (const tree of [desktop, dsm]) {
    assert.equal(tree.type, 'WorkspaceShell')
    assert.equal(tree.props.responsive, true, 'mobile breakpoint cannot depend on Host identity')
    assert.equal(child(tree, 'WorkspaceSidebar').props.responsive, true)
    const route = child(tree, 'RouteContent')
    assert.deepEqual(route.props.pageSx, { p: { xs: 2, md: '34px 40px 48px' } })
    assert.equal(route.props.host.platform, tree === desktop ? 'desktop' : 'synology')
  }
  assert.deepEqual(child(desktop, 'RouteContent').props.pageSx,
    child(dsm, 'RouteContent').props.pageSx)
})

test('Host can override page padding while Files keeps its edge-to-edge viewport', () => {
  const override = { p: 3 }
  const desktop = renderApp('desktop', { pageSx: override })
  assert.equal(child(desktop, 'RouteContent').props.pageSx, override)
  for (const platform of ['desktop', 'synology']) {
    const host = { platform }
    const overview = routeContent({ host, view: 'overview', pageSx: override })
    assert.equal(overview.type, 'RouteSurface')
    assert.equal(overview.props.view, 'overview')
    assert.equal(overview.props.sx, override)
    const files = routeContent({ host, view: 'files', pageSx: override })
    assert.equal(files.type, 'RouteSurface')
    assert.equal(files.props.view, 'files')
    assert.equal(files.props.sx, undefined, 'Files must not inherit page padding')
    assert.equal(child(files, 'PageOutlet').props.view, 'files')
  }
})
