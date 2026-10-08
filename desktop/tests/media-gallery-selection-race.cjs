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
  let actionCalls = 0
  let clearCalls = 0

  const runSelectionAction = compileExpression(
    source.filename,
    source.initializer,
    {
      useCallback: (callback) => callback,
      selectedMedia,
      selectionBusyRef: { current: false },
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
