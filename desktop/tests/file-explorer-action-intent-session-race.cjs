const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractActionIntentEffect() {
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
      node.arguments[0].getText(sourceFile).includes("actionIntent.action === 'upload-files'")
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

  assert.ok(callback, 'missing Desktop FileExplorer action-intent effect')
  assert.ok(dependencies, 'action-intent effect must have a dependency array')
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

test('Desktop FileExplorer pending action intent cannot cross account lifecycle', () => {
  const { filename, callback } = extractActionIntentEffect()
  const actionIntent = {
    id: 41,
    action: 'create-folder',
    lifecycleKey: 'server-a:user-a',
  }
  const actionIntentRef = { current: 0 }
  const consumed = []
  const createOpen = []
  let uploadCalls = 0
  const folderUploadInputRef = { current: { click: () => { throw new Error('unexpected folder upload') } } }

  const common = {
    actionIntent,
    actionIntentRef,
    trashActive: false,
    explorerActionBusy: false,
    uploadConflictSupported: true,
    onActionIntentConsumed: (id) => consumed.push(id),
    onError: (message) => { throw new Error(message) },
    uploadFiles: async () => { uploadCalls += 1 },
    folderUploadInputRef,
    setCreateOpen: (value) => createOpen.push(value),
  }

  const accountAEffect = compileEffect(filename, callback, {
    ...common,
    current: null,
    navigationSessionStorageKey: 'server-a:user-a',
  })
  accountAEffect()

  assert.deepEqual(consumed, [])
  assert.deepEqual(createOpen, [])
  assert.equal(actionIntentRef.current, 0)

  const accountBEffect = compileEffect(filename, callback, {
    ...common,
    current: { id: 9 },
    navigationSessionStorageKey: 'server-b:user-b',
  })
  accountBEffect()

  assert.equal(
    uploadCalls,
    0,
    'a delayed account-A action must not execute upload work in account B',
  )
  assert.deepEqual(
    createOpen,
    [],
    'a delayed account-A create-folder intent must not open the dialog in account B',
  )
  assert.deepEqual(
    consumed,
    [41],
    'a stale action intent must be consumed when its owning lifecycle is no longer current',
  )
})
