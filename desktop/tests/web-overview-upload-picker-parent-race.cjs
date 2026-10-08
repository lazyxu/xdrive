const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function readSourceFile() {
  const filename = path.join(repo, 'web', 'src', 'WebOverviewPage.tsx')
  const source = fs.readFileSync(filename, 'utf8')
  return {
    filename,
    sourceFile: ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  }
}

function jsxAttributeExpression(node, name, sourceFile) {
  const attribute = node.attributes.properties.find((property) => (
    ts.isJsxAttribute(property) &&
    property.name.text === name
  ))
  if (
    !attribute ||
    !ts.isJsxAttribute(attribute) ||
    !attribute.initializer ||
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  ) return null
  return attribute.initializer.expression.getText(sourceFile)
}

function extractOverviewPickerCallbacks() {
  const { filename, sourceFile } = readSourceFile()
  let fileInputOnChange = null
  let folderInputOnChange = null
  let openFilesPicker = null
  let openFolderPicker = null

  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile)
      if (tag === 'input') {
        const ref = jsxAttributeExpression(node, 'ref', sourceFile)
        const onChange = jsxAttributeExpression(node, 'onChange', sourceFile)
        if (ref === 'uploadInputRef') fileInputOnChange = onChange
        if (ref?.includes('folderUploadInputRef')) folderInputOnChange = onChange
      }
      if (tag === 'XDriveHomePage') {
        openFilesPicker = jsxAttributeExpression(node, 'onUploadFiles', sourceFile)
        openFolderPicker = jsxAttributeExpression(node, 'onUploadFolder', sourceFile)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  assert.ok(fileInputOnChange, 'missing Overview file input onChange handler')
  assert.ok(folderInputOnChange, 'missing Overview folder input onChange handler')
  assert.ok(openFilesPicker, 'missing Overview upload action handler')
  assert.ok(openFolderPicker, 'missing Overview folder-upload action handler')

  return {
    filename,
    fileInputOnChange,
    folderInputOnChange,
    openFilesPicker,
    openFolderPicker,
  }
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

test('Web Overview file picker keeps the parent captured when the picker opened', async () => {
  const callbacks = extractOverviewPickerCallbacks()
  const uploadInputRef = {
    current: {
      click() {},
    },
  }
  const uploadPickerParentIDRef = { current: null }
  const uploads = []
  const files = { length: 1, 0: { name: 'a.txt' } }

  const openPicker = compileExpression(
    callbacks.filename,
    'openPicker',
    callbacks.openFilesPicker,
    {
      uploadInputRef,
      uploadPickerParentIDRef,
      uploadParentID: 10,
      onOpenFiles: () => {},
    },
  )

  openPicker()

  assert.equal(
    uploadPickerParentIDRef.current,
    10,
    'opening the Overview picker must capture the current parent before navigation can change',
  )

  const inputOnChange = compileExpression(
    callbacks.filename,
    'inputOnChange',
    callbacks.fileInputOnChange,
    {
      uploadPickerParentIDRef,
      onUploadFiles: async (...args) => {
        uploads.push(args)
      },
    },
  )

  await inputOnChange({
    target: {
      files,
      value: 'selected',
    },
  })

  assert.deepEqual(
    uploads,
    [[10, files]],
    'file selection must upload to the directory that owned the picker when it opened',
  )
  assert.equal(uploadPickerParentIDRef.current, null)
})

test('Web Overview folder picker keeps the parent captured when the picker opened', async () => {
  const callbacks = extractOverviewPickerCallbacks()
  const folderUploadInputRef = {
    current: {
      click() {},
    },
  }
  const folderUploadPickerParentIDRef = { current: null }
  const uploads = []
  const files = { length: 1, 0: { name: 'folder/file.txt' } }

  const openPicker = compileExpression(
    callbacks.filename,
    'openPicker',
    callbacks.openFolderPicker,
    {
      folderUploadInputRef,
      folderUploadPickerParentIDRef,
      uploadParentID: 10,
      onOpenFiles: () => {},
    },
  )

  openPicker()

  assert.equal(
    folderUploadPickerParentIDRef.current,
    10,
    'opening the Overview folder picker must capture the current parent',
  )

  const inputOnChange = compileExpression(
    callbacks.filename,
    'inputOnChange',
    callbacks.folderInputOnChange,
    {
      folderUploadPickerParentIDRef,
      onUploadFolderFiles: async (...args) => {
        uploads.push(args)
      },
    },
  )

  await inputOnChange({
    target: {
      files,
      value: 'selected',
    },
  })

  assert.deepEqual(uploads, [[10, files]])
  assert.equal(folderUploadPickerParentIDRef.current, null)
})
