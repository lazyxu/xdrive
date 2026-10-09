const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8')

function loadSearchModel() {
  const source = read('ui/shared/src/mui/MediaGallerySearchModel.ts')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const record = { exports: {} }
  const mockRequire = (name) => {
    if (name === '../media-timezone') {
      return { xDriveMediaDayKey: (instant) => new Date(instant).toISOString().slice(0, 10) }
    }
    throw new Error('unexpected dependency: ' + name)
  }
  new Function('require', 'module', 'exports', compiled)(
    mockRequire, record, record.exports,
  )
  return record.exports
}

const model = loadSearchModel()

test('G05 applied facet signature ignores sort, IANA zone, folder and transient anchor', () => {
  const a = {
    search: 'river', formats: ['video/mp4', 'image/jpeg'],
    time_zone: 'Asia/Singapore', folder_id: 25,
    sort_by: 'captured', sort_dir: 'desc', anchor_node_id: 19,
  }
  const b = {
    search: 'river', formats: ['image/jpeg', 'video/mp4'],
    time_zone: 'Europe/Berlin', folder_id: 999,
    sort_by: 'added', sort_dir: 'asc',
  }
  assert.equal(model.xDriveGalleryFilterSignature(a), model.xDriveGalleryFilterSignature(b))
  assert.notEqual(
    model.xDriveGalleryFilterSignature(a),
    model.xDriveGalleryFilterSignature({ ...b, search: 'sea' }),
  )
})

test('G05 chips describe only committed query fields and respect locked navigation', () => {
  const chips = model.xDriveGalleryAppliedChips({
    search: 'lake', favorite: false, has_location: false,
    cameras: ['apple iphone'], formats: ['image/heic'], folder_id: 4,
    captured_from: '2026-10-08T00:00:00Z',
    captured_to: '2026-10-10T00:00:00Z',
  }, { timeZone: 'UTC', locked: ['favorite'] })
  const byKey = Object.fromEntries(chips.map((chip) => [chip.key, chip]))
  assert.equal(byKey.search.label, '搜索：lake')
  assert.equal(byKey.favorite.label, '未收藏')
  assert.equal(byKey.favorite.removable, false)
  assert.equal(byKey.has_location.label, '无 GPS')
  assert.equal(byKey.captured_to.label, '拍摄至：2026-10-09')
  assert.equal(byKey.folder_id, undefined)
  assert.equal(byKey.sort_by, undefined)
})

test('G05 recent search suggestions are account-scoped, bounded and optional', () => {
  const old = global.window
  const memory = new Map()
  global.window = {
    localStorage: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
    },
  }
  try {
    assert.deepEqual(model.xDriveGalleryRecentSearches('user A'), [])
    model.xDriveGalleryRememberSearch('user A', ' Sunset ')
    model.xDriveGalleryRememberSearch('user A', 'sunset')
    for (let i = 0; i < 15; i += 1) {
      model.xDriveGalleryRememberSearch('user A', 'search ' + i)
    }
    assert.equal(model.xDriveGalleryRecentSearches('user A').length, 8)
    assert.equal(model.xDriveGalleryRecentSearches('user A')[0], 'search 14')
    assert.deepEqual(model.xDriveGalleryRecentSearches('user B'), [])
    model.xDriveGalleryRememberSearch('', 'private')
    assert.equal(memory.has('xdrive.gallery.recent-searches.v1:'), false)
  } finally {
    if (old === undefined) delete global.window
    else global.window = old
  }
})

test('G05 UI separates draft from applied state, shows query scope and exact range total', () => {
  const page = read('ui/shared/src/mui/MediaGallery.tsx')
  const toolbar = read('ui/shared/src/mui/MediaGalleryFilters.tsx')
  assert.match(page, /const appliedFilterQuery = currentAlbum/)
  assert.match(page, /xDriveGalleryFilterSignature\(/)
  assert.match(page, /filtersActive=\{xDriveGalleryAppliedChips\(appliedFilterQuery\)\.length > 0\}/)
  assert.match(page, /data-xdrive-gallery-search-feedback/)
  assert.match(page, /data-xdrive-gallery-applied-filter/)
  assert.match(page, /data-xdrive-gallery-pending-filters/)
  assert.match(page, /logicalItemCount\.toLocaleString\('zh-CN'\)/)
  assert.match(page, /setSearchOrder\(range\.search_order \?\? ''\)/)
  assert.match(page, /xDriveGalleryRememberSearch\(preferenceScope, target\.query\.search\)/)
  assert.match(page, /索引覆盖尚未核验/)
  assert.match(toolbar, /data-xdrive-gallery-recent-search/)
  assert.match(toolbar, /recentSearches\.filter/)
})
