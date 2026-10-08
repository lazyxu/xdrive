const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractSourceOptionsEffect() {
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
  let dependencies = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('api.sources()')
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

  assert.ok(callback, 'missing Web FileExplorer source-options effect')
  assert.ok(dependencies, 'Web source-options effect must have a dependency array')
  return { filename, callback, dependencies }
}

function compileEffect(filename, callback, injected) {
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

  const names = Object.keys(injected)
  const values = names.map((name) => injected[name])
  return new Function(...names, output + '\nreturn effect')(...values)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('Web FileExplorer source options cannot publish an old account response after account switch', async () => {
  const { filename, callback, dependencies } = extractSourceOptionsEffect()
  const pendingA = deferred()
  const pendingB = deferred()
  let account = 'A'
  const writes = []
  const errors = []

  const api = {
    sources: () => account === 'A' ? pendingA.promise : pendingB.promise,
  }
  const effect = compileEffect(filename, callback, {
    api,
    onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    setSearchSourceOptions: (items) => writes.push(items.map((item) => item.name)),
  })

  const cleanupA = effect()

  account = 'B'
  let cleanupB
  if (dependencies.includes('navigationSessionStorageKey')) {
    if (typeof cleanupA === 'function') cleanupA()
    cleanupB = effect()
  }

  pendingB.resolve([{ id: 2, name: 'B source' }])
  await flushAsync()

  pendingA.resolve([{ id: 1, name: 'A source' }])
  await flushAsync()

  if (typeof cleanupB === 'function') cleanupB()

  const nonEmptyWrites = writes.filter((items) => items.length > 0)
  assert.deepEqual(
    nonEmptyWrites,
    [['B source']],
    'account B must be the only account that publishes non-empty source filters after the switch',
  )
  assert.equal(
    writes.some((items) => items.includes('A source')),
    false,
    'a late account-A source response must never overwrite account-B source filters',
  )
  assert.deepEqual(errors, [])
})
