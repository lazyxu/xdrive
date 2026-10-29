'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')
const root=path.resolve(__dirname,'../..')
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
function load(file,modules={}) {
  const parsed=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}})
  assert.deepEqual((parsed.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error),[])
  const output={exports:{}}
  new Function('module','exports','require',parsed.outputText)(output,output.exports,id=>{
    assert.ok(Object.hasOwn(modules,id),'unexpected runtime import '+id)
    return modules[id]
  })
  return output.exports
}
const range=load('ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts')
const scope=load('ui/shared/src/media-gallery-baidu-map-photo-scope.ts',{
  './media-gallery-baidu-jsapi4-viewport-range':range,
})
const cellReturn=load('ui/shared/src/media-gallery-baidu-cell-return-session.ts',{
  './media-gallery-baidu-map-photo-scope':scope,
})
const viewportReturn=load('ui/shared/src/media-gallery-baidu-viewport-return-session.ts',{
  './media-gallery-baidu-map-photo-scope':scope,
})
const bd09={coordinate_space:'bd09ll',west:116,south:39,east:117,north:40}
const source={filters:{sort_by:'added',sort_dir:'asc',favorite:true,asset_kind:'image',
  captured_from:'2026-01-01',captured_to:'2026-12-31',time_zone:'Asia/Tokyo'},
  albumKey:'manual:Family Trip'}
const copy=v=>JSON.parse(JSON.stringify(v))
test('BD09 selected filters use the exact same Owner Cells and full-viewport query',()=>{
  const approved=scope.xDriveNormalizeBaiduMapPhotoScope(source)
  assert.ok(approved)
  const cells=range.xDriveBaiduNativeCellsFilterParams(bd09,approved.filters,approved.albumKey)
  const wall=range.xDriveBaiduNativeViewportRangeParams(
    bd09,48,0,{...approved.filters,fold_duplicates:false},approved.albumKey)
  assert.ok(cells&&wall)
  for(const [key,value] of cells.entries())
    assert.equal(wall.get(key),value,key)
  assert.equal(wall.get('range'),'true')
  assert.equal(cells.get('range'),null)
  assert.equal(cells.get('album'),'manual:Family Trip')
  assert.equal(cells.get('coordinate_space'),null)
  assert.equal(cells.get('owner_id'),null)
})
test('map filter snapshot refuses unknown filters, forged CRS and album identities',()=>{
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,filters:{
    ...source.filters,bbox:'116,39,117,40',
  }}),null)
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,filters:{
    ...source.filters,fold_duplicates:true,
  }}),null)
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,albumKey:'not-an-album'}),null)
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,albumKey:'manual:'}),null)
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,albumKey:'manual:'+ 'x'.repeat(550)}),null)
  assert.equal(scope.xDriveNormalizeBaiduMapPhotoScope({...source,filters:{
    ...source.filters,favorite:'true',
  }}),null)
  const accepted=scope.xDriveNormalizeBaiduMapPhotoScope(source)
  assert.ok(accepted)
  const duplicate=scope.xDriveCopyBaiduMapPhotoScope(accepted)
  assert.notEqual(duplicate.filters,accepted.filters)
  assert.equal(scope.xDriveBaiduMapPhotoScopeKey(source),
    scope.xDriveBaiduMapPhotoScopeKey(duplicate))
  assert.notEqual(scope.xDriveBaiduMapPhotoScopeKey({
    ...source,filters:{...source.filters,favorite:false},
  }),scope.xDriveBaiduMapPhotoScopeKey(source))
})
test('Cell Viewer return freezes the exact filtered scope, not caller-mutated filters',()=>{
  const selected={bounds:bd09,cell_x:1,cell_y:2,asset_id:11,node_id:22,
    node_revision:3,photo_count:2}
  const input={selection:selected,sort:{by:'added',dir:'asc'},photoScope:copy(source)}
  assert.equal(cellReturn.xDriveRememberBaiduCellReturn('owner-a',input,1000),true)
  assert.equal(cellReturn.xDriveMarkBaiduCellViewerReturn('owner-a',22,0,1001),true)
  input.photoScope.filters.favorite=false
  assert.equal(cellReturn.xDriveTakeBaiduCellViewerReturn('owner-b',1002),undefined)
  const returned=cellReturn.xDriveTakeBaiduCellViewerReturn('owner-a',1002)
  assert.equal(returned.photoScope.filters.favorite,true)
  assert.equal(returned.photoScope.albumKey,'manual:Family Trip')
  assert.equal(returned.anchorNodeID,22)
  assert.equal(cellReturn.xDriveTakeBaiduCellViewerReturn('owner-a',1003),undefined)
  cellReturn.xDriveClearBaiduCellReturn('owner-a')
})
test('Current-map Viewer return carries the original BD09 bounds and filters',()=>{
  const input={bounds:bd09,sort:{by:'added',dir:'asc'},photoScope:copy(source)}
  assert.equal(viewportReturn.xDriveRememberBaiduViewportReturn('owner-a',input,1000),true)
  assert.equal(viewportReturn.xDriveMarkBaiduViewportViewerReturn('owner-a',22,0,1001),true)
  input.photoScope.filters.favorite=false
  const returned=viewportReturn.xDriveTakeBaiduViewportViewerReturn('owner-a',1002)
  assert.ok(returned)
  assert.deepEqual(returned.bounds,bd09)
  assert.equal(returned.photoScope.filters.favorite,true)
  assert.equal(returned.photoScope.albumKey,'manual:Family Trip')
  viewportReturn.xDriveClearBaiduViewportReturn('owner-a')
})
test('trusted Parent cancels stale Camera generations without remounting provider Child',()=>{
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  for(const s of [
    'approved.key!==filterRef.current.key',
    'run!==generation',
    'activeQuery?.abort()',
    'acceptedScope.current = null',
  ]) assert.ok(surface.includes(s),s)
  assert.ok(surface.includes('listOwnerCells(bounds,request.signal,'))
  assert.ok(surface.includes('refreshFilteredCells.current?.()'))
  assert.ok(surface.includes('openVerifiedCell(pin.selection)'))
  assert.ok(map.includes('data-xdrive-places-map-photo-filters'))
  assert.ok(map.includes('mapPhotoScope={mapPhotoScope}'))
  assert.ok(gallery.includes('onMapPhotoScopeChange={changeBaiduMapPhotoScope}'))
  assert.ok(gallery.includes('kind:\'baidu-cell\',id:approved.albumKey || undefined'))
  assert.ok(gallery.includes('kind:\'baidu-viewport\',id:approved.albumKey || undefined'))
  assert.ok(!read('deploy/baidu-isolated-child/child.js').includes('albumKey'))
})
test('Web Viewer and Desktop Agent use bounded filtered BD09 only',()=>{
  const viewer=read('web/src/webViewerContext.ts')
  const api=read('web/src/api.ts')
  const desktop=read('desktop/src/main/agent_client.cts')
  const agent=read('cmd/xdrive-agent/desktop_ipc_baidu_native_viewport_items.go')
  const client=read('internal/client/media_baidu_native_viewport_items.go')
  assert.ok(viewer.includes("signal, target.id ?? ''"))
  assert.ok(viewer.includes("filters:target.query,albumKey:target.id ?? ''"))
  assert.ok(api.includes('query, albumKey)'))
  assert.ok(desktop.includes("q.set('album',filters.map_album)"))
  assert.ok(agent.includes('filter.AlbumKey = vals.Get("album")'))
  assert.ok(client.includes('q.Set("album", f.AlbumKey)'))
  assert.ok(client.includes('validBaiduViewportAlbumKey'))
  assert.ok(!read('deploy/baidu-isolated-child/child.js').includes('viewport-items'))
})

test('iOS map filter changes invalidate old SDK pins before the next paint in both Hosts', () => {
  const surface = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  assert.match(surface, /import \{ useEffect, useLayoutEffect, useRef, useState \} from 'react'/)
  const start = surface.indexOf('  // Revoke stale SDK pins before the browser can paint')
  const end = surface.indexOf('  useEffect(() => {\n    const node = mount.current', start)
  assert.ok(start > 0 && end > start, 'Owner filter fence must precede SDK mount')
  const filter = surface.slice(start, end)
  assert.match(filter, /useLayoutEffect\(\(\) => \{/)
  assert.match(filter, /\[currentFilterKey\]/)
  assert.ok(filter.indexOf('lastFilterKey.current=currentFilterKey') <
    filter.indexOf('refreshFilteredCells.current?.()'))
  assert.doesNotMatch(filter, /setTimeout|requestAnimationFrame|window\.location|frame\.dispose\(/)
  const queryStart = surface.indexOf('    const queryCells = async')
  const queryEnd = surface.indexOf('    refreshFilteredCells.current=', queryStart)
  assert.ok(queryStart >= 0 && queryEnd > queryStart)
  const query = surface.slice(queryStart, queryEnd)
  assert.ok(query.indexOf('      cancel(Boolean(keepVisual))') < query.indexOf('await listOwnerCells('))
  assert.ok(query.indexOf('frame.replaceAuthorizedCells([])') <
    query.indexOf('await listOwnerCells('))
  assert.match(query, /approved\.key!==filterRef\.current\.key/)
  assert.match(surface, /mode === 'inline'/)
  assert.match(surface, /xDriveMountBaiduIsolatedFrame/)
  assert.match(surface, /xDriveMountBaiduInlineMap/)
  assert.match(surface, /const trustedSummary = scopeIsCurrent \? summary : null/)
})
