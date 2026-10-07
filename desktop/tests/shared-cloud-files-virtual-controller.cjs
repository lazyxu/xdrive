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
    useCallback(callback, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = { kind: 'callback', deps: deps ? [...deps] : undefined, value: callback }
      }
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
    if (request === 'react') return react
    if (Object.prototype.hasOwnProperty.call(extraModules, request)) return extraModules[request]
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function loadController(react) {
  const core = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'virtual-collection.ts'],
    react,
  )
  const virtual = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts'],
    react,
    { '../virtual-collection': core },
  )
  const fileExplorer = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'file-explorer-controller.ts'],
    react,
  )
  const grouping = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'file-explorer-grouping.ts'],
    null,
  )
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'],
    react,
    {
      './VirtualCollectionController': virtual,
      '../file-explorer-controller': fileExplorer,
      '../file-explorer-grouping': grouping,
    },
  ).useXDriveCloudFilesController
}

async function flushAsyncWork() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function node(id, name) {
  return {
    id,
    name,
    type: 'file',
    size: id,
    revision: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

test('CloudFilesController primes range zero and exposes the full logical count', async () => {
  const runtime = createHookRuntime()
  const useController = loadController(runtime.react)
  const rangeCalls = []
  const pageCalls = []
  const sort = { key: 'name', direction: 'asc' }
  const port = {
    getRoot: async () => ({ id: 1 }),
    getQuota: async () => ({ used_bytes: 0, quota_bytes: 0 }),
    getPage: async (...args) => {
      pageCalls.push(args)
      throw new Error('directory browsing must not use cursor pages')
    },
    getRange: async (parentID, offset, limit, requestSort, includeCount, requestGrouping) => {
      rangeCalls.push({ parentID, offset, limit, requestSort, includeCount, requestGrouping })
      return {
        items: [node(offset + 1, `item-${offset + 1}`)],
        total_count: includeCount ? 1000 : 0,
        total_count_included: includeCount,
        offset,
        limit,
        sort: requestSort.key,
        order: requestSort.direction,
      }
    },
  }
  const onError = (error) => { throw error }
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError,
  }))

  let controller = render()
  await flushAsyncWork()
  controller = render()

  assert.equal(pageCalls.length, 0)
  assert.equal(rangeCalls.length, 1)
  assert.deepEqual(rangeCalls[0], {
    parentID: 1,
    offset: 0,
    limit: 200,
    requestSort: sort,
    includeCount: true,
    requestGrouping: { groupBy: 'none', foldersFirst: true },
  })
  assert.equal(controller.virtualDirectory.itemCount, 1000)
  assert.equal(controller.virtualDirectory.loadedItems.size, 1)
  assert.equal(controller.virtualDirectory.itemAt(0).id, 1)

  await controller.virtualDirectory.ensureViewport(0, 20)
  assert.equal(
    rangeCalls.filter((call) => call.offset === 0).length,
    1,
    'primed first range must not refetch offset zero',
  )
  assert.ok(
    rangeCalls.every((call, index) => index === 0 || call.offset > 0),
    'viewport overscan may prefetch later ranges but must not duplicate page zero',
  )
  assert.ok(
    rangeCalls.slice(1).every((call) => (
      call.includeCount === false &&
      call.requestGrouping.groupBy === 'none' &&
      call.requestGrouping.foldersFirst === true
    )),
    'subsequent ranges must reuse both the generation total and grouping contract',
  )
  controller = render()
  assert.equal(
    controller.virtualDirectory.itemCount,
    1000,
    'count-free range responses must preserve the authoritative generation total',
  )
})

test('CloudFilesController treats grouping changes as a new sparse generation', async () => {
  const runtime = createHookRuntime()
  const useController = loadController(runtime.react)
  const rangeCalls = []
  const sort = { key: 'name', direction: 'asc' }
  const port = {
    getRoot: async () => ({ id: 1 }),
    getQuota: async () => ({ used_bytes: 0, quota_bytes: 0 }),
    getPage: async () => { throw new Error('unexpected cursor page') },
    getRange: async (parentID, offset, limit, requestSort, includeCount, grouping) => {
      rangeCalls.push({ parentID, offset, limit, requestSort, includeCount, grouping })
      return {
        items: [node(offset + 1, `item-${offset + 1}`)],
        total_count: 2,
        total_count_included: includeCount,
        offset,
        limit,
        sort: requestSort.key,
        order: requestSort.direction,
        groups: includeCount && grouping.groupBy === 'type'
          ? [{ key: 'ext:txt', item_count: 2, start_index: 0 }]
          : [],
      }
    },
  }
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsyncWork()
  let controller = render()
  assert.equal(controller.grouping.groupBy, 'none')

  await controller.loadDirectory(
    1,
    [{ id: 1, name: 'root' }],
    sort,
    { groupBy: 'type', foldersFirst: false },
  )
  controller = render()

  assert.deepEqual(controller.grouping, { groupBy: 'type', foldersFirst: false })
  assert.deepEqual(controller.virtualDirectory.groups, [
    { key: 'ext:txt', item_count: 2, start_index: 0 },
  ])
  assert.deepEqual(
    rangeCalls.at(-1).grouping,
    { groupBy: 'type', foldersFirst: false },
  )

  await controller.virtualDirectory.ensureViewport(1, 1)
  assert.ok(
    rangeCalls.slice(1).every((call) => (
      call.grouping.groupBy === 'type' &&
      call.grouping.foldersFirst === false
    )),
    'viewport ranges must remain bound to the active grouping generation',
  )
})

test('CloudFilesController ignores an older directory range that resolves after navigation', async () => {
  const runtime = createHookRuntime()
  const useController = loadController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const pending = new Map()
  const port = {
    getRoot: async () => ({ id: 1 }),
    getQuota: async () => ({ used_bytes: 0, quota_bytes: 0 }),
    getPage: async () => { throw new Error('unexpected cursor page') },
    getRange: async (parentID, offset, limit, requestSort, includeCount) => {
      if (parentID === 1) {
        assert.equal(includeCount, true)
        return {
          items: [node(1, 'root')],
          total_count: 1,
          total_count_included: true,
          offset,
          limit,
          sort: requestSort.key,
          order: requestSort.direction,
        }
      }
      return new Promise((resolve) => {
        pending.set(parentID, { resolve, offset, limit, requestSort, includeCount })
      })
    },
  }
  const errors = []
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError: (error) => errors.push(error),
  }))

  let controller = render()
  await flushAsyncWork()
  controller = render()

  const older = controller.loadDirectory(2, [{ id: 1, name: 'root' }, { id: 2, name: 'old' }], sort)
  const newer = controller.loadDirectory(3, [{ id: 1, name: 'root' }, { id: 3, name: 'new' }], sort)
  await flushAsyncWork()

  assert.equal(pending.get(2).includeCount, true)
  assert.equal(pending.get(3).includeCount, true)
  pending.get(3).resolve({
    items: [node(30, 'new-item')],
    total_count: 400,
    offset: 0,
    limit: 200,
    sort: 'name',
    order: 'asc',
  })
  await newer
  pending.get(2).resolve({
    items: [node(20, 'old-item')],
    total_count: 900,
    offset: 0,
    limit: 200,
    sort: 'name',
    order: 'asc',
  })
  await older

  controller = render()
  assert.equal(errors.length, 0)
  assert.equal(controller.crumbs.at(-1).id, 3)
  assert.equal(controller.items[0].id, 30)
  assert.equal(controller.virtualDirectory.itemCount, 400)
})
