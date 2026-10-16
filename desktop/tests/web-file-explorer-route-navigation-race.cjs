const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractRouteDirectoryEffect() {
  const filename = path.join(repo, 'web', 'src', 'WebFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('initialDirectoryID') &&
      node.arguments[0].getText(sourceFile).includes('api.node(cursor)')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Web FileExplorer route-directory effect')
  return { filename, callback }
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
  let reject
  const promise = new Promise((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function routeHarness() {
  const { filename, callback } = extractRouteDirectoryEffect()
  const pending = deferred()
  let navigationGeneration = 0
  const navigations = []
  const errors = []

  const beginNavigationIntent = () => {
    navigationGeneration += 1
    return navigationGeneration
  }
  const isNavigationIntentCurrent = (requestID) => (
    requestID === navigationGeneration
  )
  const navigateTo = async (crumbs, _record = true, requestID) => {
    const effectiveRequestID = requestID ?? beginNavigationIntent()
    if (!isNavigationIntentCurrent(effectiveRequestID)) return false
    navigations.push(crumbs.map((crumb) => ({ ...crumb })))
    return true
  }

  const effect = compileEffect(filename, callback, {
    initialDirectoryID: 30,
    current: { id: 10 },
    routedDirectoryRef: { current: null },
    internalDirectoryRouteRef: { current: null },
    navigationSessionStorageKey: 'files:account-a',
    api: {
      node: () => pending.promise,
    },
    navigateTo,
    beginNavigationIntent,
    isNavigationIntentCurrent,
    onError: (error) => errors.push(
      error instanceof Error ? error.message : String(error),
    ),
  })

  return {
    effect,
    pending,
    navigations,
    errors,
    beginNavigationIntent,
  }
}

test('Web route-directory completion cannot override a newer manual navigation intent', async () => {
  const harness = routeHarness()
  const cleanup = harness.effect()
  assert.equal(typeof cleanup, 'function')
  await flushAsync()

  harness.beginNavigationIntent()

  harness.pending.resolve({
    id: 30,
    parent_id: null,
    name: 'Route target',
    type: 'dir',
  })
  await flushAsync()

  assert.deepEqual(
    harness.navigations,
    [],
    'a route resolution started before a newer manual navigation must not reclaim the FileExplorer directory',
  )
  assert.deepEqual(harness.errors, [])

  cleanup()
})

test('Web route-directory rejection cannot publish an error after a newer manual navigation intent', async () => {
  const harness = routeHarness()
  const cleanup = harness.effect()
  assert.equal(typeof cleanup, 'function')
  await flushAsync()

  harness.beginNavigationIntent()

  harness.pending.reject(new Error('stale route directory failure'))
  await flushAsync()

  assert.deepEqual(
    harness.errors,
    [],
    'a stale route-resolution failure must not surface after a newer manual navigation owns FileExplorer',
  )
  assert.deepEqual(harness.navigations, [])

  cleanup()
})

test('acknowledged old child URL cannot undo committed Files Back; new external URL and account still reauthorize', async () => {
  const { filename, callback } = extractRouteDirectoryEffect()
  const routedDirectoryRef = { current: null }
  const internalDirectoryRouteRef = { current: { directoryID: 2, lifecycleKey: 'files:account-a' } }
  const nodeCalls = [], navigations = []
  let generation = 0
  const execute = (initialDirectoryID, currentID, lifecycleKey) => compileEffect(filename, callback, {
    initialDirectoryID, current: { id: currentID }, navigationSessionStorageKey: lifecycleKey,
    routedDirectoryRef, internalDirectoryRouteRef,
    api: { node: async id => {
      nodeCalls.push({ id, lifecycleKey })
      return { id, parent_id: null, name: String(id), type: 'dir' }
    } },
    beginNavigationIntent: () => ++generation,
    isNavigationIntentCurrent: id => generation === id,
    navigateTo: async crumbs => { navigations.push(crumbs.at(-1).id); return true },
    onError: error => { throw error },
  })

  // Parent=1 won Back, but App has not mirrored old acknowledged child URL=2.
  assert.equal(execute(2, 1, 'files:account-a')(), undefined)
  await flushAsync()
  assert.deepEqual(nodeCalls, [], 'stale child must not be re-read')
  assert.deepEqual(navigations, [], 'stale child must not undo Back')

  const external = execute(3, 1, 'files:account-a')()
  await flushAsync()
  assert.deepEqual(nodeCalls, [{ id: 3, lifecycleKey: 'files:account-a' }])
  assert.deepEqual(navigations, [3])
  external?.()

  const nextAccount = execute(2, 1, 'files:account-b')()
  await flushAsync()
  assert.deepEqual(nodeCalls, [
    { id: 3, lifecycleKey: 'files:account-a' },
    { id: 2, lifecycleKey: 'files:account-b' },
  ])
  assert.deepEqual(navigations, [3, 2])
  nextAccount?.()
})
