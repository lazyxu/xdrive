'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const surface = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
const sheet = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const driver = read('desktop/scripts/gallery-places-dual-host-chromium.cjs')

test('both SDK Hosts share one already-signed Owner camera wall for nearby',()=>{
  assert.equal((surface.match(/const openVerifiedCameraNearby =/g)||[]).length,1)
  assert.match(surface,/onClick=\{openVerifiedCameraNearby\}/)
  assert.match(surface,/onOpenNearby=\{acceptedViewport && activeDrawer\.phase==='ready'/)
  assert.match(surface,/approved\.key!==filterRef\.current\.key/)
  assert.match(surface,/accepted\.west!==acceptedViewport\.west/)
  assert.match(surface,/accepted\.east!==acceptedViewport\.east/)
  assert.match(surface,/accepted\.south!==acceptedViewport\.south/)
  assert.match(surface,/accepted\.north!==acceptedViewport\.north/)
  assert.match(surface,/!scopeIsCurrent/)
  assert.match(surface,/openViewport\.current\(\{\.\.\.accepted\},approved\.scope\)/)
  assert.match(surface,/xDriveMountBaiduInlineMap/)
  assert.match(surface,/xDriveMountBaiduIsolatedFrame/)
  assert.equal((surface.match(/<XDriveMediaGalleryPlacesPhotoDrawer/g)||[]).length,1)
})

test('the trusted sheet exposes nearby only when given a verified Parent callback',()=>{
  assert.match(sheet,/onOpenNearby\?: \(\) => void/)
  assert.match(sheet,/\{onOpenNearby \? \(/)
  assert.match(sheet,/data-xdrive-places-photo-drawer-nearby/)
  assert.match(sheet,/onClick=\{onOpenNearby\}/)
  assert.match(sheet,/显示附近照片/)
  assert.match(sheet,/aria-label="显示当前地图范围的附近照片"/)
  // No new unscoped Gallery API, embedded photo URL or SDK Child callback.
  assert.doesNotMatch(sheet,/listItemRange\(|listPlacesViewport\(|fetch\(|postMessage\(/)
})

test('genuine mounted Gallery, Gin and Child browser flow asserts signed nearby',()=>{
  assert.match(driver,/nearby sheet uses freshly authorized Camera Range/)
  assert.match(driver,/nearby sheet back returns to Owner map without SDK error/)
  assert.match(driver,/galleryPageReads\.filter\(read=>read\.kind==='viewport'\)/)
  assert.match(driver,/await page\.locator\('\[data-xdrive-places-photo-drawer-nearby\]'\)\.click\(\)/)
})

test('real Gin viewport fixture uses canonical signed BD09 query serializer',()=>{
  const mounted=read('desktop/scripts/gallery-places-dual-host-chromium.tsx')
  const begin=mounted.indexOf('  listBaiduNativeViewportItems:async(')
  const end=mounted.indexOf('  getBaiduJSAPI4Status:',begin)
  assert.ok(begin>=0 && end>begin)
  const viewport=mounted.slice(begin,end)
  assert.match(mounted,/import \{ xDriveBaiduNativeViewportRangeParams \}/)
  assert.match(viewport,/xDriveBaiduNativeViewportRangeParams\(/)
  assert.doesNotMatch(viewport,/for\(const \[key,value\] of galleryQuery\(query\)\)/)
  const sourceFile='ui/shared/src/media-gallery-baidu-jsapi4-viewport-range.ts'
  const compiled=ts.transpileModule(read(sourceFile),{
    fileName:sourceFile,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  })
  const module={exports:{}}
  new Function('module','exports',compiled.outputText)(module,module.exports)
  const serialize=module.exports.xDriveBaiduNativeViewportRangeParams
  const bounds={coordinate_space:'bd09ll',west:100,south:20,east:125,north:40}
  const query={sort_by:'captured',sort_dir:'desc',
    favorite:true,fold_duplicates:false}
  const params=serialize(bounds,48,0,query)
  assert.ok(params instanceof URLSearchParams)
  assert.equal(params.get('favorite'),'true')
  assert.equal(params.get('range'),'true')
  assert.equal(params.get('limit'),'48')
  assert.equal(params.has('fold_duplicates'),false)
  assert.equal(serialize(bounds,48,0,{...query,fold_duplicates:true}),null)
  assert.equal(serialize(bounds,48,0,{...query,unknown:true}),null)
})

test('camera-nearby callback behavior denies stale or unverified authority',()=>{
  // Execute the actual shared Parent action's body with inert refs. This is
  // not a mock authorization: the Server Range still independently gates it.
  const begin=surface.indexOf('  const openVerifiedCameraNearby = () => {')
  const end=surface.indexOf(String.fromCharCode(10)+'  return (',begin)
  assert.ok(begin>=0 && end>begin)
  const code=surface.slice(begin,end)
  const evaluate=new Function('data',
    'const {latestAcceptedViewport,acceptedViewport,phase,scopeIsCurrent,'+
    'acceptedScope,filterRef,openViewport}=data;'+String.fromCharCode(10)+code+
    String.fromCharCode(10)+'return openVerifiedCameraNearby;')
  const scope={albumKey:'manual:Family',filters:{favorite:true,sort_by:'captured'}}
  const bounds={west:115,south:32,east:117,north:34}
  const base={
    latestAcceptedViewport:{current:{...bounds}},
    acceptedViewport:{...bounds},
    phase:'ready',scopeIsCurrent:true,
    acceptedScope:{current:{key:'scope-A',scope}},
    filterRef:{current:{key:'scope-A'}},
  }
  const attempt=override=>{
    const calls=[]
    const values={...base,
      openViewport:{current:(b,s)=>calls.push({bounds:b,scope:s})},
      ...override}
    evaluate(values)()
    return calls
  }
  const accepted=attempt({})
  assert.equal(accepted.length,1)
  assert.deepEqual(accepted[0].bounds,bounds)
  assert.notEqual(accepted[0].bounds,base.latestAcceptedViewport.current)
  assert.equal(accepted[0].scope,scope)
  for(const [name,override] of [
    ['loading',{phase:'loading'}],
    ['unavailable',{phase:'unavailable'}],
    ['stale Owner',{scopeIsCurrent:false}],
    ['missing accepted Camera',{acceptedViewport:null}],
    ['mismatched west',{acceptedViewport:{...bounds,west:114}}],
    ['mismatched east',{acceptedViewport:{...bounds,east:118}}],
    ['mismatched south',{acceptedViewport:{...bounds,south:31}}],
    ['mismatched north',{acceptedViewport:{...bounds,north:35}}],
    ['missing verified bounds',{latestAcceptedViewport:{current:null}}],
    ['revoked approved scope',{acceptedScope:{current:null}}],
    ['changed filter key',{filterRef:{current:{key:'scope-B'}}}],
    ['no Owner camera opener',{openViewport:{current:null}}],
  ])assert.equal(attempt(override).length,0,name)
})

test('shared Parent map and drawer compile as TSX modules',()=>{
  for(const name of ['ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx',
    'ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx']){
    const errors=(ts.transpileModule(read(name),{fileName:name,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,
        target:ts.ScriptTarget.ES2022}}).diagnostics||[])
      .filter(x=>x.category===ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')),[],name)
  }
})
