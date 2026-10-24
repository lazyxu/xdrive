'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const localRequire = createRequire(path.join(root, 'desktop/package.json'))
const esbuild = localRequire('esbuild')
const helperFile = 'ui/shared/src/media-gallery-places-photo-drawer.ts'
const bundled = esbuild.buildSync({
  entryPoints: [path.join(root, helperFile)],
  bundle: true, format: 'cjs', platform: 'node',
  target: 'node20', write: false, logLevel: 'silent',
})
const moduleFixture = { exports: {} }
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(
  moduleFixture, moduleFixture.exports, require,
)
const helper = moduleFixture.exports
const selection = (count=2) => ({
  bounds:{coordinate_space:'bd09ll',west:118,south:30,east:122,north:33},
  cell_x:3,cell_y:4,asset_id:23,node_id:45,node_revision:7,photo_count:count,
})
const scope = {filters:{sort_by:'captured',sort_dir:'desc'},albumKey:''}
const item = (id,revision=2) => ({node:{id,revision,name:'photo-' + id + '.jpg',type:'file',
  size:500,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'},
  metadata:{mime_type:'image/jpeg'}})
const range=(count=2,items=[item(45),item(46)],limit=12)=>({
  total_count:count,offset:0,limit,items,
})

test('Drawer preview accepts only complete authenticated current Cell ranges',()=>{
  assert.equal(helper.XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,12)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range()),true)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(1),range(1,[item(45)])),true)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range(3)),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),{...range(),offset:1}),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range(2,[item(45)])),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range(2,[item(45),item(45)])),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range(2,[item(45,0),item(46)])),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange({...selection(),node_revision:0},range()),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange({...selection(),bounds:{
    ...selection().bounds,coordinate_space:'wgs84'}},range()),false)
  assert.equal(helper.xDrivePlacesDrawerValidRange(selection(),range(2,[item(45),item(46)],101)),false)
})

test('Viewer Back reauthorizes exact worldwide or camera Cell before drawer returns',()=>{
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  assert.match(surface,/if \(restoreHint\.current\) \{/)
  assert.match(surface,/xDrivePlacesDrawerMatchesFresh\(hint,verifiedScope,entry\.selection\)/)
  assert.match(surface,/if \(current\) \{\s*restoreHint\.current=null\s*selectCellRef\.current\(current\.selection, hint\.presentation\)/)
  assert.match(surface,/else if \(liveCamera\) \{\s*restoreHint\.current=null/)
  assert.match(surface,/xDrivePlacesDrawerValidRange\(cell,range\)/)
})

test('Viewer Back hint is ephemeral, Owner-bound and never accepted across cameras',()=>{
  const original=selection()
  const album={filters:{sort_by:'captured',sort_dir:'desc',favorite:true},albumKey:'manual:42'}
  assert.equal(helper.xDriveRememberPlacesDrawerViewerReturn('owner-A',original,album,1000),true)
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('owner-B',1001),undefined)
  const saved=helper.xDriveTakePlacesDrawerViewerReturn('owner-A',1001)
  assert.ok(saved)
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('owner-A',1002),undefined)
  assert.equal(helper.xDrivePlacesDrawerMatchesFresh(saved,album,original),true)
  assert.equal(helper.xDrivePlacesDrawerMatchesFresh(saved,scope,original),false)
  assert.equal(helper.xDrivePlacesDrawerMatchesFresh(saved,album,{
    ...original,node_revision:8,
  }),false)
  assert.equal(helper.xDrivePlacesDrawerMatchesFresh(saved,album,{
    ...original,bounds:{...original.bounds,west:117},
  }),false)
  assert.equal(helper.xDriveRememberPlacesDrawerViewerReturn('owner-A',original,scope,2000),true)
  helper.xDriveClearPlacesDrawerViewerReturn('owner-A')
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('owner-A',2001),undefined)
  assert.equal(helper.xDriveRememberPlacesDrawerViewerReturn('owner-A',original,scope,2002),true)
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('owner-A',
    2002+helper.XDRIVE_PLACES_DRAWER_RETURN_TTL_MS),undefined)
})

test('Viewer return preserves only bounded expansion and scroll state',()=>{
  const initial={expanded:true,scrollTop:84,scrollLeft:31}
  assert.equal(helper.xDriveRememberPlacesDrawerViewerReturn(
    'scroll-owner',selection(),scope,1000,initial),true)
  initial.scrollTop=500
  const restored=helper.xDriveTakePlacesDrawerViewerReturn('scroll-owner',1001)
  assert.deepEqual(restored.presentation,
    {expanded:true,scrollTop:84,scrollLeft:31})
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('scroll-owner',1002),undefined)
  for (const presentation of [
    {expanded:true,scrollTop:-1,scrollLeft:0},
    {expanded:true,scrollTop:Infinity,scrollLeft:0},
    {expanded:true,scrollTop:10001,scrollLeft:0},
    {expanded:'yes',scrollTop:0,scrollLeft:0},
    {expanded:false,scrollTop:0,scrollLeft:1.5},
  ]) assert.equal(helper.xDriveRememberPlacesDrawerViewerReturn(
    'scroll-owner',selection(),scope,1003,presentation),false)
  assert.equal(helper.xDriveTakePlacesDrawerViewerReturn('scroll-owner',1004),undefined)
})

test('Single shared map host previews a fresh Parent-only Range and cancels stale ones',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const surface=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  const sheet=read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const adapter=read('web/src/mediaGalleryAdapter.ts')
  assert.match(adapter,/listBaiduNativeCellItems: \(selection, limit, offset, sort, signal\)/)
  for(const part of [
    'listBaiduNativeCellItems={source.listBaiduNativeCellItems}',
    'listBaiduNativeCellItems={listBaiduNativeCellItems}',
    'onOpenBaiduNativeCellPhoto={onOpenBaiduNativeCellPhoto}',
    'listOwnerCellItems={listBaiduNativeCellItems}',
    'onOpenCellPhoto={onOpenBaiduNativeCellPhoto}',
  ]) assert.ok((gallery+map).includes(part),part)
  for(const part of [
    'preview(cell,XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,0,',
    'xDrivePlacesDrawerValidRange(cell,range)',
    'drawerFetch.current?.abort()',
    'xDriveBaiduCellReturnMatchesFreshSelection(selection, fresh)',
    'selectCellRef.current(selection)',
    'xDrivePlacesDrawerMatchesFresh(hint,verifiedScope,entry.selection)',
    'const verifiedScope=approved.snapshot',
    'if(!verifiedScope)return false',
    'data-xdrive-places-photo-drawer',
  ]) assert.ok((surface+sheet).includes(part),part)
  assert.equal((surface.match(/<XDriveMediaGalleryPlacesPhotoDrawer/g)||[]).length,1)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
  assert.match(sheet,/revision=\{item.node.revision\}/)
  assert.match(sheet,/onClick=\{\(\) => onOpenPhoto\(item, position\(\)\)\}/)
  assert.match(sheet,/data-xdrive-places-photo-drawer-open-all/)
  assert.match(sheet,/useLayoutEffect/)
  assert.match(sheet,/node.scrollTop = initialPresentation.scrollTop/)
  assert.match(sheet,/node.scrollLeft = initialPresentation.scrollLeft/)
  assert.match(surface,/initialPresentation=\{activeDrawer.returnPresentation\}/)
  assert.match(surface,/selectCellRef.current\(current.selection, hint.presentation\)/)
  assert.match(gallery,/directPhoto.presentation/)
  assert.match(sheet,/data-xdrive-places-photo-drawer-expand/)
  assert.match(sheet,/data-xdrive-places-photo-drawer-close/)
  assert.match(gallery,/index < 0 \|\| range.total_count!==cell.photo_count/)
  assert.match(gallery,/xDriveRememberPlacesDrawerViewerReturn\(preferenceScope,cell,approved\)/)
})

test('Shared map, Gallery and photo drawer remain syntactically valid TSX',()=>{
  for(const name of [
    'ui/shared/src/mui/MediaGallery.tsx',
    'ui/shared/src/mui/MediaGalleryPlacesMap.tsx',
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx',
    'ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx',
  ]) {
    const out=ts.transpileModule(read(name),{fileName:name,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,
        target:ts.ScriptTarget.ES2022}})
    const errors=(out.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')),[],name)
  }
})
