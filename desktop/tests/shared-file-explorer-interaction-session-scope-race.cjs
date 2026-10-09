const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractInteractionCacheKeyExpression() {
  const filename = path.join(
    repo,
    'ui',
    'shared',
    'src',
    'mui',
    'FileExplorerWorkspaceController.ts',
  )
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  let expression = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'interactionCacheKey' &&
      node.initializer
    ) {
      expression = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(expression, 'missing interactionCacheKey expression')
  return { filename, expression }
}

function compileExpression(filename, expression) {
  const output = ts.transpileModule(
    'const compute = () => ' + expression + ';',
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    },
  ).outputText

  return (dependencies) => {
    const names = Object.keys(dependencies)
    const values = names.map((name) => dependencies[name])
    return new Function(
      ...names,
      output + '\nreturn compute()',
    )(...values)
  }
}

function workspaceDependencies(navigationSessionStorageKey) {
  return {
    navigationSessionStorageKey,
    // Keep the entry key identical to isolate account lifecycle ownership.
    workspaceKey: 'same-runtime-entry',
    navigation: {
      activeTabID: 'tab-1',
      grouping: { key: 'none' },
      sort: { key: 'name', direction: 'asc' },
    },
    crumbs: [
      { id: 1, name: '我的文件' },
      { id: 77, name: '相同目录' },
    ],
    search: {
      searchResults: null,
      searchState: {
        query: '',
        filters: {},
      },
    },
    xDriveFileExplorerSearchFiltersSignature: () => '',
    xDriveFileExplorerGroupingSignature: () => 'none',
  }
}

test('FileExplorer interaction cache key changes across account lifecycle even when tab and node ids match', () => {
  const { filename, expression } = extractInteractionCacheKeyExpression()
  const compute = compileExpression(filename, expression)

  const accountA = compute(workspaceDependencies('server-a:user-a'))
  const accountB = compute(workspaceDependencies('server-b:user-b'))

  assert.notEqual(
    accountB,
    accountA,
    'account lifecycle must participate in the interaction scope key so same tab/node ids cannot reuse stale selection, Properties, thumbnail, or projection caches',
  )
})
