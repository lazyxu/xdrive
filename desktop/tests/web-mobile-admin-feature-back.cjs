const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')

function loadState() {
  const filename = path.join(root, 'web/src/mobileFiveSlotState.ts')
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputText)(
    mod, mod.exports, name => { throw new Error('Unexpected runtime import: ' + name) },
  )
  return mod.exports
}

test('Web Mobile system dependency detail Back stays in same dynamic feature', () => {
  const state = loadState()
  const rootRoute = { app: 'admin-services', params: {} }
  const baidu = { app: 'admin-services', params: { service: 'baidu-map', tab: 'config' } }
  const policy = { app: 'admin-services', params: { policy: 'photo-auto', tab: 'config' } }
  assert.deepEqual(state.xDriveMobileFeatureParentRoute(baidu), rootRoute)
  assert.deepEqual(state.xDriveMobileFeatureParentRoute(policy), rootRoute)
  assert.equal(state.xDriveMobileFeatureParentRoute(rootRoute), null)
  assert.equal(state.xDriveMobileFeatureParentRoute({ app: 'gallery', params: {} }), null)
  assert.equal(state.xDriveMobileFeatureParentRoute({
    app: 'admin-storage', params: { section: 'archive' },
  }).app, 'admin-storage')
})

test('dirty admin dependency detail changes are guarded in both navigation paths', () => {
  const state = loadState()
  const from = { app: 'admin-services', params: { service: 'baidu-map', tab: 'config' } }
  assert.equal(state.xDriveMobileSystemDependenciesRouteChanged(
    from, { app: 'admin-services', params: {} },
  ), true)
  assert.equal(state.xDriveMobileSystemDependenciesRouteChanged(
    from, { app: 'admin-services', params: { service: 'baidu-map', tab: 'verify' } },
  ), true)
  assert.equal(state.xDriveMobileSystemDependenciesRouteChanged(
    from, { app: 'admin-services', params: { service: 'baidu-map', tab: 'config' } },
  ), false)
  assert.equal(state.xDriveMobileSystemDependenciesRouteChanged(
    from, { app: 'files', params: {} },
  ), false)

  const app = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
  assert.match(app, /xDriveMobileSystemDependenciesRouteChanged\(from, to\)/)
  assert.match(app, /xDriveMobileSystemDependenciesRouteChanged\(activeRouteRef\.current, next\)/)
  assert.match(app, /else if \(mobileParent\) launchWebApp\(mobileParent, \{ replace: true \}\)/)
  assert.match(app, /onConfirm=\{\(\) => \{/)
  assert.match(app, /launchWebAppRuntime\(pending\.next, pending\.options\)/)
})
