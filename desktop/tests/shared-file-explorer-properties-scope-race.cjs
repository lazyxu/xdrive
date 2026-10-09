const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractInteractionScopeEffect() {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  let selectionLoadCallback = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === 'updateSelectionLoad' &&
      node.initializer
    ) {
      selectionLoadCallback = node.initializer.getText(sourceFile)
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('interactionScopeKeyRef.current') &&
      node.arguments[0].getText(sourceFile).includes('selectionItemCacheRef.current.clear()')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing FileExplorer interaction-scope effect')
  assert.ok(selectionLoadCallback, 'missing FileExplorer selection-load state updater')
  return { filename, callback, selectionLoadCallback }
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

test('FileExplorer interaction scope change clears stale Properties session and media cache', () => {
  const { filename, callback, selectionLoadCallback } = extractInteractionScopeEffect()

  const propertiesWrites = []
  const quickLookSessionWrites = []
  const touchDragReleaseWrites = []
  const touchDragActiveWrites = []
  const mediaDetailsCacheRef = {
    current: new Map([
      ['1:7', { id: 1, revision: 7, width: 111, height: 222 }],
    ]),
  }
  const propertiesMediaDetailsRequestRef = { current: 4 }
  const mediaDetailsRequestRef = { current: 8 }
  const mediaDetailsRevisionWrites = []
  let selectionLoad = { intent: 3, scope: 'account-a:/same', loaded: 200, total: 1024 }
  let selectionLoadFeedback = 'previous scope selection feedback'
  const selectionLoadRef = { current: selectionLoad }

  const dependencies = {
    interactionScopeKeyRef: { current: 'account-a:/same' },
    interactionScopeKey: 'account-b:/same',
    setEditingPath: () => {},
    setPathDraft: () => {},
    derivedPath: '/same',
    window: { cancelAnimationFrame: () => {} },
    marqueeFrameRef: { current: null },
    marqueePointerRef: { current: null },
    marqueeSessionRef: { current: null },
    setMarqueeRect: () => {},
    suppressBackgroundClickRef: { current: false },
    dragPointerYRef: { current: null },
    dragAutoScrollFrameRef: { current: null },
    touchDragRef: { current: {
      pointerId: 2,
      captureHost: {
        hasPointerCapture: (value) => value === 2,
        releasePointerCapture: (value) => touchDragReleaseWrites.push(value),
      },
    } },
    setTouchDragActive: (value) => touchDragActiveWrites.push(value),
    setDraggedItems: () => {},
    setDropTargetID: () => {},
    setDropTargetCrumbID: () => {},
    setContextMenu: () => {},
    renameCancelledRef: { current: false },
    renameSubmitGenerationRef: { current: 2 },
    renameSubmittingRef: { current: true },
    setRenameSubmitting: () => {},
    setRenamingID: () => {},
    setRenameDraft: () => {},
    setRenameError: () => {},
    typeSelectRef: { current: { query: 'x', updatedAt: 1 } },
    typeSelectIntentRef: { current: 2 },
    selectionIntentRef: { current: 3 },
    updateSelectionLoad: compileEffect(filename, selectionLoadCallback, {
      selectionLoadRef,
      setSelectionLoad: (value) => { selectionLoad = value },
    }),
    setSelectionLoadFeedback: (value) => { selectionLoadFeedback = value },
    quickLookIntentRef: { current: 4 },
    selectionItemCacheRef: { current: new Map([[1, { id: 1 }]]) },
    setSelectionAnchorID: () => {},
    setSelectionAnchorIndex: () => {},
    setActiveItemID: () => {},
    setActiveLogicalIndex: () => {},
    setQuickLookItemID: () => {},
    setQuickLookLogicalIndex: () => {},
    setQuickLookSessionIDs: (value) => quickLookSessionWrites.push(value),
    controlledSelectedIDs: undefined,
    setInternalSelectedIDs: () => {},
    onSelectionChange: () => {},
    setPropertiesItems: (value) => propertiesWrites.push(value),
    propertiesMediaDetailsRequestRef,
    mediaDetailsRequestRef,
    mediaDetailsCacheRef,
    setMediaDetailsRevision: (update) => {
      mediaDetailsRevisionWrites.push(typeof update === 'function' ? update(10) : update)
    },
  }

  const effect = compileEffect(filename, callback, dependencies)
  effect()

  assert.deepEqual(touchDragReleaseWrites, [2], 'scope change releases a captured touch pointer')
  assert.deepEqual(touchDragActiveWrites, [false], 'scope change removes the touch drag overlay')
  assert.equal(dependencies.touchDragRef.current, null, 'scope change invalidates pending touch drops')
  assert.equal(selectionLoad, null, 'scope change must clear the old selection-load state')
  assert.equal(selectionLoadRef.current, null, 'scope change must release the old selection-load owner')
  assert.equal(selectionLoadFeedback, '', 'scope change must clear selection feedback from the previous scope')

  assert.deepEqual(
    propertiesWrites,
    [[]],
    'scope change must close an old Properties dialog before the new workspace can reuse item ids',
  )
  assert.deepEqual(
    quickLookSessionWrites,
    [null],
    'scope change must discard a frozen Quick Look multi-selection session',
  )
  assert.equal(
    propertiesMediaDetailsRequestRef.current,
    5,
    'scope change must invalidate in-flight Properties media-detail work',
  )
  assert.equal(
    mediaDetailsRequestRef.current,
    9,
    'scope change must invalidate in-flight Details/Inspector media-detail work',
  )
  assert.equal(
    mediaDetailsCacheRef.current.size,
    0,
    'account/directory scope change must not reuse media details cached by id+revision from the previous scope',
  )
  assert.deepEqual(
    mediaDetailsRevisionWrites,
    [11],
    'clearing the media-detail cache must publish a render revision for the new scope',
  )
})


test('FileExplorer media-details loaders are keyed by interaction scope even when refs are identical', () => {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  const dependencyLists = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      (
        node.arguments[0].getText(sourceFile).includes('mediaDetailsRequestRef.current') ||
        node.arguments[0].getText(sourceFile).includes('propertiesMediaDetailsRequestRef.current')
      ) &&
      node.arguments[0].getText(sourceFile).includes('new AbortController()') &&
      ts.isArrayLiteralExpression(node.arguments[1])
    ) {
      dependencyLists.push(
        node.arguments[1].elements.map((element) => element.getText(sourceFile)),
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.equal(dependencyLists.length, 2)
  for (const dependencies of dependencyLists) {
    assert.ok(
      dependencies.includes('interactionScopeKey'),
      'media-details async work must restart when FileExplorer interaction scope changes even if id+revision refs are unchanged',
    )
  }
})
