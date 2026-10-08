const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sourceFile() {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'MediaGalleryCreativeDialog.tsx')
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

function extractRunGeneration() {
  const { filename, sourceFile: file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'runGeneration' &&
      node.initializer
    ) {
      initializer = node.initializer.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing Gallery creative runGeneration')
  return { filename, initializer }
}

function extractItemResetEffect() {
  const { filename, sourceFile: file } = sourceFile()
  let callback = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(file).includes("loadPreviewURL(item.node.id, 'image')")
    ) {
      callback = node.arguments[0].getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'missing Gallery creative item-reset effect')
  return { filename, callback }
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

function item(id, name) {
  return {
    node: { id, name, revision: 1 },
    asset_kind: 'image',
    live_photo: null,
    metadata: {
      media_kind: 'image',
      index_state: 'ready',
    },
  }
}

test('Gallery creative generation completion cannot cross selected item lifecycle', async () => {
  const runSource = extractRunGeneration()
  const effectSource = extractItemResetEffect()
  const itemA = item(1, 'A.jpg')
  const itemB = item(2, 'B.jpg')
  const pendingCreate = deferred()

  const generationWrites = []
  const busyWrites = []
  const errorWrites = []
  const sourceWrites = []
  const resultWrites = []
  const pointsWrites = []
  const strokesWrites = []
  const activeStrokeWrites = []
  const completedRef = { current: '' }
  const creativeActionGenerationRef = { current: 0 }

  const stateDependencies = {
    supported: true,
    loadPreviewURL: async () => '',
    setSourceURL: (value) => sourceWrites.push(value),
    setResultURL: (value) => resultWrites.push(value),
    setError: (value) => errorWrites.push(value),
    setGeneration: (value) => generationWrites.push(value),
    setPoints: (value) => pointsWrites.push(value),
    setStrokes: (value) => strokesWrites.push(value),
    setActiveStroke: (value) => activeStrokeWrites.push(value),
    completedRef,
    creativeActionGenerationRef,
    setBusy: (value) => busyWrites.push(value),
  }

  const resetA = compileExpression(
    effectSource.filename,
    'itemResetEffect',
    effectSource.callback,
    { ...stateDependencies, open: true, item: itemA },
  )
  const cleanupA = resetA()
  await flushAsync()

  const runGeneration = compileExpression(
    runSource.filename,
    'runGeneration',
    runSource.initializer,
    {
      item: itemA,
      onCreate: async () => pendingCreate.promise,
      canGenerate: true,
      setBusy: (value) => busyWrites.push(value),
      setError: (value) => errorWrites.push(value),
      setResultURL: (value) => resultWrites.push(value),
      completedRef,
      mode: 'cutout',
      outputName: '',
      points: [{ x: 0.5, y: 0.5, foreground: true }],
      strokes: [],
      setGeneration: (value) => generationWrites.push(value),
      creativeActionGenerationRef,
    },
  )

  const pending = runGeneration()
  await flushAsync()

  if (typeof cleanupA === 'function') cleanupA()
  const resetB = compileExpression(
    effectSource.filename,
    'itemResetEffect',
    effectSource.callback,
    { ...stateDependencies, open: true, item: itemB },
  )
  const cleanupB = resetB()
  await flushAsync()

  const marker = generationWrites.length
  const busyMarker = busyWrites.length
  const errorMarker = errorWrites.length
  pendingCreate.resolve({
    id: 'generation-a',
    state: 'queued',
    input_node_id: 1,
  })
  await pending
  await flushAsync()

  assert.deepEqual(
    generationWrites.slice(marker),
    [],
    'a generation started for item A must not overwrite item B after the selected item changes',
  )
  assert.deepEqual(
    busyWrites.slice(busyMarker),
    [],
    'a stale item-A completion must not mutate item-B busy ownership',
  )
  assert.deepEqual(
    errorWrites.slice(errorMarker),
    [],
    'a stale item-A completion must not publish an error into item B',
  )

  if (typeof cleanupB === 'function') cleanupB()
})
