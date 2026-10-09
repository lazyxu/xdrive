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


function tag(owner) {
  return { id: 42, name: owner + ' private tag', color: owner === 'A' ? '#114466' : '#661144', node_count: 2 }
}

function search(owner) {
  return {
    id: 42, name: owner + ' saved search', position: 0,
    query: owner + ' query', filters: {}, sort: 'name', direction: 'asc',
  }
}

function fixture() {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)
  const requests = []
  const errors = []
  let account = 'A'
  let enabled = true
  const makeAdapter = (owner) => ({
    listTags: async () => [tag(owner)],
    listSavedSearches: async () => [search(owner)],
    createTag: async (name, color) => ({ id: 43, name: owner + ':' + name, color }),
    updateTag: async (id) => ({ ...tag(owner), id }),
    deleteTag: async (id) => { requests.push([owner, 'deleteTag', id]) },
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    queryNodeTags: async () => [],
    createSavedSearch: async () => ({ ...search(owner), id: 43 }),
    updateSavedSearch: async () => search(owner),
    deleteSavedSearch: async (id) => { requests.push([owner, 'deleteSavedSearch', id]) },
    reorderSavedSearches: async (ids) => { requests.push([owner, 'reorderSavedSearches', ids]) },
  })
  const aAdapter = makeAdapter('A')
  const bAdapter = makeAdapter('B')
  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server:' + account,
    adapter: account === 'A' ? aAdapter : bAdapter,
    enabled,
    onError: (err) => errors.push(err),
  }))
  return {
    render, requests, errors,
    setAccount(value) { account = value },
    setEnabled(value) { enabled = value },
    adapterA: aAdapter,
    adapterB: bAdapter,
  }
}

async function loadedA(scope) {
  scope.render()
  await flushAsync()
  const a = scope.render()
  assert.equal(a.tags[0]?.name, 'A private tag', 'the first account must actually have visible tag state')
  assert.equal(a.savedSearches[0]?.name, 'A saved search', 'the first account must actually have a visible saved search')
  return a
}

test('Organization must hide old tag definitions on the first render of another account', async () => {
  const scope = fixture()
  await loadedA(scope)
  scope.setAccount('B')
  const bFirst = scope.render()
  assert.deepEqual(
    bFirst.tags,
    [],
    'account B must not render account A tag definitions before the passive reset completes',
  )
})

test('Organization must hide old tag options on the first render of another account', async () => {
  const scope = fixture()
  await loadedA(scope)
  scope.setAccount('B')
  const bFirst = scope.render()
  assert.deepEqual(
    bFirst.tagOptions,
    [],
    'account B must not expose account A tag IDs/options before B loads its own tags',
  )
})

test('Organization must hide old saved searches on the first render of another account', async () => {
  const scope = fixture()
  await loadedA(scope)
  scope.setAccount('B')
  const bFirst = scope.render()
  assert.deepEqual(
    bFirst.savedSearches,
    [],
    'account B must not show account A search name, query or filter before B session load',
  )
})

test('Organization must hide old user data immediately when disabled without a lifecycle key change', async () => {
  const scope = fixture()
  await loadedA(scope)
  scope.setEnabled(false)
  const disabledFirst = scope.render()
  assert.deepEqual(disabledFirst.tags, [], 'disabled first frame may not retain old tags')
  assert.deepEqual(disabledFirst.tagOptions, [], 'disabled first frame may not retain old tag options')
  assert.deepEqual(disabledFirst.savedSearches, [], 'disabled first frame may not retain old searches')
  assert.equal(disabledFirst.loading, false)
  assert.equal(disabledFirst.busyKey, '')
})

test('Organization must not retain account A mutation busy ownership in account B first frame', async () => {
  const scope = fixture()
  await loadedA(scope)
  const pending = deferred()
  scope.adapterA.createTag = async () => pending.promise
  const oldA = scope.render().createTag('new', '#114466')
  await flushAsync()
  assert.equal(scope.render().busyKey, 'tag:create')
  scope.setAccount('B')
  const firstB = scope.render()
  assert.equal(
    firstB.busyKey,
    '',
    'B must not render a spinner from a still-pending account A createTag',
  )
  pending.resolve({ id: 43, name: 'A:late', color: '#114466' })
  await oldA
  await flushAsync()
  const b = scope.render()
  assert.deepEqual(b.tags.map(x => x.name), ['B private tag'])
  assert.deepEqual(scope.errors, [])
})

test('Organization current-account tags and smart folders remain visible with no lifecycle change', async () => {
  const scope = fixture()
  const a = await loadedA(scope)
  assert.deepEqual(a.tagOptions.map(x => x.id), [42])
  assert.equal(a.busyKey, '')
  assert.equal(a.loading, false)
  const stillA = scope.render()
  assert.equal(stillA.tags[0].name, 'A private tag')
  assert.equal(stillA.savedSearches[0].name, 'A saved search')
  assert.deepEqual(scope.errors, [])
})

test('Organization account B eventually loads its own tags and saved searches with reused numeric IDs', async () => {
  const scope = fixture()
  await loadedA(scope)
  scope.setAccount('B')
  scope.render()
  await flushAsync()
  const b = scope.render()
  assert.deepEqual(b.tags.map(x => x.name), ['B private tag'])
  assert.deepEqual(b.savedSearches.map(x => x.name), ['B saved search'])
  assert.deepEqual(b.tagOptions.map(x => x.id), [42])
  assert.equal(b.busyKey, '')
  assert.equal(b.loading, false)
  assert.deepEqual(scope.errors, [])
})
