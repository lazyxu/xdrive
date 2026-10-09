const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.resolve(__dirname, '../../ui/shared/src/mui/MediaGallery.tsx')

function compileDeleteItems() {
  const source = fs.readFileSync(filename, 'utf8')
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer = null
  function visit(node) {
    if (ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) && node.name.text === 'deleteItems') {
      initializer = node.initializer?.getText(file) ?? null
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(initializer?.startsWith('useCallback('), 'expected the real Gallery deleteItems callback')
  const output = ts.transpileModule('const deleteItems = ' + initializer + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return (environment) => {
    const names = Object.keys(environment)
    return new Function(...names, output + '\nreturn deleteItems')(
      ...names.map((name) => environment[name]),
    )
  }
}

// Compare dependencies like React.useCallback and execute the actual TSX
// callback. A dependency-array syntax assertion alone misses stale closures.
test('G11 deletion refresh follows current Burst review scope across rerenders', async () => {
  const createCallback = compileDeleteItems()
  let cached = null
  const useCallback = (callback, deps) => {
    if (cached && cached.deps.length === deps.length &&
        deps.every((value, index) => Object.is(value, cached.deps[index]))) {
      return cached.callback
    }
    cached = { callback, deps }
    return callback
  }
  const events = []
  const items = [{ node: { id: 91, revision: 4 } }]
  let rejectNext = false
  const source = {
    deleteItems: async (value) => {
      assert.strictEqual(value, items)
      events.push('delete')
      if (rejectNext) throw new Error('delete refused')
    },
  }
  const loadCleanup = async () => { events.push('cleanup-refresh') }
  const loadFirstPage = async () => { events.push('range-refresh') }
  const query = {}
  const errors = []
  const setError = (message) => { if (message) errors.push(message) }
  const onError = (error) => { errors.push('reported: ' + error.message) }
  const render = (currentCleanupReview) => createCallback({
    useCallback, source, setError, loadCleanup, loadFirstPage,
    currentCleanupReview,
    currentAlbum: null, currentPerson: null, currentSuggestedPerson: null,
    query, onError,
    xDriveMediaGalleryErrorMessage: (error) => error.message,
  })

  const ordinaryDelete = render(null)
  await ordinaryDelete(items)
  assert.deepEqual(events, ['delete', 'range-refresh'])

  // The ordinary Gallery and opened Cleanup review share all other values.
  events.length = 0
  const reviewDelete = render({ kind: 'burst', group: { id: 'burst-91' } })
  assert.notStrictEqual(reviewDelete, ordinaryDelete,
    'opening a cleanup review must invalidate the previous delete closure')
  await reviewDelete(items)
  assert.deepEqual(events, ['delete', 'cleanup-refresh'],
    'accepted deletion must refresh Cleanup, not the ordinary Gallery range')

  events.length = 0
  rejectNext = true
  await assert.rejects(reviewDelete(items), /delete refused/)
  assert.deepEqual(events, ['delete'], 'failed submission must never trigger refresh')
  assert.deepEqual(errors, ['delete refused', 'reported: delete refused'])

  events.length = 0
  rejectNext = false
  const returnToGallery = render(null)
  await returnToGallery(items)
  assert.deepEqual(events, ['delete', 'range-refresh'],
    'leaving review must restore the ordinary collection refresh path')
})
