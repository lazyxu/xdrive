const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function parse(relativePath) {
  const filename = path.join(repo, ...relativePath)
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    source,
    sourceFile: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function extractVariableExpression(relativePath, name) {
  const { filename, sourceFile } = parse(relativePath)
  let expression = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      expression = node.initializer.getText(sourceFile)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(expression, 'missing variable expression: ' + name)
  return { filename, expression }
}

function extractJsxHandler(relativePath, componentName, propName) {
  const { filename, sourceFile } = parse(relativePath)
  let expression = null
  const visit = (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === componentName
    ) {
      const attribute = node.attributes.properties.find((candidate) => (
        ts.isJsxAttribute(candidate) &&
        candidate.name.getText(sourceFile) === propName
      ))
      if (
        attribute &&
        ts.isJsxAttribute(attribute) &&
        attribute.initializer &&
        ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression
      ) {
        expression = attribute.initializer.expression.getText(sourceFile)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(expression, 'missing JSX handler: ' + componentName + '.' + propName)
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

test('Desktop create-folder dialog keeps the directory scope that opened it', async () => {
  const openSource = extractJsxHandler(
    ['desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'],
    'XDriveFileExplorer',
    'onCreateFolder',
  )
  const createSource = extractVariableExpression(
    ['desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx'],
    'createFolder',
  )

  const createFolderParentIDRef = { current: null }
  let createOpen = false
  const openCreateFolder = compileExpression(
    openSource.filename,
    'openCreateFolder',
    openSource.expression,
    {
      current: { id: 101 },
      createFolderParentIDRef,
      trashActive: false,
      setCreateOpen: (value) => { createOpen = value },
    },
  )
  openCreateFolder()

  assert.equal(createOpen, true)
  assert.equal(
    createFolderParentIDRef.current,
    101,
    'opening the dialog in directory A must freeze A as the create target',
  )

  const parents = []
  const token = { key: 'create-folder', generation: 1 }
  const createFolder = compileExpression(
    createSource.filename,
    'createFolder',
    createSource.expression,
    {
      current: { id: 202 },
      createFolderParentIDRef,
      actionBusyRef: { current: null },
      fileOperationBusy: false,
      uploadBusy: false,
      beginActionBusy: () => token,
      isActionBusyCurrent: () => true,
      window: {
        xdriveDesktop: {
          agent: {
            cloudCreateDirectory: async (parentID) => {
              parents.push(parentID)
              return { ok: true, data: {} }
            },
          },
        },
      },
      refreshCurrentDirectoryIfCurrent: async () => {},
      onFeedback: () => {},
      finishActionBusy: () => {},
    },
  )

  await createFolder('from-a')

  assert.deepEqual(
    parents,
    [101],
    'navigating to directory B while the dialog is open must not redirect the create request into B',
  )
})

test('Web create-folder dialog keeps the directory scope that opened it', async () => {
  const openSource = extractJsxHandler(
    ['web', 'src', 'App.tsx'],
    'WebFileExplorer',
    'onCreateFolder',
  )
  const createSource = extractVariableExpression(
    ['web', 'src', 'App.tsx'],
    'createFolder',
  )

  const folderParentIDRef = { current: null }
  let folderOpen = false
  const openCreateFolder = compileExpression(
    openSource.filename,
    'openCreateFolder',
    openSource.expression,
    {
      current: { id: 301 },
      folderParentIDRef,
      setFolderOpen: (value) => { folderOpen = value },
    },
  )
  openCreateFolder()

  assert.equal(folderOpen, true)
  assert.equal(
    folderParentIDRef.current,
    301,
    'Web must freeze the directory that opened the create-folder dialog',
  )

  const parents = []
  const createFolder = compileExpression(
    createSource.filename,
    'createFolder',
    createSource.expression,
    {
      current: { id: 302 },
      folderParentIDRef,
      api: {
        createDirectory: async (parentID) => { parents.push(parentID) },
      },
      refreshCurrentDirectory: async () => {},
    },
  )
  await createFolder('from-a')

  assert.deepEqual(
    parents,
    [301],
    'Web navigation while the dialog is open must not move the create request to the new current directory',
  )
})
