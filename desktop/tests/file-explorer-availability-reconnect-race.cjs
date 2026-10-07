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
    useMemo(factory, deps) {
      const index = cursor++
      const current = slots[index]
      if (!current || !sameDeps(current.deps, deps)) {
        slots[index] = {
          kind: 'memo',
          deps: deps ? [...deps] : undefined,
          value: factory(),
        }
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
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports
}

function loadCloudFilesHook(react) {
  const virtualCore = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'virtual-collection.ts'],
    null,
  )
  const virtualController = loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts'],
    react,
    { '../virtual-collection': virtualCore },
  )
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'],
    react,
    {
      '../file-explorer-controller': {
        XDRIVE_FILE_EXPLORER_PAGE_SIZE: 200,
      },
      '../file-explorer-grouping': {
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING: {
          groupBy: 'none',
          foldersFirst: true,
        },
        xDriveFileExplorerGroupingSignature: (grouping) => (
          `${grouping.groupBy}:${grouping.foldersFirst ? 'folders-first' : 'mixed'}`
        ),
      },
      './VirtualCollectionController': virtualController,
    },
  ).useXDriveCloudFilesController
}

function loadNavigationHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerNavigation.ts'],
    react,
    {
      '../file-explorer-controller': {
        XDRIVE_FILE_EXPLORER_DEFAULT_SORT: { key: 'name', direction: 'asc' },
      },
      '../file-explorer-grouping': {
        XDRIVE_FILE_EXPLORER_DEFAULT_GROUPING: {
          groupBy: 'none',
          foldersFirst: true,
        },
      },
    },
  ).useXDriveFileExplorerNavigation
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

test('transient availability outage does not return Desktop FileExplorer to 我的文件', async () => {
  const mainSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'main', 'index.cts'),
    'utf8',
  )
  const availabilityStart = mainSource.indexOf(
    "ipcMain.handle('agent:get-file-availability-batch'",
  )
  const availabilityEnd = mainSource.indexOf(
    "ipcMain.handle('agent:set-file-availability'",
    availabilityStart,
  )
  assert.ok(availabilityStart >= 0 && availabilityEnd > availabilityStart)
  const availabilityHandler = mainSource.slice(availabilityStart, availabilityEnd)
  assert.ok(
    availabilityHandler.includes('runAgentAction<AgentFileAvailabilityBatch>'),
    'availability probes must use the shared non-refresh Agent action path',
  )
  assert.ok(
    availabilityHandler.includes('}, false)'),
    'availability probes must opt out of renderer-driven Agent state refresh',
  )
  assert.equal(
    availabilityHandler.includes('ensureRunning()'),
    false,
    'availability probes must not start or restart the Agent lifecycle',
  )

  const actionStart = mainSource.indexOf('async function runAgentAction')
  const actionEnd = mainSource.indexOf('async function attemptAutomaticLogin', actionStart)
  assert.ok(actionStart >= 0 && actionEnd > actionStart)
  const actionSource = mainSource.slice(actionStart, actionEnd)
  assert.ok(
    actionSource.includes('if (refresh && isUnavailable(error))'),
    'non-refresh renderer reads must not publish global Agent disconnected state',
  )

  const runtime = createHookRuntime()
  const useCloudFiles = loadCloudFilesHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const projects = { id: 2, name: 'Projects' }
  const report = { id: 3, name: 'report.pdf' }
  const sort = { key: 'name', direction: 'asc' }
  const enabled = true

  const port = {
    async getRoot() {
      return root
    },
    async getQuota() {
      return {
        quota_bytes: 1000,
        physical_used_bytes: 100,
        available_bytes: 900,
        logical_file_bytes: 100,
        trash_bytes: 0,
        history_bytes: 0,
        over_quota: false,
      }
    },
    async getPage() {
      throw new Error('unexpected getPage')
    },
    async getRange(parentID, offset, limit) {
      return {
        items: parentID === root.id ? [projects] : [report],
        total_count: 1,
        offset,
        limit,
        sort: 'name',
        order: 'asc',
      }
    },
  }

  const render = () => runtime.render(() => useCloudFiles({
    port,
    enabled,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let cloud = render()
  assert.deepEqual(cloud.crumbs, [root])

  await cloud.loadDirectory(projects.id, [root, projects], sort)
  cloud = render()
  assert.deepEqual(cloud.crumbs, [root, projects])

  // A transient availability failure is now contained inside the passive
  // probe path. Global Agent connectivity stays enabled, so CloudFiles never
  // executes its disable/reset/re-enable root initialization sequence.
  cloud = render()

  assert.deepEqual(
    cloud.crumbs,
    [root, projects],
    'a best-effort availability failure must not reset the active child directory',
  )
})


test('transient Agent monitor reconnect preserves the active child directory', async () => {
  const mainSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'main', 'index.cts'),
    'utf8',
  )
  const monitorStart = mainSource.indexOf('function startAgentMonitor()')
  const monitorEnd = mainSource.indexOf('function startTransferMonitor()', monitorStart)
  assert.ok(monitorStart >= 0 && monitorEnd > monitorStart)
  const monitorSource = mainSource.slice(monitorStart, monitorEnd)
  assert.ok(
    monitorSource.includes('publishAgentState({ connected: false'),
    'Agent monitor should continue reporting a real transient disconnected state',
  )

  const runtime = createHookRuntime()
  const useCloudFiles = loadCloudFilesHook(runtime.react)
  const root = { id: 1, name: '我的文件' }
  const projects = { id: 2, name: 'Projects' }
  const report = { id: 3, name: 'report.pdf' }
  const sort = { key: 'name', direction: 'asc' }
  let enabled = true

  const port = {
    async getRoot() {
      return root
    },
    async getQuota() {
      return {
        quota_bytes: 1000,
        physical_used_bytes: 100,
        available_bytes: 900,
        logical_file_bytes: 100,
        trash_bytes: 0,
        history_bytes: 0,
        over_quota: false,
      }
    },
    async getPage() {
      throw new Error('unexpected getPage')
    },
    async getRange(parentID, offset, limit) {
      return {
        items: parentID === root.id ? [projects] : [report],
        total_count: 1,
        offset,
        limit,
        sort: 'name',
        order: 'asc',
      }
    },
  }

  const render = () => runtime.render(() => useCloudFiles({
    port,
    enabled,
    defaultSort: sort,
    quotaRefreshIntervalMs: 0,
    preserveStateOnDisable: true,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let cloud = render()
  assert.deepEqual(cloud.crumbs, [root])

  await cloud.loadDirectory(projects.id, [root, projects], sort)
  cloud = render()
  assert.deepEqual(cloud.crumbs, [root, projects])

  // A monitor failure still reaches the renderer as connected=false. Desktop
  // opts into state preservation, so disabling aborts stale work but keeps the
  // active crumbs. Reconnect reloads Projects rather than loadInitial(root).
  enabled = false
  cloud = render()
  assert.deepEqual(cloud.crumbs, [root, projects])

  enabled = true
  render()
  await flushAsync()
  cloud = render()

  assert.deepEqual(
    cloud.crumbs,
    [root, projects],
    'transient Agent monitor reconnect must preserve the active child directory',
  )
})

test('CloudFiles reconnect preservation is Desktop-only opt-in', () => {
  const appSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'),
    'utf8',
  )
  assert.ok(
    appSource.includes('preserveStateOnDisable: true'),
    'Desktop CloudFiles must preserve navigation across transient Agent disconnects',
  )

  const controllerSource = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'CloudFilesController.ts'),
    'utf8',
  )
  assert.ok(
    controllerSource.includes('preserveStateOnDisable = false'),
    'shared/Web callers must retain the existing destructive disable default',
  )
})


test('tab activation cannot outlive an Agent reconnect and desynchronize tab from visible directory', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const runtime = createHookRuntime()
    const useCloudFiles = loadCloudFilesHook(runtime.react)
    const useNavigation = loadNavigationHook(runtime.react)
    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const beta = { id: 3, name: 'Beta' }
    const sort = { key: 'name', direction: 'asc' }
    let enabled = true
    let betaLoads = 0
    let releasePendingBeta

    const port = {
      async getRoot() {
        return root
      },
      async getQuota() {
        return {
          quota_bytes: 1000,
          physical_used_bytes: 100,
          available_bytes: 900,
          logical_file_bytes: 100,
          trash_bytes: 0,
          history_bytes: 0,
          over_quota: false,
        }
      },
      async getPage() {
        throw new Error('unexpected getPage')
      },
      getRange(parentID, offset, limit) {
        if (parentID === beta.id) {
          betaLoads += 1
          if (betaLoads >= 2) {
            return new Promise((resolve) => {
              releasePendingBeta = () => resolve({
                items: [{ id: 30, name: 'beta.txt' }],
                total_count: 1,
                offset,
                limit,
                sort: 'name',
                order: 'asc',
              })
            })
          }
        }
        return Promise.resolve({
          items: parentID === root.id
            ? [alpha, beta]
            : parentID === alpha.id
              ? [{ id: 20, name: 'alpha.txt' }]
              : [{ id: 30, name: 'beta.txt' }],
          total_count: parentID === root.id ? 2 : 1,
          offset,
          limit,
          sort: 'name',
          order: 'asc',
        })
      },
    }

    const render = () => runtime.render(() => {
      const cloud = useCloudFiles({
        port,
        enabled,
        defaultSort: sort,
        quotaRefreshIntervalMs: 0,
        preserveStateOnDisable: true,
        onError: (error) => { throw error },
      })
      const navigation = useNavigation({
        crumbs: cloud.crumbs,
        viewModeStorageKey: 'reconnect-tabs',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()
    assert.deepEqual(app.cloud.crumbs, [root])

    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    assert.equal(await app.navigation.openTab([root, beta]), true)
    app = render()
    assert.equal(app.cloud.current?.id, beta.id)
    assert.equal(app.navigation.activeTabID, 'tab-2')

    await app.navigation.activateTab('tab-1')
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    const pendingBetaActivation = app.navigation.activateTab('tab-2')
    await flushAsync()
    assert.equal(typeof releasePendingBeta, 'function')

    enabled = false
    render()
    enabled = true
    render()
    await flushAsync()
    app = render()
    assert.equal(
      app.cloud.current?.id,
      alpha.id,
      'reconnect should reload the directory that was actually visible before reconnect',
    )

    releasePendingBeta()
    await pendingBetaActivation

    app = render()
    assert.equal(
      app.navigation.activeTabID,
      'tab-1',
      'a tab activation invalidated by reconnect must not commit after its directory load was discarded',
    )
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.pathValue, '我的文件/Alpha')
  } finally {
    global.window = originalWindow
  }
})


test('background current-directory reload cannot make a discarded manual navigation corrupt tab history', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const runtime = createHookRuntime()
    const useCloudFiles = loadCloudFilesHook(runtime.react)
    const useNavigation = loadNavigationHook(runtime.react)
    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const beta = { id: 3, name: 'Beta' }
    const sort = { key: 'name', direction: 'asc' }
    let releasePendingBeta

    const port = {
      async getRoot() {
        return root
      },
      async getQuota() {
        return {
          quota_bytes: 1000,
          physical_used_bytes: 100,
          available_bytes: 900,
          logical_file_bytes: 100,
          trash_bytes: 0,
          history_bytes: 0,
          over_quota: false,
        }
      },
      async getPage() {
        throw new Error('unexpected getPage')
      },
      getRange(parentID, offset, limit) {
        if (parentID === beta.id) {
          return new Promise((resolve) => {
            releasePendingBeta = () => resolve({
              items: [{ id: 30, name: 'beta.txt' }],
              total_count: 1,
              offset,
              limit,
              sort: 'name',
              order: 'asc',
            })
          })
        }
        return Promise.resolve({
          items: parentID === root.id
            ? [alpha, beta]
            : [{ id: 20, name: 'alpha.txt' }],
          total_count: parentID === root.id ? 2 : 1,
          offset,
          limit,
          sort: 'name',
          order: 'asc',
        })
      },
    }

    const render = () => runtime.render(() => {
      const cloud = useCloudFiles({
        port,
        enabled: true,
        defaultSort: sort,
        quotaRefreshIntervalMs: 0,
        preserveStateOnDisable: true,
        onError: (error) => { throw error },
      })
      const navigation = useNavigation({
        crumbs: cloud.crumbs,
        viewModeStorageKey: 'reload-vs-manual-navigation',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()
    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.tabs[0]?.label, 'Alpha')

    const pendingManualNavigation = app.navigation.navigateTo([root, beta])
    await flushAsync()
    assert.equal(typeof releasePendingBeta, 'function')

    await app.cloud.loadDirectory(alpha.id, [root, alpha], sort)
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)

    releasePendingBeta()
    await pendingManualNavigation

    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(
      app.navigation.tabs[0]?.label,
      'Alpha',
      'a manual navigation whose directory load was discarded must not rewrite tab history to Beta',
    )
    assert.equal(app.navigation.pathValue, '我的文件/Alpha')
  } finally {
    global.window = originalWindow
  }
})


test('reconnect cannot leave tab grouping ahead of the committed directory grouping', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const runtime = createHookRuntime()
    const useCloudFiles = loadCloudFilesHook(runtime.react)
    const useNavigation = loadNavigationHook(runtime.react)
    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const sort = { key: 'name', direction: 'asc' }
    const noneGrouping = { groupBy: 'none', foldersFirst: true }
    const typeGrouping = { groupBy: 'type', foldersFirst: true }
    let enabled = true
    let releasePendingGrouping

    const page = (parentID, offset, limit, grouping) => ({
      items: parentID === root.id ? [alpha] : [{ id: 20, name: 'alpha.txt' }],
      total_count: 1,
      offset,
      limit,
      sort: 'name',
      order: 'asc',
      groups: grouping?.groupBy === 'type'
        ? [{ key: 'ext:txt', item_count: 1, start_index: 0 }]
        : [],
    })

    const port = {
      async getRoot() {
        return root
      },
      async getQuota() {
        return {
          quota_bytes: 1000,
          physical_used_bytes: 100,
          available_bytes: 900,
          logical_file_bytes: 100,
          trash_bytes: 0,
          history_bytes: 0,
          over_quota: false,
        }
      },
      async getPage() {
        throw new Error('unexpected getPage')
      },
      getRange(parentID, offset, limit, _sort, _includeCount, grouping) {
        if (parentID === alpha.id && grouping?.groupBy === 'type') {
          return new Promise((resolve) => {
            releasePendingGrouping = () => resolve(
              page(parentID, offset, limit, grouping),
            )
          })
        }
        return Promise.resolve(page(parentID, offset, limit, grouping))
      },
    }

    const render = () => runtime.render(() => {
      const cloud = useCloudFiles({
        port,
        enabled,
        defaultSort: sort,
        quotaRefreshIntervalMs: 0,
        preserveStateOnDisable: true,
        onError: (error) => { throw error },
      })
      const navigation = useNavigation({
        crumbs: cloud.crumbs,
        viewModeStorageKey: 'reconnect-grouping',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()
    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.deepEqual(app.cloud.grouping, noneGrouping)
    assert.deepEqual(app.navigation.grouping, noneGrouping)

    app.navigation.changeGrouping(typeGrouping)
    await flushAsync()
    app = render()
    assert.equal(typeof releasePendingGrouping, 'function')
    assert.deepEqual(
      app.navigation.grouping,
      noneGrouping,
      'directory grouping must remain at the last committed value while its replacement load is pending',
    )

    enabled = false
    render()
    enabled = true
    render()
    await flushAsync()
    app = render()
    assert.deepEqual(
      app.cloud.grouping,
      noneGrouping,
      'reconnect should reload the grouping that was actually committed before the pending change',
    )

    releasePendingGrouping()
    await flushAsync()
    app = render()

    assert.deepEqual(
      app.navigation.grouping,
      app.cloud.grouping,
      'a discarded grouping load must not leave tab grouping different from visible CloudFiles grouping',
    )
  } finally {
    global.window = originalWindow
  }
})

test('background reload cannot leave tab sort ahead of the committed directory sort', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const runtime = createHookRuntime()
    const useCloudFiles = loadCloudFilesHook(runtime.react)
    const useNavigation = loadNavigationHook(runtime.react)
    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const nameSort = { key: 'name', direction: 'asc' }
    const updatedSort = { key: 'updated', direction: 'desc' }
    const noneGrouping = { groupBy: 'none', foldersFirst: true }
    let releasePendingSort

    const page = (parentID, offset, limit) => ({
      items: parentID === root.id ? [alpha] : [{ id: 20, name: 'alpha.txt' }],
      total_count: 1,
      offset,
      limit,
      sort: 'name',
      order: 'asc',
      groups: [],
    })

    const port = {
      async getRoot() {
        return root
      },
      async getQuota() {
        return {
          quota_bytes: 1000,
          physical_used_bytes: 100,
          available_bytes: 900,
          logical_file_bytes: 100,
          trash_bytes: 0,
          history_bytes: 0,
          over_quota: false,
        }
      },
      async getPage() {
        throw new Error('unexpected getPage')
      },
      getRange(parentID, offset, limit, sort) {
        if (parentID === alpha.id && sort?.key === 'updated') {
          return new Promise((resolve) => {
            releasePendingSort = () => resolve(page(parentID, offset, limit))
          })
        }
        return Promise.resolve(page(parentID, offset, limit))
      },
    }

    const render = () => runtime.render(() => {
      const cloud = useCloudFiles({
        port,
        enabled: true,
        defaultSort: nameSort,
        quotaRefreshIntervalMs: 0,
        preserveStateOnDisable: true,
        onError: (error) => { throw error },
      })
      const navigation = useNavigation({
        crumbs: cloud.crumbs,
        viewModeStorageKey: 'reload-vs-sort',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()
    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.deepEqual(app.cloud.sort, nameSort)
    assert.deepEqual(app.navigation.sort, nameSort)

    app.navigation.changeSort(updatedSort)
    await flushAsync()
    app = render()
    assert.equal(typeof releasePendingSort, 'function')
    assert.deepEqual(
      app.navigation.sort,
      nameSort,
      'directory sort must remain at the last committed value while its replacement load is pending',
    )

    await app.cloud.loadDirectory(
      alpha.id,
      [root, alpha],
      nameSort,
      noneGrouping,
    )
    app = render()
    assert.deepEqual(app.cloud.sort, nameSort)

    releasePendingSort()
    await flushAsync()
    app = render()

    assert.deepEqual(
      app.navigation.sort,
      app.cloud.sort,
      'a discarded sort load must not leave tab sort different from visible CloudFiles sort',
    )
  } finally {
    global.window = originalWindow
  }
})
