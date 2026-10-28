'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {createRequire} = require('node:module')

const root = path.resolve(__dirname, '../..')
const fromDesktop = createRequire(path.join(root, 'desktop/package.json'))
const esbuild = fromDesktop('esbuild')
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, 'ui/shared/src/media-gallery-places-photo-paging.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node20',
  write: false, logLevel: 'silent',
})
const output = { exports: {} }
new Function('module','exports','require',bundle.outputFiles[0].text)(
  output,output.exports,require)
const {xDriveAppendPlacesDrawerPage: append} = output.exports
const item = id => ({node:{id,revision:1,name:'item-'+id,type:'file'}})
const photos = (start,end) =>
  Array.from({length:end-start+1}, (_,i)=>item(start+i))
const selection = (count=142) => ({
  bounds:{coordinate_space:'bd09ll',west:110,south:20,east:120,north:30},
  cell_x:3,cell_y:4,asset_id:33,node_id:75,node_revision:2,photo_count:count,
})
const page = (offset,items,total=142,limit=48) =>
  ({offset,items,total_count:total,limit})
const initial = photos(1,48)
const read = p => fs.readFileSync(path.join(root,p),'utf8')

test('142-photo Owner cell pages through 48 + 48 + 46 without losing its scope', () => {
  const second=append(selection(),initial,142,page(48,photos(49,96)))
  assert.ok(second)
  assert.equal(second.length,96)
  const third=append(selection(),second,142,page(96,photos(97,142)))
  assert.ok(third)
  assert.equal(third.length,142)
  assert.deepEqual(third.map(x=>x.node.id),Array.from({length:142},(_,i)=>i+1))
  assert.equal(append(selection(),third,142,page(142,[])),null)
})

test('Server Live Photo grouping can reduce logical count but never widen owner count', () => {
  const group=append(selection(150),initial,100,page(48,photos(49,96),100))
  assert.ok(group)
  const last=append(selection(150),group,100,page(96,photos(97,100),100))
  assert.equal(last?.length,100)
  assert.equal(append(selection(99),initial,100,page(48,photos(49,96),100)),null)
})

test('reject stale or forged offset, count, limits, partial pages and repeated node identities', () => {
  const good=page(48,photos(49,96))
  const bad=[
    {...good,offset:0},{...good,offset:49},{...good,limit:100},
    {...good,total_count:141},{...good,total_count:143},
    {...good,items:photos(49,95)},
    {...good,items:[item(1),...photos(50,96)]},
    {...good,items:[item(49),item(49),...photos(51,96)]},
    {...good,items:[{node:{id:49,revision:0}},...photos(50,96)]},
    {...good,items:[{node:{id:0,revision:1}},...photos(50,96)]},
  ]
  for(const candidate of bad)
    assert.equal(append(selection(),initial,142,candidate),null,
      JSON.stringify({offset:candidate.offset,total:candidate.total_count}))
  assert.equal(append(selection(),[item(1),item(1),...photos(3,48)],142,good),null)
})

test('shared Owner Parent alone paginates, fences cancellations and retains the original dialog', () => {
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const dialog=read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  for(const needle of [
    'const loadDrawerMore = () => {',
    'const offset=state.items.length',
    'preview(selection,XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,offset,',
    'xDriveAppendPlacesDrawerPage(selection,current.items,current.total,range)',
    'acceptedScope.current?.key !== key',
    'hasAcceptedCell(selection)',
    'drawerFetch.current?.abort()',
    'onLoadMore={loadDrawerMore}',
  ])assert.ok(surface.includes(needle),needle)
  for(const needle of [
    'data-xdrive-places-photo-drawer-load-more',
    'data-xdrive-places-photo-drawer-page-error',
    'data-xdrive-places-album-dialog',
    'onScroll={event => {',
    'onLoadMore()',
  ])assert.ok(dialog.includes(needle),needle)
  assert.doesNotMatch(dialog,/data-xdrive-places-photo-collection-strip/)
  assert.doesNotMatch(surface,/fetch\s*\(\s*['"]https?:/)
})

test('Viewer return saves only a bounded page count and reauthorizes after return', () => {
  const details=esbuild.buildSync({
    entryPoints: [path.join(root,'ui/shared/src/media-gallery-places-photo-drawer.ts')],
    bundle:true,format:'cjs',platform:'node',target:'node20',
    write:false,logLevel:'silent',
  })
  const instance={exports:{}}
  new Function('module','exports','require',details.outputFiles[0].text)(
    instance,instance.exports,require)
  const h=instance.exports
  const scope={albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}}
  const view={expanded:true,scrollTop:1220,scrollLeft:0,loadedCount:142}
  assert.equal(h.XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,480)
  assert.equal(h.xDriveRememberPlacesDrawerViewerReturn(
    'paging-owner',selection(),scope,1000,view),true)
  view.scrollTop=1
  const restored=h.xDriveTakePlacesDrawerViewerReturn('paging-owner',1001)
  assert.equal(restored?.presentation.scrollTop,1220)
  assert.equal(restored?.presentation.loadedCount,142)
  assert.equal(h.xDriveTakePlacesDrawerViewerReturn('paging-owner',1002),undefined)
  for(const value of [0,-1,481,1.5,NaN,Infinity,'48']) {
    const invalid={expanded:true,scrollTop:1220,scrollLeft:0,loadedCount:value}
    assert.equal(h.xDriveRememberPlacesDrawerViewerReturn(
      'paging-owner',selection(),scope,1003,invalid),false)
  }
  assert.equal(h.xDriveTakePlacesDrawerViewerReturn('paging-owner',1004),undefined)
  const sheet=read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  assert.ok(sheet.includes('const target=Math.min(initialPresentation?.loadedCount ?? 0,total)'))
  assert.ok(sheet.includes('(initialPresentation.loadedCount ?? 0)<=items.length'))
  assert.ok(sheet.includes('loadedCount:Math.min(XDRIVE_PLACES_DRAWER_RETURN_ITEM_LIMIT,items.length)'))
})

test('Gallery reauthorizes late-page Viewer from Server anchor, never first 48 alone', () => {
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const fixture=read('desktop/scripts/gallery-places-dual-host-chromium.tsx')
  const browser=read('desktop/scripts/gallery-places-dual-host-chromium.cjs')
  for(const needle of [
    'anchorNodeID:directPhoto.nodeID',
    'const index=range.anchor_index',
    'const pageOffset=Math.floor(index/pageSize)*pageSize',
    'const itemPage=pageOffset===0 ? range : await listCellItems(',
    'itemPage.total_count!==range.total_count',
    'itemPage.items[itemIndex]?.node.revision!==directPhoto.revision',
    'activeIndex:index,totalCount:range.total_count',
    'if(controller.signal.aborted || request!==requestID.current) return',
  ])assert.ok(gallery.includes(needle),needle)
  assert.ok(fixture.includes('anchor_index:sort.anchorNodeID-selection.node_id'))
  assert.ok(fixture.includes('anchorNodeID:nodeID'))
  assert.ok(browser.includes('item 142 opens Viewer only after Owner anchor and page 96 recheck'))
  assert.ok(browser.includes('Viewer Back reauthorizes 142 items before restoring scroll anchor'))
})
