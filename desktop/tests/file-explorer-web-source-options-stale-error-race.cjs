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
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('api.sources()')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Web FileExplorer source-options effect')
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
}

test('Web FileExplorer source-options error cannot escape a disposed effect lifecycle', async () => {
  const { filename, callback } = extractSourceOptionsEffect()
  const pending = deferred()
  const errors = []
  const writes = []

  const effect = compileEffect(filename, callback, {
    api: {
      sources: () => pending.promise,
    },
    onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    setSearchSourceOptions: (value) => writes.push(value),
  })

  const cleanup = effect()
  assert.equal(typeof cleanup, 'function')
  cleanup()

  pending.reject(new Error('stale account source failure'))
  await flushAsync()

  assert.deepEqual(
    errors,
    [],
    'an old source-options request must not publish an error after its FileExplorer effect was disposed',
  )
  assert.deepEqual(writes, [])
})
