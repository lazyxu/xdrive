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
      node.arguments[0].getText(sourceFile).includes('setCreateOpen(false)') &&
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

  assert.ok(callback, 'missing Desktop FileExplorer account lifecycle effect')
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

test('Desktop FileExplorer account lifecycle closes stale organization dialogs and selections', () => {
  const { filename, callback } = extractLifecycleEffect()
  const writes = {
    tagDialogItems: [],
    saveSearchOpen: [],
    renameSavedSearch: [],
    activeSavedSearchID: [],
    activeTagID: [],
  }

  const effect = compileEffect(filename, callback, {
    actionGenerationRef: { current: 4 },
    actionBusyRef: { current: null },
    setActionBusy: () => {},
    createFolderParentIDRef: { current: null },
    setCreateOpen: () => {},
    setOpenPreviewItem: () => {},
    setTagDialogItems: (value) => writes.tagDialogItems.push(value),
    setSaveSearchOpen: (value) => writes.saveSearchOpen.push(value),
    setRenameSavedSearch: (value) => writes.renameSavedSearch.push(value),
    setActiveSavedSearchID: (value) => writes.activeSavedSearchID.push(value),
    setActiveTagID: (value) => writes.activeTagID.push(value),
  })

  const cleanup = effect()

  assert.deepEqual(
    writes.tagDialogItems,
    [[]],
    'account B must not inherit account-A node ids from an open tag dialog',
  )
  assert.deepEqual(
    writes.saveSearchOpen,
    [false],
    'account-A save-smart-folder dialog must close before account B becomes current',
  )
  assert.deepEqual(
    writes.renameSavedSearch,
    [null],
    'account-A saved-search rename target must not survive into account B',
  )
  assert.deepEqual(
    writes.activeSavedSearchID,
    [null],
    'account-A saved-search selection must not select an unrelated same-id search in account B',
  )
  assert.deepEqual(
    writes.activeTagID,
    [null],
    'account-A tag selection must not select an unrelated same-id tag in account B',
  )

  if (typeof cleanup === 'function') cleanup()
})
