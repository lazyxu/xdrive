const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/mui/MediaGalleryAlbumOrganization.ts')
const content = fs.readFileSync(file, 'utf8')
const compiled = ts.transpileModule(content, {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const loaded = new Module(file, module)
loaded.filename = file
loaded.paths = Module._nodeModulePaths(path.dirname(file))
loaded._compile(compiled, file)
const {
  normalizeMediaAlbumPreferences, mediaAlbumPreferencesKey, sortedMediaAlbums,
  changeAlbumPin, moveAlbum, readMediaAlbumPreferences, writeMediaAlbumPreferences,
} = loaded.exports

const albums = [
  { id: 'manual:b', name: '北京', kind: 'manual', item_count: 3, updated_at: '2026-10-03T00:00:00Z' },
  { id: 'smart:z', name: '旅行', kind: 'smart', item_count: 7, updated_at: '2026-10-06T00:00:00Z' },
  { id: 'manual:a', name: 'Animals', kind: 'manual', item_count: 12, updated_at: '2026-10-02T00:00:00Z' },
]
const ids = (items) => items.map((item) => item.id)

test('G04 album search and order do not alter source albums or duplicate membership', () => {
  const defaultPrefs = normalizeMediaAlbumPreferences(null)
  assert.deepEqual(defaultPrefs, { sort: 'name', pinned: [], order: [] })
  const oldIDs = ids(albums)
  const byName = sortedMediaAlbums(albums, defaultPrefs)
  assert.deepEqual(ids(byName.pinned), [])
  assert.deepEqual(ids(byName.other), ['manual:b', 'smart:z', 'manual:a'])
  assert.deepEqual(ids(albums), oldIDs)
  assert.deepEqual(ids(sortedMediaAlbums(albums, defaultPrefs, '北').other), ['manual:b'])
  assert.deepEqual(ids(sortedMediaAlbums(albums, defaultPrefs, '无').other), [])
  const count = sortedMediaAlbums(albums, { ...defaultPrefs, sort: 'count' })
  assert.deepEqual(ids(count.other), ['manual:a', 'smart:z', 'manual:b'])
  const recent = sortedMediaAlbums(albums, { ...defaultPrefs, sort: 'recent' })
  assert.deepEqual(ids(recent.other), ['smart:z', 'manual:b', 'manual:a'])
})

test('G04 pin order and custom reordering survive inserted albums', () => {
  const normal = normalizeMediaAlbumPreferences(null)
  const pinned = changeAlbumPin(albums, normal, 'smart:z')
  assert.deepEqual(pinned.pinned, ['smart:z'])
  const pinnedAgain = changeAlbumPin(albums, pinned, 'manual:b')
  assert.deepEqual(ids(sortedMediaAlbums(albums, pinnedAgain).pinned), ['smart:z', 'manual:b'])
  const moved = moveAlbum(albums, pinnedAgain, 'manual:b', -1)
  assert.deepEqual(moved.pinned, ['manual:b', 'smart:z'])
  assert.equal(moved.sort, 'name')
  const unpinned = changeAlbumPin(albums, moved, 'manual:b')
  assert.deepEqual(unpinned.pinned, ['smart:z'])

  const manuallySorted = moveAlbum(albums, normal, 'smart:z', -1)
  assert.equal(manuallySorted.sort, 'manual')
  assert.deepEqual(ids(sortedMediaAlbums(albums, manuallySorted).other), [
    'smart:z', 'manual:b', 'manual:a',
  ])
  const plusAlbum = [{ id: 'manual:new', name: '新建相册', item_count: 2 }, ...albums]
  assert.deepEqual(ids(sortedMediaAlbums(plusAlbum, manuallySorted).other).slice(0, 3), [
    'smart:z', 'manual:b', 'manual:a',
  ])
})

test('G04 validates persisted selections and isolates account keys', () => {
  const aKey = mediaAlbumPreferencesKey('web:accountA')
  const bKey = mediaAlbumPreferencesKey('web:accountB')
  assert.notEqual(aKey, bKey)
  const decoded = normalizeMediaAlbumPreferences({
    sort: 'unexpected', pinned: ['manual:a', 'manual:a', 12, ''], order: ['manual:b', null],
  })
  assert.deepEqual(decoded, { sort: 'name', pinned: ['manual:a'], order: ['manual:b'] })
  const prev = global.window
  const storage = new Map()
  global.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value) },
    },
  }
  try {
    writeMediaAlbumPreferences('web:accountA', { sort: 'count', pinned: ['manual:a'], order: [] })
    assert.deepEqual(readMediaAlbumPreferences('web:accountA').pinned, ['manual:a'])
    assert.deepEqual(readMediaAlbumPreferences('web:accountB').pinned, [])
  } finally {
    if (prev === undefined) delete global.window
    else global.window = prev
  }
})

test('G04 album organizer shares one Web/Desktop component, scoped to the signed-in account', () => {
  const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const organization = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx'), 'utf8')
  const web = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8')
  const desktop = fs.readFileSync(path.join(root, 'desktop/src/renderer/App.tsx'), 'utf8')
  assert.match(gallery, /<XDriveMediaGalleryAlbumOrganizer/)
  assert.match(organization, /data-xdrive-gallery-album-search/)
  assert.match(organization, /data-xdrive-gallery-album-pin/)
  assert.match(organization, /data-xdrive-gallery-album-sort/)
  assert.match(organization, /data-xdrive-gallery-album-move-up/)
  assert.match(gallery, /key=\{preferenceScope \|\| 'gallery-default'\}/)
  assert.match(web, /preferenceScope=\{\x60web:\$\{profile\?\.id \?\? username\}\x60\}/)
  assert.match(desktop, /preferenceScope=\{\x60desktop:\$\{status\?\.server/)
  assert.doesNotMatch(organization, /mediaItemRange|new Array\(100000\)/)
})
