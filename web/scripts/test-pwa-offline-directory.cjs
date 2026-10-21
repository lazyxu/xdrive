const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../src/pwaOfflineDirectory.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
vm.runInNewContext(js, {
  exports: exportsObject,
  TextEncoder,
  Set, Date, Number, Array, Error, JSON, Promise,
}, { filename: sourcePath })
const {
  xDrivePwaNormalizeVisitedDirectory: normalize,
  xDrivePwaBoundedDirectories: bound,
  XDRIVE_PWA_OFFLINE_MAX_DIRECTORIES: maxDirs,
  XDRIVE_PWA_OFFLINE_MAX_ITEMS_PER_DIRECTORY: maxPerDir,
  XDRIVE_PWA_OFFLINE_MAX_ITEMS: maxTotal,
} = exportsObject

function fixture(id, size = 3) {
  return normalize({
    id, name: 'Folder ' + id, capturedAt: 1792593900000, totalCount: 100000,
    items: Array.from({ length: size }, (_, n) => ({
      id: id * 1000 + n + 1, name: 'safe-' + n, type: 'file', size: 22,
      revision: 2, updated_at: '2026-10-21T12:00:00Z',
      access_token: 'private', sha256: 'private', url: 'https://private.invalid',
      metadata: { exif: 'private' }, content: 'private', blob: 'private',
    })),
  })
}

test('directory projection selects strictly public metadata fields, not Node extras', () => {
  const dir = fixture(10)
  assert.ok(dir)
  assert.equal(dir.partial, true)
  assert.equal(dir.totalCount, 100000)
  assert.equal(dir.items.length, 3)
  const allowed = ['id', 'name', 'type', 'size', 'revision', 'updated_at']
  assert.deepEqual(Object.keys(dir.items[0]).sort(), allowed.sort())
  const serialized = JSON.stringify(dir)
  for (const forbidden of ['access_token', 'sha256', 'private', 'url', 'exif', 'blob', 'content']) {
    assert.ok(!serialized.includes(forbidden), forbidden)
  }
})

test('100k source rows are bounded without duplicating their metadata', () => {
  const huge = Array.from({ length: 100000 }, (_, i) => ({
    id: i + 1, name: 'JPEG-' + i, type: 'file', size: 100,
    sha256: 'never-persist',
  }))
  const result = normalize({ id: 1, name: 'Photos', items: huge, totalCount: 100000 })
  assert.equal(result.capturedCount, maxPerDir)
  assert.equal(result.partial, true)
  assert.equal(result.totalCount, 100000)
  assert.ok(!JSON.stringify(result).includes('never-persist'))
})

test('invalid or duplicate children, control characters and invalid dates are filtered', () => {
  const dir = normalize({
    id: 1, name: 'valid',
    items: [
      { id: 7, name: 'a\u0000b', type: 'dir', size: -1, revision: -4, updated_at: 'secret' },
      { id: 7, name: 'dup', type: 'file' },
      { id: 0, name: 'invalid', type: 'file' },
      { id: 9, name: '', type: 'file' },
      { id: 11, name: 'bad', type: 'link' },
    ],
  })
  assert.equal(dir.items.length, 1)
  assert.equal(dir.items[0].name, 'ab')
  assert.equal(dir.items[0].size, 0)
  assert.equal(dir.items[0].revision, 0)
  assert.ok(!('updated_at' in dir.items[0]))
  assert.equal(normalize({ id: -1, name: 'bad', items: [] }), null)
})

test('complete account budget caps directory count and total rows', () => {
  const dirs = Array.from({ length: 20 }, (_, i) => fixture(i + 1, 20))
  const result = bound(dirs[0], dirs.slice(1))
  assert.equal(result.length, maxDirs)
  assert.ok(result.reduce((sum, dir) => sum + dir.items.length, 0) <= maxTotal)
  assert.equal(bound(dirs[0], [dirs[0], dirs[1]]).length, 2)
})

test('storage is opt-in, never touched by merely importing the module', () => {
  // This test VM intentionally provides no window, indexedDB or CacheStorage.
  assert.equal(exportsObject.xDrivePwaOfflineAvailable(), false)
  assert.ok(!source.includes('caches.open('))
  assert.ok(!source.includes('skipWaiting('))
  assert.ok(!source.includes('localStorage.setItem('))
})
