const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

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
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'XDriveFileNameDialog') {
      const attributes = node.attributes.properties
      const mode = attributes.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'mode'
      ))
      const initialValue = attributes.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'initialValue'
      ))
      const onSubmit = attributes.find((attribute) => (
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === 'onSubmit'
      ))
      const modeText = mode?.initializer?.getText(sourceFile) ?? ''
      if (
        modeText === '"saved-search"' &&
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

  assert.ok(initializer, 'missing create-saved-search submit handler')
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
}

test('Desktop FileExplorer saved-search completion cannot cross account lifecycle', async () => {
  const { filename, initializer } = extractCreateSavedSearchSubmit()
  const pending = deferred()
  const organizationLifecycleKeyRef = { current: 'server-a:user-a' }
  const activeIDs = []
  const feedback = []

  const onSubmit = compileExpression(
    filename,
    'onSubmit',
    initializer,
    {
      organization: {
        createSavedSearch: async () => pending.promise,
      },
      organizationLifecycleKeyRef,
      searchState: { query: 'kind:image' },
      persistedSearchFilters: { tagID: 3 },
      setActiveSavedSearchID: (id) => activeIDs.push(id),
      searchFilters: { availability: null },
      onFeedback: (tone, message) => feedback.push({ tone, message }),
    },
  )

  const submit = onSubmit('A smart folder')
  await flushAsync()

  organizationLifecycleKeyRef.current = 'server-b:user-b'
  pending.resolve({
    id: 41,
    name: 'A smart folder',
    query: 'kind:image',
    filters: { tagID: 3 },
    position: 0,
  })
  await submit

  assert.deepEqual(
    activeIDs,
    [],
    'account-A saved-search completion must not activate an A saved-search id after account B becomes current',
  )
  assert.deepEqual(
    feedback,
    [],
    'account-A saved-search completion must not publish success feedback into account B',
  )
})
