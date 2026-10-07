const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function variableInitializer(relativePath, variableName) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, `missing ${variableName} in ${relativePath.join('/')}`)
  return initializer
}

function compileFactory(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', output)(mod, mod.exports)
  return mod.exports
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  const react = {
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: { current: initialValue } }
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
  }
  return {
    react,
    render(factory) {
      cursor = 0
      return factory()
    },
  }
}

function loadRefreshHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerCurrentDirectoryRefresh.ts',
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
  const localRequire = (request) => request === 'react' ? react : require(request)
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerCurrentDirectoryRefresh
}

test('shared current-directory refresh fence ignores stale completion and uses latest context', async () => {
  const runtime = createHookRuntime()
  const useRefresh = loadRefreshHook(runtime.react)
  const refreshes = []
  let currentID = 10
  let crumbs = [{ id: 1, name: '我的文件' }, { id: 10, name: 'A' }]
  let sort = { key: 'name', direction: 'asc' }

  const render = () => runtime.render(() => useRefresh({
    currentID,
    currentCrumbs: crumbs,
    sort,
    refreshDirectory: async (id, nextCrumbs, nextSort) => {
      refreshes.push({ id, crumbs: nextCrumbs, sort: nextSort })
    },
  }))

  const staleCallback = render()
  currentID = 20
  crumbs = [{ id: 1, name: '我的文件' }, { id: 20, name: 'B' }]
  sort = { key: 'updated', direction: 'desc' }
  const currentCallback = render()

  assert.equal(await staleCallback(10), false)
  assert.deepEqual(refreshes, [])

  assert.equal(await currentCallback(20), true)
  assert.deepEqual(refreshes, [{
    id: 20,
    crumbs,
    sort,
  }])
})

test('Web upload completion cannot refresh the directory it started in after navigation moved away', async () => {
  const uploadTargetsSource = variableInitializer(
    ['web', 'src', 'App.tsx'],
    'uploadTargets',
  )
  const makeUploadTargets = compileFactory(`
    type WebUploadTarget = { parentID: number; file: unknown }
    module.exports = (
      fileUploads: { runTargets: (...args: unknown[]) => Promise<any> },
      current: { id: number } | undefined,
      refreshCurrentDirectory: (expectedCurrentID: number | undefined) => Promise<boolean>,
      refreshQuota: () => Promise<void>,
    ) => {
      const uploadTargets = ${uploadTargetsSource}
      return uploadTargets
    }
  `)

  let releaseUpload
  const fileUploads = {
    runTargets: () => new Promise((resolve) => {
      releaseUpload = () => resolve({
        started: true,
        uploaded: 1,
        skipped: 0,
        failed: 0,
        cancelled: false,
      })
    }),
  }

  let visibleDirectoryID = 10
  const refreshes = []
  const uploadTargets = makeUploadTargets(
    fileUploads,
    { id: 10 },
    async (expectedCurrentID) => {
      if (visibleDirectoryID !== expectedCurrentID) return false
      refreshes.push(expectedCurrentID)
      visibleDirectoryID = expectedCurrentID
      return true
    },
    async () => {},
  )

  const pending = uploadTargets([{ parentID: 10, file: {} }])
  await flushAsync()

  visibleDirectoryID = 20
  releaseUpload()
  await pending

  assert.equal(
    visibleDirectoryID,
    20,
    'an upload completion from directory A must not navigate the user back from B to A',
  )
  assert.deepEqual(
    refreshes,
    [],
    'stale Web upload completion must not refresh the directory captured by its old render',
  )
})

test('Desktop conflict-aware upload completion cannot refresh an old directory after navigation moved away', async () => {
  const uploadTargetsSource = variableInitializer(
    ['desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'],
    'uploadConflictAwareTargets',
  )
  const makeUploadTargets = compileFactory(`
    type DesktopUploadTarget = { parentID: number; file: unknown; relativePath?: string }
    module.exports = (
      explorerActionBusy: boolean,
      runUploadTargets: (...args: unknown[]) => Promise<any>,
      current: { id: number } | undefined,
      crumbs: Array<{ id: number; name: string }>,
      sort: { key: string; direction: string },
      refreshCurrentDirectoryIfCurrent: (expectedCurrentID: number | undefined) => Promise<boolean>,
      onQuotaChanged: () => Promise<void>,
      onError: (error: string) => void,
    ) => {
      const uploadConflictAwareTargets = ${uploadTargetsSource}
      return uploadConflictAwareTargets
    }
  `)

  let releaseUpload
  const runUploadTargets = () => new Promise((resolve) => {
    releaseUpload = () => resolve({
      started: true,
      uploaded: 1,
      skipped: 0,
      failed: 0,
      cancelled: false,
    })
  })

  let visibleDirectoryID = 10
  const refreshes = []
  const uploadTargets = makeUploadTargets(
    false,
    runUploadTargets,
    { id: 10 },
    [{ id: 1, name: '我的文件' }, { id: 10, name: 'A' }],
    { key: 'name', direction: 'asc' },
    async (expectedCurrentID) => {
      if (visibleDirectoryID !== expectedCurrentID) return false
      refreshes.push(expectedCurrentID)
      visibleDirectoryID = expectedCurrentID
      return true
    },
    async () => {},
    (error) => { throw new Error(error) },
  )

  const pending = uploadTargets(
    async () => [{ parentID: 10, file: {} }],
    'upload',
  )
  await flushAsync()

  visibleDirectoryID = 20
  releaseUpload()
  await pending

  assert.equal(
    visibleDirectoryID,
    20,
    'a Desktop upload completion from directory A must not navigate the user back from B to A',
  )
  assert.deepEqual(
    refreshes,
    [],
    'stale Desktop upload completion must not refresh the directory captured by its old render',
  )
})
