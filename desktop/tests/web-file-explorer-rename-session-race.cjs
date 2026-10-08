const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractRenameItem() {
  const filename = path.join(repo, 'web', 'src', 'WebFileExplorer.tsx')
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
      node.name.text === 'renameItem' &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing Web FileExplorer renameItem')
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
}

function renameHarness() {
  const { filename, initializer } = extractRenameItem()
  const pending = deferred()
  const renameLifecycleKeyRef = { current: 'account-a' }
  const node = { id: 7, parent_id: 10, name: 'before.txt', type: 'file', revision: 3 }
  const nodeByID = new Map([[node.id, node]])
  const clears = []
  const refreshes = []
  const feedback = []
  const errors = []

  const renameItem = compileExpression(filename, 'renameItem', initializer, {
    xDriveFileExplorerNodeForItem: (item, byID) => byID.get(Number(item.id)),
    nodeByID,
    current: { id: 10 },
    api: {
      rename: () => pending.promise,
    },
    clearSearch: () => clears.push(renameLifecycleKeyRef.current),
    refreshCurrentDirectory: async (expectedCurrentID) => {
      refreshes.push({ scope: renameLifecycleKeyRef.current, expectedCurrentID })
    },
    onFeedback: (tone, message) => feedback.push({
      scope: renameLifecycleKeyRef.current,
      tone,
      message,
    }),
    onError: (error) => errors.push({
      scope: renameLifecycleKeyRef.current,
      message: error instanceof Error ? error.message : String(error),
    }),
    renameLifecycleKeyRef,
  })

  return {
    pending,
    renameLifecycleKeyRef,
    renameItem,
    item: { id: node.id, kind: 'file', name: node.name, revision: node.revision },
    clears,
    refreshes,
    feedback,
    errors,
  }
}

test('Web FileExplorer stale rename success cannot clear the newer account search', async () => {
  const harness = renameHarness()
  const work = harness.renameItem(harness.item, 'after.txt')
  await flushAsync()

  harness.renameLifecycleKeyRef.current = 'account-b'
  harness.pending.resolve({ id: 7, name: 'after.txt', type: 'file', revision: 4 })
  await work
  await flushAsync()

  assert.deepEqual(
    harness.clears,
    [],
    'an account-A rename completion must not clear Search after FileExplorer moved to account B',
  )
  assert.deepEqual(
    harness.refreshes,
    [],
    'an account-A rename completion must not refresh account B directory state',
  )
  assert.deepEqual(
    harness.feedback,
    [],
    'an account-A rename completion must not publish success feedback into account B',
  )
  assert.deepEqual(harness.errors, [])
})

test('Web FileExplorer stale rename rejection cannot publish an account-A error into account B', async () => {
  const harness = renameHarness()
  const work = harness.renameItem(harness.item, 'after.txt')
  await flushAsync()

  harness.renameLifecycleKeyRef.current = 'account-b'
  harness.pending.reject(new Error('account A rename failure'))

  let rejection
  try {
    await work
  } catch (error) {
    rejection = error
  }
  await flushAsync()

  assert.equal(
    rejection,
    undefined,
    'a stale account-A rename rejection must terminate silently after the lifecycle changes',
  )
  assert.deepEqual(
    harness.errors,
    [],
    'an account-A rename rejection must not publish an error into account B',
  )
  assert.deepEqual(harness.clears, [])
  assert.deepEqual(harness.refreshes, [])
  assert.deepEqual(harness.feedback, [])
})
