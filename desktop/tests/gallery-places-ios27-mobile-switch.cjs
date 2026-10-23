'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root,file), 'utf8')
const name = 'ui/shared/src/media-gallery-places-presentation.ts'
const built = ts.transpileModule(read(name), {
  fileName:name, reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
})
assert.deepEqual((built.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error), [])
const m={exports:{}}
new Function('module','exports',built.outputText)(m,m.exports)
const panels=m.exports.xDrivePlacesVisiblePanels

test('compact map-first Places has exactly one active presentation',()=>{
  assert.deepEqual(panels(true,'map'),{map:true,list:false})
  assert.deepEqual(panels(true,'list'),{map:false,list:true})
  assert.deepEqual(panels(false,'map'),{map:true,list:true})
  assert.deepEqual(panels(false,'list'),{map:true,list:true})
})
test('mobile switch preserves trusted shared Map and Owner photo wall routes',()=>{
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const places=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const child=read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
  for(const marker of [
    'data-xdrive-places-mobile-switch',
    "useState<'map' | 'list'>('map')",
    'xDrivePlacesVisiblePanels(compactGallery, placesMobileMode)',
    'placesPanels.map ? (',
    'placesPanels.list && listPlacesHierarchy',
    'placesPanels.list ? (',
    "aria-pressed={placesMobileMode === 'map'}",
    "aria-pressed={placesMobileMode === 'list'}",
    'onOpenBaiduNativeCell={onOpenBaiduNativeCell}',
    'onOpenNearby={onOpenNearby}',
  ]) assert.ok(gallery.includes(marker),marker)
  assert.ok(places.includes('edgeToEdge={compact}'))
  assert.ok(child.includes('xDriveSelectBaiduNativeCell(page,bounds,cell)'))
  assert.ok(child.includes('frame.replaceAuthorizedCells(cells)'))
  assert.ok(!child.includes('localStorage.setItem'))
})
