const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function readDesktopExplorer() {
  const filename = path.join(repo, 'desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  return { filename, sourceFile }
}

function extractVariableInitializer(name) {
  const { filename, sourceFile } = readDesktopExplorer()
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
  assert.ok(initializer, 'missing variable initializer: ' + name)
  return { filename, initializer }
}

function extractInputChangeHandler(refName) {
  const { filename, sourceFile } = readDesktopExplorer()
  let handler = null
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'input') {
      let refMatches = false
      let onChange = null
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const name = attribute.name.getText(sourceFile)
        if (name === 'ref' && attribute.initializer?.getText(sourceFile).includes(refName)) {
          refMatches = true
        }
        if (name === 'onChange' && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          onChange = attribute.initializer.expression?.getText(sourceFile) ?? null
        }
      }
      if (refMatches && onChange) {
        handler = onChange
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(handler, 'missing input onChange handler for ' + refName)
  return { filename, handler }
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

test('Desktop FileExplorer file picker keeps the parent directory that opened it', async () => {
  const uploadSource = extractVariableInitializer('uploadFiles')
  const inputSource = extractInputChangeHandler('uploadInputRef')

  const uploadPickerParentIDRef = { current: null }
  let clicks = 0
  const uploadInputRef = {
    current: {
      click: () => { clicks += 1 },
    },
  }

  const uploadFiles = compileExpression(
    uploadSource.filename,
    'uploadFiles',
    uploadSource.initializer,
    {
      current: { id: 10 },
      actionBusyRef: { current: null },
      fileOperationBusy: false,
      uploadBusy: false,
      uploadConflictSupported: true,
      uploadInputRef,
      uploadPickerParentIDRef,
    },
  )

  await uploadFiles()
  assert.equal(clicks, 1)

  const calls = []
  const onChange = compileExpression(
    inputSource.filename,
    'onChange',
    inputSource.handler,
    {
      current: { id: 20 },
      uploadPickerParentIDRef,
      uploadConflictAwareFiles: async (parentID, files, action) => {
        calls.push({ parentID, files, action })
      },
    },
  )

  const file = { name: 'picked.txt', size: 3 }
  onChange({
    target: {
      files: [file],
      value: 'picked.txt',
    },
  })

  await Promise.resolve()
  await Promise.resolve()

  assert.equal(
    calls[0]?.parentID,
    10,
    'picker completion must upload to the directory that opened the picker, not the directory that became current while the OS dialog was open',
  )
  assert.equal(calls[0]?.action, 'upload')
})


test('Desktop FileExplorer folder picker keeps the parent directory that opened it', async () => {
  const openSource = extractVariableInitializer('openFolderUploadPicker')
  const inputSource = extractInputChangeHandler('folderUploadInputRef')

  const folderUploadPickerParentIDRef = { current: null }
  let clicks = 0
  const folderUploadInputRef = {
    current: {
      click: () => { clicks += 1 },
    },
  }

  const openFolderUploadPicker = compileExpression(
    openSource.filename,
    'openFolderUploadPicker',
    openSource.initializer,
    {
      current: { id: 10 },
      actionBusyRef: { current: null },
      fileOperationBusy: false,
      uploadBusy: false,
      uploadConflictSupported: true,
      folderUploadInputRef,
      folderUploadPickerParentIDRef,
    },
  )

  openFolderUploadPicker()
  assert.equal(clicks, 1)

  const calls = []
  const onChange = compileExpression(
    inputSource.filename,
    'onChange',
    inputSource.handler,
    {
      current: { id: 20 },
      folderUploadPickerParentIDRef,
      uploadFolderFiles: async (parentID, files) => {
        calls.push({ parentID, files })
      },
    },
  )

  const file = { name: 'folder/a.txt', size: 3, webkitRelativePath: 'folder/a.txt' }
  onChange({
    target: {
      files: [file],
      value: 'folder',
    },
  })

  await Promise.resolve()
  await Promise.resolve()

  assert.equal(
    calls[0]?.parentID,
    10,
    'folder picker completion must resolve targets under the directory that opened the picker',
  )
})
