const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

// Execute the real production ancestor walker inside the extracted React
// effect. Do not mock away the AbortSignal or Owner/navigation fences.
const resolverFilename = path.join(repo, 'web', 'src', 'routedDirectoryAncestors.ts')
const resolverJS = ts.transpileModule(fs.readFileSync(resolverFilename, 'utf8'), {
  fileName: resolverFilename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const resolverModule = { exports: {} }
new Function('exports', 'module', resolverJS)(resolverModule.exports, resolverModule)
const xDriveResolveRoutedDirectoryAncestors =
  resolverModule.exports.xDriveResolveRoutedDirectoryAncestors

function extractRouteDirectoryEffect() {
  const filename = path.join(repo, 'web', 'src', 'WebFileExplorer.tsx')
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
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments.length >= 2 &&
      node.arguments[0].getText(sourceFile).includes('initialDirectoryID') &&
      node.arguments[0].getText(sourceFile).includes('xDriveResolveRoutedDirectoryAncestors(') &&
      node.arguments[0].getText(sourceFile).includes('api.node(id, signal)')
    ) {
      callback = node.arguments[0].getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(callback, 'missing Web FileExplorer route-directory effect')
  return { filename, callback }
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

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

test('Web route-directory same numeric id must be resolved again after account lifecycle changes', async () => {
  const { filename, callback } = extractRouteDirectoryEffect()
  const routedDirectoryRef = { current: null }
  const internalDirectoryRouteRef = { current: null }
  let navigationGeneration = 0
  const nodeCalls = []
  const navigations = []
  const errors = []

  const beginNavigationIntent = () => {
    navigationGeneration += 1
    return navigationGeneration
  }
  const isNavigationIntentCurrent = (requestID) => (
    requestID === navigationGeneration
  )

  const makeEffect = (account) => compileEffect(filename, callback, {
    initialDirectoryID: 30,
    current: { id: 10 },
    navigationSessionStorageKey: 'files:' + account,
    routedDirectoryRef,
    internalDirectoryRouteRef,
    api: {
      node: async () => {
        nodeCalls.push(account)
        return {
          id: 30,
          parent_id: null,
          name: account + ' route target',
          type: 'dir',
        }
      },
    },
    beginNavigationIntent,
    isNavigationIntentCurrent,
    xDriveResolveRoutedDirectoryAncestors,
    navigateTo: async (crumbs, _record = true, requestID) => {
      const effectiveRequestID = requestID ?? beginNavigationIntent()
      if (!isNavigationIntentCurrent(effectiveRequestID)) return false
      navigations.push({
        account,
        names: crumbs.map((crumb) => crumb.name),
      })
      return true
    },
    onError: (error) => errors.push(
      error instanceof Error ? error.message : String(error),
    ),
  })

  const cleanupA = makeEffect('A')()
  await flushAsync()
  assert.deepEqual(nodeCalls, ['A'])
  assert.deepEqual(navigations, [{
    account: 'A',
    names: ['A route target'],
  }])

  if (typeof cleanupA === 'function') cleanupA()

  const cleanupB = makeEffect('B')()
  await flushAsync()

  assert.deepEqual(
    nodeCalls,
    ['A', 'B'],
    'account B must resolve its own route even when the numeric directory id matches account A',
  )
  assert.deepEqual(
    navigations,
    [
      { account: 'A', names: ['A route target'] },
      { account: 'B', names: ['B route target'] },
    ],
    'same-id route de-duplication must not cross the account-scoped FileExplorer lifecycle',
  )
  assert.deepEqual(errors, [])

  if (typeof cleanupB === 'function') cleanupB()
})
