const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/media-gallery-selection-scope.ts')
const source = fs.readFileSync(file, 'utf8')
const output = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const generated = { exports: {} }
new Function('module', 'exports', output)(generated, generated.exports)
const { xDriveMediaGallerySelectionScopeKey: key } = generated.exports

test('P1-3b responsive sort and sparse-request revisions preserve exact selected scope', () => {
  const selected = {
    kind: 'all', requestID: 16,
    query: { sort_by: 'captured', sort_dir: 'asc', unknown_first: true,
      initial_position: 'latest', anchor_node_id: 1000,
      time_zone: 'UTC', search: 'family', fold_duplicates: false },
  }
  const crossing = {
    kind: 'all', requestID: 23,
    query: { search: 'family', sort_by: 'added', sort_dir: 'desc',
      anchor_node_id: 1002, unknown_first: false,
      fold_duplicates: false, time_zone: 'UTC' },
  }
  assert.equal(key(selected, 'web:owner-1'), key(crossing, 'web:owner-1'))
  assert.notEqual(key(selected, 'web:owner-1'), key(crossing, 'web:owner-2'))
})

test('P1-3b album, filter, time-zone and fold transitions reject a stale selection', () => {
  const base = { kind: 'album', id: 'album-1',
    query: { time_zone: 'UTC', search: 'photo', favorite: true, fold_duplicates: true } }
  const current = key(base, 'web:owner-1')
  const alternative = [
    { ...base, kind: 'all' },
    { ...base, id: 'album-2' },
    { ...base, query: { ...base.query, search: 'travel' } },
    { ...base, query: { ...base.query, favorite: false } },
    { ...base, query: { ...base.query, time_zone: 'Asia/Singapore' } },
    { ...base, query: { ...base.query, fold_duplicates: false } },
    { ...base, query: { ...base.query, captured_from: '2026-10-01' } },
  ]
  for (const target of alternative) assert.notEqual(key(target, 'web:owner-1'), current)
})

test('P1-3b canonical filter ordering and undefined fields do not churn selection', () => {
  const a = { kind: 'all', query: { search: 'photo', favorite: false, asset_kind: 'image',
    sort_dir: 'asc', captured_from: undefined } }
  const b = { kind: 'all', query: { asset_kind: 'image', favorite: false,
    search: 'photo', sort_dir: 'desc' } }
  assert.equal(key(a, 'web:owner-1'), key(b, 'web:owner-1'))
  assert.notEqual(key(null, 'web:owner-1'), key(null, 'web:owner-2'))
})
