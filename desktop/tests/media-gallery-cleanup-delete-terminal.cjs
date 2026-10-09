const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/MediaGallery.tsx')
const source = fs.readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function loadTS(pathname, localRequire = require) {
  const content = fs.readFileSync(path.join(root, pathname), 'utf8')
  const compiled = ts.transpileModule(content, {
    fileName: pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    localRequire, mod, mod.exports,
  )
  return mod.exports
}

const operationModel = loadTS('ui/shared/src/file-operations.ts')
const model = loadTS('ui/shared/src/mui/MediaGalleryCleanupTask.ts', (name) => {
  assert.equal(name, '../file-operations')
  return operationModel
})

function callbackInitializer() {
  let found = null
  function visit(node) {
    if (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) && node.name.text === 'deleteItems') {
      found = node.initializer?.getText(ast) ?? null
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found?.startsWith('useCallback('))
  return found
}

function completionEffectInitializer() {
  let found = null
  function visit(node) {
    if (ts.isCallExpression(node) &&
        node.expression.getText(ast) === 'useEffect' &&
        node.arguments[0]?.getText(ast).includes('xDriveMediaGallerySettledDeleteIDs')) {
      found = node.arguments[0].getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found?.includes('xDriveMediaGallerySettledDeleteIDs'),
    'missing cleanup terminal-state effect')
  return found
}

function compileExpression(expression, bindingName, env) {
  const compiled = ts.transpileModule('const ' + bindingName + ' = ' + expression + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const keys = Object.keys(env)
  return new Function(...keys, compiled + '\nreturn ' + bindingName)(
    ...keys.map((key) => env[key]),
  )
}

test('G11 real receipts normalize, never invent completion, and only settle matching IDs', () => {
  assert.deepEqual(model.xDriveMediaGalleryDeleteOperation({ id: 'g11-1', status: 'queued' }),
    { id: 'g11-1', status: 'queued' })
  for (const malformed of [null, undefined, {}, { id: '', status: 'completed' },
    { id: 'g11-1', status: 'mystery' }, { id: 5, status: 'completed' }]) {
    assert.equal(model.xDriveMediaGalleryDeleteOperation(malformed), undefined)
  }
  const pending = ['g11-1', 'g11-2']
  for (const status of ['queued', 'running', 'cancel_requested']) {
    assert.deepEqual(model.xDriveMediaGallerySettledDeleteIDs(pending, [
      { id: 'g11-1', status },
      { id: 'unrelated', status: 'completed' },
    ]), [], status)
  }
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.deepEqual(model.xDriveMediaGallerySettledDeleteIDs(pending, [
      { id: 'unrelated', status: 'completed' }, { id: 'g11-1', status },
    ]), ['g11-1'], status)
  }
  assert.deepEqual(model.xDriveMediaGallerySettledDeleteIDs(pending, []), [])
})

test('G11 actual Gallery deletion callback registers queued operation without refreshing early', async () => {
  const changes = []
  let pending = []
  const fakeOp = { id: 'cleanup-task-12', status: 'queued' }
  const deleted = [{ node: { id: 55, revision: 1 } }]
  const source = { deleteItems: async (items) => {
    assert.equal(items, deleted)
    changes.push('submitted')
    return fakeOp
  } }
  const cb = compileExpression(callbackInitializer(), 'deleteItems', {
    useCallback: (fn) => fn, source,
    currentCleanupReview: { kind: 'burst', group: { id: 'burst-5' } },
    currentAlbum: null, currentPerson: null, currentSuggestedPerson: null,
    query: {}, onError: () => { throw new Error('unexpected error') },
    setError: () => {},
    loadCleanup: async () => { changes.push('refreshed-early') },
    loadFirstPage: async () => { changes.push('wrong-range') },
    onFileOperationQueued: (op) => { assert.equal(op, fakeOp); changes.push('remembered') },
    trackDeleteCompletion: true,
    pendingCleanupReviewByTaskRef: { current: new Map() },
    deletePreferenceScopeRef: { current: 'account-a' },
    xDriveFileOperationActive: operationModel.xDriveFileOperationActive,
    setPendingCleanupDeleteIDs: (update) => { pending = update(pending) },
    xDriveMediaGalleryErrorMessage: (error) => error.message,
  })
  await cb(deleted)
  assert.deepEqual(changes, ['submitted', 'remembered'])
  assert.deepEqual(pending, ['cleanup-task-12'])
})

test('G11 actual completion effect waits for terminal states and stays in current section', () => {
  const effect = completionEffectInitializer()
  let pending = ['cleanup-task-12']
  const originalReviewByTask = new Map([['cleanup-task-12', 'burst-5']])
  const refreshes = []
  const evaluate = (operations, section = 'cleanup', reviewID = 'burst-5') => {
    const cb = compileExpression(effect, 'callback', {
      pendingCleanupDeleteIDs: pending,
      fileOperations: operations,
      section,
      currentCleanupReview: reviewID ? { group: { id: reviewID } } : null,
      pendingCleanupReviewByTaskRef: { current: originalReviewByTask },
      xDriveMediaGallerySettledDeleteIDs: model.xDriveMediaGallerySettledDeleteIDs,
      setPendingCleanupDeleteIDs: (update) => { pending = update(pending) },
      loadCleanup: () => { refreshes.push('server-query') },
    })
    cb()
  }
  evaluate([{ id: 'cleanup-task-12', status: 'queued' }])
  evaluate([{ id: 'cleanup-task-12', status: 'running' }])
  evaluate([{ id: 'cleanup-task-12', status: 'cancel_requested' }])
  evaluate([{ id: 'unrelated-task', status: 'completed' }])
  assert.deepEqual(refreshes, [])
  assert.deepEqual(pending, ['cleanup-task-12'])
  evaluate([{ id: 'cleanup-task-12', status: 'completed' }])
  assert.deepEqual(refreshes, ['server-query'])
  assert.deepEqual(pending, [])
  evaluate([{ id: 'cleanup-task-12', status: 'completed' }])
  assert.deepEqual(refreshes, ['server-query'], 'duplicate terminal snapshots are ignored')
  pending = ['cleanup-task-13']
  originalReviewByTask.set('cleanup-task-13', 'burst-5')
  evaluate([{ id: 'cleanup-task-13', status: 'failed' }], 'albums')
  assert.deepEqual(refreshes, ['server-query'], 'must never force back from a different section')
  assert.deepEqual(pending, [])
  pending = ['cleanup-task-14']
  originalReviewByTask.set('cleanup-task-14', 'burst-5')
  evaluate([{ id: 'cleanup-task-14', status: 'cancelled' }])
  assert.deepEqual(refreshes, ['server-query', 'server-query'])
  pending = ['cleanup-task-15']
  originalReviewByTask.set('cleanup-task-15', 'burst-5')
  evaluate([{ id: 'cleanup-task-15', status: 'completed' }], 'cleanup', 'burst-6')
  assert.deepEqual(refreshes, ['server-query', 'server-query'],
    'a previous group completing may not close a different open review')
  assert.deepEqual(pending, [])
  pending = ['cleanup-task-16']
  originalReviewByTask.set('cleanup-task-16', 'burst-5')
  evaluate([{ id: 'cleanup-task-16', status: 'completed' }], 'cleanup', null)
  assert.deepEqual(refreshes, ['server-query', 'server-query', 'server-query'],
    'Cleanup overview is safe to refresh after a prior review settles')
  pending = ['cleanup-task-17', 'cleanup-task-18']
  originalReviewByTask.set('cleanup-task-17', 'burst-5')
  originalReviewByTask.set('cleanup-task-18', 'burst-6')
  evaluate([
    { id: 'cleanup-task-17', status: 'completed' },
    { id: 'cleanup-task-18', status: 'failed' },
  ], 'cleanup', 'burst-6')
  assert.deepEqual(refreshes, ['server-query', 'server-query', 'server-query', 'server-query'])
  assert.equal(originalReviewByTask.size, 0,
    'simultaneous completion must consume all pending group associations')

})

test('G11 Web/Desktop connect the same durable operation lifecycle, without new polling', () => {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
  const adapter = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const web = read('web/src/App.tsx')
  const desktop = read('desktop/src/renderer/App.tsx')
  const wPort = read('web/src/mediaGalleryAdapter.ts')
  const dPort = read('desktop/src/renderer/mediaGalleryAdapter.ts')
  assert.match(adapter, /xDriveMediaGalleryDeleteOperation\(/)
  assert.match(adapter, /resolveXDriveTransport\(port\.deleteItems!\(items\)\)/)
  for (const app of [web, desktop]) {
    assert.match(app, /fileOperations=\{(?:fileOperations|cloudFileOperations)\}/)
    assert.match(app, /onFileOperationQueued=\{\(\) => \{ void refresh(?:Cloud)?FileOperations\(\) \}\s*\}/)
  }
  assert.match(wPort, /deleteItems: \(items\) => api\.createFileOperation/)
  assert.match(dPort, /deleteItems: \(items\) => agent\.cloudCreateFileOperation/)
  assert.doesNotMatch(callbackInitializer() + completionEffectInitializer(),
    /setInterval\(|setTimeout\(/,
    'Gallery deletion may only use existing Task Center operation polling')
})
