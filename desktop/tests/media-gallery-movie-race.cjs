const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sourceFile() {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'MediaGalleryMovieDialog.tsx',
  )
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

function extractVariable(name) {
  const { filename, sourceFile: file } = sourceFile()
  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer, 'missing Gallery movie function: ' + name)
  return { filename, initializer }
}

function extractItemsResetEffect() {
  const { filename, sourceFile: file } = sourceFile()
  let callback = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(file).includes('setOrderedItems(items.slice(0, 30))')
    ) {
      callback = node.arguments[0].getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'missing Gallery movie items-reset effect')
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
      width: 1920,
      height: 1080,
    },
  }
}

test('Gallery movie creation completion cannot cross selected items lifecycle', async () => {
  const createSource = extractVariable('createMovie')
  const resetSource = extractItemsResetEffect()

  const itemsA = [item(1, 'A1.jpg'), item(2, 'A2.jpg')]
  const itemsB = [item(3, 'B1.jpg'), item(4, 'B2.jpg')]
  const pendingCreate = deferred()

  const orderedWrites = []
  const generationWrites = []
  const busyWrites = []
  const errorWrites = []
  const resultWrites = []
  const completedRef = { current: '' }
  const movieActionGenerationRef = { current: 0 }

  const resetDependencies = {
    open: true,
    setOrderedItems: (value) => orderedWrites.push(value),
    setMovieTemplate: () => {},
    setMusicNode: () => {},
    setMusicPickerOpen: () => {},
    setFrameDurationMS: () => {},
    setTransitionMS: () => {},
    setOutputName: () => {},
    setGeneration: (value) => generationWrites.push(value),
    setResultURL: (value) => resultWrites.push(value),
    setError: (value) => errorWrites.push(value),
    setBusy: (value) => busyWrites.push(value),
    completedRef,
    movieActionGenerationRef,
  }

  const resetA = compileExpression(
    resetSource.filename,
    'itemsResetEffect',
    resetSource.callback,
    { ...resetDependencies, items: itemsA },
  )
  resetA()

  const createMovie = compileExpression(
    createSource.filename,
    'createMovie',
    createSource.initializer,
    {
      onCreate: async () => pendingCreate.promise,
      allSupported: true,
      generating: false,
      orderedItems: itemsA,
      movieTemplate: 'classic',
      musicNode: null,
      setBusy: (value) => busyWrites.push(value),
      setError: (value) => errorWrites.push(value),
      setResultURL: (value) => resultWrites.push(value),
      outputName: '',
      frameDurationMS: 2000,
      transitionMS: 350,
      setGeneration: (value) => generationWrites.push(value),
      movieActionGenerationRef,
    },
  )

  const pending = createMovie()
  await flushAsync()

  const resetB = compileExpression(
    resetSource.filename,
    'itemsResetEffect',
    resetSource.callback,
    { ...resetDependencies, items: itemsB },
  )
  resetB()

  const generationMarker = generationWrites.length
  const busyMarker = busyWrites.length
  const errorMarker = errorWrites.length

  pendingCreate.resolve({
    id: 'movie-a',
    state: 'queued',
    input_node_id: 1,
  })
  await pending
  await flushAsync()

  assert.deepEqual(
    generationWrites.slice(generationMarker),
    [],
    'a movie generation started for item set A must not overwrite item set B after the selected items change',
  )
  assert.deepEqual(
    busyWrites.slice(busyMarker),
    [],
    'a stale item-set-A completion must not mutate item-set-B busy ownership',
  )
  assert.deepEqual(
    errorWrites.slice(errorMarker),
    [],
    'a stale item-set-A completion must not publish an error into item set B',
  )
})


test('Gallery movie cancellation completion cannot cross selected items lifecycle', async () => {
  const cancelSource = extractVariable('cancelMovie')
  const resetSource = extractItemsResetEffect()

  const itemsA = [item(11, 'A1.jpg'), item(12, 'A2.jpg')]
  const itemsB = [item(13, 'B1.jpg'), item(14, 'B2.jpg')]
  const pendingCancel = deferred()

  const orderedWrites = []
  const generationWrites = []
  const busyWrites = []
  const errorWrites = []
  const resultWrites = []
  const completedRef = { current: '' }
  const movieActionGenerationRef = { current: 0 }

  const resetDependencies = {
    open: true,
    setOrderedItems: (value) => orderedWrites.push(value),
    setMovieTemplate: () => {},
    setMusicNode: () => {},
    setMusicPickerOpen: () => {},
    setFrameDurationMS: () => {},
    setTransitionMS: () => {},
    setOutputName: () => {},
    setGeneration: (value) => generationWrites.push(value),
    setResultURL: (value) => resultWrites.push(value),
    setError: (value) => errorWrites.push(value),
    setBusy: (value) => busyWrites.push(value),
    completedRef,
    movieActionGenerationRef,
  }

  const resetA = compileExpression(
    resetSource.filename,
    'itemsResetEffect',
    resetSource.callback,
    { ...resetDependencies, items: itemsA },
  )
  resetA()

  const cancelMovie = compileExpression(
    cancelSource.filename,
    'cancelMovie',
    cancelSource.initializer,
    {
      generation: { id: 'movie-a', state: 'running' },
      onCancel: async () => pendingCancel.promise,
      generating: true,
      setBusy: (value) => busyWrites.push(value),
      setError: (value) => errorWrites.push(value),
      setGeneration: (value) => generationWrites.push(value),
      movieActionGenerationRef,
    },
  )

  const pending = cancelMovie()
  await flushAsync()

  const resetB = compileExpression(
    resetSource.filename,
    'itemsResetEffect',
    resetSource.callback,
    { ...resetDependencies, items: itemsB },
  )
  resetB()

  const generationMarker = generationWrites.length
  const busyMarker = busyWrites.length
  const errorMarker = errorWrites.length

  pendingCancel.resolve({
    id: 'movie-a',
    state: 'cancelled',
    input_node_id: 11,
  })
  await pending
  await flushAsync()

  assert.deepEqual(
    generationWrites.slice(generationMarker),
    [],
    'a cancellation started for item set A must not overwrite item set B after the selected items change',
  )
  assert.deepEqual(
    busyWrites.slice(busyMarker),
    [],
    'a stale item-set-A cancellation must not mutate item-set-B busy ownership',
  )
  assert.deepEqual(
    errorWrites.slice(errorMarker),
    [],
    'a stale item-set-A cancellation must not publish an error into item set B',
  )
})
