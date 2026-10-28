const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..', '..')
const filename = path.join(root, 'ui/shared/src/mui/OverviewPage.tsx')
const source = fs.readFileSync(filename, 'utf8')

function extractOverviewListEffect() {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback = null
  let dependencies = null
  const visit = node => {
    if (ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(file).includes('port.cloudFileRecent(6, controller.signal)') &&
      node.arguments[0].getText(file).includes('port.cloudFileFavorites(controller.signal)')) {
      callback = node.arguments[0].getText(file)
      const deps = node.arguments[1]
      dependencies = ts.isArrayLiteralExpression(deps)
        ? deps.elements.map(element => element.getText(file)) : null
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(callback, 'shared Overview must own the original Recent/Favorites read effect')
  assert.ok(dependencies?.includes('overviewLifecycleKey'), 'Owner identity must fence every read')
  assert.ok(dependencies?.includes('port'), 'Host adapter replacement must cause reauthorization')
  return callback
}

function compileEffect(callback, vars) {
  const out = ts.transpileModule('const effect = ' + callback + ';', {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return new Function(...Object.keys(vars), out + '\nreturn effect')(...Object.values(vars))
}

function deferred() {
  let resolve
  const promise = new Promise(next => { resolve = next })
  return { promise, resolve }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function row(owner, favorite) {
  const name = owner + (favorite ? '-favorite' : '') + '.txt'
  const item = {
    node: { id: favorite ? 2 : 1, name, type: 'file', size: 1,
      revision: 1, created_at: '2026-10-08', updated_at: '2026-10-08' },
    path: name,
    crumbs: [],
  }
  return favorite
    ? { ...item, favorited_at: '2026-10-08' }
    : { ...item, accessed_at: '2026-10-08' }
}

test('common Overview ignores a superseded A Owner response after switching to B', async () => {
  const effect = extractOverviewListEffect()
  const aRecent = deferred(), aFavorites = deferred()
  const bRecent = deferred(), bFavorites = deferred()
  const receivedRecent = [], receivedFavorites = []
  let owner = 'A'
  let bRecentCalls = 0, bFavoriteCalls = 0
  const port = {
    cloudFileRecent: () => {
      if (owner === 'A') return aRecent.promise
      bRecentCalls += 1
      return bRecent.promise
    },
    cloudFileFavorites: () => {
      if (owner === 'A') return aFavorites.promise
      bFavoriteCalls += 1
      return bFavorites.promise
    },
  }
  const env = {
    port, activityRevision: 'unchanged', recentSupported: true, favoritesSupported: true,
    setRecentSnapshot: snap => { if (snap) receivedRecent.push([snap.scope, snap.rows.map(x => x.node.name)]) },
    setFavoriteSnapshot: snap => { if (snap) receivedFavorites.push([snap.scope, snap.rows.map(x => x.node.name)]) },
    setRecentFailure() {}, setFavoriteFailure() {},
    setInterval: () => 1, clearInterval() {},
  }
  const cleanupA = compileEffect(effect, { ...env, overviewLifecycleKey: 'server:A' })()
  await flush()
  owner = 'B'
  cleanupA()
  const cleanupB = compileEffect(effect, { ...env, overviewLifecycleKey: 'server:B' })()
  await flush()
  bRecent.resolve([row('B', false)])
  bFavorites.resolve([row('B', true)])
  await flush()
  aRecent.resolve([row('A', false)])
  aFavorites.resolve([row('A', true)])
  await flush()
  cleanupB()
  assert.equal(bRecentCalls, 1)
  assert.equal(bFavoriteCalls, 1)
  assert.deepEqual(receivedRecent, [['server:B', ['B.txt']]])
  assert.deepEqual(receivedFavorites, [['server:B', ['B-favorite.txt']]])
})

test('common Home does not expose old owner accepted snapshots or render-loop empty arrays', () => {
  assert.ok(source.includes('recentSnapshot?.scope === overviewLifecycleKey'))
  assert.ok(source.includes('favoriteSnapshot?.scope === overviewLifecycleKey'))
  assert.ok(source.includes('EMPTY_RECENT'))
  assert.ok(source.includes('EMPTY_FAVORITES'))
  assert.ok(source.includes('recentVerified={Boolean(recentVerified)}'))
  assert.ok(source.includes('favoritesVerified={Boolean(favoritesVerified)}'))
  assert.equal(source.includes('window.xdriveDesktop'), false)
})
