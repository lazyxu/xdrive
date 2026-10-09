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
      const result = factory()
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
      return result
    },
  }
}

function loadNavigationPane(runtime) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerNavigationPane.tsx',
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
  const mui = {
    useMediaQuery: () => false,
    Box: 'Box',
    Checkbox: 'Checkbox',
    CircularProgress: 'CircularProgress',
    Collapse: 'Collapse',
    Divider: 'Divider',
    IconButton: 'IconButton',
    ListItemButton: 'ListItemButton',
    Menu: 'Menu',
    MenuItem: 'MenuItem',
    Stack: 'Stack',
    Tooltip: 'Tooltip',
    Typography: 'Typography',
  }
  const stubDefault = () => null
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return runtime.react
    if (request === 'react/jsx-runtime') return jsxRuntime
    if (request === '@mui/material') return mui
    if (request.startsWith('@mui/icons-material/')) {
      return { __esModule: true, default: stubDefault }
    }
    if (request === './AutoLoadSentinel') {
      return { XDriveAutoLoadSentinel: 'XDriveAutoLoadSentinel' }
    }
    if (request === './FileExplorerExternalDrop') {
      return {
        xDriveFileExplorerReadExternalDrop: async () => ({ files: [], directories: [] }),
      }
    }
    if (request === './FileExplorerThumbnail') {
      return { XDriveFileExplorerThumbnail: 'XDriveFileExplorerThumbnail' }
    }
    if (request === './FileExplorer') {
      return {
        XDriveFileExplorerAvailabilityBadge: 'XDriveFileExplorerAvailabilityBadge',
        XDriveFileExplorerItemIcon: 'XDriveFileExplorerItemIcon',
        xDriveFileSupportsThumbnail: () => false,
      }
    }
    if (request === '../file-explorer-drag') {
      return {
        XDRIVE_FILE_EXPLORER_DRAG_MIME: 'application/x-xdrive',
        xDriveFileExplorerDecodeDragIDs: () => [],
      }
    }
    return {}
  }

  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.XDriveFileExplorerNavigationPane
}

function childrenOf(node) {
  if (!node || typeof node !== 'object') return []
  const value = node.props?.children
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function walk(node, output = []) {
  if (node == null || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) walk(child, output)
    return output
  }
  if (typeof node !== 'object') return output
  output.push(node)
  if (node.type === 'Collapse' && node.props?.in === false) return output
  for (const child of childrenOf(node)) walk(child, output)
  return output
}

function findByAriaLabel(tree, label) {
  return walk(tree).find((node) => node.props?.['aria-label'] === label)
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('navigation tree cache cannot cross account lifecycle when root ids are reused', async () => {
  const runtime = createHookRuntime()
  const NavigationPane = loadNavigationPane(runtime)

  let lifecycleKey = 'server-a:user-a'
  let account = 'A'
  let callsA = 0
  let callsB = 0

  const loadDirectoryPage = async () => {
    if (account === 'A') {
      callsA += 1
      return {
        items: [{ id: 2, name: 'A-child', type: 'dir' }],
        nextCursor: '',
        hasMore: false,
      }
    }
    callsB += 1
    return {
      items: [{ id: 3, name: 'B-child', type: 'dir' }],
      nextCursor: '',
      hasMore: false,
    }
  }

  const render = () => runtime.render(() => NavigationPane({
    lifecycleKey,
    currentCrumbs: [{ id: 1, name: '我的文件' }],
    loadDirectoryPage,
    onNavigate: () => {},
  }))

  let tree = render()
  const expandA = findByAriaLabel(tree, '展开 我的文件')
  assert.ok(expandA, 'root expand control must be present')
  expandA.props.onClick({ stopPropagation() {} })
  await flushAsync()
  tree = render()

  assert.ok(findByAriaLabel(tree, 'A-child'), 'account A child should be rendered after expansion')
  assert.equal(callsA, 1)

  account = 'B'
  lifecycleKey = 'server-b:user-b'
  tree = render()
  await flushAsync()
  tree = render()

  assert.equal(
    Boolean(findByAriaLabel(tree, 'A-child')),
    false,
    'account B must not render children cached by account A when root ids are reused',
  )

  const expandB = findByAriaLabel(tree, '展开 我的文件')
  assert.ok(expandB, 'tree should reset expansion after account lifecycle changes')
  expandB.props.onClick({ stopPropagation() {} })
  await flushAsync()
  tree = render()

  assert.ok(findByAriaLabel(tree, 'B-child'), 'account B should load its own tree children')
  assert.equal(callsB, 1)
})
