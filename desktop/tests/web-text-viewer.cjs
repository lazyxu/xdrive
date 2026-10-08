const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const file = path.join(__dirname, '../../web/src/webTextViewer.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'module', output)(mod.exports, mod)
const { xDriveWebTextSelection } = mod.exports

test('line/column selection never crosses the target line', () => {
  assert.deepEqual(xDriveWebTextSelection('abc\ndefgh\n', 1, 3), { start: 2, end: 3 })
  assert.deepEqual(xDriveWebTextSelection('abc\ndefgh\n', 2, 2), { start: 5, end: 9 })
  assert.deepEqual(xDriveWebTextSelection('abc\ndefgh\n', 2, 99), { start: 9, end: 9 })
})
test('selection excludes CR and clamps line numbers', () => {
  assert.deepEqual(xDriveWebTextSelection('abc\r\ndef', 1, 1), { start: 0, end: 3 })
  assert.deepEqual(xDriveWebTextSelection('abc\r\ndef', 99, 1), { start: 5, end: 8 })
  assert.deepEqual(xDriveWebTextSelection('', 1, 1), { start: 0, end: 0 })
})
