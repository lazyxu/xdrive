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
    setCutoutExpand: () => {},
    setCutoutFeather: () => {},
    setPoints: (value) => pointsWrites.push(value),
    setStrokes: (value) => strokesWrites.push(value),
    setActiveStroke: (value) => activeStrokeWrites.push(value),
    completedRef,
    creativeActionGenerationRef,
    cutoutPointDragRef: { current: null },
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
      cutoutExpand: 0.02,
      cutoutFeather: 0.01,
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


// P1-2h authentic Chrome first-red: a completed creative job sent an output
// preview ticket but left the source photo visible after the completion
// callback triggered the owning Gallery's range refresh. The old combined
// useEffect prematurely disposed its result request on callback identity
// churn, then completedRef suppressed restarting it.
function creativeCompletionEffects() {
  const { filename, sourceFile: file } = sourceFile()
  let completion = null, preview = null
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'useEffect' && node.arguments.length >= 2) {
      const callback = node.arguments[0].getText(file)
      const deps = node.arguments[1].getText(file)
      if (callback.includes('completedRef.current === completionKey')) {
        completion = { filename, callback, deps }
      }
      if (callback.includes("loadPreviewURL(generation.output_node_id, 'image')")) {
        preview = { filename, callback, deps }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(completion, 'must notify exactly once for completed creative generation')
  assert.ok(preview, 'must independently request generated-image preview')
  assert.notEqual(completion.callback, preview.callback,
    'completion notification and output preview cannot share a cancellable effect')
  assert.doesNotMatch(preview.deps, /onCompleted/,
    'callback identity churn may not dispose a started result-preview download')
  return { completion, preview }
}

test('P1-2h completed Creative result preview survives Gallery refresh callback identity changes', async () => {
  const { completion, preview } = creativeCompletionEffects()
  const done = deferred()
  const generation = { id: 'creative-completed', state: 'completed',
    output_node_id: 985, source_node_id: 31, source_node_revision: 4 }
  const completedRef = { current: '' }, notifications = [], previews = [], loads = []
  const onCompletedRef = { current: job => notifications.push('first:' + job.id) }
  const notify = compileExpression(completion.filename, 'completionEffect',
    completion.callback, { open: true, generation, completedRef, onCompletedRef })
  const load = compileExpression(preview.filename, 'resultPreviewEffect',
    preview.callback, {
      open: true, generation,
      loadPreviewURL: async (id, kind) => {
        loads.push([id, kind])
        return done.promise
      },
      setResultURL: url => previews.push(url),
    })
  notify()
  const cleanup = load()
  assert.deepEqual(notifications, ['first:creative-completed'])
  assert.deepEqual(loads, [[985, 'image']])
  // A Gallery refetch re-renders the caller and replaces its completion
  // callback before the media preview resolves; the result effect has no
  // dependency on that callback and remains mounted.
  onCompletedRef.current = job => notifications.push('next:' + job.id)
  notify()
  assert.deepEqual(notifications, ['first:creative-completed'],
    'refresh must not produce duplicate completion notifications')
  done.resolve('blob:real-generated-preview')
  await flushAsync()
  assert.deepEqual(previews, ['blob:real-generated-preview'],
    'generated bytes must replace the source photo even after owner rerender')
  if (typeof cleanup === 'function') cleanup()
})

test('P1-2h output preview aborts only when actual output source is disposed', async () => {
  const { preview } = creativeCompletionEffects()
  const pending = deferred(), previewWrites = []
  const load = compileExpression(preview.filename, 'resultPreviewEffect',
    preview.callback, {
      open: true,
      generation: { id: 'job', state: 'completed', output_node_id: 986 },
      loadPreviewURL: async () => pending.promise,
      setResultURL: value => previewWrites.push(value),
    })
  const cleanup = load()
  assert.equal(typeof cleanup, 'function')
  cleanup()
  pending.resolve('blob:obsolete-output')
  await flushAsync()
  assert.deepEqual(previewWrites, [],
    'actual close or output change must still reject the stale preview result')
})
