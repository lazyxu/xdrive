'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = path.join(root, 'ui/shared/src/media-gallery-viewer-photo-map-selection.ts')
const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName:file, reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((result.diagnostics || []).filter(
  d => d.category === ts.DiagnosticCategory.Error), [])
const lib = {exports:{}}
new Function('exports','module','require',result.outputText)(
  lib.exports,lib,require)
const select = lib.exports.xDriveViewerPhotoMapSelection

const photo = (id=42,revision=7) => ({
  node:{id,revision,name:'original-private.heic'},
  metadata:{latitude:30.135,longitude:119.975,
    gps_altitude:120,source_gps_latitude:30.13,
    exif:{GPSLatitude:30.135},cas_key:'private-cas'},
  owner_id:999, signed_url:'private-transport',
})

test('Viewer Photo Info forwards only two currently selected identity fields',()=>{
  assert.deepEqual(select(photo()),{nodeID:42,revision:7})
  assert.deepEqual(Object.keys(select(photo())).sort(),['nodeID','revision'])
  assert.deepEqual(select(photo(Number.MAX_SAFE_INTEGER,5)),
    {nodeID:Number.MAX_SAFE_INTEGER,revision:5})
})

test('Viewer Photo Info rejects stale, missing, malformed and unsafe Node identities',()=>{
  for(const bad of [0,-1,-10.1,1.2,NaN,Infinity,-Infinity,
    Number.MAX_SAFE_INTEGER+1,'42',undefined,null,{}]){
    assert.equal(select(photo(bad,7)),null)
    assert.equal(select(photo(42,bad)),null)
  }
  for(const bad of [undefined,null,{}, {node:{}}, {node:null}]){
    assert.equal(select(bad),null)
  }
})

test('Location Dialog and Viewer preserve exact Node/revision until trusted Parent',()=>{
  const dialog = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryViewerLocationDialog.tsx'),'utf8')
  const viewer = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryViewer.tsx'),'utf8')
  assert.match(dialog,/xDriveViewerPhotoMapSelection\(item\)/)
  assert.match(dialog,/disabled=\{!onOpenDynamicMap \|\| !selection\}/)
  assert.match(dialog,/if \(!validGPS \|\| !selection \|\| !onOpenDynamicMap\) return/)
  assert.match(dialog,/onOpenDynamicMap\(selection\)/)
  assert.match(viewer,/isCurrentActionOwner\(\)/)
  assert.match(viewer,/item\?\.node\.id === selection\.nodeID/)
  assert.match(viewer,/item\?\.node\.revision === selection\.revision/)
  assert.match(viewer,/onOpenDynamicMap\(selection\)/)
  assert.doesNotMatch(dialog,/onOpenDynamicMap\?\.\(\)|onOpenDynamicMap\?\.\(item\)/)
  assert.doesNotMatch(viewer,/onOpenDynamicMap\(\)/)
})

test('Original Gallery controls the map scope; this identity does not grant a Cell',()=>{
  const gallery=fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
  assert.match(gallery,/showMapFromCurrentGallery/)
  assert.match(gallery,/xDriveGalleryMapEntryScope\(/)
  assert.match(gallery,/mapGalleryEntryReturnRef\.current/)
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/localStorage|sessionStorage|wgs84|api\.map\.baidu\.com/i)
})
