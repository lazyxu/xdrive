import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/webAppRuntime.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
})
assert.equal(compiled.diagnostics?.length ?? 0, 0, 'real browser runtime must transpile')
const react = {
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => undefined]
  },
  useRef(value) { return { current: value } },
  useCallback(fn) { return fn },
  useEffect(effect) { effect() },
  useLayoutEffect(effect) { effect() },
  startTransition(fn) { fn() },
}
const parseHash = hash => {
  const match = /^#\/app\/([a-z-]+)$/.exec(hash)
  return match ? { app: match[1], params: {} } : null
}
const module = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(module, module.exports, id => {
  if (id === 'react') return react
  if (id === '../../ui/shared/src/mui/ViewerForegroundPriority')
    return { xDriveEnterForegroundPage: () => undefined }
  if (id === '../../ui/shared/src') return {
    xDriveParseWebAppHash: parseHash,
    xDriveWebAppHash: route => '#/app/' + route.app,
    xDriveWebAppViewer: () => false,
  }
  throw Error('unexpected browser runtime dependency: ' + id)
})
const { xDriveWebMobileColdLanding: landing, useXDriveWebAppRuntime } = module.exports
const gallery = { app: 'gallery', params: {} }
const home = { app: 'overview', params: {} }
assert.deepEqual(landing('', true), gallery, 'Mobile Web/PWA bare root enters cloud Gallery')
assert.equal(landing('', false), null, 'wide Web keeps the canonical Home fallback')
for (const hash of [
  '#/app/overview', '#/app/files', '#/app/gallery', '#/s/opaque',
  '#/app/unknown', '#/', '#old-client',
]) {
  assert.equal(landing(hash, true), null,
    'explicit or unknown hashes must not be reinterpreted as a Gallery request: ' + hash)
}
function startup(rawHash, compact, denyMedia = false) {
  const previous = globalThis.window
  const writes = []
  const location = { hash: rawHash }
  globalThis.window = {
    location,
    matchMedia: () => {
      if (denyMedia) throw Error('Safari media getter denied')
      return { matches: compact }
    },
    history: {
      state: null,
      replaceState(state, _title, url) {
        this.state = state
        const target = String(url)
        if (target.startsWith('#')) location.hash = target
        writes.push({ state, url: target })
      },
      pushState() { throw Error('bare startup must not push browser history') },
    },
    addEventListener() {},
    removeEventListener() {},
  }
  try {
    const route = useXDriveWebAppRuntime().route
    return { route, finalHash: location.hash, writes }
  } finally {
    globalThis.window = previous
  }
}
assert.deepEqual(startup('', true).route, gallery, 'actual hook uses mobile Gallery')
assert.equal(startup('', true).finalHash, '#/app/gallery',
  'first mobile route must have canonical Gallery hash without a pushed history entry')
assert.deepEqual(startup('', false).route, home, 'wide Web keeps Home')
assert.deepEqual(startup('', true, true).route, home,
  'denied optional Safari matchMedia must not break first Web/PWA render')
assert.deepEqual(startup('#/app/files', true).route, { app: 'files', params: {} },
  'real Files deep link must win')
assert.deepEqual(startup('#/app/gallery', false).route, gallery,
  'real Gallery deep link must win regardless of breakpoint')
assert.deepEqual(startup('#/unknown', true).route, home,
  'unknown hashes keep the existing canonical Home fallback')

assert.match(source,
  /return xDriveParseWebAppHash\(window\.location\.hash\) \?\? \{ app: 'overview', params: \{\} \}/,
  'generic Web route fallback must remain unchanged for existing history/desktop contracts')
assert.match(source, /useState<XDriveWebAppRoute>\(\(\) => initialRootRoute\(\)\)/)
assert.match(source, /const landing = initialRootRoute\(\)/,
  'initial hook state and initial hash normalization must agree')
assert.match(source, /window\.matchMedia\('\(max-width:899\.95px\)'\)/,
  'use the existing compact workspace breakpoint')
assert.match(source, /window\.addEventListener\('hashchange', sync\)/,
  'protected browser Back/Forward routing must stay in place')
assert.doesNotMatch(source, /\.\/mobileDefaultLandingRoute/,
  'existing restricted Safari and private-map test harnesses must retain dependency boundaries')
console.log('Web Mobile/PWA Gallery-first cold root: real router/hook, deep links, Safari, history passed')
