const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractLifecycleEffect(kind = 'owner') {
  const filename = kind === 'owner'
    ? path.join(repo, 'ui/shared/src/mui/FileExplorerOwnerActionLifecycle.ts')
    : path.join(repo, 'desktop/src/renderer/DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = null
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' && node.arguments.length >= 2 &&
      ts.isArrayLiteralExpression(node.arguments[1])) {
      const body = node.arguments[0].getText(sourceFile)
      const deps = node.arguments[1].elements.map(x => x.getText(sourceFile))
      const matches = kind === 'owner'
        ? body.includes('actionGenerationRef.current += 1') &&
          body.includes('actionBusyRef.current = null') && deps.includes('scopeKey')
        : body.includes('createFolderParentIDRef.current = null') &&
          body.includes('setCreateOpen(false)') && deps.includes('navigationSessionStorageKey')
      if (matches) { callback = body; return }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(callback, 'missing actual ' + kind + ' FileExplorer lifecycle effect')
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
  const { filename, callback } = extractLifecycleEffect('owner')
  const dialogEffectSource = extractLifecycleEffect('dialogs')
  const actionGenerationRef = { current: 7 }
  const actionBusyRef = { current: { key: 'create-folder', generation: 7 } }
  const actionBusyWrites = []
  const createOpenWrites = []

  const dependencies = {
    actionGenerationRef,
    actionBusyRef,
    createFolderParentIDRef: { current: 101 },
    uploadPickerParentIDRef: { current: 102 },
    folderUploadPickerParentIDRef: { current: 103 },
    setActionBusy: (value) => actionBusyWrites.push(value),
    setCreateOpen: (value) => createOpenWrites.push(value),
    setTagDialogItems: () => {},
    setTagDialogMode: () => {},
    setSaveSearchOpen: () => {},
    setRenameSavedSearch: () => {},
  }
  const effect = compileEffect(filename, callback, dependencies)
  const dialogEffect = compileEffect(dialogEffectSource.filename, dialogEffectSource.callback, dependencies)

  const cleanup = effect()
  const cleanupDialog = dialogEffect()

  assert.equal(actionGenerationRef.current, 8)
  assert.equal(actionBusyRef.current, null)
  assert.deepEqual(actionBusyWrites, [''])

  assert.deepEqual(
    createOpenWrites,
    [false],
    'a create-folder dialog opened in account A must close before account B becomes current',
  )
  if (typeof cleanup === 'function') cleanup()
  if (typeof cleanupDialog === 'function') cleanupDialog()
})
