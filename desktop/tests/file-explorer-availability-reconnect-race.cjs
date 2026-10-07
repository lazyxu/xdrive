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
    unmount() {
      for (const slot of slots) {
        if (typeof slot?.cleanup === 'function') {
          const cleanup = slot.cleanup
          slot.cleanup = undefined
          cleanup()
        }
      }
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
      '../cloud-files': {
        xDriveCloudFilesChangeAffectsParent: (change, parentID) => (
          change.affected_parent_ids.includes(parentID)
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

function loadExternalDropHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerExternalDrop.ts'],
    react,
    {
      '../file-explorer-controller': {
        xDriveFileExplorerExternalDropParentID: (currentID, target) => (
          target?.kind === 'dir' ? Number(target.id) : currentID
        ),
      },
    },
  ).useXDriveFileExplorerExternalDropController
}

function loadFavoriteHook(react) {
  return loadTypeScriptModule(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerFavoriteController.ts'],
    react,
  ).useXDriveFileExplorerFavorites
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


test('a pending reconnect reload yields to a newer tab activation', async () => {
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
    let reconnecting = false
    let releaseReconnectAlpha

    const page = (parentID, offset, limit) => ({
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
      getRange(parentID, offset, limit) {
        if (reconnecting && parentID === alpha.id) {
          return new Promise((resolve) => {
            releaseReconnectAlpha = () => resolve(page(parentID, offset, limit))
          })
        }
        return Promise.resolve(page(parentID, offset, limit))
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
        viewModeStorageKey: 'reconnect-reload-vs-tab',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()

    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(await app.navigation.openTab([root, beta]), true)
    app = render()
    await app.navigation.activateTab('tab-1')
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    reconnecting = true
    enabled = false
    render()
    enabled = true
    render()
    await flushAsync()
    app = render()
    assert.equal(typeof releaseReconnectAlpha, 'function')

    const activateBeta = app.navigation.activateTab('tab-2')
    await activateBeta
    app = render()
    assert.equal(app.cloud.current?.id, beta.id)
    assert.equal(app.navigation.activeTabID, 'tab-2')
    assert.equal(app.navigation.pathValue, '我的文件/Beta')

    releaseReconnectAlpha()
    await flushAsync()
    app = render()

    assert.equal(
      app.cloud.current?.id,
      beta.id,
      'an older reconnect reload must not replace the directory committed by a newer tab activation',
    )
    assert.equal(app.navigation.activeTabID, 'tab-2')
    assert.equal(app.navigation.pathValue, '我的文件/Beta')
  } finally {
    global.window = originalWindow
  }
})


test('node-change background refresh cannot cancel a newer manual tab navigation', async () => {
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
    let betaPending = false
    let releasePendingBeta
    let changeCalls = 0

    const page = (parentID, offset, limit) => ({
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
      getRange(parentID, offset, limit) {
        if (parentID === beta.id && betaPending) {
          return new Promise((resolve) => {
            releasePendingBeta = () => resolve(page(parentID, offset, limit))
          })
        }
        return Promise.resolve(page(parentID, offset, limit))
      },
      async getChanges(cursor) {
        changeCalls += 1
        if (changeCalls === 1) {
          return {
            changes: [],
            next_cursor: 1,
            latest_cursor: 1,
            has_more: false,
            reset_required: false,
          }
        }
        return {
          changes: [{
            id: 1,
            kind: 'updated',
            affected_parent_ids: [alpha.id],
          }],
          next_cursor: 2,
          latest_cursor: 2,
          has_more: false,
          reset_required: false,
        }
      },
    }

    const render = () => runtime.render(() => {
      const cloud = useCloudFiles({
        port,
        enabled: true,
        defaultSort: sort,
        quotaRefreshIntervalMs: 0,
        changePollIntervalMs: 0,
        changeDebounceMs: 0,
        preserveStateOnDisable: true,
        onError: (error) => { throw error },
      })
      const navigation = useNavigation({
        crumbs: cloud.crumbs,
        viewModeStorageKey: 'change-refresh-vs-tab-navigation',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()

    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(await app.navigation.openTab([root, beta]), true)
    app = render()
    await app.navigation.activateTab('tab-1')
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    // Establish the change-feed cursor before starting the race.
    await app.cloud.refreshChanges()
    app = render()

    betaPending = true
    const activateBeta = app.navigation.activateTab('tab-2')
    await flushAsync()
    assert.equal(typeof releasePendingBeta, 'function')

    // A background node-change refresh for currently committed Alpha starts
    // after the user's newer Beta navigation request.
    await app.cloud.refreshChanges()
    app = render()
    assert.equal(
      app.cloud.current?.id,
      alpha.id,
      'background refresh may keep Alpha visible only while Beta is still pending',
    )

    releasePendingBeta()
    await activateBeta

    app = render()
    assert.equal(
      app.cloud.current?.id,
      beta.id,
      'a node-change refresh must not cancel a newer manual navigation to Beta',
    )
    assert.equal(app.navigation.activeTabID, 'tab-2')
    assert.equal(app.navigation.pathValue, '我的文件/Beta')
  } finally {
    global.window = originalWindow
  }
})


test('background current-directory refresh yields to a pending manual navigation', async () => {
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
    let betaPending = false
    let releasePendingBeta

    const page = (parentID, offset, limit) => ({
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
      getRange(parentID, offset, limit) {
        if (parentID === beta.id && betaPending) {
          return new Promise((resolve) => {
            releasePendingBeta = () => resolve(page(parentID, offset, limit))
          })
        }
        return Promise.resolve(page(parentID, offset, limit))
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
        viewModeStorageKey: 'background-refresh-vs-navigation',
        onLoadDirectory: cloud.loadDirectory,
      })
      return { cloud, navigation }
    })

    render()
    await flushAsync()
    let app = render()

    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(await app.navigation.openTab([root, beta]), true)
    app = render()
    await app.navigation.activateTab('tab-1')
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    betaPending = true
    const activateBeta = app.navigation.activateTab('tab-2')
    await flushAsync()
    assert.equal(typeof releasePendingBeta, 'function')

    const refreshed = await app.cloud.refreshCurrentDirectoryIfIdle(alpha.id)
    assert.equal(
      refreshed,
      false,
      'background refresh must yield while a newer directory navigation is pending',
    )

    releasePendingBeta()
    await activateBeta
    app = render()

    assert.equal(app.cloud.current?.id, beta.id)
    assert.equal(app.navigation.activeTabID, 'tab-2')
    assert.equal(app.navigation.pathValue, '我的文件/Beta')
  } finally {
    global.window = originalWindow
  }
})

test('background FileExplorer mutation completions use the guarded idle refresh path', () => {
  const webSource = fs.readFileSync(
    path.join(repo, 'web', 'src', 'App.tsx'),
    'utf8',
  )
  const desktopSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'),
    'utf8',
  )
  const webExplorerSource = fs.readFileSync(
    path.join(repo, 'web', 'src', 'WebFileExplorer.tsx'),
    'utf8',
  )
  const desktopExplorerSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'),
    'utf8',
  )

  assert.ok(
    webSource.includes('refreshCurrentDirectoryIfIdle'),
    'Web must consume the CloudFiles guarded idle refresh helper',
  )
  assert.ok(
    desktopSource.includes('refreshCurrentDirectoryIfIdle'),
    'Desktop must consume the CloudFiles guarded idle refresh helper',
  )
  assert.ok(
    webExplorerSource.includes('onRefreshCurrentDirectoryIfIdle'),
    'Web FileExplorer background completions must use the guarded refresh adapter',
  )
  assert.equal(
    webExplorerSource.includes('useXDriveFileExplorerCurrentDirectoryRefresh'),
    false,
    'Web FileExplorer must not rebuild a weaker current-ID-only refresh fence',
  )
  assert.ok(
    desktopExplorerSource.includes('onRefreshCurrentDirectoryIfIdle'),
    'Desktop FileExplorer background completions must use the guarded refresh adapter',
  )
  assert.equal(
    desktopExplorerSource.includes('useXDriveFileExplorerCurrentDirectoryRefresh'),
    false,
    'Desktop FileExplorer must not rebuild a weaker current-ID-only refresh fence',
  )

  const webLifecycleStart = webSource.indexOf('useXDriveFileOperationLifecycle<XDriveFileOperation>')
  const webLifecycleEnd = webSource.indexOf('const fileOperationActions', webLifecycleStart)
  assert.ok(webLifecycleStart >= 0 && webLifecycleEnd > webLifecycleStart)
  const webLifecycle = webSource.slice(webLifecycleStart, webLifecycleEnd)
  assert.ok(
    webLifecycle.includes('refreshCurrentDirectoryIfIdle'),
    'Web FileOperation terminal transitions must yield to an in-flight navigation',
  )
  assert.equal(
    webLifecycle.includes('void loadDirectory('),
    false,
    'Web FileOperation terminal transitions must not issue a raw directory reload',
  )

  const desktopLifecycleStart = desktopSource.indexOf('useXDriveFileOperationLifecycle<AgentCloudFileOperation>')
  const desktopLifecycleEnd = desktopSource.indexOf('const fileOperationConflictResolveSupported', desktopLifecycleStart)
  assert.ok(desktopLifecycleStart >= 0 && desktopLifecycleEnd > desktopLifecycleStart)
  const desktopLifecycle = desktopSource.slice(desktopLifecycleStart, desktopLifecycleEnd)
  assert.ok(
    desktopLifecycle.includes('refreshCloudCurrentDirectoryIfIdle'),
    'Desktop FileOperation terminal transitions must yield to an in-flight navigation',
  )
  assert.equal(
    desktopLifecycle.includes('void loadCloudDirectory('),
    false,
    'Desktop FileOperation terminal transitions must not issue a raw directory reload',
  )

  const desktopTrashStart = desktopSource.indexOf('onTrashChanged={async () => {')
  const desktopTrashEnd = desktopSource.indexOf('historyNode={cloudHistoryNode}', desktopTrashStart)
  assert.ok(desktopTrashStart >= 0 && desktopTrashEnd > desktopTrashStart)
  const desktopTrash = desktopSource.slice(desktopTrashStart, desktopTrashEnd)
  assert.ok(
    desktopTrash.includes('refreshCloudCurrentDirectoryIfIdle'),
    'Desktop Trash completion refresh must yield to an in-flight navigation',
  )
  assert.equal(
    desktopTrash.includes('loadCloudDirectory('),
    false,
    'Desktop Trash completion must not issue a raw directory reload',
  )

  const desktopHistoryStart = desktopSource.indexOf('onHistoryRestored={async (restored) => {')
  const desktopHistoryEnd = desktopSource.indexOf('shareNode={cloudShareNode}', desktopHistoryStart)
  assert.ok(desktopHistoryStart >= 0 && desktopHistoryEnd > desktopHistoryStart)
  const desktopHistory = desktopSource.slice(desktopHistoryStart, desktopHistoryEnd)
  assert.ok(
    desktopHistory.includes('refreshCloudCurrentDirectoryIfIdle'),
    'Desktop Version History restore refresh must yield to an in-flight navigation',
  )
  assert.equal(
    desktopHistory.includes('loadCloudDirectory('),
    false,
    'Desktop Version History restore must not issue a raw directory reload',
  )

  const trashChangedStart = webSource.indexOf('onTrashChanged={async () => {')
  const trashChangedEnd = webSource.indexOf('onRemove={remove}', trashChangedStart)
  assert.ok(trashChangedStart >= 0 && trashChangedEnd > trashChangedStart)
  assert.ok(
    webSource.slice(trashChangedStart, trashChangedEnd).includes('refreshCurrentDirectoryIfIdle'),
    'Trash completion refresh must yield to an in-flight navigation',
  )

  const restoredStart = webSource.indexOf('onRestored={async (restored) => {')
  const restoredEnd = webSource.indexOf('<XDriveConfirmDialog', restoredStart)
  assert.ok(restoredStart >= 0 && restoredEnd > restoredStart)
  assert.ok(
    webSource.slice(restoredStart, restoredEnd).includes('refreshCurrentDirectoryIfIdle'),
    'Version History restore refresh must yield to an in-flight navigation',
  )
})


test('real Desktop reconnect remount preserves FileExplorer tabs and committed per-tab view state', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const desktopSource = fs.readFileSync(
      path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'),
      'utf8',
    )
    const disconnectedReturn = desktopSource.indexOf('if (!agent.connected) {')
    const filesPage = desktopSource.indexOf('<DesktopFilesPage')
    assert.ok(
      disconnectedReturn >= 0 && filesPage > disconnectedReturn,
      'the real Desktop reconnect boundary unmounts DesktopFileExplorer while App survives',
    )
    assert.ok(
      desktopSource.includes('preserveStateOnDisable: true'),
      'CloudFiles must continue preserving the committed directory across the same reconnect',
    )

    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const beta = { id: 3, name: 'Beta' }
    const updatedSort = { key: 'updated', direction: 'desc' }
    const typeGrouping = { groupBy: 'type', foldersFirst: false }
    let crumbs = [root]
    let navigationSnapshot

    const loadDirectory = async (_id, nextCrumbs) => {
      crumbs = [...nextCrumbs]
      return true
    }

    const firstRuntime = createHookRuntime()
    const useFirstNavigation = loadNavigationHook(firstRuntime.react)
    const renderFirst = () => firstRuntime.render(() => useFirstNavigation({
      crumbs,
      viewModeStorageKey: 'reconnect-remount',
      onLoadDirectory: loadDirectory,
      onNavigationStateChange: (state) => {
        navigationSnapshot = state
      },
    }))

    let navigation = renderFirst()
    await flushAsync()
    navigation = renderFirst()
    await navigation.navigateTo([root, alpha])
    navigation = renderFirst()
    assert.equal(await navigation.openTab([root, beta]), true)
    navigation = renderFirst()

    navigation.changeSort(updatedSort)
    await flushAsync()
    navigation = renderFirst()
    navigation.changeGrouping(typeGrouping)
    await flushAsync()
    navigation = renderFirst()

    assert.equal(navigation.tabs.length, 2)
    assert.equal(navigation.activeTabID, 'tab-2')
    assert.deepEqual(navigation.sort, updatedSort)
    assert.deepEqual(navigation.grouping, typeGrouping)
    assert.equal(navigation.pathValue, '我的文件/Beta')
    assert.equal(navigationSnapshot?.tabs.length, 2)
    assert.equal(navigationSnapshot?.activeTabID, 'tab-2')

    const secondRuntime = createHookRuntime()
    const useSecondNavigation = loadNavigationHook(secondRuntime.react)
    const renderSecond = () => secondRuntime.render(() => useSecondNavigation({
      crumbs,
      viewModeStorageKey: 'reconnect-remount',
      onLoadDirectory: loadDirectory,
      initialNavigationState: navigationSnapshot,
      onNavigationStateChange: (state) => {
        navigationSnapshot = state
      },
    }))

    let restored = renderSecond()
    await flushAsync()
    restored = renderSecond()

    assert.equal(restored.tabs.length, 2)
    assert.deepEqual(
      restored.tabs.map((tab) => tab.label),
      ['Alpha', 'Beta'],
      'transient Agent reconnect must not collapse or relabel FileExplorer tabs',
    )
    assert.equal(restored.activeTabID, 'tab-2')
    assert.equal(restored.pathValue, '我的文件/Beta')
    assert.deepEqual(
      restored.sort,
      updatedSort,
      'remounted tab sort must match the preserved CloudFiles directory sort',
    )
    assert.deepEqual(
      restored.grouping,
      typeGrouping,
      'remounted tab grouping must match the preserved CloudFiles directory grouping',
    )
  } finally {
    global.window = originalWindow
  }
})

test('Desktop owns transient FileExplorer navigation state above the Agent disconnect boundary', () => {
  const desktopSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx'),
    'utf8',
  )
  const explorerSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'),
    'utf8',
  )
  const workspaceSource = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerWorkspaceController.ts'),
    'utf8',
  )

  assert.ok(
    desktopSource.includes('cloudFileExplorerNavigationSnapshot'),
    'Desktop App must own the reconnect navigation snapshot so FileExplorer unmount cannot destroy it',
  )
  assert.ok(
    desktopSource.includes('navigationState: cloudFileExplorerNavigationState'),
    'Desktop must restore its owner-scoped navigation snapshot into FileExplorer',
  )
  assert.ok(
    desktopSource.includes('onNavigationStateChange: rememberCloudFileExplorerNavigationState'),
    'Desktop must receive committed navigation snapshots from FileExplorer',
  )
  assert.ok(
    explorerSource.includes('initialNavigationState: navigationState'),
    'DesktopFileExplorer must pass the transient snapshot into the shared workspace',
  )
  assert.ok(
    workspaceSource.includes('initialNavigationState'),
    'the shared workspace must support a caller-owned transient navigation snapshot',
  )
})


test('external drop completion cannot cancel a pending manual tab navigation', async () => {
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
    const useExternalDrop = loadExternalDropHook(runtime.react)
    const root = { id: 1, name: '我的文件' }
    const alpha = { id: 2, name: 'Alpha' }
    const beta = { id: 3, name: 'Beta' }
    const sort = { key: 'name', direction: 'asc' }
    let betaPending = false
    let releasePendingBeta
    let releaseUpload

    const page = (parentID, offset, limit) => ({
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
      getRange(parentID, offset, limit) {
        if (parentID === beta.id && betaPending) {
          return new Promise((resolve) => {
            releasePendingBeta = () => resolve(page(parentID, offset, limit))
          })
        }
        return Promise.resolve(page(parentID, offset, limit))
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
        viewModeStorageKey: 'external-drop-vs-tab-navigation',
        onLoadDirectory: cloud.loadDirectory,
      })
      const externalDrop = useExternalDrop({
        currentID: cloud.current?.id,
        currentCrumbs: cloud.crumbs,
        sort: cloud.sort,
        currentGrouping: cloud.grouping,
        nodeByID: new Map(),
        uploadFilesToParent: async () => new Promise((resolve) => {
          releaseUpload = () => resolve(true)
        }),
        uploadFolderEntriesToParent: async () => false,
        // Keep the legacy raw loader present in the harness so this test
        // fails against the old controller that preferred it.
        refreshDirectory: cloud.loadDirectory,
        refreshCurrentDirectoryIfIdle: cloud.refreshCurrentDirectoryIfIdle,
      })
      return { cloud, navigation, externalDrop }
    })

    render()
    await flushAsync()
    let app = render()

    await app.navigation.navigateTo([root, alpha])
    app = render()
    assert.equal(await app.navigation.openTab([root, beta]), true)
    app = render()
    await app.navigation.activateTab('tab-1')
    app = render()
    assert.equal(app.cloud.current?.id, alpha.id)
    assert.equal(app.navigation.activeTabID, 'tab-1')

    const pendingDrop = app.externalDrop.dropFiles([{}])
    await flushAsync()
    assert.equal(typeof releaseUpload, 'function')

    betaPending = true
    const activateBeta = app.navigation.activateTab('tab-2')
    await flushAsync()
    assert.equal(typeof releasePendingBeta, 'function')

    releaseUpload()
    await pendingDrop

    releasePendingBeta()
    await activateBeta
    app = render()

    assert.equal(
      app.cloud.current?.id,
      beta.id,
      'an older external-drop completion must not reload Alpha and cancel the pending Beta navigation',
    )
    assert.equal(app.navigation.activeTabID, 'tab-2')
    assert.equal(app.navigation.pathValue, '我的文件/Beta')
  } finally {
    global.window = originalWindow
  }
})

test('Web and Desktop external drop use the CloudFiles guarded idle refresh adapter', () => {
  const controllerSource = fs.readFileSync(
    path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorerExternalDrop.ts'),
    'utf8',
  )
  const webSource = fs.readFileSync(
    path.join(repo, 'web', 'src', 'WebFileExplorer.tsx'),
    'utf8',
  )
  const desktopSource = fs.readFileSync(
    path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'),
    'utf8',
  )

  assert.ok(
    controllerSource.includes('refreshCurrentDirectoryIfIdle'),
    'shared ExternalDrop must consume the guarded current-directory refresh adapter',
  )
  assert.equal(
    controllerSource.includes('currentContextRef'),
    false,
    'ExternalDrop must not rebuild the old current-ID-only refresh fence',
  )
  assert.ok(
    webSource.includes('refreshCurrentDirectoryIfIdle: onRefreshCurrentDirectoryIfIdle'),
    'Web external drop must pass the CloudFiles idle refresh guard',
  )
  assert.equal(
    webSource.includes('refreshDirectory: onLoadDirectory'),
    false,
    'Web external drop must not pass the raw directory loader as a background refresh',
  )
  assert.ok(
    desktopSource.includes('refreshCurrentDirectoryIfIdle: onRefreshCurrentDirectoryIfIdle'),
    'Desktop external drop must pass the CloudFiles idle refresh guard',
  )
  assert.equal(
    desktopSource.includes('refreshDirectory: onLoadDirectory'),
    false,
    'Desktop external drop must not pass the raw directory loader as a background refresh',
  )
})


test('unmounted FileExplorer navigation intent cannot overwrite a remounted workspace', async () => {
  const originalWindow = global.window
  global.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  }

  try {
    const root = { id: 1, name: '我的文件' }
    const beta = { id: 2, name: 'Beta' }
    const gamma = { id: 3, name: 'Gamma' }
    let crumbs = [root]
    let visibleDirectoryID = root.id

    const loadDirectory = async (id, nextCrumbs) => {
      visibleDirectoryID = id
      crumbs = [...nextCrumbs]
      return true
    }

    // This first hook instance models DesktopFileExplorer before Agent disconnect.
    const oldRuntime = createHookRuntime()
    const useOldNavigation = loadNavigationHook(oldRuntime.react)
    const renderOld = () => oldRuntime.render(() => useOldNavigation({
      crumbs,
      viewModeStorageKey: 'unmount-navigation-race-old',
      onLoadDirectory: loadDirectory,
    }))

    let oldNavigation = renderOld()
    await flushAsync()
    oldNavigation = renderOld()

    // Quick Access / Recent / typed-path flows capture a navigation intent
    // before awaiting target resolution. Hold that intent across unmount.
    const staleIntent = oldNavigation.beginNavigationIntent()
    oldRuntime.unmount()

    // Agent reconnect mounts a brand-new FileExplorer instance. The user then
    // explicitly navigates the new instance to Gamma.
    const newRuntime = createHookRuntime()
    const useNewNavigation = loadNavigationHook(newRuntime.react)
    const renderNew = () => newRuntime.render(() => useNewNavigation({
      crumbs,
      viewModeStorageKey: 'unmount-navigation-race-new',
      onLoadDirectory: loadDirectory,
    }))

    let newNavigation = renderNew()
    await flushAsync()
    newNavigation = renderNew()
    await newNavigation.navigateTo([root, gamma])
    newNavigation = renderNew()

    assert.equal(visibleDirectoryID, gamma.id)
    assert.equal(newNavigation.pathValue, '我的文件/Gamma')
    assert.equal(newNavigation.tabs[0]?.label, 'Gamma')

    // The old instance's async target resolution now completes. It must not be
    // allowed to call the App-owned directory loader after its owner unmounted.
    await oldNavigation.navigateTo([root, beta], true, staleIntent)

    const finalNavigation = renderNew()
    assert.equal(
      visibleDirectoryID,
      gamma.id,
      'an unmounted FileExplorer instance must not navigate the shared CloudFiles state after reconnect',
    )
    assert.equal(
      finalNavigation.pathValue,
      '我的文件/Gamma',
      'address path must stay aligned with the remounted active workspace',
    )
    assert.equal(
      finalNavigation.tabs[0]?.label,
      'Gamma',
      'active tab title must stay aligned with the visible directory after stale old-instance completion',
    )
  } finally {
    global.window = originalWindow
  }
})


test('favorite lookup from an unmounted FileExplorer cannot activate a stale file', async () => {
  const runtime = createHookRuntime()
  const useFavorites = loadFavoriteHook(runtime.react)
  const favoriteItem = {
    node: {
      id: 42,
      name: 'report.pdf',
      size: 128,
      revision: 1,
      updated_at: '2026-10-07T00:00:00Z',
    },
    path: '/report.pdf',
    crumbs: [{ id: 1, name: '我的文件' }],
    favorited_at: '2026-10-07T00:00:00Z',
  }
  let controlled = false
  let releaseLookup
  const activated = []

  const loadItems = () => {
    if (!controlled) return Promise.resolve([favoriteItem])
    return new Promise((resolve) => {
      releaseLookup = () => resolve([favoriteItem])
    })
  }

  const render = () => runtime.render(() => useFavorites({
    loadItems,
    favoriteItem: async () => favoriteItem,
    unfavoriteItem: async () => undefined,
    onError: (error) => { throw error },
  }))

  render()
  await flushAsync()
  let favorites = render()

  controlled = true
  const pending = favorites.activate(favoriteItem.node.id, async (node) => {
    activated.push(node.id)
  })
  await flushAsync()
  assert.equal(typeof releaseLookup, 'function')

  // Desktop disconnect unmounts FileExplorer while the Agent-facing lookup is
  // still pending. A completion owned by this old instance must not perform
  // the user-visible file-open callback after reconnect.
  runtime.unmount()

  releaseLookup()
  await pending
  favorites = render()

  assert.deepEqual(
    activated,
    [],
    'an unmounted FileExplorer favorite lookup must not activate a stale file after reconnect',
  )
})
