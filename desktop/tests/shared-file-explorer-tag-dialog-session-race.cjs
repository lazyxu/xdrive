const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function sourceFile() {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileTagDialog.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    file: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function extractArrow(name) {
  const { filename, file } = sourceFile()
  let expression = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      expression = node.initializer.getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression, 'missing FileTagDialog function: ' + name)
  return { filename, expression }
}

function extractLoadEffect() {
  const { filename, file } = sourceFile()
  let expression = null
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useEffect' &&
      node.arguments[0]?.getText(file).includes('queryNodeTags(nodeIDs)')
    ) {
      expression = node.arguments[0].getText(file)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(expression, 'missing FileTagDialog load effect')
  return { filename, expression }
}

function compileExpression(filename, name, expression, dependencies) {
  const output = ts.transpileModule(
    'const ' + name + ' = ' + expression + ';',
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
  const values = names.map((key) => dependencies[key])
  return new Function(...names, output + '\nreturn ' + name)(...values)
}

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('FileTagDialog lifecycle change invalidates pending local continuations', () => {
  const { filename, expression } = extractLoadEffect()
  const dialogGenerationRef = { current: 4 }
  const effect = compileExpression(filename, 'loadEffect', expression, {
    dialogGenerationRef,
    open: false,
    nodeIDs: [],
    setAssignments: () => {},
    setEditingTagID: () => {},
    setName: () => {},
    setColor: () => {},
    setLoading: () => {},
    setError: () => {},
    queryNodeTags: async () => [],
    defaultTagColor: '#6B7280',
  })

  effect()

  assert.equal(
    dialogGenerationRef.current,
    5,
    'closing/replacing the dialog scope must invalidate pending toggle/create/update continuations',
  )
})

test('FileTagDialog stale toggle completion cannot write account-A tags into account B assignments', async () => {
  const { filename, expression } = extractArrow('toggle')
  const dialogGenerationRef = { current: 7 }
  const pending = deferred()
  const tagA = { id: 1, name: 'A tag', color: '#111111' }
  let assignments = [{ node_id: 2, tags: [] }]
  const errors = []

  const toggle = compileExpression(filename, 'toggle', expression, {
    counts: new Map(),
    nodeIDs: [1],
    setError: (value) => {
      if (value) errors.push(value)
    },
    onSetTag: async () => pending.promise,
    setAssignments: (updater) => {
      assignments = typeof updater === 'function' ? updater(assignments) : updater
    },
    dialogGenerationRef,
  })

  const work = toggle(tagA)
  await flushAsync()

  dialogGenerationRef.current += 1
  assignments = [{ node_id: 2, tags: [] }]

  pending.resolve()
  await work

  assert.deepEqual(
    assignments,
    [{ node_id: 2, tags: [] }],
    'a stale account-A toggle must not mutate assignments already owned by account B',
  )
  assert.deepEqual(errors, [])
})


test('FileTagDialog stale create completion cannot continue assigning account-A tag data after scope change', async () => {
  const { filename, expression } = extractArrow('submitTag')
  const dialogGenerationRef = { current: 11 }
  const pendingCreate = deferred()
  let assignments = [{ node_id: 2, tags: [] }]
  let setTagCalls = 0
  const errors = []
  const nameWrites = []

  const submitTag = compileExpression(filename, 'submitTag', expression, {
    dialogGenerationRef,
    name: 'A tag',
    color: '#111111',
    editingTagID: null,
    nodeIDs: [1],
    setError: (value) => {
      if (value) errors.push(value)
    },
    onUpdateTag: async () => { throw new Error('unused') },
    onCreateTag: async () => pendingCreate.promise,
    onSetTag: async () => { setTagCalls += 1 },
    setAssignments: (updater) => {
      assignments = typeof updater === 'function' ? updater(assignments) : updater
    },
    setEditingTagID: () => {},
    setName: (value) => nameWrites.push(value),
    setColor: () => {},
    defaultTagColor: '#6B7280',
  })

  const work = submitTag()
  await flushAsync()

  dialogGenerationRef.current += 1
  assignments = [{ node_id: 2, tags: [] }]

  pendingCreate.resolve({ id: 1, name: 'A tag', color: '#111111' })
  await work

  assert.equal(
    setTagCalls,
    0,
    'a tag created under account A must not start assignment work after the dialog lifecycle moved to account B',
  )
  assert.deepEqual(assignments, [{ node_id: 2, tags: [] }])
  assert.deepEqual(nameWrites, [])
  assert.deepEqual(errors, [])
})
