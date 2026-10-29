'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const filename = path.join(root, 'ui/shared/src/mui/AdminUsersPage.tsx')
const source = fs.readFileSync(filename, 'utf8')
function realLoad(env) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(item =>
    ts.isFunctionDeclaration(item) && item.name?.text === 'AdminUsersPanel')
  assert.ok(component, 'actual shared AdminUsersPanel must be present')
  let initializer
  function walk(node) {
    if (ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) && node.name.text === 'load') {
      initializer = node.initializer?.getText(ast)
    }
    ts.forEachChild(node, walk)
  }
  walk(component)
  assert.ok(initializer?.startsWith('async '), 'real async Admin Users loader must be extracted')
  const js = ts.transpileModule('const load = ' + initializer + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const names = Object.keys(env)
  return new Function(...names, js + '\nreturn load')(...names.map(name => env[name]))
}
function pending() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function fixture(api) {
  const entries = []
  const readAbortRef = { current: null }
  const readEpochRef = { current: 0 }
  const readMountedRef = { current: true }
  const currentApiRef = { current: api }
  const events = {
    snapshots: [], errors: [], completed: [], loading: [],
  }
  const env = {
    api, readAbortRef, readEpochRef, readMountedRef, currentApiRef,
    setReadEpoch: value => entries.push(['epoch', value]),
    setPendingReadSource: value => entries.push(['source', value]),
    setLoading: value => events.loading.push(value),
    setLoadError: value => events.errors.push(value),
    setUsersSnapshot: value => events.snapshots.push(value),
    setCompletedSource: value => events.completed.push(value),
  }
  return {
    ...events, entries, readAbortRef, readEpochRef, readMountedRef, currentApiRef,
    load: realLoad(env),
  }
}

test('Admin Users accepted refresh aborts earlier GET and ignores late successful data', async () => {
  const first = pending(), newest = pending(), signals = []
  let index = 0
  const api = { adminUsers: signal => {
    signals.push(signal)
    return ++index === 1 ? first.promise : newest.promise
  } }
  const f = fixture(api)
  const old = f.load()
  assert.equal(signals[0].aborted, false)
  const current = f.load()
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  newest.resolve([{ id: 2, username: 'new' }])
  await current
  first.resolve([{ id: 1, username: 'obsolete' }])
  await old
  assert.deepEqual(f.snapshots.map(value => value.items.map(item => item.id)), [[2]],
    'old request is fenced even if its adapter ignores AbortSignal')
  assert.deepEqual(f.completed, [api])
  assert.equal(f.loading.at(-1), false)
  assert.deepEqual(f.errors, ['', ''])
})

test('Admin Users abort during route exit is silent, and old mutation receipt cannot launch a new GET', async () => {
  const first = pending(), signals = []
  const api = { adminUsers: signal => { signals.push(signal); return first.promise } }
  const f = fixture(api)
  const old = f.load()
  f.readMountedRef.current = false
  f.readAbortRef.current?.abort()
  f.readEpochRef.current += 1
  assert.equal(signals[0].aborted, true)
  first.resolve([{ id: 10, username: 'old-identity' }])
  await old
  await f.load() // possible late update/delete receipt from the previous route
  assert.equal(signals.length, 1, 'no list GET after the route has unmounted')
  assert.deepEqual(f.snapshots, [])
  assert.deepEqual(f.completed, [])
  assert.deepEqual(f.errors, [''])
})

test('Admin Users account switch rejects old owner fetch and old errors', async () => {
  const old = pending(), newValue = [{ id: 33, username: 'current' }]
  const oldSignals = []
  const oldAPI = { adminUsers: signal => { oldSignals.push(signal); return old.promise } }
  const newAPI = { adminUsers: async () => newValue }
  const f = fixture(oldAPI)
  const oldRead = f.load()
  f.currentApiRef.current = newAPI // new session accepted before old read settles
  f.readAbortRef.current?.abort()
  const newFrame = fixture(newAPI)
  await newFrame.load()
  old.reject(new Error('old owner GET failed'))
  await oldRead
  assert.equal(oldSignals[0].aborted, true)
  assert.deepEqual(f.errors, [''])
  assert.deepEqual(f.snapshots, [])
  assert.deepEqual(newFrame.snapshots.map(snapshot => snapshot.items), [newValue])
})

test('only the Admin Users list GET becomes disposable; every mutation retains its own receipt', () => {
  const port = fs.readFileSync(path.join(root, 'ui/shared/src/admin-management.ts'), 'utf8')
  assert.match(port, /adminUsers\(signal\?: AbortSignal\): Promise<AdminUser\[\]>/)
  assert.match(source, /const nextUsers = await api\.adminUsers\(controller\.signal\)/)
  assert.match(source, /return \(\) => \{\s*readMountedRef\.current = false\s*readAbortRef\.current\?\.abort\(\)/)
  for (const action of [
    'adminCreateUser(', 'adminUpdateUser(', 'adminResetPassword(',
    'adminRevokeSessions(', 'adminDeleteUser(',
  ]) {
    assert.ok(source.includes('api.' + action), 'durable Admin Users mutation missing ' + action)
  }
  assert.doesNotMatch(source, /api\.admin(CreateUser|UpdateUser|ResetPassword|RevokeSessions|DeleteUser)\([^\n]*controller\.signal/)
})
