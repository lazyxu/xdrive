const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractSetTagHandler() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
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
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === 'onSetTag' &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      initializer = node.initializer.expression.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing FileExplorer tag mutation handler')
  return { filename, initializer }
}


function extractJsxAttributeHandler(attributeName, predicate = () => true) {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
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
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === attributeName &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      predicate(node, sourceFile)
    ) {
      initializer = node.initializer.expression.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing JSX handler: ' + attributeName)
  return { filename, initializer }
}

function extractDeleteTagHandler() {
  return extractJsxAttributeHandler('onDeleteTag')
}

function extractReplaceSavedSearchHandler() {
  return extractJsxAttributeHandler('onReplaceSavedSearch')
}

function extractCreateSavedSearchSubmit() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
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
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === 'XDriveFileNameDialog'
    ) {
      const attrs = node.attributes.properties
      const mode = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'mode'
      ))
      const initialValue = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'initialValue'
      ))
      const onSubmit = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'onSubmit'
      ))
      if (
        mode?.initializer?.getText(sourceFile) === '"saved-search"' &&
        !initialValue &&
        onSubmit &&
        ts.isJsxExpression(onSubmit.initializer) &&
        onSubmit.initializer.expression
      ) {
        initializer = onSubmit.initializer.expression.getText(sourceFile)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing create saved-search submit')
  return { filename, initializer }
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

test('Desktop FileExplorer tag completion cannot reapply a stale search intent', async () => {
  const { filename, initializer } = extractSetTagHandler()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const applied = []

  const handler = compileExpression(
    filename,
    'handler',
    initializer,
    {
      organization: {
        setTagNodes: async () => pending.promise,
      },
      organizationLifecycleKeyRef,
      organizationSearchScopeKeyRef,
      searchFilters: { tagID: 5, type: '', sourceID: null, modified: '', size: '', availability: null },
      searchState: { query: 'kind:image' },
      applySearch: async (query, filters) => {
        applied.push({ query, filters })
      },
    },
  )

  const mutation = handler(5, [101], true)
  await flushAsync()

  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve(undefined)
  await mutation

  assert.deepEqual(
    applied,
    [],
    'a tag mutation completion from search A must not reapply search A after the user has moved to search B',
  )
})


test('Desktop FileExplorer delete-tag completion cannot clear a newer search intent', async () => {
  const { filename, initializer } = extractDeleteTagHandler()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const cleared = []
  const activeTags = []

  const handler = compileExpression(
    filename,
    'handler',
    initializer,
    {
      organization: {
        deleteTag: async () => pending.promise,
      },
      organizationLifecycleKeyRef,
      organizationSearchScopeKeyRef,
      searchFilters: { tagID: 5 },
      setActiveTagID: (value) => activeTags.push(value),
      clearSearch: () => cleared.push(true),
    },
  )

  const mutation = handler(5)
  await flushAsync()
  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve(undefined)
  await mutation

  assert.deepEqual(activeTags, [])
  assert.deepEqual(
    cleared,
    [],
    'a delete-tag completion from search A must not clear the newer search B',
  )
})

test('Desktop FileExplorer create-saved-search completion does not activate stale search context', async () => {
  const { filename, initializer } = extractCreateSavedSearchSubmit()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeIDs = []
  const feedback = []

  const handler = compileExpression(
    filename,
    'handler',
    initializer,
    {
      organization: {
        createSavedSearch: async () => pending.promise,
      },
      organizationLifecycleKeyRef,
      organizationSearchScopeKeyRef,
      searchState: { query: 'kind:image' },
      persistedSearchFilters: { tagID: 5 },
      searchFilters: { availability: null },
      setActiveSavedSearchID: (id) => activeIDs.push(id),
      onFeedback: (tone, message) => feedback.push({ tone, message }),
    },
  )

  const mutation = handler('A smart folder')
  await flushAsync()
  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve({ id: 51, name: 'A smart folder' })
  await mutation

  assert.deepEqual(
    activeIDs,
    [],
    'a saved-search created from search A must not be marked active after the user moved to search B',
  )
  assert.equal(feedback.length, 1, 'the successful save itself should still report completion')
})

test('Desktop FileExplorer replace-saved-search completion does not activate stale search context', async () => {
  const { filename, initializer } = extractReplaceSavedSearchHandler()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeIDs = []
  const feedback = []

  const handler = compileExpression(
    filename,
    'handler',
    initializer,
    {
      canSaveSmartFolder: true,
      organization: {
        updateSavedSearch: async () => pending.promise,
      },
      organizationLifecycleKeyRef,
      organizationSearchScopeKeyRef,
      searchState: { query: 'kind:image' },
      persistedSearchFilters: { tagID: 5 },
      setActiveSavedSearchID: (id) => activeIDs.push(id),
      onFeedback: (tone, message) => feedback.push({ tone, message }),
    },
  )

  handler({ id: 52, name: 'A smart folder' })
  await flushAsync()
  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve(undefined)
  await flushAsync()

  assert.deepEqual(
    activeIDs,
    [],
    'a saved-search replaced from search A must not be marked active after the user moved to search B',
  )
  assert.equal(feedback.length, 1, 'the successful replacement itself should still report completion')
})
