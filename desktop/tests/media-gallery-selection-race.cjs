const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractRunSelectionAction() {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
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
  return { filename, initializer }
}

function compileExpression(filename, expression, dependencies) {
  const output = ts.transpileModule(
    'const runSelectionAction = ' + expression + ';',
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
  return new Function(...names, output + '\nreturn runSelectionAction')(...values)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('Gallery selection actions are synchronously single-flight within one render', async () => {
  const source = extractRunSelectionAction()
  const pending = deferred()
  const selectedMedia = [{ node: { id: 1, name: 'A.jpg' } }]
  const busyWrites = []
  const selectionActionGenerationRef = { current: 0 }
  let actionCalls = 0
  let clearCalls = 0

  const runSelectionAction = compileExpression(
    source.filename,
    source.initializer,
    {
      useCallback: (callback) => callback,
      selectedMedia,
      selectionBusyRef: { current: false },
      selectionActionGenerationRef,
      setSelectionBusy: (value) => busyWrites.push(value),
      clearMediaSelection: () => { clearCalls += 1 },
    },
  )

  const action = async () => {
    actionCalls += 1
    await pending.promise
  }

  const first = runSelectionAction(action)
  const second = runSelectionAction(action)
  await flushAsync()

  assert.equal(
    actionCalls,
    1,
    'same-tick Gallery batch actions must not submit twice before React can publish selectionBusy',
  )

  pending.resolve()
  await Promise.all([first, second])

  assert.equal(clearCalls, 1)
  assert.deepEqual(busyWrites, [true, false])
})

test('only a current successful album selection action requests focus after its toolbar is removed', async () => {
  const source = extractRunSelectionAction()
  const gallery = fs.readFileSync(source.filename, 'utf8')
  const sourceFile = ts.createSourceFile(source.filename, gallery, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = null
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'XDriveMediaGallerySelectionToolbar') {
      const attribute = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === 'onAddToAlbum')
      const expression = attribute?.initializer?.expression
      assert.ok(expression && ts.isConditionalExpression(expression), 'expected the real optional album action')
      callback = expression.whenTrue.getText(sourceFile)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(callback, 'missing real Gallery selection album callback')
  const callbackOutput = ts.transpileModule('const callback = ' + callback + ';', {
    fileName: source.filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const makeAlbumCallback = new Function('runSelectionAction', 'onAddItemsToAlbum', callbackOutput + '\nreturn callback')

  for (const outcome of ['success', 'failure', 'superseded']) {
    const pending = deferred()
    const selectionActionGenerationRef = { current: 0 }
    const restoreSelectionFocusRef = { current: false }
    const selectedMedia = [{ node: { id: 1, revision: 7, name: 'A.jpg' } }]
    const album = { id: 'manual-a', revision: 3 }
    let clears = 0
    const runSelectionAction = compileExpression(source.filename, source.initializer, {
      useCallback: (value) => value,
      selectedMedia,
      selectionBusyRef: { current: false },
      selectionActionGenerationRef,
      restoreSelectionFocusRef,
      setSelectionBusy: () => {},
      clearMediaSelection: () => { clears += 1 },
    })
    const onAdd = makeAlbumCallback(runSelectionAction, async (target, items) => {
      assert.equal(target, album)
      assert.equal(items, selectedMedia)
      await pending.promise
      if (outcome === 'failure') throw new Error('album refused')
    })
    const action = onAdd(album)
    assert.equal(restoreSelectionFocusRef.current, false, 'pending submission must not move focus')
    if (outcome === 'superseded') selectionActionGenerationRef.current += 1
    pending.resolve()
    if (outcome === 'failure') await assert.rejects(action, /album refused/)
    else await action
    assert.equal(restoreSelectionFocusRef.current, outcome === 'success', outcome)
    assert.equal(clears, outcome === 'success' ? 1 : 0, outcome)

    if (outcome === 'success') {
      restoreSelectionFocusRef.current = false
      let otherCalls = 0
      await runSelectionAction(async () => { otherCalls += 1 }, false)
      assert.equal(restoreSelectionFocusRef.current, false, 'download does not request selection focus')
      await runSelectionAction(async () => { otherCalls += 1 })
      assert.equal(restoreSelectionFocusRef.current, false, 'other selection clears keep their existing focus behavior')
      assert.equal(otherCalls, 2)
    }
  }
})
