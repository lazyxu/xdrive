'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../..')
const has=p=>fs.existsSync(path.join(root,p))
const read=p=>fs.readFileSync(path.join(root,p),'utf8')
test('GPS backup map is removed across Desktop, Web, PWA and DSM shared UI',()=>{
  for(const filename of [
    'ui/shared/src/mui/MediaGalleryOwnerGPSOverview.tsx',
    'ui/shared/src/media-gallery-owner-gps-cover.ts',
    'ui/shared/src/media-gallery-owner-gps-tiles.ts',
    'ui/shared/src/media-gallery-owner-gps-viewport.ts',
  ]) assert.equal(has(filename),false,filename)
  const map=read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  const gallery=read('ui/shared/src/mui/MediaGallery.tsx')
  const main=read('desktop/src/main/index.cts')
  assert.doesNotMatch(map,/GPS 备用地图|GPS 位置概览|OwnerGPSOverview|owner-gps|desktopFallback|gpsScopeSupported|listPlacesMapOverview/)
  assert.doesNotMatch(gallery,/media-gallery-owner-gps-|loadPlacesMapCover/)
  assert.doesNotMatch(main,/GPS 备用地图/)
  assert.match(map,/data-xdrive-desktop-map-unavailable/)
  assert.match(map,/data-xdrive-baidu-map-unavailable/)
  assert.match(map,/data-xdrive-desktop-places-shared-web/)
  assert.match(map,/setEmbedRetry\(n=>n\+1\)/)
  assert.match(map,/getBaiduJSAPIPrototype/)
  assert.match(map,/mintBaiduIsolatedChildTicket/)
})