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
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { deps: deps ? [...deps] : undefined, value: factory() }
      }
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

function loadTrashHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerTrashController.tsx',
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

  const mod = { exports: {} }
  const virtualCollection = {
    totalCount: null,
    loadedItems: new Map(),
    reset: () => {},
    primePage: () => {},
    ensureViewport: () => {},
    collectRange: async () => null,
  }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    }
    if (request === '@mui/icons-material/DeleteForeverRounded') return () => null
    if (request === '@mui/icons-material/RestoreFromTrashRounded') return () => null
    if (request === './ConfirmDialog') return { XDriveConfirmDialog: () => null }
    if (request === './VirtualCollectionController') {
      return { useXDriveVirtualCollection: () => virtualCollection }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerTrash
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('old Trash restore completion cannot clear a newer restore busy lock after disable/re-enable', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)
  const nodeA = {
    id: 1,
    name: 'A.txt',
    type: 'file',
    revision: 'a',
    deleted_at: '2026-10-07T00:00:00Z',
  }
  const nodeB = {
    id: 2,
    name: 'B.txt',
    type: 'file',
    revision: 'b',
    deleted_at: '2026-10-07T00:01:00Z',
  }

  let enabled = true
  let releaseA
  let releaseB
  const adapter = {
    listTrash: async () => [nodeA, nodeB],
    restoreTrash: (node) => new Promise((resolve) => {
      if (node.id === nodeA.id) releaseA = resolve
      else if (node.id === nodeB.id) releaseB = resolve
      else throw new Error('unexpected restore node')
    }),
    deleteTrash: async () => undefined,
  }

  const render = () => runtime.render(() => useTrash({
    enabled,
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: (error) => { throw error },
    onFeedback: () => {},
    onChanged: async () => {},
  }))

  render()
  await flushAsync()
  let trash = render()
  assert.deepEqual(trash.items.map((item) => item.id), [nodeA.id, nodeB.id])

  trash.getItemMenuItems(trash.items[0])
    .find((item) => item.id === 'trash-restore')
    .onSelect()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, 'restore:' + nodeA.id)
  assert.equal(typeof releaseA, 'function')

  enabled = false
  render()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, '')

  enabled = true
  render()
  await flushAsync()
  trash = render()
  assert.deepEqual(trash.items.map((item) => item.id), [nodeA.id, nodeB.id])

  trash.getItemMenuItems(trash.items[1])
    .find((item) => item.id === 'trash-restore')
    .onSelect()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, 'restore:' + nodeB.id)
  assert.equal(typeof releaseB, 'function')

  releaseA()
  await flushAsync()
  await flushAsync()
  trash = render()

  assert.equal(
    trash.workingKey,
    'restore:' + nodeB.id,
    'an older restore completion from the previous Trash lifecycle must not clear the busy lock owned by the newer restore',
  )

  releaseB()
  await flushAsync()
})


test('old Trash permanent-delete completion cannot clear a newer delete target after disable/re-enable', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)
  const nodeA = {
    id: 1,
    name: 'A.txt',
    type: 'file',
    revision: 'a',
    deleted_at: '2026-10-07T00:00:00Z',
  }
  const nodeB = {
    id: 2,
    name: 'B.txt',
    type: 'file',
    revision: 'b',
    deleted_at: '2026-10-07T00:01:00Z',
  }

  let enabled = true
  let releaseDeleteA
  let releaseDeleteB
  let aDeleted = false
  let bDeleted = false

  const adapter = {
    listTrash: async () => [
      ...(!aDeleted ? [nodeA] : []),
      ...(!bDeleted ? [nodeB] : []),
    ],
    restoreTrash: async () => undefined,
    deleteTrash: (node) => new Promise((resolve) => {
      if (node.id === nodeA.id) {
        releaseDeleteA = () => {
          aDeleted = true
          resolve()
        }
      } else if (node.id === nodeB.id) {
        releaseDeleteB = () => {
          bDeleted = true
          resolve()
        }
      } else {
        throw new Error('unexpected delete node')
      }
    }),
  }

  const render = () => runtime.render(() => useTrash({
    enabled,
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: (error) => { throw error },
    onFeedback: () => {},
    onChanged: async () => {},
  }))

  render()
  await flushAsync()
  let trash = render()
  assert.deepEqual(trash.items.map((item) => item.id), [nodeA.id, nodeB.id])

  trash.getItemMenuItems(trash.items[0])
    .find((item) => item.id === 'trash-delete-forever')
    .onSelect()
  trash = render()
  assert.equal(trash.deleteTarget?.id, nodeA.id)

  const pendingDeleteA = trash.confirmPermanentDelete()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, 'delete:' + nodeA.id)
  assert.equal(typeof releaseDeleteA, 'function')

  enabled = false
  render()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, '')
  assert.equal(trash.deleteTarget, null)

  enabled = true
  render()
  await flushAsync()
  trash = render()
  assert.deepEqual(trash.items.map((item) => item.id), [nodeA.id, nodeB.id])

  trash.getItemMenuItems(trash.items[1])
    .find((item) => item.id === 'trash-delete-forever')
    .onSelect()
  trash = render()
  assert.equal(trash.deleteTarget?.id, nodeB.id)

  const pendingDeleteB = trash.confirmPermanentDelete()
  await flushAsync()
  trash = render()
  assert.equal(trash.workingKey, 'delete:' + nodeB.id)
  assert.equal(trash.deleteTarget?.id, nodeB.id)
  assert.equal(typeof releaseDeleteB, 'function')

  releaseDeleteA()
  await pendingDeleteA
  await flushAsync()
  trash = render()

  assert.equal(
    trash.workingKey,
    'delete:' + nodeB.id,
    'older delete completion must not clear the newer delete busy ownership',
  )
  assert.equal(
    trash.deleteTarget?.id,
    nodeB.id,
    'older delete completion from the previous Trash lifecycle must not clear the newer B delete target',
  )

  releaseDeleteB()
  await pendingDeleteB
  await flushAsync()
})
