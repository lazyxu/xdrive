const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractTransferLifecycleEffect() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'App.tsx')
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
      node.arguments[0].getText(sourceFile).includes('getTransfers()') &&
      node.arguments[0].getText(sourceFile).includes("setTransfers({ revision: 0, transfers: [] })")
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

  assert.ok(
    callback,
    'Desktop transfer projection must own an account-lifecycle effect that clears stale transfers and reloads the current account snapshot',
  )
  assert.ok(dependencies, 'transfer lifecycle effect must have a dependency array')
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
}

test('Desktop transfer projection resets and reloads across account lifecycle', async () => {
  const { filename, callback, dependencies } = extractTransferLifecycleEffect()

  assert.ok(dependencies.includes('status?.server'))
  assert.ok(dependencies.includes('status?.username'))

  let current = {
    revision: 9,
    transfers: [{ id: 'account-a-transfer', root_id: 'account-a-transfer' }],
  }
  const writes = []
  const transfersRevisionRef = { current: 9 }
  const setTransfers = (value) => {
    current = typeof value === 'function' ? value(current) : value
    writes.push(current)
  }
  const pendingB = deferred()
  let snapshotCalls = 0
  const window = {
    xdriveDesktop: {
      agent: {
        getTransfers: () => {
          snapshotCalls += 1
          return pendingB.promise
        },
      },
    },
  }
  const acceptTransferSnapshot = (value) => {
    if (value.revision < transfersRevisionRef.current) return false
    transfersRevisionRef.current = value.revision
    setTransfers(value)
    return true
  }

  const effect = compileEffect(filename, callback, {
    status: { server: 'server-b', username: 'user-b' },
    transfersRevisionRef,
    setTransfers,
    window,
    acceptTransferSnapshot,
  })

  const cleanup = effect()

  assert.equal(transfersRevisionRef.current, 0)
  assert.deepEqual(current, { revision: 0, transfers: [] })
  assert.equal(snapshotCalls, 1)

  pendingB.resolve({
    revision: 1,
    transfers: [{ id: 'account-b-transfer', root_id: 'account-b-transfer' }],
  })
  await flushAsync()

  assert.equal(current.revision, 1)
  assert.equal(current.transfers[0]?.id, 'account-b-transfer')

  if (typeof cleanup === 'function') cleanup()
})
