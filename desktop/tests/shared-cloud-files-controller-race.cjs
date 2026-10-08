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
        slots[index].value = typeof nextValue === 'function' ? nextValue(current) : nextValue
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

function loadCloudFilesController(react) {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts')
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const useVirtualCollection = () => react.useMemo(() => {
    const loadedItems = new Map()
    return {
      totalCount: 0,
      loadedItems,
      itemAt: (index) => loadedItems.get(index),
      ensureViewport: async () => {},
      reset: () => {},
      primePage: () => {},
    }
  }, [])

  const mod = { exports: {} }
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-explorer-controller') {
      return { XDRIVE_FILE_EXPLORER_PAGE_SIZE: 200 }
    }
    if (request === '../file-explorer-grouping') {
      return {
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING: {
          groupBy: 'none',
          foldersFirst: true,
        },
        xDriveFileExplorerGroupingSignature: (grouping) => (
          `${grouping.groupBy}:${grouping.foldersFirst ? 'folders-first' : 'mixed'}`
        ),
      }
    }
    if (request === '../cloud-files') {
      return {
        xDriveCloudFilesChangeAffectsParent: (change, parentID) => (
          change.affected_parent_ids.includes(parentID)
        ),
      }
    }
    if (request === './VirtualCollectionController') {
      return { useXDriveVirtualCollection: useVirtualCollection }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveCloudFilesController
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('changing onError identity cannot reinitialize Cloud Files back to My Files', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const root = { id: 1, name: 'root' }
  const folder = { id: 2, name: 'Folder A' }
  const sort = { key: 'name', direction: 'asc' }
  let rootLoads = 0

  const port = {
    getRoot: async () => {
      rootLoads += 1
      return root
    },
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => ({
      items: [],
      total_count: 0,
      offset,
      limit,
      parent_id: parentID,
    }),
    getQuota: async () => ({
      quota_bytes: 0,
      used_bytes: 0,
      available_bytes: 0,
      reserved_bytes: 0,
    }),
  }

  let onError = () => {}
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError,
  }))

  render()
  await flushAsync()
  let controller = render()
  assert.equal(rootLoads, 1)
  assert.deepEqual(controller.crumbs.map((crumb) => crumb.id), [root.id])

  await controller.loadDirectory(folder.id, [
    { id: root.id, name: '我的文件' },
    { id: folder.id, name: folder.name },
  ], sort)
  controller = render()
  assert.equal(controller.current.id, folder.id)
  assert.deepEqual(controller.crumbs.map((crumb) => crumb.id), [root.id, folder.id])

  // This models the Web App's periodic server-build refresh: before the fix,
  // a new error callback changed loadInitial's identity and reran the init effect.
  onError = () => {}
  render()
  await flushAsync()
  controller = render()

  assert.equal(rootLoads, 1, 'ordinary parent rerenders must not reload the root directory')
  assert.equal(controller.current.id, folder.id)
  assert.deepEqual(controller.crumbs.map((crumb) => crumb.id), [root.id, folder.id])
})


test('disabling Cloud Files invalidates a pending quota refresh completion', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const initialQuota = {
    quota_bytes: 100,
    used_bytes: 10,
    available_bytes: 90,
    reserved_bytes: 0,
  }
  const staleQuota = {
    quota_bytes: 999,
    used_bytes: 888,
    available_bytes: 111,
    reserved_bytes: 0,
  }

  let enabled = true
  let quotaCalls = 0
  let releaseRefresh
  const port = {
    getRoot: async () => ({ id: 1 }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => ({
      items: [],
      total_count: 0,
      total_count_included: true,
      offset,
      limit,
      parent_id: parentID,
    }),
    getQuota: async () => {
      quotaCalls += 1
      if (quotaCalls === 1) return initialQuota
      return new Promise((resolve) => {
        releaseRefresh = () => resolve(staleQuota)
      })
    },
  }
  const render = () => runtime.render(() => useController({
    port,
    enabled,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let controller = render()
  assert.deepEqual(controller.quota, initialQuota)

  const pendingRefresh = controller.refreshQuota()
  await flushAsync()
  assert.equal(typeof releaseRefresh, 'function')

  enabled = false
  render()
  await flushAsync()
  controller = render()
  assert.equal(controller.quota, null)

  releaseRefresh()
  await pendingRefresh

  controller = render()
  assert.equal(
    controller.quota,
    null,
    'a quota request started before disable must not repopulate disabled Cloud Files state',
  )
})


test('newer Cloud Files quota refresh wins when responses complete out of order', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const initialQuota = {
    quota_bytes: 100,
    used_bytes: 10,
    available_bytes: 90,
    reserved_bytes: 0,
  }
  const olderQuota = {
    quota_bytes: 200,
    used_bytes: 20,
    available_bytes: 180,
    reserved_bytes: 0,
  }
  const newerQuota = {
    quota_bytes: 300,
    used_bytes: 30,
    available_bytes: 270,
    reserved_bytes: 0,
  }

  let quotaCalls = 0
  const pending = []
  const port = {
    getRoot: async () => ({ id: 1 }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => ({
      items: [],
      total_count: 0,
      total_count_included: true,
      offset,
      limit,
      parent_id: parentID,
    }),
    getQuota: async () => {
      quotaCalls += 1
      if (quotaCalls === 1) return initialQuota
      return new Promise((resolve) => pending.push(resolve))
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
  await flushAsync()
  let controller = render()
  assert.deepEqual(controller.quota, initialQuota)

  const older = controller.refreshQuota()
  const newer = controller.refreshQuota()
  await flushAsync()
  assert.equal(pending.length, 2)

  pending[1](newerQuota)
  await newer
  pending[0](olderQuota)
  await older

  controller = render()
  assert.deepEqual(
    controller.quota,
    newerQuota,
    'an older quota refresh must not overwrite the newer refresh result',
  )
})

test('applyQuota invalidates an older pending Cloud Files quota refresh', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const initialQuota = {
    quota_bytes: 100,
    used_bytes: 10,
    available_bytes: 90,
    reserved_bytes: 0,
  }
  const appliedQuota = {
    quota_bytes: 400,
    used_bytes: 40,
    available_bytes: 360,
    reserved_bytes: 0,
  }
  const staleQuota = {
    quota_bytes: 999,
    used_bytes: 999,
    available_bytes: 0,
    reserved_bytes: 0,
  }

  let quotaCalls = 0
  let releaseRefresh
  const port = {
    getRoot: async () => ({ id: 1 }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => ({
      items: [],
      total_count: 0,
      total_count_included: true,
      offset,
      limit,
      parent_id: parentID,
    }),
    getQuota: async () => {
      quotaCalls += 1
      if (quotaCalls === 1) return initialQuota
      return new Promise((resolve) => {
        releaseRefresh = () => resolve(staleQuota)
      })
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
  await flushAsync()
  let controller = render()

  const pendingRefresh = controller.refreshQuota()
  await flushAsync()
  controller.applyQuota(appliedQuota)

  releaseRefresh()
  await pendingRefresh

  controller = render()
  assert.deepEqual(
    controller.quota,
    appliedQuota,
    'an older quota refresh must not overwrite a newer applied quota value',
  )
})

test('Cloud Files change feed refreshes only the affected current directory', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const rangeCalls = []
  let changeCall = 0
  const port = {
    getRoot: async () => ({ id: 1, name: 'root' }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit, requestSort, includeCount, grouping) => {
      rangeCalls.push({ parentID, offset, limit, requestSort, includeCount, grouping })
      return {
        items: [],
        total_count: 0,
        total_count_included: includeCount,
        offset,
        limit,
        sort: requestSort.key,
        order: requestSort.direction,
        groups: [],
      }
    },
    getChanges: async (after) => {
      changeCall += 1
      if (changeCall === 1) {
        assert.equal(after, 0)
        return {
          changes: [],
          next_cursor: 10,
          latest_cursor: 10,
          has_more: false,
        }
      }
      if (changeCall === 2) {
        assert.equal(after, 10)
        return {
          changes: [{
            cursor: 11,
            node_id: 90,
            operation: 'upsert',
            affected_parent_ids: [99],
          }],
          next_cursor: 11,
          latest_cursor: 11,
          has_more: false,
        }
      }
      assert.equal(after, 11)
      return {
        changes: [{
          cursor: 12,
          node_id: 91,
          operation: 'upsert',
          affected_parent_ids: [1],
        }],
        next_cursor: 12,
        latest_cursor: 12,
        has_more: false,
      }
    },
    getQuota: async () => ({ quota_bytes: 0, used_bytes: 0 }),
  }
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    changePollIntervalMs: 0,
    changeDebounceMs: 0,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let controller = render()
  assert.equal(rangeCalls.length, 1)

  await controller.refreshChanges()
  controller = render()
  assert.equal(rangeCalls.length, 2, 'cursor handshake must close the initial-list race with one refresh')

  assert.equal(await controller.refreshChanges(), false)
  assert.equal(rangeCalls.length, 2, 'unrelated parent changes must not refresh the current directory')

  assert.equal(await controller.refreshChanges(), true)
  assert.equal(rangeCalls.length, 3, 'affected parent changes must rebuild the current directory generation')
})

test('late change-feed response cannot refresh the directory navigated away from', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }
  const rangeCalls = []
  let releaseChanges
  let changeCall = 0
  const port = {
    getRoot: async () => ({ id: 1, name: 'root' }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit, requestSort, includeCount, grouping) => {
      rangeCalls.push({ parentID, offset, limit, requestSort, includeCount, grouping })
      return {
        items: [],
        total_count: 0,
        total_count_included: includeCount,
        offset,
        limit,
        sort: requestSort.key,
        order: requestSort.direction,
        groups: [],
      }
    },
    getChanges: async () => {
      changeCall += 1
      if (changeCall === 1) {
        return {
          changes: [],
          next_cursor: 20,
          latest_cursor: 20,
          has_more: false,
        }
      }
      return new Promise((resolve) => {
        releaseChanges = () => resolve({
          changes: [{
            cursor: 21,
            node_id: 7,
            operation: 'upsert',
            affected_parent_ids: [2],
          }],
          next_cursor: 21,
          latest_cursor: 21,
          has_more: false,
        })
      })
    },
    getQuota: async () => ({ quota_bytes: 0, used_bytes: 0 }),
  }
  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    changePollIntervalMs: 0,
    changeDebounceMs: 0,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let controller = render()
  await controller.loadDirectory(2, [{ id: 1, name: 'root' }, { id: 2, name: 'A' }], sort)
  controller = render()
  await controller.refreshChanges()
  controller = render()

  const pending = controller.refreshChanges()
  await flushAsync()
  assert.equal(typeof releaseChanges, 'function')

  await controller.loadDirectory(3, [{ id: 1, name: 'root' }, { id: 3, name: 'B' }], sort)
  const beforeRelease = rangeCalls.length
  releaseChanges()
  assert.equal(await pending, false)
  assert.equal(
    rangeCalls.length,
    beforeRelease,
    'a late change for directory A must not refresh the now-current directory B',
  )
})


test('debounced change refresh stays bound to the directory that scheduled it', async () => {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  try {
    const runtime = createHookRuntime()
    const useController = loadCloudFilesController(runtime.react)
    const sort = { key: 'name', direction: 'asc' }
    const rangeCalls = []
    let changeCall = 0
    let debounceMs = 0
    let scheduled = null

    const port = {
      getRoot: async () => ({ id: 1, name: 'root' }),
      getPage: async () => ({ items: [], has_more: false }),
      getRange: async (parentID, offset, limit, requestSort, includeCount, grouping) => {
        rangeCalls.push({ parentID, offset, limit, requestSort, includeCount, grouping })
        return {
          items: [],
          total_count: 0,
          total_count_included: includeCount,
          offset,
          limit,
          sort: requestSort.key,
          order: requestSort.direction,
          groups: [],
        }
      },
      getChanges: async () => {
        changeCall += 1
        if (changeCall === 1) {
          return {
            changes: [],
            next_cursor: 10,
            latest_cursor: 10,
            has_more: false,
          }
        }
        return {
          changes: [{
            cursor: 11,
            node_id: 7,
            operation: 'upsert',
            affected_parent_ids: [2],
          }],
          next_cursor: 11,
          latest_cursor: 11,
          has_more: false,
        }
      },
      getQuota: async () => ({ quota_bytes: 0, used_bytes: 0 }),
    }

    const render = () => runtime.render(() => useController({
      port,
      enabled: true,
      defaultSort: sort,
      quotaRefreshIntervalMs: 0,
      changePollIntervalMs: 0,
      changeDebounceMs: debounceMs,
      onError: (error) => { throw error },
    }))

    render()
    await flushAsync()
    let controller = render()

    await controller.loadDirectory(
      2,
      [{ id: 1, name: 'root' }, { id: 2, name: 'A' }],
      sort,
    )
    controller = render()

    // Establish the durable change cursor with an immediate handshake refresh.
    await controller.refreshChanges()
    controller = render()

    debounceMs = 250
    controller = render()

    globalThis.setTimeout = (callback) => {
      scheduled = callback
      return 123
    }
    globalThis.clearTimeout = () => {
      scheduled = null
    }

    assert.equal(
      await controller.refreshChanges(),
      true,
      'a change affecting the current directory should schedule a refresh',
    )
    assert.equal(typeof scheduled, 'function')

    await controller.loadDirectory(
      3,
      [{ id: 1, name: 'root' }, { id: 3, name: 'B' }],
      sort,
    )
    controller = render()
    assert.equal(controller.current?.id, 3)

    const beforeTimer = rangeCalls.length
    const fire = scheduled
    scheduled = null
    fire()
    await flushAsync()

    assert.equal(
      rangeCalls.length,
      beforeTimer,
      'a refresh scheduled for A must be discarded after navigation moves to B',
    )
    controller = render()
    assert.equal(controller.current?.id, 3)
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})


test('Cloud Files account lifecycle change reloads identical root and node ids for the new account', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }

  let account = 'A'
  let lifecycleKey = 'server-a:user-a'
  let aRootLoads = 0
  let bRootLoads = 0

  const port = {
    getRoot: async () => {
      if (account === 'A') aRootLoads += 1
      else bRootLoads += 1
      return { id: 1 }
    },
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => ({
      items: [{ id: 10, name: account === 'A' ? 'A.txt' : 'B.txt' }],
      total_count: 1,
      total_count_included: true,
      offset,
      limit,
      parent_id: parentID,
      groups: [],
    }),
    getQuota: async () => ({
      quota_bytes: 100,
      used_bytes: account === 'A' ? 10 : 20,
      available_bytes: account === 'A' ? 90 : 80,
      reserved_bytes: 0,
    }),
  }

  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    lifecycleKey,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    changePollIntervalMs: 0,
    preserveStateOnDisable: true,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let controller = render()

  assert.equal(aRootLoads, 1)
  assert.equal(controller.items[0]?.name, 'A.txt')
  assert.deepEqual(controller.crumbs.map((crumb) => crumb.id), [1])

  account = 'B'
  lifecycleKey = 'server-b:user-b'
  render()
  await flushAsync()
  controller = render()

  assert.equal(
    bRootLoads,
    1,
    'account B must issue a fresh Cloud Files root load even when enabled and port identity remain unchanged',
  )
  assert.equal(
    controller.items[0]?.name,
    'B.txt',
    'account B must never retain account-A projected items when node ids are reused',
  )
  assert.deepEqual(controller.crumbs.map((crumb) => crumb.id), [1])
  assert.equal(controller.quota?.used_bytes, 20)
})


test('late Cloud Files account-A initial range cannot overwrite account B after lifecycle switch', async () => {
  const runtime = createHookRuntime()
  const useController = loadCloudFilesController(runtime.react)
  const sort = { key: 'name', direction: 'asc' }

  let account = 'A'
  let lifecycleKey = 'server-a:user-a'
  let releaseA
  let aRangeCalls = 0
  let bRangeCalls = 0

  const port = {
    getRoot: async () => ({ id: 1 }),
    getPage: async () => ({ items: [], has_more: false }),
    getRange: async (parentID, offset, limit) => {
      if (account === 'A') {
        aRangeCalls += 1
        return new Promise((resolve) => {
          releaseA = () => resolve({
            items: [{ id: 10, name: 'A.txt' }],
            total_count: 1,
            total_count_included: true,
            offset,
            limit,
            parent_id: parentID,
            groups: [],
          })
        })
      }
      bRangeCalls += 1
      return {
        items: [{ id: 10, name: 'B.txt' }],
        total_count: 1,
        total_count_included: true,
        offset,
        limit,
        parent_id: parentID,
        groups: [],
      }
    },
    getQuota: async () => ({
      quota_bytes: 100,
      used_bytes: account === 'A' ? 10 : 20,
      available_bytes: account === 'A' ? 90 : 80,
      reserved_bytes: 0,
    }),
  }

  const render = () => runtime.render(() => useController({
    port,
    enabled: true,
    lifecycleKey,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    changePollIntervalMs: 0,
    preserveStateOnDisable: true,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  assert.equal(aRangeCalls, 1)
  assert.equal(typeof releaseA, 'function')

  account = 'B'
  lifecycleKey = 'server-b:user-b'
  let controller = render()

  assert.deepEqual(
    controller.items,
    [],
    'the first account-B render must hide stale account-A items before lifecycle effects finish',
  )

  await flushAsync()
  controller = render()
  assert.equal(bRangeCalls, 1)
  assert.equal(controller.items[0]?.name, 'B.txt')

  releaseA()
  await flushAsync()
  controller = render()

  assert.equal(
    controller.items[0]?.name,
    'B.txt',
    'a late account-A range completion must be rejected after the lifecycle generation changes',
  )
  assert.equal(controller.quota?.used_bytes, 20)
})
