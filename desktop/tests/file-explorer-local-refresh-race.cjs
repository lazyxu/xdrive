const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function read(...parts) {
  return fs.readFileSync(path.join(repo, ...parts), 'utf8')
}

function extractVariableInitializer(source, filename, variableName) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.ES2022,
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
  assert.ok(initializer, `missing ${variableName} in ${filename}`)
  return initializer
}

function loadClosureFunction(source, filename, variableName, bindings) {
  const initializer = extractVariableInitializer(source, filename, variableName)
  const compiled = ts.transpileModule(
    `const candidate = ${initializer}; module.exports = candidate;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    },
  ).outputText

  const mod = { exports: {} }
  const names = Object.keys(bindings)
  const values = Object.values(bindings)
  new Function('exports', 'module', ...names, compiled)(
    mod.exports,
    mod,
    ...values,
  )
  return mod.exports
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
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (request) => request === 'react' ? react : require(request)
  new Function('exports', 'module', 'require', compiled)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerCurrentDirectoryRefresh
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('shared current-directory refresh fence rejects stale directory and uses latest context', async () => {
  const runtime = createHookRuntime()
  const useRefresh = loadRefreshHook(runtime.react)
  const calls = []
  let currentID = 10
  let crumbs = [{ id: 1, name: '我的文件' }, { id: 10, name: 'A' }]
  let sort = { key: 'name', direction: 'asc' }
  const refreshDirectory = async (id, nextCrumbs, nextSort) => {
    calls.push({ id, crumbs: nextCrumbs, sort: nextSort })
  }
  const render = () => runtime.render(() => useRefresh({
    currentID,
    currentCrumbs: crumbs,
    sort,
    refreshDirectory,
  }))

  const refreshFromA = render()
  currentID = 20
  crumbs = [{ id: 1, name: '我的文件' }, { id: 20, name: 'B' }]
  sort = { key: 'updated', direction: 'desc' }
  render()

  assert.equal(await refreshFromA(10), false)
  assert.deepEqual(calls, [])

  assert.equal(await refreshFromA(20), true)
  assert.deepEqual(calls, [{
    id: 20,
    crumbs,
    sort,
  }])
})

test('Web upload completion cannot refresh the directory it started from after navigation moved away', async () => {
  const source = read('web', 'src', 'App.tsx')
  let releaseUpload
  const refreshCalls = []
  let visibleDirectoryID = 10

  const uploadTargets = loadClosureFunction(
    source,
    'web/src/App.tsx',
    'uploadTargets',
    {
      fileUploads: {
        runTargets: () => new Promise((resolve) => {
          releaseUpload = () => resolve({ uploaded: 1, skipped: 0, failed: 0 })
        }),
      },
      current: { id: 10, name: 'A' },
      loadDirectory: async (id) => {
        refreshCalls.push(id)
      },
      refreshCurrentDirectoryIfCurrent: async (expectedID) => {
        if (expectedID !== visibleDirectoryID) return false
        refreshCalls.push(expectedID)
        return true
      },
      refreshQuota: async () => {},
    },
  )

  const pending = uploadTargets(
    [{ parentID: 10, file: { name: 'a.txt', size: 1 } }],
    true,
    'upload',
  )
  await flushAsync()
  assert.equal(typeof releaseUpload, 'function')

  // User navigated to directory B while A's upload was still pending.
  visibleDirectoryID = 20
  releaseUpload()
  await pending

  assert.deepEqual(
    refreshCalls,
    [],
    `upload completion from A must not refresh stale directory A after current directory became ${visibleDirectoryID}`,
  )
})

test('Desktop upload completion cannot refresh stale crumbs and sort after navigation moved away', async () => {
  const source = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  let releaseUpload
  const refreshCalls = []
  let visibleDirectoryID = 10
  const crumbs = [
    { id: 1, name: '我的文件' },
    { id: 10, name: 'A' },
  ]
  const sort = { key: 'name', direction: 'asc' }

  const uploadConflictAwareTargets = loadClosureFunction(
    source,
    'desktop/src/renderer/DesktopFileExplorer.tsx',
    'uploadConflictAwareTargets',
    {
      explorerActionBusy: false,
      runUploadTargets: () => new Promise((resolve) => {
        releaseUpload = () => resolve({ uploaded: 1, skipped: 0, failed: 0 })
      }),
      current: { id: 10, name: 'A' },
      crumbs,
      sort,
      onLoadDirectory: async (id, nextCrumbs, nextSort) => {
        refreshCalls.push({ id, crumbs: nextCrumbs, sort: nextSort })
      },
      refreshCurrentDirectoryIfCurrent: async (expectedID) => {
        if (expectedID !== visibleDirectoryID) return false
        refreshCalls.push({ id: expectedID, crumbs, sort })
        return true
      },
      onQuotaChanged: async () => {},
      onError: (error) => { throw error },
    },
  )

  const pending = uploadConflictAwareTargets(
    async () => [{ parentID: 10, file: { name: 'a.txt', size: 1 } }],
    'upload',
  )
  await flushAsync()
  assert.equal(typeof releaseUpload, 'function')

  // User navigated to directory B while A's upload was still pending.
  visibleDirectoryID = 20
  releaseUpload()
  await pending

  assert.deepEqual(
    refreshCalls,
    [],
    `Desktop upload completion from A must not refresh stale A context after current directory became ${visibleDirectoryID}`,
  )
})


test('Web and Desktop local mutation refreshes use the shared current-directory fence', () => {
  const webApp = read('web', 'src', 'App.tsx')
  const webExplorer = read('web', 'src', 'WebFileExplorer.tsx')
  const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')

  for (const token of [
    'useXDriveFileExplorerCurrentDirectoryRefresh',
    'refreshCurrentDirectoryIfCurrent(expectedCurrentID)',
  ]) {
    assert.ok(webApp.includes(token), 'Web local refresh fence missing: ' + token)
    assert.ok(desktop.includes(token), 'Desktop local refresh fence missing: ' + token)
  }

  assert.ok(
    webExplorer.includes('await refreshCurrentDirectoryIfCurrent(expectedCurrentID)'),
    'Web rename must fence its completion refresh',
  )
  assert.equal(
    webExplorer.includes('await onLoadDirectory(current.id, crumbs, sort)'),
    false,
    'Web rename must not refresh a stale render directory directly',
  )
  assert.equal(
    desktop.includes('await onLoadDirectory(current.id, crumbs, sort)'),
    false,
    'Desktop local mutations must not refresh a stale render directory directly',
  )
})
