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
        slots[index].value = typeof nextValue === 'function'
          ? nextValue(current)
          : nextValue
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

  const virtualCollection = {
    totalCount: null,
    loadedItems: new Map(),
    reset: () => {},
    primePage: () => {},
    ensureViewport: async () => {},
    collectRange: async () => null,
  }

  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === 'react/jsx-runtime') {
      return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    }
    if (
      request === '@mui/icons-material/DeleteForeverRounded' ||
      request === '@mui/icons-material/RestoreFromTrashRounded'
    ) return { __esModule: true, default: () => null }
    if (request === './ConfirmDialog') return { XDriveConfirmDialog: () => null }
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

function trashNode() {
  return {
    id: 1,
    name: 'A.txt',
    type: 'file',
    size: 1,
    revision: 1,
    updated_at: '2026-10-09T00:00:00Z',
    deleted_at: '2026-10-09T00:00:00Z',
  }
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

test('Trash restore uses a synchronous mutex against same-tick duplicate submission', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)
  const node = trashNode()
  const pending = deferred()
  let restoreCalls = 0

  const adapter = {
    listTrash: async () => [node],
    restoreTrash: async () => {
      restoreCalls += 1
      await pending.promise
    },
    deleteTrash: async () => {},
  }

  const render = () => runtime.render(() => useTrash({
    enabled: true,
    lifecycleKey: 'server:user',
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: (error) => { throw error },
    onChanged: async () => {},
  }))

  render()
  await flushAsync()
  const trash = render()
  const restore = trash.getItemMenuItems(trash.items[0])
    .find((item) => item.id === 'trash-restore')

  restore.onSelect()
  restore.onSelect()
  await flushAsync()

  assert.equal(
    restoreCalls,
    1,
    'two same-tick restore activations must submit only one adapter restore',
  )

  pending.resolve()
  await flushAsync()
})

test('Trash permanent delete uses a synchronous mutex against same-tick duplicate confirmation', async () => {
  const runtime = createHookRuntime()
  const useTrash = loadTrashHook(runtime.react)
  const node = trashNode()
  const pending = deferred()
  let deleteCalls = 0

  const adapter = {
    listTrash: async () => [node],
    restoreTrash: async () => {},
    deleteTrash: async () => {
      deleteCalls += 1
      await pending.promise
    },
  }

  const render = () => runtime.render(() => useTrash({
    enabled: true,
    lifecycleKey: 'server:user',
    adapter,
    sort: { key: 'name', direction: 'asc' },
    onError: (error) => { throw error },
    onChanged: async () => {},
  }))

  render()
  await flushAsync()
  let trash = render()
  trash.getItemMenuItems(trash.items[0])
    .find((item) => item.id === 'trash-delete-forever')
    .onSelect()
  trash = render()
  assert.equal(trash.deleteTarget?.id, node.id)

  const first = trash.confirmPermanentDelete()
  const second = trash.confirmPermanentDelete()
  await flushAsync()

  assert.equal(
    deleteCalls,
    1,
    'two same-tick permanent-delete confirmations must submit only one adapter delete',
  )

  pending.resolve()
  await Promise.all([first, second])
})
