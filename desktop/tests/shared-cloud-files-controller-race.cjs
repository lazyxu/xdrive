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
