const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function extractArrowFunction(name) {
  const filename = path.join(repo, 'ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )

  let initializer = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(initializer, 'missing FileExplorer function: ' + name)
  return { filename, initializer }
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

test('FileExplorer external folder scan cannot start an upload after interaction lifecycle changes', async () => {
  const source = extractArrowFunction('dropExternalFilesOnBackground')
  const pendingRead = deferred()
  const externalDropGenerationRef = { current: 3 }
  let folderUploadCalls = 0
  let dragEndCalls = 0

  const dropExternalFilesOnBackground = compileExpression(
    source.filename,
    'dropExternalFilesOnBackground',
    source.initializer,
    {
      onExternalFilesDrop: async () => {},
      onExternalFolderDrop: async () => {
        folderUploadCalls += 1
      },
      xDriveFileExplorerReadExternalDrop: async () => pendingRead.promise,
      endItemDrag: () => {
        dragEndCalls += 1
      },
      externalDropGenerationRef,
    },
  )

  const event = {
    preventDefault() {},
    dataTransfer: {
      types: ['Files'],
      files: [],
    },
  }

  const pending = dropExternalFilesOnBackground(event)
  await flushAsync()

  externalDropGenerationRef.current += 1

  pendingRead.resolve({
    files: [],
    directories: ['folder'],
  })
  await pending

  assert.equal(
    folderUploadCalls,
    0,
    'a folder scan started in account/scope A must not invoke the upload callback after scope B becomes current',
  )
  assert.equal(
    dragEndCalls,
    1,
    'stale external drops should still release drag UI state',
  )
})


test('all asynchronous external folder-drop entry points fence stale lifecycle generations', () => {
  const names = ['dropOnFolder', 'dropOnCrumb', 'dropExternalFilesOnBackground']
  for (const name of names) {
    const source = extractArrowFunction(name).initializer
    assert.ok(
      source.includes('const externalDropGeneration = externalDropGenerationRef.current'),
      name + ' must capture the FileExplorer lifecycle generation before async scanning',
    )
    assert.ok(
      source.includes('externalDropGenerationRef.current !== externalDropGeneration'),
      name + ' must reject a scan result from a replaced interaction lifecycle',
    )
  }
})
