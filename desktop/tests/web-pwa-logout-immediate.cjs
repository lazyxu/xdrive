const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

// Exercise the actual signOut handler from App.tsx rather than reimplementing
// its timing in a test helper. The real clearSession/auth-storage/IDB safety
// behavior is already covered by web-pwa-storage-denied-auth.cjs.
const root = path.resolve(__dirname, '../..')
const app = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let signOutInitializer = null
const visit = node => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === 'signOut') {
    assert.equal(signOutInitializer, null, 'only one Web sign-out handler is supported')
    signOutInitializer = node.initializer?.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(signOutInitializer, 'missing Web/PWA sign-out handler')
const js = ts.transpileModule('exports.signOut = ' + signOutInitializer + ';', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(remoteLogout) {
  const events = []
  let owner = 'original-owner'
  let localClears = 0
  const originalApi = {
    refreshToken: 'original-refresh',
    logout() { events.push(['server-revoke', this.refreshToken]); return remoteLogout() },
  }
  const callbacks = {
    api: originalApi,
    clearSession() { events.push(['local-clear']); localClears++; owner = null },
    xDriveClearBaiduConversionSession() { events.push(['clear-conversion']) },
    xDriveClearPrivateMapBrowseSessions() { events.push(['clear-private-map']) },
  }
  const exported = {}
  new Function('exports', ...Object.keys(callbacks), js)(
    exported, ...Object.values(callbacks))
  return {
    signOut: exported.signOut, events,
    get owner() { return owner }, set owner(value) { owner = value },
    get clears() { return localClears },
  }
}
function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
async function drainMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

test('PWA: click logout immediately clears local Owner, even if remote never settles', async () => {
  const remote = deferred()
  const h = harness(() => remote.promise)
  assert.equal(h.signOut(), undefined)
  assert.equal(h.owner, null, 'old Owner must disappear before awaiting HTTP')
  assert.equal(h.clears, 1)
  assert.deepEqual(h.events, [
    ['clear-conversion'], ['clear-private-map'], ['local-clear'],
  ], 'map and browser session cleanup must happen in the click handler')
  await drainMicrotasks()
  assert.deepEqual(h.events.at(-1), ['server-revoke', 'original-refresh'],
    'remote revocation still attempts the captured old API token')
  remote.resolve()
  await drainMicrotasks()
  assert.equal(h.clears, 1, 'late success must not rerun local sign-out')
})

test('PWA: offline logout rejection must not revive old Owner or clear a new login', async () => {
  const remote = deferred()
  const h = harness(() => remote.promise)
  h.signOut()
  assert.equal(h.owner, null)
  h.owner = 'new-owner'
  await drainMicrotasks()
  remote.reject(new TypeError('network offline'))
  await drainMicrotasks()
  assert.equal(h.owner, 'new-owner')
  assert.equal(h.clears, 1)
  assert.deepEqual(h.events.filter(x => x[0] === 'server-revoke'),
    [['server-revoke', 'original-refresh']])
})

test('PWA: synchronous optional logout transport denial also cannot block local cleanup', async () => {
  const h = harness(() => { throw new Error('restricted browser fetch') })
  assert.doesNotThrow(() => h.signOut())
  assert.equal(h.owner, null)
  assert.equal(h.clears, 1)
  await drainMicrotasks()
  assert.equal(h.clears, 1)
})

test('PWA: FileManager still wires the same sign-out and offline cleanup', () => {
  assert.match(app, /onLogout=\{signOut\}/)
  assert.match(app, /transferApiRef\.current\?\.disposeTransfers\(\)/)
  assert.match(app, /xDrivePwaClearOfflineMetadata\(\)/)
  assert.doesNotMatch(signOutInitializer, /await\s+.*logout\(|\.finally\(\s*\(\)\s*=>\s*clearSession/)
})
