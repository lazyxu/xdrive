'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const surfacePath = 'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx'
const dialogPath = 'ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx'
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const surface = read(surfacePath)
const dialog = read(dialogPath)

test('only one TSX photo drawer and two SDK hosts share the same Owner retry',()=>{
  for(const file of [surfacePath,dialogPath]){
    const result=ts.transpileModule(read(file),{
      fileName:file,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,
        module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
    })
    assert.deepEqual((result.diagnostics||[]).filter(x=>
      x.category===ts.DiagnosticCategory.Error).map(x=>
      ts.flattenDiagnosticMessageText(x.messageText,'\n')),[],file)
  }
  assert.equal((surface.match(/<XDriveMediaGalleryPlacesPhotoDrawer/g)||[]).length,1)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
  assert.match(surface,/const retryDrawer = \(\) => \{/)
  assert.match(surface,/onRetry=\{retryDrawer\}/)
  assert.match(surface,/onRefreshMap=\{\(\) => \{ closeDrawer\(\);refreshFilteredCells\.current\?\.\(\) \}\}/)
  assert.match(surface,/preview\(cell,XDRIVE_PLACES_DRAWER_PREVIEW_LIMIT,0,/)
  assert.match(surface,/xDrivePlacesDrawerValidRange\(cell,range\)/)
})

const retryStart=surface.indexOf('  const retryDrawer = () => {')
const retryEnd=surface.indexOf('  const openDrawerAll = () => {',retryStart)
assert.ok(retryStart>0 && retryEnd>retryStart)
const retryBody=surface.slice(retryStart,retryEnd)
// Execute the ACTUAL current shared Parent handler, not a reimplemented
// acceptance predicate. A stale/foreign Cell never starts an Owner Range.
function runRetry({
  phase='error',accepted=true,scope='Owner-A/album-1',
  currentScope='Owner-A/album-1',cellIsCurrent=true,
  returnPresentation={expanded:true,scrollTop:120,scrollLeft:0},
}={}){
  const selection={node_id:42,node_revision:2,photo_count:5}
  const calls=[]
  const env={
    activeDrawer:accepted
      ? {phase,key:scope,selection,returnPresentation}
      : null,
    acceptedScope:{current:{key:scope}},
    filterRef:{current:{key:currentScope}},
    hasAcceptedCell:cell=>cellIsCurrent && cell===selection,
    selectCellRef:{current:(cell,presentation)=>{
      calls.push({selection:cell,presentation})
    }},
  }
  const names=Object.keys(env)
  const handler=new Function(...names,retryBody+'return retryDrawer')(
    ...names.map(key=>env[key]))
  handler()
  return {calls,selection,returnPresentation}
}

test('failed initial page retries SAME selected Cell with previous visual intent',()=>{
  const {calls,selection,returnPresentation}=runRetry()
  assert.equal(calls.length,1)
  assert.equal(calls[0].selection,selection)
  assert.equal(calls[0].presentation,returnPresentation)
  assert.doesNotMatch(retryBody,/refreshFilteredCells|window\.location|onOpenViewport|openDrawerAll/)
})

test('stale, switched, revoked or already ready Cell cannot be retried',()=>{
  const invalid=[
    {accepted:false},{phase:'ready'},{phase:'loading'},
    {scope:'Owner-A/album-1',currentScope:'Owner-B/album-1'},
    {cellIsCurrent:false},
  ]
  for(const entry of invalid){
    assert.equal(runRetry(entry).calls.length,0,JSON.stringify(entry))
  }
  assert.match(surface,/acceptedScope\.current\?\.key!==filterRef\.current\.key/)
  assert.match(surface,/!hasAcceptedCell\(state\.selection\)/)
  // The original selector revalidates the Owner cell and uses the signed
  // /cell-items port, not stale modal objects or a broader Library range.
  assert.match(surface,/const selectCell = \(selection: MediaBaiduNativeCellSelection,/)
  assert.match(surface,/const scopeCopy=xDriveCopyBaiduMapPhotoScope\(approved\.scope\)/)
  assert.match(surface,/drawerFetch\.current=controller/)
})

test('retry and full map refresh are separate 44px accessible actions',()=>{
  const start=dialog.indexOf(") : phase==='error' ? (")
  const end=dialog.indexOf(") : (",start+6)
  const error=dialog.slice(start,end)
  assert.ok(start>0 && end>start)
  assert.match(error,/data-xdrive-places-photo-drawer-retry/)
  assert.match(error,/data-xdrive-places-photo-drawer-refresh-map/)
  assert.match(error,/onClick=\{onRetry\}/)
  assert.match(error,/onClick=\{onRefreshMap\}/)
  assert.match(error,/重试此地点照片/)
  assert.match(error,/刷新地图/)
  assert.equal((error.match(/sx=\{\{minHeight:44\}\}/g)||[]).length,2)
  assert.match(dialog,/onRefreshMap: \(\) => void/)
  assert.doesNotMatch(error,/onClick=\{onOpenAll\}/)
})
