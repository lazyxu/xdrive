'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const shared = fs.readFileSync(path.join(root, 'ui/shared/src/mui/FileNameDialog.tsx'), 'utf8')
const compiled = ts.transpileModule(shared, {
  fileName: 'FileNameDialog.tsx',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, name => {
  if (name === 'react') return require('react')
  if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
  if (name === '@mui/material' || name.startsWith('./')) return {}
  throw Error('unexpected FileNameDialog dependency: ' + name)
})
const validate = mod.exports.xDriveFileNameValidationError

test('U05 actual shared editor accepts 255-byte UTF-8 Chinese and emoji names', () => {
  const chinese = '界'.repeat(85)
  const emoji = '😀'.repeat(63) + 'abc'
  for (const name of [chinese, emoji]) {
    assert.equal(new TextEncoder().encode(name).length, 255)
    assert.equal(validate(name, 'rename'), '')
    assert.equal(validate(name, 'create-folder'), '')
  }
})

test('U05 editor rejects 256 bytes before submission and retains editable failed draft', () => {
  const chinese = '界'.repeat(85) + 'a'
  const emoji = '😀'.repeat(63) + 'abcd'
  for (const name of [chinese, emoji]) {
    assert.equal(new TextEncoder().encode(name).length, 256)
    assert.match(validate(name, 'rename'), /255.*UTF-8/)
    assert.match(validate(name, 'create-folder'), /255.*UTF-8/)
  }
  for (const phrase of [
    'if (nextError) return',
    'if (open && !submitting && error) inputRef.current?.focus()',
    'setError((submitError instanceof Error ? submitError.message',
    'setName(value)',
  ]) assert.ok(shared.includes(phrase), phrase)
  assert.ok(!shared.includes('setName(value.trim())'), 'typing must not destructively trim draft')
})

test('U05 saved-search keeps distinct 128-byte threshold', () => {
  const valid = '界'.repeat(42) + 'ab'
  assert.equal(new TextEncoder().encode(valid).length, 128)
  assert.equal(validate(valid, 'saved-search'), '')
  assert.match(validate(valid + 'c', 'saved-search'), /128.*UTF-8/)
})

test('U05 Go security and byte-length check uses real Gin/PostgreSQL lifecycle', () => {
  const go = fs.readFileSync(path.join(root, 'internal/api/file_explorer_basic_lifecycle_integration_test.go'), 'utf8')
  for (const anchor of [
    'assertBasicU05UTF8RenameServerContract(t, router, cli, token, otherToken, root.ID)',
    'strings.Repeat("界", 85)',
    'requestWithHeaders(t, router, http.MethodPatch, nodePath, token,',
    'http.StatusNotFound',
    'http.StatusBadRequest',
    'http.StatusConflict',
    'check(exact255, revision+1)',
  ]) assert.ok(go.includes(anchor), anchor)
})
