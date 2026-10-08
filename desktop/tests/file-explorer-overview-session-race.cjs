const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractOverviewListsEffect() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopOverviewPage.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let callback = null
  let dependencies = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('cloudFileRecent(6)') &&
      node.arguments[0].getText(sourceFile).includes('cloudFileFavorites()')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      const deps = node.arguments[1]
      dependencies = ts.isArrayLiteralExpression(deps)
        ? deps.elements.map((element) => element.getText(sourceFile))
        : null
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Desktop Overview Recent/Favorites effect')
  assert.ok(dependencies, 'Overview lists effect must have a dependency array')
  return { filename, callback, dependencies }
}

function compileEffect(filename, callback, dependencies) {
  const output = ts.transpileModule(
    'const effect = ' + callback + ';',
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
  return new Function(...names, output + '\nreturn effect')(...values)
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

function recentResult(account) {
  return {
    ok: true,
    data: [{
      node: {
        id: 1,
        revision: 1,
        name: account + '.txt',
        type: 'file',
        size: 1,
        updated_at: '2026-10-08T00:00:00Z',
      },
      path: account + '.txt',
      accessed_at: '2026-10-08T00:00:00Z',
    }],
  }
}

function favoriteResult(account) {
  return {
    ok: true,
    data: [{
      node: {
        id: 2,
        revision: 1,
        name: account + '-favorite.txt',
        type: 'file',
        size: 1,
        updated_at: '2026-10-08T00:00:00Z',
      },
      path: account + '-favorite.txt',
      favorited_at: '2026-10-08T00:00:00Z',
    }],
  }
}

test('Desktop Overview Recent and Favorites cannot cross account lifecycle when activity revision is unchanged', async () => {
  const { filename, callback, dependencies } = extractOverviewListsEffect()

  const recentA = deferred()
  const favoriteA = deferred()
  const recentB = deferred()
  const favoriteB = deferred()
  let account = 'A'
  let bRecentCalls = 0
  let bFavoriteCalls = 0
  const recentWrites = []
  const favoriteWrites = []

  const window = {
    xdriveDesktop: {
      agent: {
        cloudFileRecent: () => {
          if (account === 'A') return recentA.promise
          bRecentCalls += 1
          return recentB.promise
        },
        cloudFileFavorites: () => {
          if (account === 'A') return favoriteA.promise
          bFavoriteCalls += 1
          return favoriteB.promise
        },
      },
    },
    setInterval: () => 1,
    clearInterval: () => {},
  }

  const baseDependencies = {
    activityRevision: '7::',
    recentSupported: true,
    favoritesSupported: true,
    window,
    setRecentItems: (value) => recentWrites.push(value.map((item) => item.node.name)),
    setFavoriteItems: (value) => favoriteWrites.push(value.map((item) => item.node.name)),
  }

  const effectA = compileEffect(filename, callback, {
    ...baseDependencies,
    overviewLifecycleKey: 'server-a:user-a',
  })
  const cleanupA = effectA()
  await flushAsync()

  account = 'B'
  let cleanupB
  if (dependencies.includes('overviewLifecycleKey')) {
    if (typeof cleanupA === 'function') cleanupA()
    const effectB = compileEffect(filename, callback, {
      ...baseDependencies,
      overviewLifecycleKey: 'server-b:user-b',
    })
    cleanupB = effectB()
  }

  if (bRecentCalls > 0) {
    recentB.resolve(recentResult('B'))
    favoriteB.resolve(favoriteResult('B'))
    await flushAsync()
  }

  recentA.resolve(recentResult('A'))
  favoriteA.resolve(favoriteResult('A'))
  await flushAsync()

  if (typeof cleanupB === 'function') cleanupB()

  assert.equal(
    bRecentCalls,
    1,
    'account B must start its own Recent request even when status/activity revision is unchanged',
  )
  assert.equal(
    bFavoriteCalls,
    1,
    'account B must start its own Favorites request even when status/activity revision is unchanged',
  )

  const nonEmptyRecent = recentWrites.filter((items) => items.length > 0)
  const nonEmptyFavorites = favoriteWrites.filter((items) => items.length > 0)
  assert.deepEqual(nonEmptyRecent, [['B.txt']])
  assert.deepEqual(nonEmptyFavorites, [['B-favorite.txt']])
  assert.ok(
    !recentWrites.some((items) => items.includes('A.txt')),
    'late account-A Recent response must never publish into account B',
  )
  assert.ok(
    !favoriteWrites.some((items) => items.includes('A-favorite.txt')),
    'late account-A Favorites response must never publish into account B',
  )
})
