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
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer organization mutation completion cannot cross account lifecycle', async () => {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let account = 'A'
  const pendingA = deferred()
  const pendingB = deferred()
  const errors = []

  const adapter = {
    listTags: async () => [],
    createTag: async (name, color) => {
      if (account === 'A') return pendingA.promise
      return pendingB.promise
    },
    updateTag: async () => { throw new Error('unused') },
    deleteTag: async () => {},
    queryNodeTags: async () => [],
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    listSavedSearches: async () => [],
    createSavedSearch: async () => { throw new Error('unused') },
    updateSavedSearch: async () => { throw new Error('unused') },
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => [],
  }

  const render = () => runtime.render(() => useOrganization({
    lifecycleKey,
    adapter,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let organization = render()

  const createA = organization.createTag('A tag', '#111111')
  await flushAsync()
  organization = render()
  assert.equal(organization.busyKey, 'tag:create')

  lifecycleKey = 'server-b:user-b'
  account = 'B'
  render()
  await flushAsync()
  organization = render()
  assert.equal(organization.busyKey, '')

  const createB = organization.createTag('B tag', '#222222')
  await flushAsync()
  organization = render()
  assert.equal(organization.busyKey, 'tag:create')

  pendingA.resolve({ id: 1, name: 'A tag', color: '#111111' })
  await createA
  await flushAsync()
  organization = render()

  assert.equal(
    organization.busyKey,
    'tag:create',
    'stale account-A completion must not clear account-B mutation busy ownership',
  )
  assert.deepEqual(
    organization.tags,
    [],
    'stale account-A completion must not publish A tag data into account B',
  )

  pendingB.resolve({ id: 2, name: 'B tag', color: '#222222' })
  await createB
  await flushAsync()
  organization = render()

  assert.equal(organization.busyKey, '')
  assert.deepEqual(organization.tags.map((tag) => tag.id), [2])
  assert.deepEqual(errors, [])
})


test('FileExplorer organization refresh does not invalidate same-lifecycle mutation completion', async () => {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)

  const pendingCreate = deferred()
  const errors = []
  const adapter = {
    listTags: async () => [],
    createTag: async () => pendingCreate.promise,
    updateTag: async () => { throw new Error('unused') },
    deleteTag: async () => {},
    queryNodeTags: async () => [],
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    listSavedSearches: async () => [],
    createSavedSearch: async () => { throw new Error('unused') },
    updateSavedSearch: async () => { throw new Error('unused') },
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => [],
  }

  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server-a:user-a',
    adapter,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let organization = render()

  const pending = organization.createTag('A tag', '#111111')
  await flushAsync()
  await organization.refresh()
  await flushAsync()

  pendingCreate.resolve({ id: 1, name: 'A tag', color: '#111111' })
  await pending
  await flushAsync()
  organization = render()

  assert.deepEqual(
    organization.tags.map((tag) => tag.id),
    [1],
    'same-account refresh must not invalidate a mutation that still belongs to the current lifecycle',
  )
  assert.equal(organization.busyKey, '')
  assert.deepEqual(errors, [])
})


test('FileExplorer organization same-tick duplicate mutation is synchronously single-flight', async () => {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)

  const pendingCreate = deferred()
  let createCalls = 0
  const errors = []

  const adapter = {
    listTags: async () => [],
    createTag: async () => {
      createCalls += 1
      return pendingCreate.promise
    },
    updateTag: async () => { throw new Error('unused') },
    deleteTag: async () => {},
    queryNodeTags: async () => [],
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    listSavedSearches: async () => [],
    createSavedSearch: async () => { throw new Error('unused') },
    updateSavedSearch: async () => { throw new Error('unused') },
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => [],
  }

  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server-a:user-a',
    adapter,
    onError: (error) => errors.push(error),
  }))

  render()
  await flushAsync()
  let organization = render()

  const first = organization.createTag('Tag', '#111111')
  const second = organization.createTag('Tag', '#111111')

  await flushAsync()

  assert.equal(
    createCalls,
    1,
    'two same-tick submissions for the same organization mutation must not issue duplicate adapter writes',
  )

  organization = render()
  assert.equal(organization.busyKey, 'tag:create')

  pendingCreate.resolve({ id: 1, name: 'Tag', color: '#111111' })
  await Promise.all([first, second])
  await flushAsync()
  organization = render()

  assert.equal(organization.busyKey, '')
  assert.deepEqual(
    organization.tags.map((tag) => tag.id),
    [1],
    'coalesced duplicate mutation completion must publish the result once',
  )
  assert.deepEqual(errors, [])
})
