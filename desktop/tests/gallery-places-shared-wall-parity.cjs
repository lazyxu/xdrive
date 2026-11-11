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
const dateControls = read('ui/shared/src/mui/MediaGalleryDateNavigation.tsx')
const scaleControls = read('ui/shared/src/mui/MediaGalleryTimeScaleControls.tsx')
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
  assert.match(drawer,/hasTimeline=\{Boolean\(timelineGroups\)\}/)
  assert.match(scaleControls,/disabled=\{disabled \|\| \(value !== 'all' && !hasTimeline\)\}/)
})

test('Gallery and Places use one shared photo wall and one dated virtual renderer',()=>{
  assert.match(gallery,/<XDriveMediaGalleryPhotoWall surface="gallery"/)
  assert.match(gallery,/pinch=\{compactGallery && !selectionMode && !mobileCollectionsOverview/)
  assert.match(gallery,/onChange: changeSharedGalleryPinch/)
  assert.match(drawer,/<XDriveMediaGalleryPhotoWall surface="places"/)
  assert.match(drawer,/<XDriveMediaGalleryVirtualTimeline/)
  assert.match(gallery,/XDriveMediaGalleryVirtualTimeline as MediaVirtualTimeline/)
  assert.match(host,/data-xdrive-shared-photo-wall=\{surface\}/)
  assert.match(tiles,/export function MediaVirtualTileGrid\(/)
  assert.match(timeline,/export function XDriveMediaGalleryVirtualTimeline\(/)
  assert.match(timeline,/placesDrawer=\{placesDrawer\}/)
  assert.doesNotMatch(host,/fetch\(|listOwnerCells|JWT|Baidu/)
})

test('Gallery and Places use one pinch recognizer with independent UI-only states',()=>{
  assert.match(gallery, /pinch=\{compactGallery && !selectionMode && !mobileCollectionsOverview/)
  assert.match(gallery, /onStart: startSharedGalleryPinch/)
  assert.match(gallery, /onChange: changeSharedGalleryPinch/)
  assert.match(gallery, /onGestureEnd: endSharedGalleryPinch/)
  assert.match(gallery, /galleryPinchSuppressClickUntilRef\.current = Date\.now\(\) \+ 350/)
  assert.match(gallery, /clearGalleryTouchPress\(\)/)
  assert.doesNotMatch(gallery, /handleGalleryTouchStart|handleGalleryTouchMove|finishGalleryPinch/)
  assert.match(host, /pinch\.onStart\?\.\(index\)/)
  assert.match(host, /pinch\?\.onGestureEnd\?\.\(\)/)
  assert.match(host, /onClickCapture=\{event => \{/)
  assert.match(host, /event\.stopPropagation\(\)/)
  assert.match(drawer, /pinchChange = useCallback/)
  assert.match(drawer, /restoreLayout\(index,viewportOffset\)/)
  assert.doesNotMatch(host, /fetch\(|listOwnerCells|Authorization|JWT/)
})

test('Places pinch shares Gallery column policy and retains a numeric visible anchor',()=>{
  assert.match(host,/xDriveMediaGalleryPinchColumnCount\(/)
  assert.match(host,/onChange\(columns, current.index, current.viewportOffset\)/)
  assert.match(host,/suppressClickUntil.current = Date.now\(\) \+ 350/)
  assert.match(drawer,/XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_DEFAULT/)
  assert.match(drawer,/xDriveReadMobileGalleryColumns\(\)/)
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
  // The small signed prefix must be complete before the shared date
  // Timeline renders its total count; never treat a 48-item prefix as total.
  assert.match(drawer,/timeScale==='all' \|\|/)
  assert.match(drawer,/loadedDepth>=total \|\| loadingMore \|\| pageError/)
  assert.match(drawer,/timeScale !== 'all' && timelineGroups && \(sparse \|\| loadedDepth>=total\)/)
  assert.match(drawer,/data-xdrive-places-photo-date-loading/)
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
  assert.match(drawer,/<XDriveMediaGalleryPhotoWall surface="places" framing=\{framing\}>/)
  assert.match(drawer,/xDriveMediaGalleryReadFraming/)
  assert.match(drawer,/xDriveMediaGalleryObserveFraming\(setFraming\)/)
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


test('Places date jump uses the same indexed Gallery lookup for deep signed ranges',()=>{
  const nav = loadPolicy('ui/shared/src/mui/MediaGalleryTimelineNavigation.ts')
  const range = first(100000)
  range.timeline_group_sets = {
    year: [{key:'2026',item_count:100000,start_index:0}],
    month: [
      {key:'2026-11',item_count:90048,start_index:0},
      {key:'2026-10',item_count:9952,start_index:90048},
    ],
    day: [
      {key:'2026-11-10',item_count:48,start_index:0},
      {key:'2026-11-07',item_count:90000,start_index:48},
      {key:'2026-10-31',item_count:9952,start_index:90048},
    ],
  }
  const signed = policy.xDrivePlacesPhotoTimelineGroups(range)
  assert.ok(signed, 'A full first-Range signed group index is required')
  assert.equal(nav.xDriveMediaGalleryTimelineGroupAtIndex(signed.day,90048).key,
    '2026-10-31')
  assert.deepEqual(nav.xDriveMediaGalleryTimelineNearestDay(signed.day,'2026-11-01'),
    {group:signed.day[2],exact:false})
  assert.deepEqual(nav.xDriveMediaGalleryTimelineNearestDay(signed.day,'2026-11-07'),
    {group:signed.day[1],exact:true})
  assert.equal(nav.xDriveMediaGalleryTimelineNearestDay(signed.day,'2026-02-30'),null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({...range,offset:48}),null)

  // A sparse far-date target must be handed to the existing virtual window.
  // Reading a signed date index never grants raw Node/media access by itself.
  assert.match(drawer,/restoreLayout\(group\.start_index, 0\)/)
  assert.match(drawer,/onRangeChange: notifyRange/)
  assert.match(parent,/xDrivePlacesPhotoWindowSeek\(selection,priorWindow,range\)/)
  assert.match(parent,/xDrivePlacesDrawerValidRange\(cell,range\)/)
})

test('Places dated browsing matches Gallery navigation without bypassing Owner fencing',()=>{
  const navigation = read('ui/shared/src/mui/MediaGalleryTimelineNavigation.ts')
  assert.match(drawer,/xDriveMediaGalleryTimelineNearestDay\(timelineGroups\.day, day\)/)
  assert.match(drawer,/xDriveMediaGalleryTimelineGroupAtIndex\(/)
  assert.match(gallery,/xDriveMediaGalleryTimelineNearestDay\(dayGroupsForJump, day\)/)
  assert.match(navigation,/export function xDriveMediaGalleryTimelineNearestDay\(/)
  for(const selector of [
    'data-xdrive-places-photo-timeline-jump',
    'data-xdrive-places-photo-timeline-day-jump',
    'data-xdrive-places-photo-timeline-current-date',
    'data-xdrive-places-photo-timeline-return',
    'data-xdrive-places-photo-timeline-day-feedback',
  ]) assert.ok(dateControls.includes(selector), selector)
  assert.match(drawer,/<XDriveMediaGalleryDateNavigation/)
  assert.match(drawer,/onJumpGroup=\{jumpToTimelineGroup\}/)
  assert.match(drawer,/onJumpDay=\{jumpToTimelineDay\}/)
  assert.match(drawer,/onReturn=\{returnToTimelineAnchor\}/)
  assert.match(drawer,/phase==='ready' && timelineGroups && expanded/)
  assert.match(drawer,/Number\.isSafeInteger\(group\.start_index\)/)
  assert.match(drawer,/group\.start_index \+ group\.item_count > total/)
  assert.match(drawer,/setTimelineReturnAnchor\(\{ index, viewportOffset: offset \}\)/)
  assert.match(drawer,/restoreLayout\(anchor\.index, anchor\.viewportOffset\)/)
  assert.match(drawer,/dayDisabled=\{!timelineGroups\.day\.some\(/)
  // There is no new range reader or date-derived authority in the presentation.
  assert.doesNotMatch(drawer,/fetch\(|listOwnerCells\(|listOwnerCellItems\(/)
  assert.match(parent,/photoOpener\.current\(state\.selection,approved\.scope,item\.node\.id,item\.node\.revision/)
})

test('Owner-scoped Places render admission rejects same-filter different-Owner and revoked receipts',()=>{
  const policy=loadPolicy('ui/shared/src/media-gallery-places-owner-fence.ts')
  const current={owner:'owner-A',key:'identical-photo-filters'}
  assert.equal(policy.xDrivePlacesSignedScopeIsCurrent(current,'owner-A','identical-photo-filters'),true)
  assert.equal(policy.xDrivePlacesSignedScopeIsCurrent(current,'owner-B','identical-photo-filters'),false)
  assert.equal(policy.xDrivePlacesSignedScopeIsCurrent(current,null,'identical-photo-filters'),false)
  assert.equal(policy.xDrivePlacesSignedScopeIsCurrent(current,'owner-A','different-photo-filters'),false)
  assert.equal(policy.xDrivePlacesSignedScopeIsCurrent(null,'owner-A','identical-photo-filters'),false)
  assert.match(parent,/acceptedScope = useRef<\{owner:string;key:string;scope:/)
  assert.match(parent,/acceptedScope\.current=\{owner:scope\?\?'',key:approved\.key,scope:verifiedScope\}/)
  assert.match(parent,/const scopeIsCurrent = xDrivePlacesSignedScopeIsCurrent\(/)
  assert.match(parent,/const activeDrawer = drawer && phase === 'ready' &&\s+xDrivePlacesSignedScopeIsCurrent\(/)
  assert.match(parent,/const hasAcceptedCell = [\s\S]*?xDrivePlacesSignedScopeIsCurrent\(/)
})

test('same-Cell retry cannot inherit the previous Dialog visual epoch or stale scroll',()=>{
  assert.match(parent,/const drawerEpoch = useRef\(0\)/)
  assert.match(parent,/setDrawer\(\{epoch:\+\+drawerEpoch\.current,selection:cell/)
  assert.match(parent,/key=\{activeDrawer\.epoch\}/)
  assert.match(drawer,/const collapseAnchor = useRef/)
  assert.match(drawer,/const requestExpanded = \(next:boolean\) =>/)
  assert.match(drawer,/if \(expanded && !wasExpanded\)/)
  assert.match(drawer,/restoreLayout\(anchor\.index,anchor\.viewportOffset\)/)
  assert.match(drawer,/onPointerUp=\{event => \{/)
  assert.doesNotMatch(drawer,/onExpand\(dy<0\)|onExpand\(!expanded\)/)
})

test('two entrances share framing, dated wall, thumbnail Tile, Live/video badges and bounded zoom',()=>{
  const framing=read('ui/shared/src/mui/MediaGalleryPhotoWallFraming.ts')
  const tiles=read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
  const controls=read('ui/shared/src/mui/MediaGalleryFramingControls.tsx')
  assert.match(gallery,/<XDriveMediaGalleryPhotoWall surface="gallery"/)
  assert.match(drawer,/<XDriveMediaGalleryPhotoWall surface="places"/)
  assert.match(gallery,/framing=\{[^}]+\}/)
  assert.match(drawer,/framing=\{framing\}/)
  assert.match(drawer,/XDriveMediaGalleryFramingControls/)
  assert.match(controls,/export function XDriveMediaGalleryFramingControls/)
  assert.match(framing,/objectFit/)
  assert.match(framing,/maskSize/)
  assert.match(tiles,/data-xdrive-media-tile-badges/)
  assert.match(tiles,/livePhoto/)
  assert.match(tiles,/video/)
  assert.match(gallery,/XDriveMediaGalleryVirtualTimeline as MediaVirtualTimeline/)
  assert.match(drawer,/<XDriveMediaGalleryVirtualTimeline/)
  assert.match(gallery,/XDriveMediaGalleryDateNavigation/)
  assert.match(drawer,/XDriveMediaGalleryDateNavigation/)
  assert.match(gallery,/XDriveMediaGalleryTimeScaleControls/)
  assert.match(drawer,/XDriveMediaGalleryTimeScaleControls/)
  assert.match(scaleControls,/data-xdrive-gallery-time-scale/)
  assert.match(scaleControls,/data-xdrive-places-photo-time-scale/)
  assert.match(host,/xDriveMediaGalleryPinchColumnCount/)
  assert.match(drawer,/maxColumns: 10/)
  assert.match(parent,/xDrivePlacesDrawerValidRange/)
  assert.match(parent,/controller\.signal\.aborted/)
})


test('legacy Places date index is allowed only for complete sorted Owner page (never a sparse 100k prefix)', () => {
  const item = (id, day) => ({
    node: {id,revision:1},
    metadata: {captured_at: day === 'unknown' ? undefined : day + 'T12:34:56Z'},
  })
  const full = days => ({
    items: days.map((day,i)=>item(i+1,day)),
    offset: 0, total_count: days.length, limit: 48,
  })
  const days = ['2026-11-11','2026-11-11','2026-11-10','2026-10-01']
  const accepted = policy.xDrivePlacesPhotoTimelineGroups(full(days))
  assert.deepEqual(accepted.year,[{key:'2026',item_count:4,start_index:0}])
  assert.deepEqual(accepted.month,[
    {key:'2026-11',item_count:3,start_index:0},
    {key:'2026-10',item_count:1,start_index:3},
  ])
  assert.deepEqual(accepted.day,[
    {key:'2026-11-11',item_count:2,start_index:0},
    {key:'2026-11-10',item_count:1,start_index:2},
    {key:'2026-10-01',item_count:1,start_index:3},
  ])
  const ascending = policy.xDrivePlacesPhotoTimelineGroups(full([...days].reverse()))
  assert.equal(ascending.day[0].key, '2026-10-01')
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups(full([
    '2026-11-11','unknown','2026-11-10',
  ])), null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups(full([
    'unknown','unknown',
  ])), null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups(full([
    '2026-11-11','2026-10-01','2026-11-10',
  ])), null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups(full([
    '2026-11-11','2026-02-30',
  ])), null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({
    ...full(days), total_count: 100000,
  }),null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({
    ...full(days), total_count: 49,
  }),null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({
    ...full(days), offset: 48,
  }),null)
  assert.equal(policy.xDrivePlacesPhotoTimelineGroups({
    ...full(days), timeline_group_sets:{year:[],month:[],day:[]},
  }),null)
})
