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
          value: typeof initialValue === 'function' ? initialValue() : initialValue,
        }
      }
      const setValue = (nextValue) => {
        const current = slots[index].value
        slots[index].value = typeof nextValue === 'function' ? nextValue(current) : nextValue
      }
      return [slots[index].value, setValue]
    },
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { deps: deps ? [...deps] : undefined, value: callback }
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
          deps: pending.deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
      return result
    },
  }
}

function loadVersionHistoryDialog(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'VersionHistoryDialog.tsx',
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

  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') {
      return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    }
    if (request === '@mui/material') {
      return new Proxy({}, { get: (_target, name) => String(name) })
    }
    if (request === '../format') return { formatBytes: (value) => String(value) }
    if (request === './DialogTitle') {
      return { XDriveDialogTitle: 'XDriveDialogTitle', xDriveDialogPaperProps: {} }
    }
    if (request === './ActionButton') return { XDriveActionButton: 'XDriveActionButton' }
    if (request === './ConfirmDialog') return { XDriveConfirmDialog: 'XDriveConfirmDialog' }
    if (request === './DialogActions') return { XDriveDialogActions: 'XDriveDialogActions' }
    if (request === './DialogContent') return { XDriveDialogContent: 'XDriveDialogContent' }
    if (request === './StatePanel') return { XDriveStatePanel: 'XDriveStatePanel' }
    if (request === './TableSurface') return { XDriveTableSurface: 'XDriveTableSurface' }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.XDriveVersionHistoryDialog
}

function findElement(value, predicate) {
  if (value === null || value === undefined || typeof value !== 'object') return null
  if (predicate(value)) return value
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (value.props) {
    for (const child of Object.values(value.props)) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return null
}

function collectStrings(value, out = []) {
  if (value === null || value === undefined || typeof value === 'boolean') return out
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value))
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (typeof value === 'object') {
    if (value.props) {
      for (const [key, child] of Object.entries(value.props)) {
        if (key === 'children' || key === 'title' || key === 'subtitle' || key === 'message') {
          collectStrings(child, out)
        }
      }
    }
  }
  return out
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('older Version History load cannot overwrite a newer node dialog', async () => {
  const runtime = createHookRuntime()
  const VersionHistoryDialog = loadVersionHistoryDialog(runtime.react)

  const nodeA = { id: 1, name: 'A.txt', type: 'file', revision: 10 }
  const nodeB = { id: 2, name: 'B.txt', type: 'file', revision: 20 }
  const versionA = {
    id: 101,
    revision: 101,
    size: 10,
    created_at: '2026-10-07T00:00:00Z',
  }
  const versionB = {
    id: 202,
    revision: 202,
    size: 20,
    created_at: '2026-10-07T00:01:00Z',
  }

  let currentNode = nodeA
  let releaseA
  let releaseB

  const adapter = {
    listVersions: (nodeID) => new Promise((resolve) => {
      if (nodeID === nodeA.id) releaseA = () => resolve([versionA])
      else if (nodeID === nodeB.id) releaseB = () => resolve([versionB])
      else throw new Error('unexpected node')
    }),
    restoreVersion: async (node) => node,
  }

  const onError = (error) => { throw error }
  const render = () => runtime.render(() => VersionHistoryDialog({
    node: currentNode,
    adapter,
    onClose: () => {},
    onError,
  }))

  render()
  await flushAsync()
  assert.equal(typeof releaseA, 'function')

  currentNode = nodeB
  render()
  await flushAsync()
  assert.equal(typeof releaseB, 'function')

  releaseB()
  await flushAsync()
  let tree = render()
  let strings = collectStrings(tree)
  assert.ok(strings.includes('版本历史 — B.txt'))
  assert.ok(strings.includes('r202'))
  assert.equal(strings.includes('r101'), false)

  releaseA()
  await flushAsync()
  tree = render()
  strings = collectStrings(tree)

  assert.ok(strings.includes('版本历史 — B.txt'))
  assert.ok(
    strings.includes('r202'),
    'a late Version History response for A must not replace the newer B version list',
  )
  assert.equal(
    strings.includes('r101'),
    false,
    'A versions must not appear under the B Version History dialog after A resolves late',
  )
})


test('stale Version History restore cannot replace a newer node dialog', async () => {
  const runtime = createHookRuntime()
  const VersionHistoryDialog = loadVersionHistoryDialog(runtime.react)

  const nodeA = { id: 1, name: 'A.txt', type: 'file', revision: 10 }
  const restoredA = { id: 1, name: 'A.txt', type: 'file', revision: 11 }
  const nodeB = { id: 2, name: 'B.txt', type: 'file', revision: 20 }
  const versionA = {
    id: 101,
    revision: 101,
    size: 10,
    created_at: '2026-10-07T00:00:00Z',
  }
  const versionAAfterRestore = {
    id: 111,
    revision: 111,
    size: 11,
    created_at: '2026-10-07T00:02:00Z',
  }
  const versionB = {
    id: 202,
    revision: 202,
    size: 20,
    created_at: '2026-10-07T00:01:00Z',
  }

  let currentNode = nodeA
  let releaseRestoreA
  let aLoads = 0

  const adapter = {
    listVersions: async (nodeID) => {
      if (nodeID === nodeA.id) {
        aLoads += 1
        return aLoads === 1 ? [versionA] : [versionAAfterRestore]
      }
      if (nodeID === nodeB.id) return [versionB]
      throw new Error('unexpected node')
    },
    restoreVersion: (node, version) => {
      assert.equal(node.id, nodeA.id)
      assert.equal(version.id, versionA.id)
      return new Promise((resolve) => {
        releaseRestoreA = () => resolve(restoredA)
      })
    },
  }

  const errors = []
  const restoredNotifications = []
  const render = () => runtime.render(() => VersionHistoryDialog({
    node: currentNode,
    adapter,
    onClose: () => {},
    onError: (error) => errors.push(error),
    onRestored: async (node) => {
      restoredNotifications.push(node.id)
    },
  }))

  render()
  await flushAsync()
  let tree = render()
  let strings = collectStrings(tree)
  assert.ok(strings.includes('版本历史 — A.txt'))
  assert.ok(strings.includes('r101'))

  const restoreButton = findElement(tree, (element) => (
    element.type === 'XDriveActionButton' &&
    collectStrings(element).includes('恢复') &&
    typeof element.props?.onClick === 'function'
  ))
  assert.ok(restoreButton, 'missing restore action')
  restoreButton.props.onClick()
  tree = render()

  const confirm = findElement(tree, (element) => (
    element.type === 'XDriveConfirmDialog' &&
    typeof element.props?.onConfirm === 'function'
  ))
  assert.ok(confirm, 'missing restore confirmation')
  confirm.props.onConfirm()
  await flushAsync()
  assert.equal(typeof releaseRestoreA, 'function')

  // While A restore is still pending, the user switches Version History to B.
  currentNode = nodeB
  render()
  await flushAsync()
  tree = render()
  strings = collectStrings(tree)
  assert.ok(strings.includes('版本历史 — B.txt'))
  assert.ok(strings.includes('r202'))
  assert.equal(strings.includes('r101'), false)

  // A restore completes late. It may finish server-side, but it must not take
  // ownership of the dialog that now belongs to B.
  releaseRestoreA()
  await flushAsync()
  await flushAsync()
  tree = render()
  strings = collectStrings(tree)

  assert.ok(
    strings.includes('版本历史 — B.txt'),
    'a stale restore completion for A must not replace the newer B dialog node',
  )
  assert.ok(
    strings.includes('r202'),
    'a stale restore completion for A must not replace B versions with A versions',
  )
  assert.equal(
    strings.includes('r111'),
    false,
    'post-restore A versions must not appear under the newer B dialog',
  )
  assert.equal(errors.length, 0)
})
