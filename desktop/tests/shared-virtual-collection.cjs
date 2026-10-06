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
      if (!slots[index]) {
        slots[index] = { kind: 'ref', value: { current: initialValue } }
      }
      return slots[index].value
    },
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = {
          kind: 'callback',
          deps: deps ? [...deps] : undefined,
          value: callback,
        }
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

function loadTypeScriptModule(relativePath, react, extraModules = {}) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react' && react) return react
    if (Object.prototype.hasOwnProperty.call(extraModules, request)) {
      return extraModules[request]
    }
    return require(request)
  }
  const execute = new Function('exports', 'module', 'require', output)
  execute(mod.exports, mod, localRequire)
  return mod.exports
}

function loadVirtualCollection() {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'virtual-collection.ts'],
    null,
  )
}

function loadVirtualCollectionHook(react) {
  const core = loadVirtualCollection()
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts'],
    react,
    { '../virtual-collection': core },
  ).useXDriveVirtualCollection
}

test('VirtualCollection aligns viewport requests to stable pages with bounded overscan', () => {
  const {
    xDriveVirtualCollectionRangesForViewport,
  } = loadVirtualCollection()

  assert.deepEqual(
    xDriveVirtualCollectionRangesForViewport({
      startIndex: 450,
      endIndex: 489,
      totalCount: 650,
      pageSize: 200,
      overscanPages: 1,
    }),
    [
      { offset: 200, limit: 200 },
      { offset: 400, limit: 200 },
      { offset: 600, limit: 200 },
    ],
  )
})

test('VirtualCollection can evict metadata outside retained page ranges', () => {
  const {
    xDriveCreateVirtualCollectionSnapshot,
    xDriveVirtualCollectionApplyPage,
    xDriveVirtualCollectionRetainRanges,
  } = loadVirtualCollection()

  let snapshot = xDriveCreateVirtualCollectionSnapshot('directory', 1)
  snapshot = xDriveVirtualCollectionApplyPage(snapshot, 1, {
    offset: 0,
    limit: 2,
    totalCount: 6,
    items: [{ id: 1 }, { id: 2 }],
  })
  snapshot = xDriveVirtualCollectionApplyPage(snapshot, 1, {
    offset: 2,
    limit: 2,
    totalCount: 6,
    items: [{ id: 3 }, { id: 4 }],
  })
  snapshot = xDriveVirtualCollectionRetainRanges(snapshot, [
    { offset: 2, limit: 2 },
  ])

  assert.equal(snapshot.items.size, 2)
  assert.equal(snapshot.items.has(0), false)
  assert.equal(snapshot.items.has(1), false)
  assert.deepEqual(snapshot.items.get(2), { id: 3 })
  assert.deepEqual(snapshot.items.get(3), { id: 4 })
})

test('VirtualCollection ignores stale pages from an older generation', () => {
  const {
    xDriveCreateVirtualCollectionSnapshot,
    xDriveVirtualCollectionApplyPage,
  } = loadVirtualCollection()

  const current = xDriveCreateVirtualCollectionSnapshot('new', 2)
  const stale = xDriveVirtualCollectionApplyPage(current, 1, {
    offset: 0,
    limit: 200,
    totalCount: 1,
    items: [{ id: 1 }],
  })

  assert.equal(stale, current)
  assert.equal(stale.totalCount, null)
  assert.equal(stale.items.size, 0)
})

test('old range completion cannot release the new generation in-flight lock', async () => {
  const runtime = createHookRuntime()
  const useVirtualCollection = loadVirtualCollectionHook(runtime.react)
  const pending = []
  const errors = []

  const loadRange = (range, signal) => new Promise((resolve) => {
    pending.push({ range, signal, resolve })
  })
  const onError = (error) => errors.push(error)
  const render = (queryKey) => runtime.render(() => useVirtualCollection({
    queryKey,
    loadRange,
    onError,
    pageSize: 200,
    overscanPages: 0,
  }))

  let collection = render('old')
  const oldRequest = collection.ensureViewport(0, 20)
  assert.equal(pending.length, 1)

  render('new')
  collection = render('new')
  const newRequest = collection.ensureViewport(0, 20)
  assert.equal(pending.length, 2)
  assert.equal(pending[0].signal.aborted, true)

  pending[0].resolve({
    offset: 0,
    limit: 200,
    totalCount: 1,
    items: [{ id: 1 }],
  })
  await oldRequest

  collection = render('new')
  const duplicate = collection.ensureViewport(0, 20)
  assert.equal(
    pending.length,
    2,
    'an old finally block must not delete the newer request with the same range key',
  )

  pending[1].resolve({
    offset: 0,
    limit: 200,
    totalCount: 1,
    items: [{ id: 2 }],
  })
  await Promise.all([newRequest, duplicate])

  collection = render('new')
  assert.equal(errors.length, 0)
  assert.equal(collection.totalCount, 1)
  assert.equal(collection.loadedCount, 1)
  assert.deepEqual(collection.itemAt(0), { id: 2 })

  await collection.ensureViewport(0, 0)
  assert.equal(
    pending.length,
    2,
    'learning totalCount must not change the page cache key and refetch the final page',
  )
})


test('VirtualCollection reset stays stable and primed pages do not refetch', async () => {
  const runtime = createHookRuntime()
  const useVirtualCollection = loadVirtualCollectionHook(runtime.react)
  const pending = []
  const loadRange = (range, signal) => new Promise((resolve) => {
    pending.push({ range, signal, resolve })
  })
  const onError = () => {}

  let collection = runtime.render(() => useVirtualCollection({
    queryKey: 'old',
    loadRange,
    onError,
    pageSize: 2,
    overscanPages: 0,
  }))
  const reset = collection.reset

  collection.reset('new')
  collection.primePage({
    offset: 0,
    limit: 2,
    totalCount: 6,
    items: [{ id: 1 }, { id: 2 }],
  })

  collection = runtime.render(() => useVirtualCollection({
    queryKey: 'new',
    loadRange,
    onError,
    pageSize: 2,
    overscanPages: 0,
  }))

  assert.equal(collection.reset, reset, 'reset callback must stay stable across query keys')
  assert.equal(collection.totalCount, 6)
  assert.deepEqual(collection.itemAt(0), { id: 1 })
  await collection.ensureViewport(0, 1)
  assert.equal(pending.length, 0, 'primed first page must not be fetched twice')
})

test('VirtualCollection patches retained metadata without expanding the cache', () => {
  const runtime = createHookRuntime()
  const useVirtualCollection = loadVirtualCollectionHook(runtime.react)
  const loadRange = async () => {
    throw new Error('unexpected range load')
  }
  const render = () => runtime.render(() => useVirtualCollection({
    queryKey: 'gallery',
    loadRange,
    onError: () => {},
    pageSize: 2,
    overscanPages: 0,
  }))

  let collection = render()
  collection.primePage({
    offset: 400,
    limit: 2,
    totalCount: 1000,
    items: [{ id: 1, favorite: false }, { id: 2, favorite: false }],
  })
  collection = render()

  collection.updateLoadedItems((item) => (
    item.id === 2 ? { ...item, favorite: true } : item
  ))
  collection = render()

  assert.equal(collection.loadedCount, 2)
  assert.deepEqual(collection.itemAt(400), { id: 1, favorite: false })
  assert.deepEqual(collection.itemAt(401), { id: 2, favorite: true })
  assert.equal(collection.itemAt(0), undefined)
})

test('VirtualCollection cancels and evicts ranges that move outside retention', async () => {
  const runtime = createHookRuntime()
  const useVirtualCollection = loadVirtualCollectionHook(runtime.react)
  const pending = []
  const errors = []
  const loadRange = (range, signal) => new Promise((resolve) => {
    pending.push({ range, signal, resolve })
  })
  const onError = (error) => errors.push(error)
  const render = () => runtime.render(() => useVirtualCollection({
    queryKey: 'directory',
    loadRange,
    onError,
    pageSize: 2,
    overscanPages: 0,
    retentionOverscanPages: 0,
  }))

  let collection = render()
  const staleRequest = collection.ensureViewport(0, 1)
  assert.equal(pending.length, 1)

  const nextRequest = collection.ensureViewport(4, 5)
  assert.equal(pending.length, 2)
  assert.equal(pending[0].signal.aborted, true)

  pending[0].resolve({
    offset: 0,
    limit: 2,
    totalCount: 6,
    items: [{ id: 1 }, { id: 2 }],
  })
  pending[1].resolve({
    offset: 4,
    limit: 2,
    totalCount: 6,
    items: [{ id: 5 }, { id: 6 }],
  })
  await Promise.all([staleRequest, nextRequest])

  collection = render()
  assert.equal(errors.length, 0)
  assert.equal(collection.loadedCount, 2)
  assert.equal(collection.loadedItems.size, 2)
  assert.equal(collection.itemAt(0), undefined)
  assert.deepEqual(collection.itemAt(4), { id: 5 })
  assert.deepEqual(collection.itemAt(5), { id: 6 })
})

test('VirtualCollection evicts previously loaded pages after the viewport moves away', async () => {
  const runtime = createHookRuntime()
  const useVirtualCollection = loadVirtualCollectionHook(runtime.react)
  const errors = []
  const loadRange = async (range) => ({
    offset: range.offset,
    limit: range.limit,
    totalCount: 6,
    items: range.offset === 0
      ? [{ id: 1 }, { id: 2 }]
      : [{ id: 5 }, { id: 6 }],
  })
  const onError = (error) => errors.push(error)
  const render = () => runtime.render(() => useVirtualCollection({
    queryKey: 'directory',
    loadRange,
    onError,
    pageSize: 2,
    overscanPages: 0,
    retentionOverscanPages: 0,
  }))

  let collection = render()
  await collection.ensureViewport(0, 1)
  collection = render()
  assert.equal(collection.loadedCount, 2)
  assert.deepEqual(collection.itemAt(0), { id: 1 })

  await collection.ensureViewport(4, 5)
  collection = render()
  assert.equal(errors.length, 0)
  assert.equal(collection.loadedCount, 2)
  assert.equal(collection.itemAt(0), undefined)
  assert.deepEqual(collection.itemAt(4), { id: 5 })
})

test('VirtualCollection is exported from shared core and shared MUI', () => {
  const sharedIndex = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'index.ts'),
    'utf8',
  )
  const muiIndex = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'index.tsx'),
    'utf8',
  )
  assert.ok(sharedIndex.includes("export * from './virtual-collection'"))
  assert.ok(muiIndex.includes("export * from './VirtualCollectionController'"))
})
