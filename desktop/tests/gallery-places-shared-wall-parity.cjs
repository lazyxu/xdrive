'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const localRequire = createRequire(path.join(root, 'desktop/package.json'))
const esbuild = localRequire('esbuild')

const loadPolicy = file => {
  const bundled = esbuild.buildSync({
    entryPoints: [path.join(root, file)], bundle: true,
    format: 'cjs', platform: 'node', target: 'node20',
    write: false, logLevel: 'silent',
  })
  const obj = { exports: {} }
  new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(
    obj, obj.exports, require)
  return obj.exports
}
const policy = loadPolicy('ui/shared/src/media-gallery-places-photo-window.ts')
const grid = loadPolicy('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
const map = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const tiles = read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
const host = read('ui/shared/src/mui/MediaGalleryPhotoWall.tsx')
const timeline = read('ui/shared/src/mui/MediaGallerySharedTimeline.tsx')

const fullGroups = n => ({
  year: [{key: '2026', item_count: n, start_index: 0}],
  month: [{key: '2026-11', item_count: n, start_index: 0}],
  day: [
    {key: '2026-11-01', item_count: n - 1, start_index: 0},
    {key: '2026-11-02', item_count: 1, start_index: n - 1},
  ],
})
const first = (n=142) => ({
  total_count: n, offset: 0, limit: 48,
  items: Array.from({length: 48}, (_,i)=>({node:{id:i+1,revision:1}})),
  timeline_group_sets: fullGroups(n),
})

test('Viewer and resize keep only validated UI date/column hints',()=>{
  const state = loadPolicy('ui/shared/src/media-gallery-places-photo-drawer.ts')
  const select = {
    bounds:{coordinate_space:'bd09ll',west:118,south:30,east:122,north:33},
    cell_x:3,cell_y:4,asset_id:23,node_id:45,node_revision:7,photo_count:142,
  }
  const scope = {filters:{sort_by:'captured',sort_dir:'desc'},albumKey:''}
  const good = {
    expanded:true,scrollTop:880,scrollLeft:0,
    loadedCount:48,timeScale:'month',columns:5,
    anchorIndex:72,anchorViewportOffset:33,
  }
  assert.equal(state.xDriveRememberPlacesDrawerViewerReturn(
    'gallery-parity-1',select,scope,1000,good),true)
  assert.deepEqual(
    state.xDriveTakePlacesDrawerViewerReturn('gallery-parity-1',1001).presentation,
    good)
  for(const invalid of [
    {...good,timeScale:'invalid'},
    {...good,columns:1},
    {...good,columns:11},
    {...good,columns:NaN},
    {...good,timeScale:undefined,columns:3},
  ]){
    assert.equal(state.xDriveRememberPlacesDrawerViewerReturn(
      'gallery-parity-2',select,scope,1000,invalid),false)
  }
  assert.match(parent,/data-xdrive-places-photo-scale/)
  assert.match(parent,/data-xdrive-media-gallery-virtual-timeline/)
  assert.match(drawer,/data-xdrive-places-photo-columns/)
})

test('date grouping uses only complete same-Owner first-page indices, not sparse resident dates',()=>{
  const got = policy.xDrivePlacesPhotoTimelineGroups(first())
  assert.ok(got)
  assert.equal(got.year[0].item_count,142)
  assert.equal(got.day[1].start_index,141)
  // A copied return object must not let untrusted code mutate a retained
  // group index. This is UI-only; Owner membership still comes from /cells.
  assert.notEqual(got, first().timeline_group_sets)
  const n=100000
  assert.ok(policy.xDrivePlacesPhotoTimelineGroups(first(n)))
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({...first(),offset:48}),null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({...first(),timeline_group_sets:null}),null)
  for(const groups of [
    {...fullGroups(142), day:[{key:'2026-11-01',item_count:142,start_index:1}]},
    {...fullGroups(142), month:[{key:'2026-11',item_count:141,start_index:0}]},
    {...fullGroups(142), year:[{key:'not-a-date',item_count:142,start_index:0}]},
    {...fullGroups(142), day:[{key:'2026-11-01',item_count:143,start_index:0}]},
    {...fullGroups(142), day:[{key:'2026-11-01',item_count:0,start_index:0}]},
  ]) assert.equal(policy.xDrivePlacesPhotoTimelineGroups({...first(),timeline_group_sets:groups}),null)
  assert.match(parent,/timelineGroups:valid \? xDrivePlacesPhotoTimelineGroups\(range\)/)
  assert.match(parent,/xDrivePlacesDrawerValidRange\(cell,range\)/)
  assert.match(drawer,/disabled=\{phase!=='ready' \|\| \(scale!=='all' && !timelineGroups\)\}/)
})

test('Gallery and Places use one shared photo wall and one dated virtual renderer',()=>{
  assert.match(gallery,/<XDriveMediaGalleryPhotoWall surface="gallery">/)
  assert.match(drawer,/<XDriveMediaGalleryPhotoWall surface="places"/)
  assert.match(drawer,/<XDriveMediaGalleryVirtualTimeline/)
  assert.match(gallery,/XDriveMediaGalleryVirtualTimeline as MediaVirtualTimeline/)
  assert.match(host,/data-xdrive-shared-photo-wall=\{surface\}/)
  assert.match(tiles,/export function MediaVirtualTileGrid\(/)
  assert.match(timeline,/export function XDriveMediaGalleryVirtualTimeline\(/)
  assert.match(timeline,/placesDrawer=\{placesDrawer\}/)
  assert.doesNotMatch(host,/fetch\(|listOwnerCells|JWT|Baidu/)
})

test('Places pinch shares Gallery column policy and retains a numeric visible anchor',()=>{
  assert.match(host,/xDriveMediaGalleryPinchColumnCount\(/)
  assert.match(host,/onChange\(columns, current.index, current.viewportOffset\)/)
  assert.match(host,/suppressClickUntil.current = Date.now\(\) \+ 350/)
  assert.match(drawer,/all: 3, year: 6, month: 5, day: 3/)
  assert.match(drawer,/referenceColumnWidth=\{144\}/)
  assert.match(drawer,/restoreLayout\(index,viewportOffset\)/)
  for(const count of [142,100000]){
    for(const columns of [2,3,5,6,10]){
      const m=grid.xDriveMediaGalleryGridMetrics({
        width:390,itemCount:count,minColumns:columns,
        baselineColumns:3,referenceColumnWidth:144,
      })
      assert.ok(m.columns >= 1 && m.totalRows === Math.ceil(count/m.columns))
    }
  }
})

test('short Owner Cell scrolls continuously without manual load-more controls',()=>{
  assert.match(drawer,/if \(sparse \|\| phase!=='ready' \|\| !expanded \|\| loadingMore \|\|/)
  assert.match(drawer,/list.scrollHeight-list.clientHeight < 180\) onLoadMore\(\)/)
  assert.match(drawer,/onScroll=\{event => \{/)
  assert.match(drawer,/onLoadMore\(\)/)
  assert.match(drawer,/data-xdrive-places-photo-drawer-auto-more/)
  assert.doesNotMatch(drawer,/data-xdrive-places-photo-drawer-load-more/)
  assert.match(drawer,/onClick=\{pageErrorKind === 'window' \? onRetryWindow : onLoadMore\}/)
  assert.match(parent,/xDrivePlacesPhotoWindowSeek\(selection,priorWindow,range\)/)
  assert.match(parent,/xDrivePlacesPhotoWindowRehydrate\(selection,priorWindow,range\)/)
})

test('video poster and Live badges reuse Gallery Tile and original Owner loaders',()=>{
  assert.match(gallery,/savePhotoCoverVideoPoster=\{saveVideoPoster\}/)
  assert.match(map,/loadPreviewURL=\{loadPhotoCoverPreviewURL\}/)
  assert.match(map,/saveVideoPoster=\{savePhotoCoverVideoPoster\}/)
  assert.match(parent,/loadPreviewURL=\{loadPreviewURL\}/)
  assert.match(parent,/saveVideoPoster=\{saveVideoPoster\}/)
  assert.match(drawer,/loadPreviewURL=\{loadPreviewURL\}/)
  assert.match(drawer,/saveVideoPoster=\{saveVideoPoster\}/)
  assert.match(tiles,/<XDriveMediaAsyncVideoPoster/)
  assert.match(tiles,/const livePhoto = Boolean\(/)
})

test('optional favorites stay authenticated; no cross-Owner bulk mutation is added',()=>{
  assert.match(gallery,/onSetFavorite=\{onSetFavorite\}/)
  assert.match(map,/onSetFavorite=\{onSetFavorite\}/)
  assert.match(parent,/mapPhotoScope.filters.favorite!==undefined/)
  assert.match(parent,/!hasAcceptedCell\(state.selection\)/)
  assert.match(parent,/await onSetFavorite\(item, favorite\)/)
  assert.match(drawer,/await onSetFavorite\(item, !item.favorite\)/)
  assert.match(drawer,/data-xdrive-places-photo-drawer-favorite/)
  assert.match(drawer,/disabled=\{favoriteBusy\}/)
  assert.doesNotMatch(drawer,/onSetFavorite=\{onSetFavorite\}/)
  assert.doesNotMatch(drawer,/<MediaGallerySelectionReviewDialog|onDeleteItems=|deleteSelectionSnapshot/)
})

test('collapsed preview is bounded and uses the same thumbnail and photo wall host',()=>{
  assert.match(drawer,/items\.slice\(0,8\)\.map/)
  assert.match(drawer,/<XDriveMediaGalleryPhotoWall surface="places">/)
  assert.match(drawer,/<MediaTile/)
  assert.match(drawer,/new XDriveMediaThumbnailScheduler\(loadThumbnail\)/)
  assert.match(drawer,/scheduler\.dispose\(\)/)
  assert.match(drawer,/thumbnailScheduler=\{thumbnailScheduler\}/)
  assert.match(drawer,/onVisibleAnchorChange=\{captureVisibleAnchor\}/)
})

test('Owner revocation, stale Cell, Viewer return and dual hosts keep original fences',()=>{
  assert.match(parent,/drawerFetch.current\?\.abort\(\)/)
  assert.match(parent,/xDriveBaiduCellReturnMatchesFreshSelection/)
  assert.match(parent,/acceptedScope.current\?\.key !== key/)
  assert.match(parent,/hasAcceptedCell\(selection\)/)
  assert.match(parent,/photoOpener.current\(state.selection,approved.scope,item.node.id,item.node.revision/)
  assert.match(parent,/xDriveMountBaiduIsolatedFrame/)
  assert.match(parent,/xDriveMountBaiduInlineMap/)
  assert.match(tiles,/data-xdrive-places-photo-drawer-item=\{placesDrawer \? item.node.id : undefined\}/)
  assert.match(drawer,/restoreAnchorViewportOffset=/)
  assert.match(drawer,/data-xdrive-places-album-dialog/)
})
