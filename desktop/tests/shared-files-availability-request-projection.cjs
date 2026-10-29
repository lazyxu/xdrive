'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/file-explorer-availability-request-projection.ts'
const source = fs.readFileSync(path.join(root, file), 'utf8')
const js = ts.transpileModule(source, {
  fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  },
}).outputText
const ref = { exports: {} }
new Function('module', 'exports', js)(ref, ref.exports)
const project = ref.exports.xDriveFileExplorerAvailabilityRequests

function fixture(overrides = {}) {
  return {
    nodes: [{ id: 10, name: 'a.txt' }, { id: 11, name: 'b.txt' }],
    crumbs: [{ name: '我的文件' }, { name: 'Docs' }],
    searchByID: new Map(),
    quickAccess: [], favorites: [], recent: [], navigation: [], columns: [],
    ...overrides,
  }
}

test('the current Files directory projects the same bounded native paths with no transport', () => {
  assert.deepEqual(project(fixture()), [
    { nodeID: 10, path: 'Docs/a.txt' },
    { nodeID: 11, path: 'Docs/b.txt' },
  ])
})

test('verified search then Quick Access/Favorites/Recent/tree/column precedence remains stable', () => {
  const sources = fixture({
    searchByID: new Map([[10, { path: 'Search/10' }]]),
    quickAccess: [{ id: 10, path: 'Quick/10' }],
    favorites: [{ id: 10, path: 'Favorites/10' }],
    recent: [{ id: 10, path: 'Recent/10' }],
    navigation: [{ id: '10', path: 'Tree/10' }],
    columns: [{ id: 10, path: 'Column/10' }],
  })
  assert.deepEqual(project(sources), [
    { nodeID: 10, path: 'Column/10' },
    { nodeID: 11, path: 'Docs/b.txt' },
  ])
  assert.deepEqual(project({ ...sources, columns: [] })[0],
    { nodeID: 10, path: 'Tree/10' })
  assert.deepEqual(project({ ...sources, columns: [], navigation: [] })[0],
    { nodeID: 10, path: 'Recent/10' })
})

test('untrusted list keys never create fake native availability requests', () => {
  const input = fixture({
    nodes: [],
    quickAccess: [
      { id: 0, path: 'zero' }, { id: -1, path: 'negative' },
      { id: 1.5, path: 'fraction' }, { id: '0', path: 'zero-string' },
      { id: '12', path: 'valid-numeric-string' },
      { id: 'not-a-node', path: 'text' }, { id: '', path: 'blank' },
      { id: ' 13', path: 'whitespace' },
      { id: Number.MAX_SAFE_INTEGER + 1, path: 'unsafe' },
      { id: 14, path: '' },
    ],
    columns: [{ id: 21, path: 'Verified/21' }],
  })
  assert.deepEqual(project(input), [
    { nodeID: 12, path: 'valid-numeric-string' },
    { nodeID: 21, path: 'Verified/21' },
  ])
})

test('Desktop consumes the common pure selector and retains real scoped Agent batch', () => {
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/DesktopFileExplorer.tsx'), 'utf8')
  assert.match(desktop, /const availabilityRequests = useMemo\(\(\) => xDriveFileExplorerAvailabilityRequests\(\{/)
  for (const token of ['nodeByID.values()', 'quickAccess.items', 'favorites.items',
    'recent.items', 'navigationAvailabilityItems', 'columnAvailabilityItems']) {
    assert.ok(desktop.includes(token), token)
  }
  assert.match(desktop, /readBatch: paths => hostPort\.browse\.getFileAvailabilityBatch\(paths\)/)
  assert.doesNotMatch(source, /window\.|fetch\s*\(|ipcRenderer|localStorage|Promise|setFileAvailability/)
  const exports = fs.readFileSync(path.join(root, 'ui/shared/src/index.ts'), 'utf8')
  assert.match(exports, /export \* from '\.\/file-explorer-availability-request-projection'/)
})
