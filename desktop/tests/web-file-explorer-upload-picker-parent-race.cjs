const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function readWebExplorer() {
  const filename = path.join(repo, 'web', 'src', 'WebFileExplorer.tsx')
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
  const { filename, sourceFile } = readWebExplorer()
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
  const { filename, sourceFile } = readWebExplorer()
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

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

test('Web FileExplorer file picker consumes the parent directory captured when it opened', async () => {
  const source = extractInputChangeHandler('uploadInputRef')
  const uploadPickerParentIDRef = { current: 10 }
  const calls = []
  const onChange = compileExpression(
    source.filename,
    'onChange',
    source.handler,
    {
      uploadPickerParentIDRef,
      onUploadFiles: async (parentID, files) => {
        calls.push({ parentID, files })
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
  await flushAsync()

  assert.equal(
    calls[0]?.parentID,
    10,
    'Web picker completion must not defer parent resolution to the latest FileManager current directory',
  )
})

test('Web FileExplorer folder picker consumes the parent directory captured when it opened', async () => {
  const source = extractInputChangeHandler('folderUploadInputRef')
  const folderUploadPickerParentIDRef = { current: 10 }
  const calls = []
  const onChange = compileExpression(
    source.filename,
    'onChange',
    source.handler,
    {
      folderUploadPickerParentIDRef,
      onUploadFolderFiles: async (parentID, files) => {
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
  await flushAsync()

  assert.equal(
    calls[0]?.parentID,
    10,
    'Web folder picker completion must retain the directory that opened the OS picker',
  )
})


test('Web FileExplorer file picker captures current parent before opening', () => {
  const source = extractVariableInitializer('openUploadPicker')
  const uploadPickerParentIDRef = { current: null }
  let clicks = 0
  const openUploadPicker = compileExpression(
    source.filename,
    'openUploadPicker',
    source.initializer,
    {
      current: { id: 10 },
      uploadPickerParentIDRef,
      uploadInputRef: { current: { click: () => { clicks += 1 } } },
    },
  )

  openUploadPicker()

  assert.equal(uploadPickerParentIDRef.current, 10)
  assert.equal(clicks, 1)
})

test('Web FileExplorer folder picker captures current parent before opening', () => {
  const source = extractVariableInitializer('openFolderUploadPicker')
  const folderUploadPickerParentIDRef = { current: null }
  let clicks = 0
  const openFolderUploadPicker = compileExpression(
    source.filename,
    'openFolderUploadPicker',
    source.initializer,
    {
      current: { id: 10 },
      folderUploadPickerParentIDRef,
      folderUploadInputRef: { current: { click: () => { clicks += 1 } } },
    },
  )

  openFolderUploadPicker()

  assert.equal(folderUploadPickerParentIDRef.current, 10)
  assert.equal(clicks, 1)
})
