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

  const virtualCollection = {
    loadedItems: new Map(),
    totalCount: null,
    ensureViewport: async () => {},
    collectRange: async () => null,
    reset: () => {},
    primePage: () => {},
  }

  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') {
      return {
        jsx: () => null,
        jsxs: () => null,
        Fragment: Symbol('Fragment'),
      }
    }
    if (
      request === '@mui/icons-material/DeleteForeverRounded' ||
      request === '@mui/icons-material/RestoreFromTrashRounded'
    ) {
      return { __esModule: true, default: () => null }
    }
    if (request === './ConfirmDialog') {
      return { XDriveConfirmDialog: () => null }
    }
    if (request === './VirtualCollectionController') {
      return { useXDriveVirtualCollection: () => virtualCollection }
    }
    return require(request)
  }

  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    localRequire,
  )
  return mod.exports.useXDriveFileExplorerTrash
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function node(id, name) {
  return {
    id,
    name,
    type: 'file',
    size: 1,
    revision: 1,
    updated_at: '2026-10-08T00:00:00Z',
    deleted_at: '2026-10-08T00:00:00Z',
  }
}

test('Trash account lifecycle change rejects stale restore ownership while remaining enabled', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)

  const nodeA = node(1, 'A.txt')
  const nodeB = node(2, 'B.txt')
  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let restoreBCalls = 0
  const feedback = []
  const errors = []
  let changedCalls = 0

  const adapterA = {
    listTrash: async () => [nodeA],
    restoreTrash: () => new Promise((resolve) => {
      releaseA = resolve
    }),
    deleteTrash: async () => {},
  }
  const adapterB = {
    listTrash: async () => [nodeB],
    restoreTrash: async () => {
      restoreBCalls += 1
    },
    deleteTrash: async () => {},
  }
  let adapter = adapterA

  const render = () => runtime.render(() => useTrash({
    enabled: true,
    lifecycleKey,
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: (error) => errors.push(error),
    onFeedback: (message) => feedback.push(message),
    onChanged: async () => {
      changedCalls += 1
    },
  }))

  render()
  await flushAsync()
  let trash = render()
  assert.deepEqual(trash.items.map((item) => Number(item.id)), [1])

  trash.getItemMenuItems(trash.items[0])[0].onSelect()
  await flushAsync()
  trash = render()
  assert.equal(typeof releaseA, 'function')
  assert.equal(trash.working, true)

  lifecycleKey = 'server-b:user-b'
  adapter = adapterB
  render()
  await flushAsync()
  trash = render()

  assert.equal(
    trash.working,
    false,
    'account lifecycle change must release the old Trash working ownership',
  )
  assert.deepEqual(
    trash.items.map((item) => Number(item.id)),
    [2],
    'account lifecycle change must replace old Trash data with the new account',
  )

  trash.getItemMenuItems(trash.items[0])[0].onSelect()
  await flushAsync()
  assert.equal(
    restoreBCalls,
    1,
    'new account Trash restore must not be blocked by the previous account operation',
  )

  releaseA()
  await flushAsync()
  trash = render()

  assert.deepEqual(
    trash.items.map((item) => Number(item.id)),
    [2],
    'stale account-A restore completion must not refresh old Trash data into account B',
  )
  assert.deepEqual(feedback, ['项目已恢复'])
  assert.equal(changedCalls, 1)
  assert.deepEqual(errors, [])
})


test('Trash account lifecycle change clears a stale permanent-delete target', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)

  const nodeA = node(1, 'A.txt')
  const nodeB = node(2, 'B.txt')
  let lifecycleKey = 'server-a:user-a'
  let adapter = {
    listTrash: async () => [nodeA],
    restoreTrash: async () => {},
    deleteTrash: async () => {},
  }

  const render = () => runtime.render(() => useTrash({
    enabled: true,
    lifecycleKey,
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: () => {},
  }))

  render()
  await flushAsync()
  let trash = render()
  const deleteItem = trash.getItemMenuItems(trash.items[0])
    .find((item) => item.id === 'trash-delete-forever')
  deleteItem.onSelect()
  trash = render()
  assert.equal(Number(trash.deleteTarget?.id), 1)

  lifecycleKey = 'server-b:user-b'
  adapter = {
    listTrash: async () => [nodeB],
    restoreTrash: async () => {},
    deleteTrash: async () => {},
  }
  render()
  await flushAsync()
  trash = render()

  assert.equal(
    trash.deleteTarget,
    null,
    'an account-A permanent-delete confirmation must not survive into account B',
  )
  assert.deepEqual(trash.items.map((item) => Number(item.id)), [2])
})
