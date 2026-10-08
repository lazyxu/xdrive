const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractSourcesEffect() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callbackText = null
  let dependencyTexts = null

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('agent.getSources()')
    ) {
      callbackText = node.arguments[0].getText(sourceFile)
      const deps = node.arguments[1]
      dependencyTexts = ts.isArrayLiteralExpression(deps)
        ? deps.elements.map((element) => element.getText(sourceFile))
        : null
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callbackText, 'missing Desktop FileExplorer source-options effect')
  assert.ok(dependencyTexts, 'source-options effect must have a dependency array')
  return { filename, callbackText, dependencyTexts }
}

function compileEffect(filename, callbackText, dependencies) {
  const output = ts.transpileModule(
    'const effect = ' + callbackText + ';',
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

test('Desktop FileExplorer source options reject an old account response after account switch', async () => {
  const { filename, callbackText, dependencyTexts } = extractSourcesEffect()

  const pendingA = deferred()
  const pendingB = deferred()
  let account = 'A'
  const writes = []

  const window = {
    xdriveDesktop: {
      agent: {
        getSources: () => account === 'A' ? pendingA.promise : pendingB.promise,
      },
    },
  }
  const setSearchSourceOptions = (next) => {
    writes.push(next.map((item) => item.name))
  }

  const effect = compileEffect(filename, callbackText, {
    window,
    setSearchSourceOptions,
  })

  const cleanupA = effect()

  account = 'B'
  let cleanupB
  if (dependencyTexts.includes('navigationSessionStorageKey')) {
    if (typeof cleanupA === 'function') cleanupA()
    cleanupB = effect()
  }

  pendingB.resolve({
    ok: true,
    data: [{ id: 2, name: 'B source' }],
  })
  await flushAsync()

  pendingA.resolve({
    ok: true,
    data: [{ id: 1, name: 'A source' }],
  })
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
    'a late account-A response must never overwrite account-B source filters',
  )
})
