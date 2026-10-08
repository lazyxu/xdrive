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
  const visit = (node) => {
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

test('FileExplorer interaction scope change clears stale Properties session and media cache', () => {
  const { filename, callback } = extractInteractionScopeEffect()

  const propertiesWrites = []
  const mediaDetailsCacheRef = {
    current: new Map([
      ['1:7', { id: 1, revision: 7, width: 111, height: 222 }],
    ]),
  }
  const propertiesMediaDetailsRequestRef = { current: 4 }
  const mediaDetailsRequestRef = { current: 8 }
  const mediaDetailsRevisionWrites = []

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
    quickLookIntentRef: { current: 4 },
    selectionItemCacheRef: { current: new Map([[1, { id: 1 }]]) },
    setSelectionAnchorID: () => {},
    setSelectionAnchorIndex: () => {},
    setActiveItemID: () => {},
    setActiveLogicalIndex: () => {},
    setQuickLookItemID: () => {},
    setQuickLookLogicalIndex: () => {},
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

  assert.deepEqual(
    propertiesWrites,
    [[]],
    'scope change must close an old Properties dialog before the new workspace can reuse item ids',
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
