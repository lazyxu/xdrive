'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
function load(file, modules = {}) {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
  const compiled = ts.transpileModule(src, {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  assert.deepEqual((compiled.diagnostics || []).filter(x =>
    x.category === ts.DiagnosticCategory.Error), [])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, id => {
      assert.ok(Object.hasOwn(modules, id), 'unexpected import ' + id)
      return modules[id]
    })
  return module.exports
}
const range = load('ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts')
const scope = load('ui/shared/src/media-gallery-baidu-map-photo-scope.ts', {
  './media-gallery-baidu-jsapi4-viewport-range': range,
})
const entry = load('ui/shared/src/media-gallery-baidu-map-entry.ts', {
  './media-gallery-baidu-map-photo-scope': scope,
})
const input = (section, query = {}, album = null, extra = {}) => ({
  section, query, album, sort: { by: 'captured', dir: 'desc' },
  timeZone: 'Asia/Tokyo', ...extra,
})

test('root Gallery map can use default prototype only without restricted membership', () => {
  const result = entry.xDriveGalleryMapEntryScope(input('library'))
  assert.equal(result.ok, true)
  assert.equal(result.requiresIsolated, false)
  assert.equal(result.scope.albumKey, '')
  assert.equal(result.scope.filters.sort_by, 'captured')
})
test('Album, favorite, media type and capture dates retain exact Parent scope', () => {
  const a = entry.xDriveGalleryMapEntryScope(input('albums', {
    favorite: true, captured_from: '2026-01-01', captured_to: '2026-12-31',
    sort_by: 'added', fold_duplicates: false,
  }, {id: 'manual:Family Photos', kind: 'manual'}, {
    sort: {by:'added', dir:'asc'},
  }))
  assert.equal(a.ok, true)
  assert.equal(a.requiresIsolated, true)
  assert.equal(a.scope.albumKey, 'manual:Family Photos')
  assert.equal(a.scope.filters.favorite, true)
  assert.equal(a.scope.filters.time_zone, 'Asia/Tokyo')
  assert.equal(a.scope.filters.sort_dir, 'asc')
  const favorites = entry.xDriveGalleryMapEntryScope(input('favorites'))
  assert.equal(favorites.ok, true)
  assert.equal(favorites.scope.filters.favorite, true)
  assert.equal(favorites.requiresIsolated, true)
  const video = entry.xDriveGalleryMapEntryScope(input('media-types',
    {asset_kind:'video'}, null, {activeMediaType:'video'}))
  assert.equal(video.ok, true)
  assert.equal(video.scope.filters.asset_kind, 'video')
})
test('never expand unsupported location, person, search or folded filters', () => {
  for (const [section,q] of [
    ['library',{search:'family'}],
    ['library',{bbox:'116,39,117,40'}],
    ['library',{nearby:'116,40,5'}],
    ['library',{folder_id:123}],
    ['library',{person:'alice'}],
    ['library',{fold_duplicates:true}],
    ['library',{has_location:false}],
    ['library',{asset_kind:'live_photo'}],
    ['library',{favorite:'true'}],
    ['library',{sort_by:'captured', anchor_node_id:0}],
  ]) {
    const result = entry.xDriveGalleryMapEntryScope(input(section,q))
    assert.equal(result.ok,false,section+JSON.stringify(q))
  }
  assert.equal(entry.xDriveGalleryMapEntryScope(input('albums', {}, null)).ok, false)
  assert.equal(entry.xDriveGalleryMapEntryScope(input('memories')).ok, false)
  assert.equal(entry.xDriveGalleryMapEntryScope(input('library', {}, null,
    {hasUnsupportedContext:true})).ok, false)
  assert.equal(entry.xDriveGalleryMapEntryScope(input('media-types', {}, null,
    {activeMediaType:'gif'})).ok, false)
  assert.equal(entry.xDriveGalleryMapEntryScope(input('albums', {}, {
    id: 'untrusted:album',kind: 'manual',
  })).ok,false)
  assert.equal(entry.xDriveGalleryMapEntryScope(input('library',{},null,
    {sort:null})).ok,false)
})
test('scoped map mode changes retain filter protections but allow cleared timezone', () => {
  const map = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')
  assert.ok(map.includes('data-xdrive-map-mode-scope-warning'))
  assert.ok(map.includes("f?.favorite !== undefined"))
  assert.ok(map.includes("f?.sort_by !== 'captured'"))
  assert.ok(!map.includes('xDriveBaiduMapPhotoScopeKey(mapPhotoScope) !=='))
})
test('Owner and private identities never appear in the map entry scope', () => {
  const result = entry.xDriveGalleryMapEntryScope(input('albums', {},
    { id:'manual:Summer',kind:'manual' }))
  assert.equal(result.ok,true)
  assert.ok(!JSON.stringify(result).includes('owner_id'))
  assert.ok(!JSON.stringify(result).includes('wgs84'))
  const wall = range.xDriveBaiduNativeViewportRangeParams(
    {coordinate_space:'bd09ll',west:116,south:39,east:117,north:40},
    48,0,{...result.scope.filters,fold_duplicates:false},result.scope.albumKey)
  assert.ok(wall)
  assert.equal(wall.get('album'),'manual:Summer')
  assert.equal(wall.get('range'),'true')
})
test('Gallery source and map modes do not silently bypass the converter', () => {
  const g = fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  assert.ok(g.includes('if (loading || collectionError || !accepted ||'))
  assert.ok(g.includes("accepted.kind !== 'album' || accepted.id !== currentAlbum.id"))
  assert.ok(g.includes("accepted.kind !== 'all'"))
  assert.ok(g.includes('xDriveGalleryMapEntryScope('))
  assert.ok(g.includes('changeBaiduMapPhotoScope(entry.scope)'))
  assert.ok(g.includes('entry.requiresIsolated'))
  // Electron never opens a new HTTPS window with the untrusted/unsent
  // current Album just because the browser mode URL happens to say isolated.
  assert.ok(g.includes('entry.requiresIsolated && onOpenSecureDesktopMap'))
  assert.ok(g.includes('foldDuplicates || currentFolderView'))
  assert.ok(!g.includes("onShowMap={() => { setMobileCollectionsOverview(false); selectSection('places') }}"))
})

test('map Back restores the original Owner Range before Album UI and scroll anchor', () => {
  const g = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')
  const start = g.indexOf('const leaveCollection = useCallback(')
  const end = g.indexOf('const reviewSuggestedPerson = useCallback(', start)
  assert.ok(start >= 0 && end > start)
  const back = g.slice(start, end)
  assert.ok(back.includes('mapReturn.owner === preferenceScope'))
  assert.ok(back.includes('mapReturn.dataSource === source'))
  assert.ok(back.includes('mapGalleryEntryReturnRef.current === mapReturn'))
  assert.ok(back.includes('Date.now() - mapReturn.createdAt >= 10 * 60 * 1000'))
  assert.ok(back.includes('pendingSortAnchorRef.current = mapReturn.anchorNodeID'))
  assert.ok(back.includes('loadFirstPage(mapReturn.album, {...mapReturn.query}'))
  assert.ok(back.indexOf('loadFirstPage(mapReturn.album,') <
    back.indexOf('setSection(mapReturn.section)'))
  assert.ok(back.includes('routeSectionAppliedRef.current = mapReturn.section'))
  assert.ok(back.includes('mapGalleryEntryReturnRef.current = null'))
  assert.ok(!back.includes("loadFirstPage(null, {}) // map-return"))
  assert.ok(g.includes('canReturnToMapEntry={Boolean(section'))
  assert.ok(g.includes('mapGalleryVisibleAnchorRef.current = {'))
})
