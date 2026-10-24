'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const modulePath = 'ui/shared/src/media-gallery-baidu-prototype-singleton.ts'
const output = ts.transpileModule(read(modulePath), {
  fileName: modulePath, reportDiagnostics: true,
  compilerOptions: {module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022},
})
assert.deepEqual((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), [])
const mod = {exports: {}}
new Function('module','exports',output.outputText)(mod,mod.exports)
const choose = mod.exports.xDrivePrototypeTrustedSingleton
const canonical = mod.exports.xDrivePrototypeCanonicalPlaceID
const validScope = mod.exports.xDrivePrototypeSingletonScopeValid
const place = {id:'place:120:300',item_count:1,cover_node_id:9}
const item = {node:{id:9,type:'file',revision:3},metadata:{media_kind:'image'}}
const range = {offset:0,limit:1,total_count:1,items:[item]}

test('only the fresh authorized exact singleton is selected', () => {
  assert.equal(choose(place,range),item)
  assert.equal(choose({...place,cover_node_id:undefined},range),item)
  assert.equal(choose({...place,cover_node_id:null},range),item)
  assert.equal(choose(place,{...range,items:[{...item,node:{...item.node,deleted_at:null}}]}).node.id,9)
  assert.equal(choose(place,{...range,items:[{...item,metadata:{media_kind:'video'}}]}).metadata.media_kind,'video')
})
test('synthetic regions, stale cover and changed counts cannot open Viewer', () => {
  for (const p of [
    {...place,id:'map-region:q:1:2:3:4:0:0'},
    {...place,id:'place:invalid'},
    {...place,item_count:2},
    {...place,cover_node_id:10},
    {...place,cover_node_id:-1},
  ]) assert.equal(choose(p,range),null)
  for(const changed of [
    {...range,total_count:0},{...range,total_count:2},
    {...range,anchor_index:1},
    {...range,limit:100},{...range,offset:1},
    {...range,items:[]},{...range,items:[item,item]},
    {...range,items:[{...item,node:{...item.node,id:10}}]},
    {...range,items:[{...item,node:{...item.node,type:'folder'}}]},
    {...range,items:[{...item,node:{...item.node,revision:0}}]},
    {...range,items:[{...item,node:{...item.node,revision:undefined}}]},
    {...range,items:[{...item,node:{...item.node,revision:1.5}}]},
    {...range,items:[{...item,node:{...item.node,deleted_at:'2026-10-24T00:00:00Z'}}]},
    {...range,items:[{...item,metadata:{media_kind:'other'}}]},
    {...range,items:[{...item,metadata:null}]},
  ]) assert.equal(choose(place,changed),null)
})
test('the legacy direct Viewer remains Owner-place-scoped and camera-cancelable', () => {
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const prototype=read('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  assert.ok(gallery.includes('onOpenPrototypePlace={openPrototypeMapPlace}'))
  assert.ok(gallery.includes('xDrivePrototypeTrustedSingleton(place, range)'))
  assert.ok(gallery.includes('source.listItemRange(1, 0, viewerQuery, controller.signal)'))
  assert.ok(gallery.includes("target: { kind: 'all', query: { ...viewerQuery } }"))
  assert.ok(gallery.includes('owner !== deletePreferenceScopeRef.current'))
  assert.ok(gallery.includes('generation !== requestID.current'))
  assert.ok(places.includes('mode={mapMode === \'prototype\' ? \'inline\' : \'isolated\'}'))
  assert.ok(places.includes('onInvalidated={onBaiduNativeCellInvalidated}'))
  assert.ok(prototype.includes('invalidateRef.current?.()'))
  const gestureStart=prototype.indexOf('const stopOnGesture = () => {')
  const gestureEnd=prototype.indexOf("runtime.map.addEventListener('movestart', stopOnGesture)",gestureStart)
  assert.ok(gestureStart >= 0 && gestureEnd > gestureStart)
  assert.match(prototype.slice(gestureStart,gestureEnd),/invalidateRef\.current\?\.\(\)/)
})

test('only bounded canonical original place identities may initiate singleton lookup', () => {
  for(const id of ['place:0:0','place:1:-2','place:-9000:18000',
    'place:9000:-18000']) assert.equal(canonical(id),true,id)
  for(const id of ['place:01:1','place:+1:1','place:-0:0',
    'place:9001:0','place:-9001:0','place:0:18001','place:0:-18001',
    'place:999999999999999999999999:0','map-region:q:1:2:3:4:0:0',
    'place:1:1%20','place:1:1/../../foo',null,undefined,42]){
    assert.equal(canonical(id),false,String(id))
    assert.equal(choose({...place,id},range),null,String(id))
  }
})
test('singleton lookup requires an exact Owner place with retained user filters', () => {
  const scope={place:place.id,has_location:true,
    sort_by:'captured',sort_dir:'desc',fold_duplicates:false,favorite:true}
  assert.equal(validScope(place,scope),true)
  assert.equal(validScope(place,{...scope,captured_from:'2026-01-01'}),true)
  for(const invalid of [
    {...scope,place:'place:9:9'},{...scope,place:undefined},
    {...scope,has_location:false},{...scope,has_location:undefined},
    {...scope,fold_duplicates:true},{...scope,fold_duplicates:undefined},
    {...scope,nearby:'35,135,5'},{...scope,bbox:'1,2,3,4'},
    {...scope,place_hierarchy:'country:JP'},{...scope,anchor_node_id:9},
    {...scope,fold_member_ids:[9]},{...scope,initial_position:'latest'},null,
  ]) assert.equal(validScope(place,invalid),false,JSON.stringify(invalid))
  assert.equal(validScope({...place,id:'map-region:1:2:3:4:0:0'},scope),false)
})
test('Gallery validates place and query before any authorized singleton request', () => {
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  assert.match(gallery,/if \(!xDrivePrototypeCanonicalPlaceID\(place\?\.id\)\) return/)
  assert.match(gallery,/if \(!xDrivePrototypeSingletonScopeValid\(place, viewerQuery\)\)/)
  const start=gallery.indexOf('const openPrototypeMapPlace = useCallback(')
  const end=gallery.indexOf('// B1-D: stable identity',start)
  assert.ok(start>0&&end>start)
  const block=gallery.slice(start,end)
  assert.ok(block.indexOf('xDrivePrototypeSingletonScopeValid(place, viewerQuery)') <
    block.indexOf('source.listItemRange(1, 0, viewerQuery, controller.signal)'))
  assert.ok(block.indexOf('nativePhotoOpenAbort.current?.abort()') <
    block.indexOf('if (!xDrivePrototypeCanonicalPlaceID(place?.id))'))
  assert.ok(block.indexOf('nativePhotoOpenAbort.current?.abort()') <
    block.indexOf('if (!onOpenViewer || place.item_count !== 1)'))
  assert.match(block,/nativePhotoOpenAbort\.current\?\.abort\(\)/)
  assert.match(block,/controller\.signal\.aborted/)
})

test('current-map nearby action cannot precede an accepted Owner/Convertor generation', () => {
  const src=read('ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx')
  const query=src.slice(src.indexOf('const update = (immediate = false) =>'),
    src.indexOf('const refresh = () => update(false)',src.indexOf('const update = (immediate = false) =>')))
  assert.ok(query.includes('committedOwnerFrame.current = false'))
  assert.ok(query.includes('setCanBrowseNearby(false)'))
  const save=src.slice(src.indexOf('saveCamera = () =>'),src.indexOf('activeLayer.addEventListener',src.indexOf('saveCamera = () =>')))
  assert.ok(save.includes('committedOwnerFrame.current && manualCamera.current'))
  const commit=src.slice(src.indexOf("phase = 'layer'"),src.indexOf('refreshCoversRef.current()',src.indexOf("phase = 'layer'")))
  assert.ok(commit.includes('committedOwnerFrame.current = true'))
  assert.ok(commit.includes('setCanBrowseNearby(Boolean(manualCamera.current && features.length > 0'))
  assert.ok(src.includes('!runtime ||\n              !committedOwnerFrame.current'))
  assert.ok(src.includes('!runtime || !manualCamera.current || !committedOwnerFrame.current'))
})

test('only active versioned media from the Server Owner range can open direct Viewer',()=>{
  const code=read('ui/shared/src/media-gallery-baidu-prototype-singleton.ts')
  assert.match(code,/Number\.isSafeInteger\(item\.node\.revision\)/)
  assert.match(code,/item\.node\.revision < 1/)
  assert.match(code,/item\.node\.deleted_at !== undefined/)
  assert.match(code,/item\.metadata\?\.media_kind !== 'image'/)
  assert.match(code,/item\.metadata\?\.media_kind !== 'video'/)
  assert.equal(choose(place,{...range,items:[{...item,node:{...item.node,revision:2}}]}).node.revision,2)
  assert.equal(choose(place,{...range,items:[{...item,node:{...item.node,deleted_at:'deleted'}}]}),null)
})

test('legacy place selector reuses native pin Viewer scope and cancels stale requests', () => {
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(places, /const placeListScoped = !xDriveBaiduMapScopeSurvivesFullReload\(mapPhotoScope\)/)
  assert.match(places, /const openSelectedPlace = placeListScoped \? undefined/)
  assert.match(places, /selectedPlace\?\.id\.startsWith\('place:'\)/)
  assert.match(places, /\(onOpenPrototypePlace \?\? onOpenPlace\) : onOpenPlace/)
  assert.match(places, /disabled=\{placeListScoped\}/)
  assert.match(places, /onOpenNearby && !placeListScoped/)
  assert.match(places, /普通地点和附近操作暂不可用/)
  // Synthetic map-region entries keep the pre-existing photo-wall navigation.
  assert.match(places, /onOpenCell=\{onOpenBaiduNativeCell\}/)
  assert.match(places, /\{openSelectedPlace \? \(/)
  assert.match(places, /if \(selectedPlace\) openSelectedPlace\(selectedPlace\)/)
  const select=places.slice(places.indexOf('onChange={(_event, p) => {'),
    places.indexOf('setSelectedPlaceID(p?.id ?? null)'))
  assert.match(select, /onBaiduNativeCellInvalidated\?\.\(\)/)
  assert.ok(select.indexOf('onBaiduNativeCellInvalidated?.()') <
    select.indexOf('clearCamera()'))
  const nearby=places.slice(places.indexOf('data-xdrive-places-map-options'))
  assert.match(nearby, /onBaiduNativeCellInvalidated\?\.\(\)[\s\S]*?if \(selectedPlace\) onOpenNearby\(selectedPlace, nearbyRadiusKM\)/)
})
