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
  assert.equal(a.requiresIsolated, false)
  assert.equal(a.scope.albumKey, 'manual:Family Photos')
  assert.equal(a.scope.filters.favorite, true)
  assert.equal(a.scope.filters.time_zone, 'Asia/Tokyo')
  assert.equal(a.scope.filters.sort_dir, 'asc')
  const favorites = entry.xDriveGalleryMapEntryScope(input('favorites'))
  assert.equal(favorites.ok, true)
  assert.equal(favorites.scope.filters.favorite, true)
  assert.equal(favorites.requiresIsolated, false)
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
  assert.ok(map.includes('xDriveBaiduMapScopeSurvivesFullReload(scope)'))
  assert.ok(!map.includes("next === 'prototype' && (!approved"))
  // Unrestricted scope can reload directly ONLY before a valid BD-09 camera
  // is available; otherwise both directions use the same one-use handoff.
  assert.match(map,/xDriveBaiduMapScopeSurvivesFullReload\(scope\) &&\s*!xDriveValidBaiduNativeCameraSnapshot\(cameraRef\.current\)/)
  assert.ok(map.indexOf('xDriveBaiduMapScopeSurvivesFullReload(scope)') <
    map.indexOf('window.location.replace(href)'))
  assert.match(map,/onMapModeHandoff\(scope, next, controller.signal,/)
  assert.match(map,/xDrivePlacesMapScopeHandoffURL\(window.location.href, next, ticket\)/)
  assert.match(map,/setModeWarning\('地图状态交接失败/)
  assert.doesNotMatch(map,/localStorage|sessionStorage/)
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
  assert.ok(!g.includes('entry.requiresIsolated'))
  // Electron never opens a new HTTPS window with the untrusted/unsent
  // current Album just because the browser mode URL happens to say isolated.
  // Desktop must send exact signed-map membership to the separately
  // authenticated HTTPS Parent, without falling back to all photos.
  assert.ok(g.includes('if (onOpenSecureDesktopMap) {'))
  assert.ok(g.includes('onOpenSecureDesktopMap(entry.scope)'))
  assert.ok(g.indexOf('if (!entry.ok)') < g.indexOf('onOpenSecureDesktopMap(entry.scope)'))
  assert.ok(!g.includes('onOpenSecureDesktopMap()'))
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

test('both full-document map runtime transitions reject signed Owner scope loss', () => {
  const safe = scope.xDriveBaiduMapScopeSurvivesFullReload
  assert.equal(safe({albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}}),true)
  assert.equal(safe({albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',
    time_zone:'Asia/Tokyo'}}),true)
  for(const scopeValue of [
    {albumKey:'manual:Private',filters:{sort_by:'captured',sort_dir:'desc'}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',favorite:false}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',favorite:true}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',asset_kind:'video'}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',captured_from:'2026-01-01'}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',captured_to:'2026-12-31'}},
    {albumKey:'',filters:{sort_by:'added',sort_dir:'asc'}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'asc'}},
    {albumKey:'',filters:{sort_by:'captured',sort_dir:'desc',owner_id:42}},
    null,
  ]) assert.equal(safe(scopeValue),false,JSON.stringify(scopeValue))
})

test('Viewer location can open map only after current Owner map admission succeeds', () => {
  const gallery = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  const start = gallery.indexOf('  const showMapFromCurrentGallery = () => {')
  const end = gallery.indexOf('\n  const appliedScopeLabel =',start)
  assert.ok(start >= 0 && end > start)
  const source = gallery.slice(start,end)
  // Execute the real shared navigation action with controlled Owner/Range
  // state, not a duplicate authorization implementation.
  const run = (overrides = {}) => {
    const events = []
    const currentSource = {}
    const env = {
      onOpenSecureDesktopMap: undefined,
      collectionTargetRef: {current:{kind:'all',id:'',query:{}}},
      setError: message => { if (message) events.push(['error',message]) },
      leaveBaiduCellWall: () => events.push(['return-to-map']),
      loading: false, collectionError: null, currentAlbum: null,
      xDriveGalleryMapEntryScope: () => ({ok:true,scope:{
        albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'},
      }}),
      section:'library',query:{},
      gallerySortRef:{current:{by:'captured',dir:'desc'}},
      mediaTimeZoneRef:{current:'Asia/Tokyo'},activeMediaType:'',
      foldDuplicates:false,currentFolderView:null,currentSuggestedPerson:null,
      currentPerson:null,currentPet:null,currentMemory:null,currentCleanupReview:null,
      mapGalleryVisibleAnchorRef:{current:null},
      mediaGalleryQuerySignature: () => 'accepted-range',
      preferenceScope:'owner-A', source:currentSource,
      mapGalleryEntryReturnRef:{current:null},
      changeBaiduMapPhotoScope: () => events.push(['map-scope']),
      setMobileCollectionsOverview: () => {},
      selectSection: section => events.push(['section',section]),
      ...overrides,
    }
    const names=Object.keys(env)
    const make=new Function(...names,source+'\nreturn showMapFromCurrentGallery;')
    const perform=make(...names.map(name=>env[name]))
    return {accepted:perform(),events,entry:env.mapGalleryEntryReturnRef.current}
  }
  const accepted=run()
  assert.equal(accepted.accepted,true)
  assert.deepEqual(accepted.events,[['map-scope'],['section','places']])
  assert.equal(accepted.entry.owner,'owner-A')
  assert.equal(accepted.entry.section,'library')
  for(const [label,override] of [
    ['pending Range',{loading:true}],
    ['failed Range',{collectionError:new Error('offline')}],
    ['no accepted owner Range',{collectionTargetRef:{current:null}}],
    ['stale album identity',{collectionTargetRef:{current:{kind:'album',id:'old',query:{}}}}],
    ['unsupported private filters',{xDriveGalleryMapEntryScope:()=>({ok:false})}],
  ]) {
    const denied=run(override)
    assert.equal(denied.accepted,false,label)
    assert.ok(denied.events.length > 0,label)
    assert.ok(denied.events.every(event=>event[0]==='error'),label)
    assert.equal(denied.entry,null,label)
  }
  const cell=run({collectionTargetRef:{current:{kind:'baidu-cell'}}})
  assert.equal(cell.accepted,true)
  assert.deepEqual(cell.events,[['return-to-map']])
  assert.equal(cell.entry,null)
  const viewport=run({collectionTargetRef:{current:{kind:'baidu-viewport'}}})
  assert.equal(viewport.accepted,true)
  assert.deepEqual(viewport.events,[['return-to-map']])
  const desktopEvents=[]
  const desktop=run({onOpenSecureDesktopMap:scope=>desktopEvents.push(scope)})
  assert.equal(desktop.accepted,true)
  assert.equal(desktopEvents.length,1)
  assert.ok(desktop.events.every(event=>event[0]!=='section'))
  assert.equal(desktop.entry,null)
})

test('Viewer->Map keeps preview open on rejection and never widens to an unscoped tab', () => {
  const gallery = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  const marker=gallery.indexOf('      <XDriveMediaGalleryViewer\\n'.replace('\\n','\n'))
  assert.ok(marker >= 0)
  const handler=gallery.slice(marker,gallery.indexOf('positionLabel=',marker))
  assert.match(handler,/onOpenDynamicMap=\{onShowMap && \(showGalleryMapEntry \|\| nativeCellWall\)/)
  assert.match(handler,/if \(!onShowMap\(\)\) return/)
  assert.ok(handler.indexOf('if (!onShowMap()) return') <
    handler.indexOf('closeMediaPreview()'))
  assert.doesNotMatch(handler,/onSectionChange\?\.\('places'\)/)
  const location=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryViewerLocationDialog.tsx'),'utf8')
  // Viewer Info also rejects a missing/stale JS-safe current Node+revision.
  // This is a stricter gate, not a relaxation of the original Owner scope.
  assert.match(location,/disabled=\{!onOpenDynamicMap \|\| !selection\}/)
  assert.match(location,/if \(!validGPS \|\| !selection \|\| !onOpenDynamicMap\) return/)
  assert.match(location,/当前照片集合暂不能安全映射到地图/)
  assert.match(location,/role="status"/)
})

