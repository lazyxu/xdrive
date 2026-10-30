'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/virtual-collection.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual((compiled.diagnostics || [])
  .filter(x => x.category === ts.DiagnosticCategory.Error)
  .map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n')), [])
const unit = { exports: {} }
new Function('exports', 'module', compiled.outputText)(unit.exports, unit)
const {
  xDriveCreateVirtualCollectionSnapshot: create,
  xDriveVirtualCollectionApplyPage: apply,
} = unit.exports

function populated() {
  return apply(create('owner:a:100k', 1), 1, {
    offset: 0, limit: 200, totalCount: 100000,
    items: [{ id: 1, name: 'verified-1' }, { id: 2, name: 'verified-2' }],
  })
}

test('invalid metadata cannot erase previously certified sparse files or change total', () => {
  const old = populated()
  assert.equal(old.totalCount, 100000)
  assert.equal(old.items.get(0)?.name, 'verified-1')
  const page = {
    offset: 200, limit: 200, totalCount: null,
    items: [{ id: 3, name: 'candidate' }],
  }
  for (const invalid of [
    null,
    { ...page, offset: -1 },
    { ...page, offset: NaN },
    { ...page, offset: Number.MAX_SAFE_INTEGER },
    { ...page, limit: 0 },
    { ...page, limit: -1 },
    { ...page, limit: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, items: null },
    { ...page, limit: 1, items: [{ id: 3 }, { id: 4 }] },
    { ...page, totalCount: NaN },
    { ...page, totalCount: -1 },
    { ...page, totalCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, totalCount: 200 },
  ]) {
    const candidate = apply(old, 1, invalid)
    assert.strictEqual(candidate, old, JSON.stringify(invalid),
      'malformed transport data must not become an accepted empty folder')
  }
  assert.equal(old.totalCount, 100000)
  assert.equal(old.items.size, 2)
})

test('count-free valid pages keep the current verified total and positional nodes', () => {
  const old = populated()
  const page = {
    offset: 200, limit: 200, totalCount: null,
    items: [{ id: 3, name: 'valid' }],
  }
  const next = apply(old, 1, page)
  assert.notStrictEqual(next, old)
  assert.equal(next.totalCount, 100000)
  assert.deepEqual(next.items.get(0), { id: 1, name: 'verified-1' })
  assert.deepEqual(next.items.get(200), { id: 3, name: 'valid' })
  assert.equal(next.items.get(201), undefined)
})

test('genuine Owner zero count and changed total still update a current generation', () => {
  const old = populated()
  const empty = apply(old, 1, {
    offset: 0, limit: 200, totalCount: 0, items: [],
  })
  assert.equal(empty.totalCount, 0)
  assert.equal(empty.items.size, 0)
  const stale = apply(old, 0, {
    offset: 0, limit: 200, totalCount: 0, items: [],
  })
  assert.strictEqual(stale, old)
})

test('out-of-bound forged rows are never stored under a trusted count', () => {
  const old = populated()
  assert.strictEqual(apply(old, 1, {
    offset: 99999, limit: 200, totalCount: null, items: [{ id: 3 }, { id: 4 }],
  }), old)
  assert.strictEqual(apply(old, 1, {
    offset: 9, limit: 2, totalCount: 10, items: [{ id: 3 }, { id: 4 }],
  }), old)
})

test('the shared cache reducer has no native transport or content-edit authority', () => {
  assert.doesNotMatch(source, /window\.xdriveDesktop|ipcRenderer|fetch\s*\(|cloudUpload|cloudDelete/)
  assert.match(source, /!Number\.isSafeInteger\(page\.offset \+ page\.limit\)/)
  assert.match(source, /page\.items\.length > page\.limit/)
})
