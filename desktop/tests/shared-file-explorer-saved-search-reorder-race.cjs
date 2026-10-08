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

function loadOrganizationHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerOrganizationController.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    (request) => request === 'react' ? react : require(request),
  )
  return mod.exports.useXDriveFileExplorerOrganization
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function savedSearch(id, name, position) {
  return {
    id,
    name,
    position,
    query: '',
    filters: {},
    grouping: 'none',
    sort: { key: 'name', direction: 'asc' },
  }
}

test('FileExplorer saved-search reorder ignores an older failure after a newer reorder succeeds', async () => {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)

  const first = deferred()
  const second = deferred()
  let reorderCalls = 0
  const errors = []

  const adapter = {
    listTags: async () => [],
    createTag: async () => { throw new Error('unused') },
    updateTag: async () => { throw new Error('unused') },
    deleteTag: async () => {},
    queryNodeTags: async () => [],
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    listSavedSearches: async () => [
      savedSearch(1, 'One', 0),
      savedSearch(2, 'Two', 1),
      savedSearch(3, 'Three', 2),
    ],
    createSavedSearch: async () => { throw new Error('unused') },
    updateSavedSearch: async () => { throw new Error('unused') },
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => {
      reorderCalls += 1
      return reorderCalls === 1 ? first.promise : second.promise
    },
  }

  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server-a:user-a',
    adapter,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let organization = render()
  assert.deepEqual(organization.savedSearches.map((item) => item.id), [1, 2, 3])

  const reorderA = organization.reorderSavedSearches([2, 1, 3])
  await flushAsync()
  organization = render()
  assert.deepEqual(organization.savedSearches.map((item) => item.id), [2, 1, 3])

  const reorderB = organization.reorderSavedSearches([3, 2, 1])
  await flushAsync()
  organization = render()
  assert.equal(
    reorderCalls,
    1,
    'persisted reorder requests must serialize so Server final order is deterministic',
  )
  assert.deepEqual(organization.savedSearches.map((item) => item.id), [3, 2, 1])

  first.reject(new Error('stale first reorder failed'))
  await reorderA
  await flushAsync()
  assert.equal(reorderCalls, 2)

  second.resolve([])
  await reorderB
  await flushAsync()
  organization = render()

  assert.deepEqual(
    organization.savedSearches.map((item) => item.id),
    [3, 2, 1],
    'an older reorder failure must not rollback a newer successful optimistic order',
  )
  assert.deepEqual(
    errors,
    [],
    'an older reorder failure must not surface an error after a newer reorder superseded it',
  )
})


test('FileExplorer saved-search reorder reloads canonical state when the latest queued reorder fails', async () => {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)

  const first = deferred()
  const second = deferred()
  let reorderCalls = 0
  let listCalls = 0
  const errors = []

  const canonical = [
    savedSearch(1, 'One', 0),
    savedSearch(2, 'Two', 1),
    savedSearch(3, 'Three', 2),
  ]

  const adapter = {
    listTags: async () => [],
    createTag: async () => { throw new Error('unused') },
    updateTag: async () => { throw new Error('unused') },
    deleteTag: async () => {},
    queryNodeTags: async () => [],
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    listSavedSearches: async () => {
      listCalls += 1
      return canonical
    },
    createSavedSearch: async () => { throw new Error('unused') },
    updateSavedSearch: async () => { throw new Error('unused') },
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => {
      reorderCalls += 1
      return reorderCalls === 1 ? first.promise : second.promise
    },
  }

  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server-a:user-a',
    adapter,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let organization = render()
  assert.deepEqual(organization.savedSearches.map((item) => item.id), [1, 2, 3])

  const reorderA = organization.reorderSavedSearches([2, 1, 3])
  await flushAsync()
  organization = render()
  const reorderB = organization.reorderSavedSearches([3, 2, 1])
  await flushAsync()

  first.reject(new Error('first reorder failed'))
  await reorderA
  await flushAsync()
  assert.equal(reorderCalls, 2)

  second.reject(new Error('latest reorder failed'))
  await reorderB
  await flushAsync()
  organization = render()

  assert.deepEqual(
    organization.savedSearches.map((item) => item.id),
    [1, 2, 3],
    'when the latest reorder fails the UI must reload canonical Server order instead of keeping an unconfirmed optimistic order',
  )
  assert.equal(listCalls, 2, 'initial load plus latest-failure canonical reload')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]?.message ?? errors[0]), /latest reorder failed/)
})
