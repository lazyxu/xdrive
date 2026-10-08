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

test('Desktop FileExplorer account lifecycle closes stale organization dialogs and active identities', () => {
  const { filename, callback } = extractLifecycleEffect()

  const tagDialogWrites = []
  const saveSearchWrites = []
  const renameSearchWrites = []
  const activeSavedSearchWrites = []
  const activeTagWrites = []

  const effect = compileEffect(filename, callback, {
    actionGenerationRef: { current: 3 },
    actionBusyRef: { current: { key: 'x', generation: 3 } },
    setActionBusy: () => {},
    setCreateOpen: () => {},
    setOpenPreviewItem: () => {},
    setTagDialogItems: (value) => tagDialogWrites.push(value),
    setSaveSearchOpen: (value) => saveSearchWrites.push(value),
    setRenameSavedSearch: (value) => renameSearchWrites.push(value),
    setActiveSavedSearchID: (value) => activeSavedSearchWrites.push(value),
    setActiveTagID: (value) => activeTagWrites.push(value),
  })

  const cleanup = effect()

  assert.deepEqual(
    tagDialogWrites,
    [[]],
    'account lifecycle change must close a tag dialog that owns account-A node ids',
  )
  assert.deepEqual(
    saveSearchWrites,
    [false],
    'account lifecycle change must close account-A saved-search creation UI',
  )
  assert.deepEqual(
    renameSearchWrites,
    [null],
    'account lifecycle change must close account-A saved-search rename UI',
  )
  assert.deepEqual(
    activeSavedSearchWrites,
    [null],
    'account lifecycle change must clear account-A active saved-search identity',
  )
  assert.deepEqual(
    activeTagWrites,
    [null],
    'account lifecycle change must clear account-A active tag identity',
  )

  if (typeof cleanup === 'function') cleanup()
})
