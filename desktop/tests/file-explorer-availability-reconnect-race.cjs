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
      './VirtualCollectionController': virtualController,
    },
  ).useXDriveCloudFilesController
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
