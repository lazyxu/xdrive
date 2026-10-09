const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.resolve(__dirname, '../../ui/shared/src/mui/FileExplorerOrganizationController.ts')

function realRunInitializer() {
  const input = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let run = null
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === 'run' && node.initializer) {
      run = node.initializer.getText(ast)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(run?.startsWith('useCallback('), 'missing real Organization run hook')
  return run
}

function makeRunner() {
  const expression = realRunInitializer()
  const output = ts.transpileModule('const run = ' + expression + ';', {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const errors = []
  let busy = ''
  const refs = {
    lifecycleGenerationRef: { current: 2 },
    refreshGenerationRef: { current: 0 },
    mutationRef: { current: null },
    mutationByKeyRef: { current: new Map() },
    mutationTailsRef: { current: new Map() },
    onErrorRef: { current: (error) => errors.push(error) },
    useCallback: (fn) => fn,
    setBusyKey(value) { busy = typeof value === 'function' ? value(busy) : value },
    setLoading() {},
  }
  const keys = Object.keys(refs)
  const run = new Function(...keys, output + '\nreturn run')(...keys.map((name) => refs[name]))
  return { run, refs, errors, busy: () => busy }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flushAsync() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

test('parallel tag and saved-search writes preserve tag exact-intent singleflight', async () => {
  const x = makeRunner()
  const tag = deferred()
  const saved = deferred()
  let tagCalls = 0
  let savedCalls = 0
  const firstTag = x.run('tag:create', () => { tagCalls++; return tag.promise }, undefined,
    JSON.stringify(['Work', '#111111']))
  const firstSaved = x.run('saved-search:create', () => { savedCalls++; return saved.promise },
    undefined, JSON.stringify(['Documents', 'pdf']))
  const secondTag = x.run('tag:create', () => { tagCalls++; return tag.promise }, undefined,
    JSON.stringify(['Work', '#111111']))

  await flushAsync()
  assert.equal(tagCalls, 1)
  assert.equal(savedCalls, 1)
  assert.strictEqual(secondTag, firstTag,
    'another resource starting must not replace the first key’s singleflight owner')
  saved.resolve('saved')
  await firstSaved
  assert.notEqual(x.busy(), '', 'tag is still running; Organization must remain busy')
  tag.resolve('tag')
  await Promise.all([firstTag, secondTag])
  assert.equal(tagCalls, 1, 'identical tag request must not cause a second Server mutation')
  assert.equal(x.busy(), '')
  assert.deepEqual(x.errors, [])
})

test('newer independent mutation finishing first cannot clear older pending busy state', async () => {
  const x = makeRunner()
  const slow = deferred()
  const fast = deferred()
  const first = x.run('tag:create', () => slow.promise, undefined, 'create-tag')
  const second = x.run('saved-search:create', () => fast.promise, undefined, 'create-search')
  await flushAsync()
  fast.resolve('search')
  await second
  assert.equal(x.busy(), 'tag:create', 'slow operation still blocks the shared Organization controls')
  slow.resolve('tag')
  await first
  assert.equal(x.busy(), '')
  assert.deepEqual(x.errors, [])
})

test('A → B → A intents on one key remain three serialized writes', async () => {
  const x = makeRunner()
  const firstPending = deferred()
  const secondPending = deferred()
  const order = []
  const first = x.run('tag:update:42', () => {
    order.push('rename-first')
    return firstPending.promise
  }, undefined, 'rename')
  const second = x.run('tag:update:42', () => {
    order.push('recolor')
    return secondPending.promise
  }, undefined, 'recolor')
  const third = x.run('tag:update:42', async () => {
    order.push('rename-again')
    return 'third'
  }, undefined, 'rename')
  assert.notStrictEqual(third, first, 'a new rename after a recolor is a new user intent')
  await flushAsync()
  assert.deepEqual(order, ['rename-first'])
  firstPending.resolve('one')
  await first
  await flushAsync()
  assert.deepEqual(order, ['rename-first', 'recolor'])
  secondPending.resolve('two')
  await Promise.all([second, third])
  assert.deepEqual(order, ['rename-first', 'recolor', 'rename-again'])
  assert.equal(x.busy(), '')
  assert.deepEqual(x.errors, [])
})

test('failed unrelated mutation must not release first key pending state', async () => {
  const x = makeRunner()
  const tag = deferred()
  const first = x.run('tag:create', () => tag.promise, undefined, 'tag-create')
  const second = x.run('saved-search:create', async () => { throw new Error('bad search') }, undefined, 'search-create')
  await assert.rejects(second, /bad search/)
  assert.equal(x.busy(), 'tag:create')
  assert.equal(x.errors.length, 1)
  tag.resolve('tag')
  await first
  assert.equal(x.busy(), '')
})
