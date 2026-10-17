'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, '../../web/src/App.tsx')
const source = fs.readFileSync(filename, 'utf8')
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer = null
function walk(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      node.name.text === 'uploadFolderFiles' && node.initializer) {
    initializer = node.initializer.getText(ast)
  }
  ts.forEachChild(node, walk)
}
walk(ast)
assert.ok(initializer, 'test the real App uploadFolderFiles callback, not a reimplementation')
function makeHandler(batch) {
  const calls = [], feedback = [], errors = [], refreshed = []
  const dependencies = {
    uploadFolderEntriesTo: async (parentID, entries, directories) => {
      calls.push({ parentID, entries, directories })
      return batch
    },
    setFeedback: (message) => feedback.push(message),
    refreshCurrentDirectory: async (id) => { refreshed.push(id) },
    handleError: (error) => { errors.push(error) },
  }
  const output = ts.transpileModule('const fn = ' + initializer + ';', {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const keys = Object.keys(dependencies)
  const fn = new Function(...keys, output + '\nreturn fn;')(...Object.values(dependencies))
  return { fn, calls, feedback, errors, refreshed }
}
const complete = { started: true, uploaded: 2, skipped: 1, failed: 0, cancelled: false }

test('M08: missing directory relative path is rejected before mutation, not silently flattened', async () => {
  const h = makeHandler(complete)
  const invalid = [{ name: 'first.txt', size: 3, webkitRelativePath: 'Album/first.txt' },
    { name: 'second.txt', size: 3, webkitRelativePath: '' }]
  await h.fn(17, invalid)
  assert.equal(h.calls.length, 0)
  assert.equal(h.refreshed.length, 0)
  assert.equal(h.errors.length, 0)
  assert.equal(h.feedback.length, 1)
  assert.match(h.feedback[0].message, /相对路径.*未上传/)
})
test('M08: valid nested chooser paths reach the unchanged shared uploader, success warns about empty folders', async () => {
  const h = makeHandler(complete)
  const files = [{ name: 'first.txt', size: 3, webkitRelativePath: '相册/第一层/first.txt' },
    { name: 'second.txt', size: 4, webkitRelativePath: '相册/第二层/second.txt' }]
  await h.fn(23, files)
  assert.deepEqual(h.calls[0].entries.map(({ relativePath }) => relativePath), files.map(x => x.webkitRelativePath))
  assert.equal(h.calls[0].parentID, 23)
  assert.deepEqual(h.refreshed, [23])
  assert.equal(h.feedback.length, 1)
  assert.match(h.feedback[0].message, /上传 2、跳过 1/)
  assert.match(h.feedback[0].message, /空目录/)
})
test('M08: no FileList and cancelled picker never claim a completed upload', async () => {
  const h = makeHandler(complete)
  await h.fn(23, null)
  await h.fn(23, [])
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.feedback, [])
  assert.deepEqual(h.refreshed, [])
})
test('M08: cancelled/failed actual group receipt is never overwritten by empty-folder success notice', async () => {
  for (const batch of [
    { ...complete, cancelled: true },
    { ...complete, failed: 1 },
    { ...complete, started: false, uploaded: 0, skipped: 0 },
  ]) {
    const h = makeHandler(batch)
    await h.fn(23, [{ name: 'a.txt', size: 1, webkitRelativePath: 'Folder/a.txt' }])
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.feedback, [])
    assert.deepEqual(h.errors, [])
  }
})
