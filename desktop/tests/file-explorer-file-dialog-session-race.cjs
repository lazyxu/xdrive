const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractFileDialogLifecycleEffect() {
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
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('setCloudHistoryNode(null)') &&
      node.arguments[0].getText(sourceFile).includes('setCloudShareNode(null)')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop file-dialog lifecycle effect')
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

test('Desktop FileExplorer history and share dialogs close when account lifecycle changes', () => {
  const { filename, callback } = extractFileDialogLifecycleEffect()

  const historyWrites = []
  const crumbWrites = []
  const shareWrites = []
  const cloudFileDialogLifecycleRef = {
    current: 'server-a\nuser-a',
  }

  const effect = compileEffect(filename, callback, {
    agent: { connected: true },
    configured: true,
    settingsOpen: false,
    view: 'files',
    status: {
      server: 'server-b',
      username: 'user-b',
      revision: 22,
    },
    cloudFileDialogLifecycleRef,
    setSettings: () => {},
    setConflicts: () => {},
    setDiagnostics: () => {},
    setCloudHistoryNode: (value) => historyWrites.push(value),
    setCloudHistoryCrumbs: (value) => crumbWrites.push(value),
    setCloudShareNode: (value) => shareWrites.push(value),
    loadSettings: () => {},
    loadConflicts: () => {},
  })

  effect()

  assert.deepEqual(
    historyWrites,
    [null],
    'an account-A version-history target must close before account B can reuse the same node id',
  )
  assert.deepEqual(
    crumbWrites,
    [[]],
    'version-history breadcrumbs must not survive an account lifecycle change',
  )
  assert.deepEqual(
    shareWrites,
    [null],
    'an account-A share target must close before account B becomes current',
  )
  assert.equal(
    cloudFileDialogLifecycleRef.current,
    'server-b\nuser-b',
    'dialog lifecycle ownership must advance to the current Server+username',
  )
})
