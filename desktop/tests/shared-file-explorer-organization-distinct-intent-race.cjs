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


function itemTag(id, name, color = '#111111', count = 0) {
  return { id, name, color, item_count: count, created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z' }
}
function itemSearch(id, name, query = name) {
  return {
    id, name, query, filters: {}, position: 0,
    created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
  }
}
function makePort(overrides = {}) {
  return {
    listTags: async () => [itemTag(42, 'Original')],
    listSavedSearches: async () => [itemSearch(42, 'Original')],
    createTag: async (name, color) => itemTag(43, name, color),
    updateTag: async (id) => itemTag(id, 'Updated'),
    deleteTag: async () => {},
    addTagNodes: async () => {},
    removeTagNodes: async () => {},
    queryNodeTags: async () => [],
    createSavedSearch: async (input) => itemSearch(43, input.name, input.query),
    updateSavedSearch: async (id, input) => itemSearch(id, input.name, input.query),
    deleteSavedSearch: async () => {},
    reorderSavedSearches: async () => {},
    ...overrides,
  }
}
async function mounted(port) {
  const runtime = createHookRuntime()
  const useOrganization = loadOrganizationHook(runtime.react)
  const errors = []
  const render = () => runtime.render(() => useOrganization({
    lifecycleKey: 'server:user', adapter: port, onError: (error) => errors.push(error),
  }))
  render()
  await flushAsync()
  return { render, errors }
}

test('Organization two different tag creates in the same tick must both reach Server', async () => {
  const pendingFirst = deferred()
  const calls = []
  const port = makePort({
    listTags: async () => [],
    createTag: (name, color) => {
      calls.push([name, color])
      return name === 'Work'
        ? pendingFirst.promise
        : Promise.resolve(itemTag(102, name, color))
    },
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.createTag('Work', '#111111')
  const second = org.createTag('Personal', '#222222')
  await flushAsync()
  pendingFirst.resolve(itemTag(101, 'Work'))
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(calls, [['Work', '#111111'], ['Personal', '#222222']],
    'different tag create intents cannot be merged just because both use tag:create')
  assert.deepEqual(render().tags.map(x => x.name), ['Personal', 'Work'])
  assert.deepEqual(errors, [])
})

test('Organization different updates of the same tag cannot silently discard new name/color intent', async () => {
  const pendingFirst = deferred()
  const calls = []
  const port = makePort({
    updateTag: (id, input) => {
      calls.push({ id, input })
      if ('name' in input) return pendingFirst.promise
      return Promise.resolve(itemTag(id, 'Renamed', input.color))
    },
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.updateTag(42, { name: 'Renamed' })
  const second = org.updateTag(42, { color: '#445566' })
  await flushAsync()
  pendingFirst.resolve(itemTag(42, 'Renamed'))
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(calls, [
    { id: 42, input: { name: 'Renamed' } },
    { id: 42, input: { color: '#445566' } },
  ], 'a color edit must not be deduplicated with a different pending rename')
  assert.equal(render().tags[0]?.name, 'Renamed')
  assert.equal(render().tags[0]?.color, '#445566',
    'newest edit must stay visible after both same-tag operations settle')
  assert.deepEqual(errors, [])
})

test('Organization different saved-search creates cannot silently lose the second search', async () => {
  const pendingFirst = deferred()
  const calls = []
  const port = makePort({
    listSavedSearches: async () => [],
    createSavedSearch: (input) => {
      calls.push(input.name)
      return input.name === 'Photos'
        ? pendingFirst.promise
        : Promise.resolve(itemSearch(51, input.name, input.query))
    },
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.createSavedSearch({ name: 'Photos', query: 'jpg', filters: {} })
  const second = org.createSavedSearch({ name: 'Documents', query: 'pdf', filters: {} })
  await flushAsync()
  pendingFirst.resolve(itemSearch(50, 'Photos', 'jpg'))
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(calls, ['Photos', 'Documents'])
  assert.deepEqual(render().savedSearches.map(x => x.name).sort(), ['Documents', 'Photos'])
  assert.deepEqual(errors, [])
})

test('Organization same saved-search ID with different update payloads must apply both in order', async () => {
  const pendingFirst = deferred()
  const calls = []
  const port = makePort({
    updateSavedSearch: (id, input) => {
      calls.push({ id, ...input })
      return input.name === 'Renamed'
        ? pendingFirst.promise
        : Promise.resolve(itemSearch(id, 'Renamed', input.query))
    },
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.updateSavedSearch(42, { name: 'Renamed', query: 'old', filters: {} })
  const second = org.updateSavedSearch(42, { name: 'Renamed and filtered', query: 'new', filters: {} })
  await flushAsync()
  pendingFirst.resolve(itemSearch(42, 'Renamed', 'old'))
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(calls.map(x => x.query), ['old', 'new'])
  assert.equal(render().savedSearches[0]?.query, 'new',
    'the newer saved-search edit must not be deduped or replaced by an older edit')
  assert.deepEqual(errors, [])
})

test('Organization opposite tag-node intents must execute add then remove rather than dedupe removal', async () => {
  const pendingAdd = deferred()
  const calls = []
  let assigned = false
  const port = makePort({
    addTagNodes: (tagID, nodeIDs) => {
      calls.push({ operation: 'add', tagID, nodeIDs })
      return pendingAdd.promise.then(() => { assigned = true })
    },
    removeTagNodes: async (tagID, nodeIDs) => {
      calls.push({ operation: 'remove', tagID, nodeIDs })
      assigned = false
    },
    listTags: async () => [itemTag(42, 'Original', '#111111', assigned ? 1 : 0)],
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.setTagNodes(42, [7], true)
  const second = org.setTagNodes(42, [7], false)
  await flushAsync()
  pendingAdd.resolve()
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(calls, [
    { operation: 'add', tagID: 42, nodeIDs: [7] },
    { operation: 'remove', tagID: 42, nodeIDs: [7] },
  ], 'opposing add/remove on the same Tag and Node must not coalesce')
  assert.equal(assigned, false,
    'last submitted remove intent must determine final tag membership')
  assert.equal(render().tags[0]?.item_count, 0)
  assert.deepEqual(errors, [])
})

test('Organization identical concurrent tag creates still coalesce into a single write', async () => {
  const pending = deferred()
  let calls = 0
  const port = makePort({
    listTags: async () => [],
    createTag: async () => {
      calls += 1
      return pending.promise
    },
  })
  const { render, errors } = await mounted(port)
  const org = render()
  const first = org.createTag('Same', '#ffffff')
  const second = org.createTag('Same', '#ffffff')
  await flushAsync()
  assert.equal(calls, 1)
  pending.resolve(itemTag(12, 'Same'))
  await Promise.all([first, second])
  await flushAsync()
  assert.deepEqual(render().tags.map(x => x.name), ['Same'])
  assert.deepEqual(errors, [])
})
