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
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } }
      return slots[index].value
    },
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { kind: 'memo', deps: deps ? [...deps] : undefined, value: factory() }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { kind: 'callback', deps: deps ? [...deps] : undefined, value: callback }
      }
      return slots[index].value
    },
    useEffect(effect, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        pendingEffects.push({ index, effect, deps: deps ? [...deps] : undefined })
      }
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

function loadColumnView(runtime) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerColumnView.tsx',
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
  const mui = new Proxy({}, {
    get: (_target, key) => function MockMui(props) {
      return { type: String(key), props }
    },
  })
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return runtime.react
    if (request === 'react/jsx-runtime') return jsxRuntime
    if (request === '@mui/material') return mui
    if (request.startsWith('@mui/icons-material/')) {
      return { __esModule: true, default: () => null }
    }
    if (request === './AutoLoadSentinel') {
      return { XDriveAutoLoadSentinel: () => null }
    }
    return require(request)
  }

  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    localRequire,
  )
  return mod.exports.XDriveFileExplorerColumnView
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer Column View reloads identical crumb ids after account lifecycle changes', async () => {
  const runtime = createHookRuntime()
  const ColumnView = loadColumnView(runtime)

  let account = 'A'
  const requests = []
  const loadPage = async (parentID, cursor, signal) => {
    requests.push({ account, parentID, cursor, signal })
    return {
      items: [{
        id: account === 'A' ? 101 : 202,
        name: account === 'A' ? 'A-only.txt' : 'B-only.txt',
        kind: 'file',
      }],
      nextCursor: '',
    }
  }

  const crumbs = [{ id: 1, name: '我的文件' }]
  const render = (lifecycleKey) => runtime.render(() => ColumnView({
    lifecycleKey,
    crumbs,
    selectedIDs: [],
    loadPage,
    onNavigate: () => {},
    onSelect: () => {},
    onOpenFile: () => {},
  }))

  render('server-a:user-a')
  await flushAsync()
  render('server-a:user-a')

  assert.equal(requests.length, 1)
  assert.equal(requests[0].account, 'A')

  account = 'B'
  render('server-b:user-b')
  await flushAsync()
  render('server-b:user-b')

  assert.equal(
    requests.length,
    2,
    'account lifecycle change must reload Column View even when root crumb ids and loader callback identity are unchanged',
  )
  assert.equal(
    requests[1]?.account,
    'B',
    'the second Column View request must belong to the new account lifecycle',
  )
})


test('Web and Desktop bind shared FileExplorer interaction scope to account lifecycle', () => {
  const explorerSource = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx'),
    'utf8',
  )
  const desktopSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'),
    'utf8',
  )
  const webSource = fs.readFileSync(
    path.join(repo, 'web', 'src', 'WebFileExplorer.tsx'),
    'utf8',
  )

  assert.ok(
    explorerSource.includes("interactionLifecycleKey,\n    virtualCollection?.interactionKey ?? derivedPath"),
    'shared FileExplorer interaction scope must include the account lifecycle key',
  )
  assert.ok(
    explorerSource.includes('lifecycleKey={interactionScopeKey}'),
    'Column View must use the combined interaction scope lifecycle',
  )
  assert.ok(
    desktopSource.includes("interactionLifecycleKey={navigationSessionStorageKey ?? ''}"),
    'Desktop must bind FileExplorer interaction state to Server+username navigation lifecycle',
  )
  assert.ok(
    webSource.includes("interactionLifecycleKey={navigationSessionStorageKey ?? ''}"),
    'Web must bind FileExplorer interaction state to username navigation lifecycle',
  )
})
