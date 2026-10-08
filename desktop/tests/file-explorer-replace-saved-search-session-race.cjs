const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractReplaceSavedSearchHandler() {
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
      node.name.getText(sourceFile) === 'onReplaceSavedSearch' &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      initializer = node.initializer.expression.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(initializer, 'missing onReplaceSavedSearch handler')
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

test('Desktop FileExplorer replace-saved-search completion cannot cross account lifecycle', async () => {
  const { filename, initializer } = extractReplaceSavedSearchHandler()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const organizationSearchScopeKeyRef = { current: 'scope-a' }
  const activeIDs = []
  const feedback = []
  let updateCalls = 0

  const handler = compileExpression(
    filename,
    'handler',
    initializer,
    {
      canSaveSmartFolder: true,
      organization: {
        updateSavedSearch: async () => {
          updateCalls += 1
          return pending.promise
        },
      },
      organizationLifecycleKeyRef,
      organizationSearchScopeKeyRef,
      searchState: { query: 'kind:image' },
      persistedSearchFilters: { tagID: 5 },
      setActiveSavedSearchID: (id) => activeIDs.push(id),
      onFeedback: (tone, message) => feedback.push({ tone, message }),
    },
  )

  handler({
    id: 42,
    name: 'A smart folder',
    query: 'old',
    filters: {},
  })
  await flushAsync()
  assert.equal(updateCalls, 1)

  organizationLifecycleKeyRef.current = 'server-b:user-b'
  pending.resolve({
    id: 42,
    name: 'A smart folder',
    query: 'kind:image',
    filters: { tagID: 5 },
    position: 0,
  })
  await flushAsync()

  assert.deepEqual(
    activeIDs,
    [],
    'account-A saved-search replacement must not activate an A id after account B becomes current',
  )
  assert.deepEqual(
    feedback,
    [],
    'account-A saved-search replacement must not publish success feedback into account B',
  )
})
