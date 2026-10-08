const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractArrowFunction(name) {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
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
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'missing FileExplorer function: ' + name)
  return { filename, initializer }
}

function compileExpression(filename, name, expression, dependencies) {
  const output = ts.transpileModule(
    'const ' + name + ' = ' + expression + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: filename,
    },
  ).outputText
  const names = Object.keys(dependencies)
  const values = names.map((key) => dependencies[key])
  return new Function(...names, output + '\nreturn ' + name)(...values)
}


function sameDeps(left, right) {
  if (!left || !right || left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function createHookRuntime() {
  const slots = []
  let cursor = 0
  let pendingEffects = []

  const react = {
    useRef(initialValue) {
      const index = cursor++
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initialValue } }
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

function loadExternalDropHook(react) {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerExternalDrop.ts',
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
  const localRequire = (request) => {
    if (request === 'react') return react
    if (request === '../file-explorer-controller') {
      return {
        xDriveFileExplorerExternalDropParentID: (currentID) => currentID,
      }
    }
    return require(request)
  }
  new Function('exports', 'module', 'require', output)(mod.exports, mod, localRequire)
  return mod.exports.useXDriveFileExplorerExternalDropController
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('FileExplorer external folder scan cannot start an upload after interaction lifecycle changes', async () => {
  const source = extractArrowFunction('dropExternalFilesOnBackground')
  const pendingRead = deferred()
  const externalDropGenerationRef = { current: 3 }
  let folderUploadCalls = 0
  let dragEndCalls = 0

  const dropExternalFilesOnBackground = compileExpression(
    source.filename,
    'dropExternalFilesOnBackground',
    source.initializer,
    {
      onExternalFilesDrop: async () => {},
      onExternalFolderDrop: async () => {
        folderUploadCalls += 1
      },
      xDriveFileExplorerReadExternalDrop: async () => pendingRead.promise,
      endItemDrag: () => {
        dragEndCalls += 1
      },
      externalDropGenerationRef,
    },
  )

  const event = {
    preventDefault() {},
    dataTransfer: {
      types: ['Files'],
      files: [],
    },
  }

  const pending = dropExternalFilesOnBackground(event)
  await flushAsync()

  externalDropGenerationRef.current += 1

  pendingRead.resolve({
    files: [],
    directories: ['folder'],
  })
  await pending

  assert.equal(
    folderUploadCalls,
    0,
    'a folder scan started in account/scope A must not invoke the upload callback after scope B becomes current',
  )
  assert.equal(
    dragEndCalls,
    1,
    'stale external drops should still release drag UI state',
  )
})


test('all asynchronous external folder-drop entry points fence stale lifecycle generations', () => {
  const names = ['dropOnFolder', 'dropOnCrumb', 'dropExternalFilesOnBackground']
  for (const name of names) {
    const source = extractArrowFunction(name).initializer
    assert.ok(
      source.includes('const externalDropGeneration = externalDropGenerationRef.current'),
      name + ' must capture the FileExplorer lifecycle generation before async scanning',
    )
    assert.ok(
      source.includes('externalDropGenerationRef.current !== externalDropGeneration'),
      name + ' must reject a scan result from a replaced interaction lifecycle',
    )
  }
})


test('stale ExternalDropController callback cannot begin folder upload after account lifecycle changes', async () => {
  const runtime = createHookRuntime()
  const useExternalDrop = loadExternalDropHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  let accountAUploads = 0
  let accountBUploads = 0
  const refreshes = []

  const render = (uploadFolderEntriesToParent) => runtime.render(() => useExternalDrop({
    lifecycleKey,
    currentID: 7,
    currentCrumbs: [{ id: 7, name: 'same' }],
    sort: { key: 'name', direction: 'asc' },
    currentGrouping: { key: 'none' },
    nodeByID: new Map(),
    uploadFilesToParent: async () => true,
    uploadFolderEntriesToParent,
    refreshCurrentDirectoryIfIdle: async (id) => {
      refreshes.push(id)
    },
  }))

  const accountA = render(async () => {
    accountAUploads += 1
    return true
  })

  lifecycleKey = 'server-b:user-b'
  const accountB = render(async () => {
    accountBUploads += 1
    return true
  })

  const payload = { files: [], directories: ['folder'] }
  await accountA.dropFolderEntries(payload)
  await accountB.dropFolderEntries(payload)

  assert.equal(
    accountAUploads,
    0,
    'a callback captured from account A must not start a folder upload after account B becomes current',
  )
  assert.equal(accountBUploads, 1)
  assert.deepEqual(refreshes, [7])
})

test('ExternalDropController completion from old account cannot refresh the new lifecycle', async () => {
  const runtime = createHookRuntime()
  const useExternalDrop = loadExternalDropHook(runtime.react)

  let lifecycleKey = 'server-a:user-a'
  const pendingA = deferred()
  const refreshes = []

  const render = (uploadFolderEntriesToParent) => runtime.render(() => useExternalDrop({
    lifecycleKey,
    currentID: 7,
    currentCrumbs: [{ id: 7, name: 'same' }],
    sort: { key: 'name', direction: 'asc' },
    currentGrouping: { key: 'none' },
    nodeByID: new Map(),
    uploadFilesToParent: async () => true,
    uploadFolderEntriesToParent,
    refreshCurrentDirectoryIfIdle: async (id) => {
      refreshes.push(id)
    },
  }))

  const accountA = render(() => pendingA.promise)
  const uploadA = accountA.dropFolderEntries({ files: [], directories: ['folder'] })
  await flushAsync()

  lifecycleKey = 'server-b:user-b'
  render(async () => true)

  pendingA.resolve(true)
  await uploadA

  assert.deepEqual(
    refreshes,
    [],
    'an account-A upload completion must not refresh account B even when the numeric current directory id is unchanged',
  )
})
