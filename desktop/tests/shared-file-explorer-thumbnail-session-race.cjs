const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  const react = {
    createContext(defaultValue) {
      return { Provider: Symbol('Provider'), defaultValue }
    },
    useContext(context) {
      return context.defaultValue
    },
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = {
          kind: 'memo',
          deps: deps ? [...deps] : undefined,
          value: factory(),
        }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        pendingEffects.push({
          index,
          effect,
          deps: deps ? [...deps] : undefined,
        })
      }
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } }
      return slots[index].value
    },
    useState(initialValue) {
      const index = cursor++
      if (!slots[index]) {
        slots[index] = {
          kind: 'state',
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
      }
      return [slots[index].value, setValue]
    },
  }

  return {
    react,
    render(factory) {
      cursor = 0
      pendingEffects = []
      const value = factory()
      for (const pending of pendingEffects) {
        const previous = slots[pending.index]
        if (typeof previous?.cleanup === 'function') previous.cleanup()
        const cleanup = pending.effect()
        slots[pending.index] = {
          kind: 'effect',
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return value
    },
  }
}

function loadThumbnailProvider(runtime) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerThumbnail.tsx',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText

  const jsxRuntime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
    Fragment: Symbol('Fragment'),
  }
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return runtime.react
    if (request === 'react/jsx-runtime') return jsxRuntime
    if (request === '@mui/material') return { Box: () => null }
    if (request === './MediaLoadProgress') {
      return { XDriveMediaLoadingProgress: () => null }
    }
    if (request === './LivePhotoSurface') {
      return { XDriveLivePhotoGlyph: () => null }
    }
    if (request === '@mui/icons-material/PlayCircleOutlineRounded') {
      return { __esModule: true, default: () => null }
    }
    return require(request)
  }

  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    localRequire,
  )
  return mod.exports.XDriveFileExplorerThumbnailProvider
}

test('FileExplorer thumbnail cache is isolated by account interaction lifecycle', () => {
  const runtime = createHookRuntime()
  const ThumbnailProvider = loadThumbnailProvider(runtime)
  const loadThumbnail = async () => 'blob:thumbnail'

  const render = (lifecycleKey) => runtime.render(() => ThumbnailProvider({
    lifecycleKey,
    loadThumbnail,
    children: null,
  }))

  const accountA = render('account-a')
  const cacheA = accountA.props.value.cache
  cacheA.values.set('number:1:7:2026-10-08', 'blob:account-a')
  cacheA.leases.set('blob:account-a', 1)

  const accountB = render('account-b')
  const cacheB = accountB.props.value.cache

  assert.notEqual(
    cacheB,
    cacheA,
    'account lifecycle change must create a fresh thumbnail cache even when the loader callback identity is stable',
  )
  assert.equal(
    cacheA.disposed,
    true,
    'the previous account thumbnail cache must be disposed so late account-A completions cannot write into account B',
  )
  assert.equal(
    cacheA.retired.has('blob:account-a'),
    true,
    'disposing an account cache must retire rather than immediately revoke an actively leased thumbnail',
  )
  assert.equal(
    cacheB.values.size,
    0,
    'account B must never reuse account-A thumbnail URLs keyed only by file id/revision',
  )
})
