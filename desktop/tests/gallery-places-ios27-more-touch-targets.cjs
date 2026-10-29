'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const ts=require('typescript')

const root=path.resolve(__dirname,'../..')
const files=[
  'ui/shared/src/mui/MediaGalleryPlacesMap.tsx',
  'ui/shared/src/mui/MediaGalleryMapGPSCoverage.tsx',
]
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8')
const map=read(files[0])
const coverage=read(files[1])

test('shared Parent map and GPS coverage still parse as TSX for both SDK Hosts',()=>{
  for(const name of files){
    const compiled=ts.transpileModule(read(name),{
      fileName:name,reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.ReactJSX,
        module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
    })
    assert.deepEqual((compiled.diagnostics||[]).filter(d=>
      d.category===ts.DiagnosticCategory.Error).map(d=>
      ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],name)
  }
  assert.equal((map.match(/<XDriveMediaGalleryBaiduIsolatedPhotoSurface/g)||[]).length,1)
  assert.match(map,/mode=\{mapMode === 'prototype' \? 'inline' : 'isolated'\}/)
  assert.equal((map.match(/<XDriveMediaGalleryMapGPSCoverage/g)||[]).length,1)
})

test('map filter and SDK runtime choices have real 44px shared hit areas',()=>{
  const filter=map.slice(map.indexOf('data-xdrive-places-map-photo-filters'),
    map.indexOf('data-xdrive-places-map-more-menu'))
  assert.match(filter, /'& \.MuiInputBase-root':\{minHeight:44\}/)
  assert.match(filter, /'& \.MuiButton-root':\{minHeight:44\}/)
  const modes=map.slice(map.indexOf('data-xdrive-places-map-mode'),
    map.indexOf('data-xdrive-places-map-options'))
  assert.match(modes, /'& \.MuiButton-root':\{minHeight:44\}/)
  assert.match(modes,/data-xdrive-map-mode-prototype/)
  assert.match(modes,/data-xdrive-map-mode-isolated/)
})

test('advanced place and nearby actions remain read-only and touch-sized',()=>{
  const start=map.indexOf('data-xdrive-places-map-options')
  const end=map.indexOf('<XDriveMediaGalleryMapGPSCoverage',start)
  const section=map.slice(start,end)
  assert.ok(start>0 && end>start)
  assert.match(section,/minHeight:44,display:'flex',alignItems:'center'/)
  assert.match(section,/'&:focus-visible'/)
  assert.match(section,/'& \.MuiInputBase-root':\{minHeight:44\}/)
  assert.match(section,/'& \.MuiButton-root':\{minHeight:44\}/)
  assert.match(section,/openSelectedPlace/)
  assert.match(section,/onOpenNearby/)
  assert.doesNotMatch(section, /minHeight:\s*28/)
  const errors=map.slice(map.indexOf('data-xdrive-baidu-map-unavailable'))
  assert.match(errors, /'& \.MuiButton-root':\{minHeight:44\}/)
  assert.match(errors,/重试动态地图/)
})

test('manual Owner GPS coverage has a 44px disclosure and 44px refresh',()=>{
  const start=coverage.indexOf('component="details" data-xdrive-map-gps-coverage')
  assert.ok(start>0)
  const section=coverage.slice(start)
  assert.match(section,/component="summary"/)
  assert.match(section,/minHeight:44,display:'flex',alignItems:'center'/)
  assert.match(section,/'&:focus-visible'/)
  assert.match(section,/sx=\{\{minHeight:44\}\} onClick=\{load\}/)
  assert.match(section,/data-xdrive-map-gps-coverage-refresh/)
  assert.match(section,/disabled=\{current.phase==='loading'\}/)
  // This diagnostic is explicitly read-only; it never starts a geoconv job.
  assert.match(section,/仅统计当前账户已索引完成的 PhotoAsset/)
  assert.doesNotMatch(section,/minHeight:\s*32/)
})
