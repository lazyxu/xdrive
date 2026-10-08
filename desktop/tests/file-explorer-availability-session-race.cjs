const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractAvailabilityEffect() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  let dependencies = null

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('getFileAvailabilityBatch(batchPaths)') &&
      node.arguments[0].getText(sourceFile).includes('setAvailabilityByID(next)')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      const deps = node.arguments[1]
      dependencies = ts.isArrayLiteralExpression(deps)
        ? deps.elements.map((element) => element.getText(sourceFile))
        : null
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop FileExplorer availability batch effect')
  assert.ok(dependencies, 'availability effect must have a dependency array')
  return { filename, callback, dependencies }
}

function compileEffect(filename, callback, dependencies) {
  const output = ts.transpileModule(
    'const effect = ' + callback + ';',
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
  const values = names.map((name) => dependencies[name])
  return new Function(...names, output + '\nreturn effect')(...values)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function batch(mode) {
  return {
    ok: true,
    data: {
      items: [{
        path: 'shared/path.txt',
        availability: {
          Path: 'shared/path.txt',
          Mode: mode,
          Placeholder: true,
          Pinned: mode === 'B',
          OnlineOnly: false,
          Mixed: false,
          AvailableOffline: true,
          InSync: true,
          Syncing: false,
        },
      }],
    },
  }
}

test('Desktop FileExplorer availability response cannot cross account lifecycle when node ids and paths match', async () => {
  const { filename, callback, dependencies } = extractAvailabilityEffect()

  const pendingA = deferred()
  const pendingB = deferred()
  let account = 'A'
  let bCalls = 0
  const writes = []
  const availabilityRequestRef = { current: 0 }
  const availabilityRequests = [{ nodeID: 1, path: 'shared/path.txt' }]

  const window = {
    xdriveDesktop: {
      agent: {
        getFileAvailabilityBatch: () => {
          if (account === 'A') return pendingA.promise
          bCalls += 1
          return pendingB.promise
        },
      },
    },
  }
  const setAvailabilityByID = (next) => {
    const rows = [...next.entries()].map(([id, entry]) => ({
      id,
      mode: entry.state?.Mode ?? null,
    }))
    writes.push(rows)
  }

  const compileForCurrentAccount = () => compileEffect(filename, callback, {
    availabilityRequestRef,
    fileAvailabilitySupported: true,
    availabilityRequests,
    desktopFileAvailabilityBatchLimit: 2048,
    window,
    setAvailabilityByID,
  })

  const effectA = compileForCurrentAccount()
  const cleanupA = effectA()
  await flushAsync()

  account = 'B'
  let cleanupB
  if (dependencies.includes('navigationSessionStorageKey')) {
    if (typeof cleanupA === 'function') cleanupA()
    const effectB = compileForCurrentAccount()
    cleanupB = effectB()
  }

  if (bCalls > 0) {
    pendingB.resolve(batch('B'))
    await flushAsync()
  }

  pendingA.resolve(batch('A'))
  await flushAsync()

  if (typeof cleanupB === 'function') cleanupB()

  const nonEmptyWrites = writes.filter((rows) => rows.length > 0)
  assert.equal(
    bCalls,
    1,
    'account B must start its own availability request even when node ids and paths are unchanged',
  )
  assert.deepEqual(
    nonEmptyWrites,
    [[{ id: 1, mode: 'B' }]],
    'a late account-A availability response must never publish into account B',
  )
})
