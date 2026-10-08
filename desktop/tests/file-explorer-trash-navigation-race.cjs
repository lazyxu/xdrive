const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractTrashHandler(relativePath) {
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
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === 'onNavigateTrash' &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      initializer = node.initializer.expression.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing FileExplorer onNavigateTrash handler in ' + relativePath.join('/'))
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

function exerciseTrashNavigation(relativePath) {
  const { filename, initializer } = extractTrashHandler(relativePath)
  let navigationGeneration = 0
  let currentDirectoryID = 10
  let trashOpenCount = 0

  const beginNavigationIntent = () => {
    navigationGeneration += 1
    return navigationGeneration
  }
  const isNavigationIntentCurrent = (requestID) => (
    navigationGeneration === requestID
  )
  const onOpenTrash = () => {
    trashOpenCount += 1
  }

  const handler = compileExpression(filename, 'handler', initializer, {
    onOpenTrash,
    beginNavigationIntent,
  })

  const pendingDirectoryIntentID = beginNavigationIntent()
  handler()

  if (isNavigationIntentCurrent(pendingDirectoryIntentID)) {
    currentDirectoryID = 20
  }

  return {
    currentDirectoryID,
    trashOpenCount,
  }
}

test('Web opening Trash invalidates a pending normal-directory navigation', () => {
  const result = exerciseTrashNavigation(['web', 'src', 'WebFileExplorer.tsx'])

  assert.equal(result.trashOpenCount, 1)
  assert.equal(
    result.currentDirectoryID,
    10,
    'opening Trash must make an older pending Web directory navigation stale before it can commit behind Trash',
  )
})

test('Desktop opening Trash invalidates a pending normal-directory navigation', () => {
  const result = exerciseTrashNavigation([
    'desktop',
    'src',
    'renderer',
    'DesktopFileExplorer.tsx',
  ])

  assert.equal(result.trashOpenCount, 1)
  assert.equal(
    result.currentDirectoryID,
    10,
    'opening Trash must make an older pending Desktop directory navigation stale before it can commit behind Trash',
  )
})
