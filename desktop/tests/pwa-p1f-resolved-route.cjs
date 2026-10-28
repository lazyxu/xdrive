'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const runtimeText = fs.readFileSync(path.join(root, 'web/src/webAppRuntime.ts'), 'utf8')
const appText = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')

function exerciseRuntime() {
  const listeners = new Map()
  const route = app => ({ app, params: {} })
  const window = {
    location: { hash: '#/app/files', href: 'https://xdrive.test/#/app/files' },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    open: () => assert.fail('navigation must not open a new tab'),
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn) },
    removeEventListener() {},
  }
  window.history = {
    state: { xdriveHistoryIndex: 0 },
    pushState(next, _title, hash) { this.state = next; window.location.hash = hash },
    replaceState(next, _title, hash) { this.state = next; if (hash) window.location.hash = String(hash).split('#').at(-1).replace(/^/, '#') },
    go() { assert.fail('no history guard should trigger for clean routes') },
    back() { assert.fail('no return guard should trigger') },
  }
  const trace = []
  const react = {
    useState(init) { const initial = typeof init === 'function' ? init() : init; return [initial, next => trace.push({ mode: 'commit', app: next.app })] },
    useRef(value) { return { current: value } },
    useCallback(fn) { return fn },
    useEffect(effect) { effect() },
    useLayoutEffect(effect) { effect() },
    startTransition(fn) { trace.push({ mode: 'transition' }); fn() },
  }
  const shared = {
    xDriveParseWebAppHash(hash) { const m = /^#\/app\/([a-z-]+)/.exec(hash); return m ? route(m[1]) : null },
    xDriveWebAppHash: x => '#/app/' + x.app,
    xDriveWebAppViewer: () => false,
  }
  const compiled = ts.transpileModule(runtimeText, {
    fileName: 'webAppRuntime.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.equal((compiled.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0)
  const coordinatorText = fs.readFileSync(path.join(root, 'ui/shared/src/mui/ViewerForegroundPriority.ts'), 'utf8')
  const coordinatorJS = ts.transpileModule(coordinatorText, {
    fileName: 'ViewerForegroundPriority.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const coordinator = { exports: {} }
  new Function('exports', 'module', coordinatorJS)(coordinator.exports, coordinator)
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'window', compiled.outputText)(
    mod, mod.exports,
    name => name === 'react' ? react :
      name === '../../ui/shared/src' ? shared :
      name === '../../ui/shared/src/mui/ViewerForegroundPriority' ? coordinator.exports : assert.fail(name), window,
  )
  return { runtime: mod.exports.useXDriveWebAppRuntime(), route, trace, window,
    dispatch: kind => (listeners.get(kind) || []).forEach(fn => fn({ type: kind })) }
}

test('cold lazy workspace keeps transition; resolved Files/Gallery route commits synchronously', () => {
  const h = exerciseRuntime()
  h.runtime.launch(h.route('gallery'))
  assert.equal(h.trace.filter(x => x.mode === 'transition').length, 1)
  h.runtime.markLoadedWorkspaceApp('gallery')
  h.runtime.launch(h.route('files'))
  assert.equal(h.trace.filter(x => x.mode === 'transition').length, 2)
  h.runtime.markLoadedWorkspaceApp('files')
  h.runtime.launch(h.route('gallery'))
  h.runtime.launch(h.route('files'))
  assert.equal(h.trace.filter(x => x.mode === 'transition').length, 2)
  h.runtime.launch(h.route('admin-users'))
  assert.equal(h.trace.filter(x => x.mode === 'transition').length, 3,
    'other cold and permission-gated programs preserve the original transition')
  h.window.location.hash = '#/app/gallery'
  h.dispatch('hashchange')
  assert.equal(h.trace.filter(x => x.mode === 'transition').length, 3,
    'browser Back/Forward to a previously resolved Gallery is also synchronous')
})

test('resolved flag is earned inside original workspace Suspense, never on route intent', () => {
  const marker = appText.indexOf('<XDriveCommittedWorkspaceRoute view={appView} onReady={markLoadedWorkspaceApp} />')
  const suspense = appText.indexOf('data-xdrive-web-route-first-read')
  const end = appText.indexOf('</Suspense>', suspense)
  assert(suspense >= 0 && marker > suspense && marker < end)
  assert(appText.includes("if (view === 'files' || view === 'gallery') onReady(view)"))
  assert(!appText.includes('onReady(route.app)'))
  assert(runtimeText.includes("new Set<'files' | 'gallery'>()"))
  assert.equal((runtimeText.match(/startTransition\(\(\) => setRoute\(next\)\)/g)||[]).length,2,
    'first-time lazy transitions must remain intact')
  assert.equal((runtimeText.match(/resolvedWorkspacesRef.current.has\(next.app/g)||[]).length,2)
  assert(!appText.includes('skipWaiting('))
})
