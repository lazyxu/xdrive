const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractLifecycleEffect() {
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
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('actionGenerationRef.current += 1') &&
      node.arguments[0].getText(sourceFile).includes('actionBusyRef.current = null') &&
      ts.isArrayLiteralExpression(node.arguments[1]) &&
      node.arguments[1].elements.some((element) => (
        ts.isIdentifier(element) &&
        element.text === 'navigationSessionStorageKey'
      ))
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop FileExplorer lifecycle effect')
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

test('Desktop FileExplorer account lifecycle change closes stale local dialogs', () => {
  const { filename, callback } = extractLifecycleEffect()
  const actionGenerationRef = { current: 7 }
  const actionBusyRef = { current: { key: 'create-folder', generation: 7 } }
  const actionBusyWrites = []
  const createOpenWrites = []
  const previewWrites = []

  const effect = compileEffect(filename, callback, {
    actionGenerationRef,
    actionBusyRef,
    createFolderParentIDRef: { current: 101 },
    uploadPickerParentIDRef: { current: 102 },
    folderUploadPickerParentIDRef: { current: 103 },
    setActionBusy: (value) => actionBusyWrites.push(value),
    setCreateOpen: (value) => createOpenWrites.push(value),
    setOpenPreviewItem: (value) => previewWrites.push(value),
  })

  const cleanup = effect()

  assert.equal(actionGenerationRef.current, 8)
  assert.equal(actionBusyRef.current, null)
  assert.deepEqual(actionBusyWrites, [''])

  assert.deepEqual(
    createOpenWrites,
    [false],
    'a create-folder dialog opened in account A must close before account B becomes current',
  )
  assert.deepEqual(
    previewWrites,
    [null],
    'a preview opened for account-A content must close before account B becomes current',
  )

  if (typeof cleanup === 'function') cleanup()
})
