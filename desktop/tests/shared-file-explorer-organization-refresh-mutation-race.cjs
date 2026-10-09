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


// Tests deliberately use the real Organization Hook and controlled transport
// promises. The list call begins before a write, snapshots older server state,
// and completes only after the write has committed to local UI state.
const tag = (id, name, count = 0) => ({ id, name, color: '#124578', node_count: count })
const saved = (id, name, position) => ({
  id, name, position, query: '', filters: {}, sort: 'name', direction: 'asc',
})

async function mountOrganization(override = {}) {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)
  const errors = []
  const adapter = {
    listTags: async () => [],
    listSavedSearches: async () => [],
    createTag: async () => tag(4, 'New'),
    updateTag: async () => tag(4, 'Updated'),
    deleteTag: async () => {},
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    queryNodeTags: async () => [],
    createSavedSearch: async () => saved(4, 'New', 1),
    updateSavedSearch: async () => saved(4, 'Updated', 1),
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => {},
    ...override,
  }
  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server:user',
    enabled: true,
    adapter,
    onError: (error) => errors.push(error),
  }))
  render()
  await flushAsync()
  return { render, errors }
}

test('Organization stale tag refresh cannot erase a successful createTag', async () => {
  const stale = deferred()
  let reads = 0
  const { render, errors } = await mountOrganization({
    listTags: () => (++reads === 2 ? stale.promise : Promise.resolve([])),
    createTag: async () => tag(4, 'New'),
  })
  let org = render()
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2, 'the stale tag request must be in flight before create')
  await org.createTag('New', '#124578')
  await flushAsync()
  org = render()
  assert.deepEqual(org.tags.map(x => x.id), [4])

  stale.resolve([])
  await oldRefresh
  await flushAsync()
  org = render()
  assert.deepEqual(org.tags.map(x => x.id), [4],
    'a tag refresh started before successful create must not erase the new tag')
  assert.deepEqual(errors, [])
})

test('Organization stale tag refresh cannot resurrect a successfully deleted tag', async () => {
  const stale = deferred()
  const original = tag(2, 'To delete')
  let reads = 0
  const { render, errors } = await mountOrganization({
    listTags: () => (++reads === 2 ? stale.promise : Promise.resolve([original])),
    deleteTag: async () => {},
  })
  let org = render()
  assert.deepEqual(org.tags.map(x => x.id), [2])
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await org.deleteTag(2)
  await flushAsync()
  org = render()
  assert.deepEqual(org.tags, [])

  stale.resolve([original])
  await oldRefresh
  await flushAsync()
  org = render()
  assert.deepEqual(org.tags, [],
    'a stale tag refresh must not resurrect a deleted tag')
  assert.deepEqual(errors, [])
})

test('Organization stale saved-search refresh cannot erase successful creation', async () => {
  const stale = deferred()
  let reads = 0
  const { render, errors } = await mountOrganization({
    listSavedSearches: () => (++reads === 2 ? stale.promise : Promise.resolve([])),
    createSavedSearch: async () => saved(5, 'New search', 0),
  })
  let org = render()
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await org.createSavedSearch({ name: 'New search', query: '', filters: {} })
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches.map(x => x.id), [5])

  stale.resolve([])
  await oldRefresh
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches.map(x => x.id), [5],
    'a stale saved-search fetch cannot erase a search just created')
  assert.deepEqual(errors, [])
})

test('Organization stale saved-search refresh cannot resurrect deleted search', async () => {
  const stale = deferred()
  const original = saved(6, 'Delete me', 0)
  let reads = 0
  const { render, errors } = await mountOrganization({
    listSavedSearches: () => (++reads === 2 ? stale.promise : Promise.resolve([original])),
    deleteSavedSearch: async () => {},
  })
  let org = render()
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await org.deleteSavedSearch(6)
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches, [])

  stale.resolve([original])
  await oldRefresh
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches, [],
    'a stale saved-search fetch cannot resurrect a successfully deleted search')
  assert.deepEqual(errors, [])
})

test('Organization stale saved-search refresh cannot rollback a successful reorder', async () => {
  const stale = deferred()
  const original = [saved(1, 'One', 0), saved(2, 'Two', 1)]
  let reads = 0
  const { render, errors } = await mountOrganization({
    listSavedSearches: () => (++reads === 2 ? stale.promise : Promise.resolve(original)),
    reorderSavedSearches: async () => {},
  })
  let org = render()
  assert.deepEqual(org.savedSearches.map(x => x.id), [1, 2])
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await org.reorderSavedSearches([2, 1])
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches.map(x => x.id), [2, 1])

  stale.resolve(original)
  await oldRefresh
  await flushAsync()
  org = render()
  assert.deepEqual(org.savedSearches.map(x => x.id), [2, 1],
    'a stale saved-search fetch cannot revert a more recent server-accepted ordering')
  assert.deepEqual(errors, [])
})

test('Organization stale listTags refresh cannot replace newer node-count enrichment', async () => {
  const stale = deferred()
  const before = tag(9, 'Photos', 1)
  const after = tag(9, 'Photos', 8)
  let reads = 0
  const { render, errors } = await mountOrganization({
    listTags: () => {
      reads++
      if (reads === 2) return stale.promise
      return Promise.resolve(reads === 1 ? [before] : [after])
    },
    addTagNodes: async () => {},
  })
  let org = render()
  assert.equal(org.tags[0].node_count, 1)
  const oldRefresh = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await org.setTagNodes(9, [10, 11], true)
  await flushAsync()
  org = render()
  assert.equal(org.tags[0].node_count, 8)

  stale.resolve([before])
  await oldRefresh
  await flushAsync()
  org = render()
  assert.equal(org.tags[0].node_count, 8,
    'an older tag refresh must not regress a newer node-count update')
  assert.deepEqual(errors, [])
})

test('Organization newer refresh after successful tag mutation still updates current results', async () => {
  let reads = 0
  const { render, errors } = await mountOrganization({
    listTags: async () => {
      reads++
      return reads === 1 ? [] : [tag(4, reads === 2 ? 'New' : 'Canonical', 2)]
    },
    createTag: async () => tag(4, 'New'),
  })
  let org = render()
  await org.createTag('New', '#124578')
  await flushAsync()
  org = render()
  assert.equal(org.tags[0].name, 'New')
  await org.refresh()
  await flushAsync()
  org = render()
  assert.equal(org.tags[0].name, 'New')
  await org.refresh()
  await flushAsync()
  org = render()
  assert.equal(org.tags[0].name, 'Canonical',
    'a genuine later refresh must remain authoritative after the earlier write')
  assert.deepEqual(errors, [])
})

test('Organization failed tag mutation does not invalidate a valid pending refresh', async () => {
  const future = deferred()
  const original = tag(3, 'Remote new')
  let reads = 0
  const { render, errors } = await mountOrganization({
    listTags: () => (++reads === 2 ? future.promise : Promise.resolve([])),
    createTag: async () => { throw new Error('create denied') },
  })
  let org = render()
  const pending = org.refresh()
  await flushAsync()
  assert.equal(reads, 2)
  await assert.rejects(org.createTag('Denied', '#124578'), /create denied/)
  future.resolve([original])
  await pending
  await flushAsync()
  org = render()
  assert.deepEqual(org.tags.map(x => x.id), [3],
    'the failed mutation must not supersede a previously started valid refresh')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /create denied/)
})
