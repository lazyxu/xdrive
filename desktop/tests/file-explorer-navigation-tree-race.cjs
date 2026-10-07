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
      loadDirectoryPageGenerationRef,
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
  const loadingIDsRef = { current: new Map() }
  const loadDirectoryPageGenerationRef = { current: 1 }
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
    loadDirectoryPageGenerationRef,
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


test('a replaced navigation-tree loader supersedes an older pending request for the same parent', async () => {
  const callbackSource = callbackInitializer(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx'],
    'loadChildren',
  )
  const makeLoadChildren = compileLoadChildren(callbackSource)

  const root = { id: 1, name: '我的文件' }
  const oldChild = { id: 2, name: 'OldChild' }
  const newChild = { id: 3, name: 'NewChild' }
  const node = {
    id: root.id,
    name: root.name,
    crumbs: [root],
  }
  const pageByParentRef = { current: {} }
  const loadingIDsRef = { current: new Map() }
  const loadDirectoryPageGenerationRef = { current: 1 }
  const latestPathCrumbsByIDRef = {
    current: new Map([[root.id, [root]]]),
  }
  let loadingIDs = new Set()
  let releaseOldPage
  let newLoaderCalls = 0

  const setLoadingIDs = (updater) => {
    loadingIDs = typeof updater === 'function' ? updater(loadingIDs) : updater
  }
  const commitParentPage = (parentID, value) => {
    pageByParentRef.current = {
      ...pageByParentRef.current,
      [String(parentID)]: value,
    }
  }

  const oldLoadChildren = makeLoadChildren(
    pageByParentRef,
    loadingIDsRef,
    setLoadingIDs,
    () => new Promise((resolve) => {
      releaseOldPage = () => resolve({
        items: [oldChild],
        nextCursor: '',
        hasMore: false,
      })
    }),
    commitParentPage,
    (error) => { throw error },
    latestPathCrumbsByIDRef,
    loadDirectoryPageGenerationRef,
  )

  const oldPending = oldLoadChildren(node)
  await flushAsync()
  assert.equal(typeof releaseOldPage, 'function')

  loadDirectoryPageGenerationRef.current += 1

  const newLoadChildren = makeLoadChildren(
    pageByParentRef,
    loadingIDsRef,
    setLoadingIDs,
    async () => {
      newLoaderCalls += 1
      return {
        items: [newChild],
        nextCursor: '',
        hasMore: false,
      }
    },
    commitParentPage,
    (error) => { throw error },
    latestPathCrumbsByIDRef,
    loadDirectoryPageGenerationRef,
  )

  const newPending = newLoadChildren(node)
  await flushAsync()

  assert.equal(
    newLoaderCalls,
    1,
    'a new tree loader generation must not be blocked by an older in-flight request for the same parent',
  )

  await newPending
  releaseOldPage()
  await oldPending

  assert.deepEqual(
    pageByParentRef.current[String(root.id)]?.children?.map((child) => child.name),
    ['NewChild'],
    'an older tree-loader response must not overwrite the page committed by its replacement loader',
  )
})


test('a replaced navigation-tree loader must reload a page already cached by the older generation', async () => {
  const callbackSource = callbackInitializer(
    ['ui', 'shared', 'src', 'mui', 'FileExplorerNavigationPane.tsx'],
    'loadChildren',
  )
  const makeLoadChildren = compileLoadChildren(callbackSource)

  const root = { id: 1, name: '我的文件' }
  const oldChild = { id: 2, name: 'OldChild' }
  const newChild = { id: 3, name: 'NewChild' }
  const node = {
    id: root.id,
    name: root.name,
    crumbs: [root],
  }
  const pageByParentRef = { current: {} }
  const loadingIDsRef = { current: new Map() }
  const loadDirectoryPageGenerationRef = { current: 1 }
  const latestPathCrumbsByIDRef = {
    current: new Map([[root.id, [root]]]),
  }
  let loadingIDs = new Set()
  let newLoaderCalls = 0

  const setLoadingIDs = (updater) => {
    loadingIDs = typeof updater === 'function' ? updater(loadingIDs) : updater
  }
  const commitParentPage = (parentID, value) => {
    pageByParentRef.current = {
      ...pageByParentRef.current,
      [String(parentID)]: value,
    }
  }

  const oldLoadChildren = makeLoadChildren(
    pageByParentRef,
    loadingIDsRef,
    setLoadingIDs,
    async () => ({
      items: [oldChild],
      nextCursor: '',
      hasMore: false,
    }),
    commitParentPage,
    (error) => { throw error },
    latestPathCrumbsByIDRef,
    loadDirectoryPageGenerationRef,
  )

  await oldLoadChildren(node)
  assert.deepEqual(
    pageByParentRef.current[String(root.id)]?.children?.map((child) => child.name),
    ['OldChild'],
  )

  loadDirectoryPageGenerationRef.current += 1

  const newLoadChildren = makeLoadChildren(
    pageByParentRef,
    loadingIDsRef,
    setLoadingIDs,
    async () => {
      newLoaderCalls += 1
      return {
        items: [newChild],
        nextCursor: '',
        hasMore: false,
      }
    },
    commitParentPage,
    (error) => { throw error },
    latestPathCrumbsByIDRef,
    loadDirectoryPageGenerationRef,
  )

  await newLoadChildren(node)

  assert.equal(
    newLoaderCalls,
    1,
    'a page cached by an older tree-loader generation must not suppress the replacement loader',
  )
  assert.deepEqual(
    pageByParentRef.current[String(root.id)]?.children?.map((child) => child.name),
    ['NewChild'],
    'replacement loader must replace children cached by the older generation',
  )
})
