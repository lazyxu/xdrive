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

function loadRecentHook(react) {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerRecentController.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => request === 'react' ? react : require(request)
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerRecent
}

async function flushAsync() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

function recentItem(name, type = 'file', accessedAt = '2026-10-09T00:00:00Z') {
  return {
    node: { id: 42, name, type, revision: 1 },
    path: '/' + name,
    crumbs: [{ id: 1, name: 'My Files' }],
    accessed_at: accessedAt,
  }
}

test('Recent file activation completing after account switch cannot touch the new account', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)
  const opened = deferred()
  const touched = []
  let account = 'A'
  let lifecycleKey = 'server-a:user-a'
  let openedA = 0

  const render = () => runtime.render(() => useRecent({
    lifecycleKey,
    enabled: true,
    loadItems: async () => [
      recentItem(account === 'A' ? 'A-secret.txt' : 'B-current.txt'),
    ],
    touchItem: async (nodeID) => {
      touched.push({ account, nodeID })
      return recentItem(
        account === 'A' ? 'A-secret.txt' : 'B-current.txt',
        'file',
        '2026-10-09T01:00:00Z',
      )
    },
    clearItems: async () => {},
  }))

  render()
  await flushAsync()
  let recent = render()
  assert.deepEqual(recent.items.map((item) => item.name), ['A-secret.txt'])

  const pendingA = recent.activate(42, {
    onFile: async (raw) => {
      openedA += 1
      assert.equal(raw.node.name, 'A-secret.txt')
      await opened.promise
      return true
    },
    onDirectory: async () => { throw new Error('unexpected directory activation') },
  })
  await flushAsync()
  assert.equal(openedA, 1, 'old-account file handler must really be awaiting completion')

  account = 'B'
  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  recent = render()
  assert.deepEqual(recent.items.map((item) => item.name), ['B-current.txt'])

  opened.resolve()
  const activated = await pendingA
  await flushAsync()
  recent = render()

  assert.deepEqual(
    touched,
    [],
    'an account-A onFile completion must not submit touchItem(42) through account B',
  )
  assert.equal(
    activated,
    false,
    'an activation whose account lifecycle ended must resolve as stale',
  )
  assert.equal(recent.items[0]?.name, 'B-current.txt')
  assert.equal(recent.items[0]?.accessedAt, '2026-10-09T00:00:00Z')
})

test('Recent directory activation does not report success after account lifecycle changes', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)
  const navigate = deferred()
  let account = 'A'
  let lifecycleKey = 'server-a:user-a'
  let startedA = 0

  const render = () => runtime.render(() => useRecent({
    lifecycleKey,
    enabled: true,
    loadItems: async () => [
      recentItem(account === 'A' ? 'A-folder' : 'B-folder', 'dir'),
    ],
    touchItem: async () => { throw new Error('directory activation must not touch') },
    clearItems: async () => {},
  }))

  render()
  await flushAsync()
  let recent = render()
  const pendingA = recent.activate(42, {
    onDirectory: async () => {
      startedA += 1
      await navigate.promise
      return true
    },
    onFile: async () => { throw new Error('unexpected file activation') },
  })
  await flushAsync()
  assert.equal(startedA, 1)

  account = 'B'
  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  recent = render()
  assert.equal(recent.items[0]?.name, 'B-folder')

  navigate.resolve()
  assert.equal(
    await pendingA,
    false,
    'the account-A directory activation must not return success in account B',
  )
})

test('Recent same-account file activation still records the access once', async () => {
  const runtime = createHookRuntime()
  const useRecent = loadRecentHook(runtime.react)
  const touched = []
  const render = () => runtime.render(() => useRecent({
    lifecycleKey: 'server:user',
    enabled: true,
    loadItems: async () => [recentItem('Report.txt')],
    touchItem: async (id) => {
      touched.push(id)
      return recentItem('Report.txt', 'file', '2026-10-09T02:00:00Z')
    },
    clearItems: async () => {},
  }))

  render()
  await flushAsync()
  let recent = render()
  const activated = await recent.activate(42, {
    onFile: async () => true,
    onDirectory: async () => { throw new Error('unexpected directory') },
  })
  await flushAsync()
  recent = render()

  assert.equal(activated, true)
  assert.deepEqual(touched, [42])
  assert.equal(recent.items[0]?.accessedAt, '2026-10-09T02:00:00Z')
})
