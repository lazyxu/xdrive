const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function callbackInitializer(relativePath, variableName) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let callback = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const candidate = node.initializer.arguments[0]
      if (candidate && (
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate)
      )) {
        callback = candidate.getText(sourceFile)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(callback, `missing callback ${variableName} in ${relativePath.join('/')}`)
  return callback
}

function compileLoadChildren(callbackSource) {
  const source = `
    module.exports = (
      pageByParentRef,
      loadingIDsRef,
      setLoadingIDs,
      loadDirectoryPage,
      commitParentPage,
      onError,
      latestPathCrumbsByIDRef,
    ) => {
      const loadChildren = ${callbackSource}
      return loadChildren
    }
  `
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', output)(mod, mod.exports)
  return mod.exports
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('stale navigation-tree child load cannot write old parent crumbs after current path metadata changes', async () => {
  const callbackSource = callbackInitializer(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx'],
    'loadChildren',
  )
  const makeLoadChildren = compileLoadChildren(callbackSource)

  const root = { id: 1, name: '我的文件' }
  const oldParent = { id: 2, name: 'OldParent' }
  const newParent = { id: 2, name: 'NewParent' }
  const child = { id: 3, name: 'Child' }
  const pageByParentRef = { current: {} }
  const loadingIDsRef = { current: new Set() }
  let loadingIDs = new Set()
  let releasePage

  const latestPathCrumbsByIDRef = {
    current: new Map([
      [oldParent.id, [root, oldParent]],
    ]),
  }

  const loadChildren = makeLoadChildren(
    pageByParentRef,
    loadingIDsRef,
    (updater) => {
      loadingIDs = typeof updater === 'function' ? updater(loadingIDs) : updater
    },
    () => new Promise((resolve) => {
      releasePage = () => resolve({
        items: [child],
        nextCursor: '',
        hasMore: false,
      })
    }),
    (parentID, value) => {
      pageByParentRef.current = {
        ...pageByParentRef.current,
        [String(parentID)]: value,
      }
    },
    (error) => { throw error },
    latestPathCrumbsByIDRef,
  )

  const oldNode = {
    id: oldParent.id,
    name: oldParent.name,
    crumbs: [root, oldParent],
  }
  const pending = loadChildren(oldNode)
  await flushAsync()
  assert.equal(typeof releasePage, 'function')

  latestPathCrumbsByIDRef.current = new Map([
    [newParent.id, [root, newParent]],
  ])

  releasePage()
  await pending

  const loadedChild = pageByParentRef.current[String(oldParent.id)]?.children?.[0]
  assert.ok(loadedChild)
  assert.deepEqual(
    loadedChild.crumbs,
    [root, newParent, child],
    'a tree request started with OldParent must use the latest path crumbs when it commits',
  )
})
