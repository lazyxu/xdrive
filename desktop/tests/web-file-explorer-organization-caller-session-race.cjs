const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sourceFile() {
  const filename = path.join(repo, 'web', 'src', 'WebFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    file: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function extractJsxAttributeHandler(attributeName) {
  const { filename, file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === attributeName &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      initializer = node.initializer.expression.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing Web FileExplorer JSX handler: ' + attributeName)
  return { filename, initializer }
}

function extractSavedSearchSubmit(rename) {
  const { filename, file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(file) === 'XDriveFileNameDialog'
    ) {
      const attrs = node.attributes.properties
      const mode = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(file) === 'mode'
      ))
      const initialValue = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(file) === 'initialValue'
      ))
      const onSubmit = attrs.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(file) === 'onSubmit'
      ))
      if (
        mode?.initializer?.getText(file) === '"saved-search"' &&
        Boolean(initialValue) === rename &&
        onSubmit &&
        ts.isJsxExpression(onSubmit.initializer) &&
        onSubmit.initializer.expression
      ) {
        initializer = onSubmit.initializer.expression.getText(file)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing Web FileExplorer saved-search submit handler')
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

test('Web FileExplorer saved-search create completion cannot cross account lifecycle', async () => {
  const { filename, initializer } = extractSavedSearchSubmit(false)
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeIDs = []
  const feedback = []

  const handler = compileExpression(filename, 'handler', initializer, {
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
  })

  const mutation = handler('A smart folder')
  await flushAsync()
  organizationLifecycleKeyRef.current = 'server-b:user-b'
  pending.resolve({ id: 51, name: 'A smart folder' })
  await mutation

  assert.deepEqual(
    activeIDs,
    [],
    'account-A saved-search completion must not activate an A id in account B',
  )
  assert.deepEqual(
    feedback,
    [],
    'account-A saved-search completion must not publish feedback into account B',
  )
})

test('Web FileExplorer saved-search replace completion cannot cross account lifecycle', async () => {
  const { filename, initializer } = extractJsxAttributeHandler('onReplaceSavedSearch')
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeIDs = []
  const feedback = []

  const handler = compileExpression(filename, 'handler', initializer, {
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
  })

  handler({ id: 52, name: 'A smart folder' })
  await flushAsync()
  organizationLifecycleKeyRef.current = 'server-b:user-b'
  pending.resolve(undefined)
  await flushAsync()

  assert.deepEqual(
    activeIDs,
    [],
    'account-A saved-search replacement must not activate an A id in account B',
  )
  assert.deepEqual(
    feedback,
    [],
    'account-A saved-search replacement must not publish feedback into account B',
  )
})

test('Web FileExplorer saved-search rename completion cannot cross account lifecycle', async () => {
  const { filename, initializer } = extractSavedSearchSubmit(true)
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const feedback = []

  const handler = compileExpression(filename, 'handler', initializer, {
    renameSavedSearch: {
      id: 53,
      name: 'Before',
      query: 'kind:image',
      filters: { tagID: 5 },
    },
    organization: {
      updateSavedSearch: async () => pending.promise,
    },
    organizationLifecycleKeyRef,
    onFeedback: (tone, message) => feedback.push({ tone, message }),
  })

  const mutation = handler('After')
  await flushAsync()
  organizationLifecycleKeyRef.current = 'server-b:user-b'
  pending.resolve(undefined)
  await mutation

  assert.deepEqual(
    feedback,
    [],
    'account-A saved-search rename must not publish feedback into account B',
  )
})

test('Web FileExplorer tag completion cannot reapply a stale search intent', async () => {
  const { filename, initializer } = extractJsxAttributeHandler('onSetTag')
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const applied = []

  const handler = compileExpression(filename, 'handler', initializer, {
    organization: {
      setTagNodes: async () => pending.promise,
    },
    organizationLifecycleKeyRef,
    organizationSearchScopeKeyRef,
    searchFilters: { tagID: 5 },
    searchState: { query: 'kind:image' },
    applySearch: async (query, filters) => applied.push({ query, filters }),
  })

  const mutation = handler(5, [101], true)
  await flushAsync()
  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve(undefined)
  await mutation

  assert.deepEqual(
    applied,
    [],
    'tag completion from search A must not reapply search A after moving to search B',
  )
})

test('Web FileExplorer delete-tag completion cannot clear a newer search intent', async () => {
  const { filename, initializer } = extractJsxAttributeHandler('onDeleteTag')
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeTags = []
  const clears = []

  const handler = compileExpression(filename, 'handler', initializer, {
    organization: {
      deleteTag: async () => pending.promise,
    },
    organizationLifecycleKeyRef,
    organizationSearchScopeKeyRef,
    searchFilters: { tagID: 5 },
    setActiveTagID: (value) => activeTags.push(value),
    clearSearch: () => clears.push(true),
  })

  const mutation = handler(5)
  await flushAsync()
  organizationSearchScopeKeyRef.current = 'scope-b'
  pending.resolve(undefined)
  await mutation

  assert.deepEqual(activeTags, [])
  assert.deepEqual(
    clears,
    [],
    'delete-tag completion from search A must not clear the newer search B',
  )
})
