const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function gallerySourceFile() {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    sourceFile: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function extractRunSelectionAction() {
  const { filename, sourceFile } = gallerySourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'runSelectionAction' &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'missing Gallery runSelectionAction')
  return { filename, expression: initializer }
}

function extractSelectionScopeResetEffect() {
  const { filename, sourceFile } = gallerySourceFile()
  let callback = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2
    ) {
      const callbackText = node.arguments[0].getText(sourceFile)
      const dependencies = node.arguments[1].getText(sourceFile)
      if (
        callbackText.includes('clearMediaSelection()') &&
        callbackText.includes('setCollageDialogItems(null)') &&
        dependencies.includes('collectionKey')
      ) {
        callback = callbackText
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(callback, 'missing Gallery selection scope-reset effect')
  return { filename, expression: callback }
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

test('Gallery collection scope change fences stale selection actions', async () => {
  const runSource = extractRunSelectionAction()
  const resetSource = extractSelectionScopeResetEffect()

  const selectionBusyRef = { current: false }
  const selectionActionGenerationRef = { current: 0 }
  const busyWrites = []
  const clearWrites = []
  const pendingA = deferred()
  const pendingB = deferred()
  let callsA = 0
  let callsB = 0

  const runA = compileExpression(
    runSource.filename,
    'runSelectionAction',
    runSource.expression,
    {
      useCallback: (callback) => callback,
      selectedMedia: [{ node: { id: 1, name: 'A.jpg' } }],
      selectionBusyRef,
      selectionActionGenerationRef,
      setSelectionBusy: (value) => busyWrites.push(['A', value]),
      clearMediaSelection: () => clearWrites.push('A'),
    },
  )

  const promiseA = runA(async () => {
    callsA += 1
    await pendingA.promise
  })
  await flushAsync()

  assert.equal(callsA, 1)
  assert.equal(selectionBusyRef.current, true)
  assert.equal(selectionActionGenerationRef.current, 0)

  const resetScope = compileExpression(
    resetSource.filename,
    'resetSelectionScope',
    resetSource.expression,
    {
      selectionActionGenerationRef,
      selectionBusyRef,
      setSelectionBusy: (value) => busyWrites.push(['scope', value]),
      clearMediaSelection: () => clearWrites.push('scope-change'),
      setCollageDialogItems: () => {},
      setMovieDialogItems: () => {},
      setMediaContextMenu: (value) => {
        assert.equal(value, null, 'collection switch must close a stale right-click menu')
      },
      section: 'library',
      setSelected: () => {},
      setPreviewItem: () => {},
      setPreviewLogicalIndex: () => {},
      setPendingPreviewIndex: () => {},
    },
  )
  resetScope()

  assert.equal(selectionActionGenerationRef.current, 1)
  assert.equal(
    selectionBusyRef.current,
    false,
    'scope change must release ownership held by the previous collection action',
  )

  const runB = compileExpression(
    runSource.filename,
    'runSelectionAction',
    runSource.expression,
    {
      useCallback: (callback) => callback,
      selectedMedia: [{ node: { id: 2, name: 'B.jpg' } }],
      selectionBusyRef,
      selectionActionGenerationRef,
      setSelectionBusy: (value) => busyWrites.push(['B', value]),
      clearMediaSelection: () => clearWrites.push('B'),
    },
  )

  const promiseB = runB(async () => {
    callsB += 1
    await pendingB.promise
  })
  await flushAsync()

  assert.equal(callsB, 1)
  assert.equal(selectionBusyRef.current, true)

  const clearMarker = clearWrites.length
  const busyMarker = busyWrites.length
  pendingA.resolve()
  await promiseA
  await flushAsync()

  assert.deepEqual(
    clearWrites.slice(clearMarker),
    [],
    'the previous collection action must not clear selection after the new collection becomes current',
  )
  assert.deepEqual(
    busyWrites.slice(busyMarker),
    [],
    'the previous collection action must not release busy ownership held by the new collection',
  )
  assert.equal(
    selectionBusyRef.current,
    true,
    'the new collection action must remain busy after the stale action finishes',
  )

  pendingB.resolve()
  await promiseB
  await flushAsync()

  assert.deepEqual(clearWrites.slice(clearMarker), ['B'])
  assert.equal(selectionBusyRef.current, false)
  assert.deepEqual(busyWrites.slice(-1), [['B', false]])
})
