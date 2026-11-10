'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root,file),'utf8')
const policyPath = 'ui/shared/src/mui/MediaGalleryPhotoWallFraming.ts'
const moduleObj = {exports:{}}
new Function('exports','module','require',
  ts.transpileModule(read(policyPath),{
    fileName:policyPath,
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText)(moduleObj.exports,moduleObj,require)
const f = moduleObj.exports
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const places = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const host = read('ui/shared/src/mui/MediaGalleryPhotoWall.tsx')
const controls = read('ui/shared/src/mui/MediaGalleryFramingControls.tsx')
const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
function withBrowser(fn) {
  const previous = global.window
  const store = new Map()
  const events = new EventTarget()
  const localStorage = {
    getItem:key=>store.get(key) ?? null,
    setItem:(key,value)=>store.set(key,String(value)),
  }
  global.window = {
    localStorage,
    addEventListener:(...args)=>events.addEventListener(...args),
    removeEventListener:(...args)=>events.removeEventListener(...args),
    dispatchEvent:event=>events.dispatchEvent(event),
  }
  try {return fn({store,events,localStorage})}
  finally {
    if (previous === undefined) delete global.window
    else global.window = previous
  }
}

test('framing retains legacy view key, time scale and per-scale density, no media identity',()=>{
  assert.equal(f.XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY,
    'xdrive.gallery.view-preferences.v1')
  assert.equal(f.xDriveMediaGalleryReadFraming(),'crop')
  withBrowser(({store})=>{
    const key = f.XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY
    store.set(key,JSON.stringify({
      timeScale:'month',densityByScale:{year:96,month:144,day:192,all:144},
      aspectMode:'crop',node_id:123,owner:'NEVER_CACHE',secretUrl:'private',
    }))
    assert.equal(f.xDriveMediaGalleryWriteFraming('contain'),true)
    const saved=JSON.parse(store.get(key))
    assert.deepEqual(saved,{
      timeScale:'month',densityByScale:{all:144,year:96,month:144,day:192},
      aspectMode:'contain',
    })
    assert.equal(f.xDriveMediaGalleryReadFraming(),'contain')
    assert.equal(f.xDriveMediaGalleryWriteFraming('crop'),true)
    assert.equal(f.xDriveMediaGalleryReadFraming(),'crop')
    assert.deepEqual(Object.keys(JSON.parse(store.get(key))).sort(),
      ['aspectMode','densityByScale','timeScale'])
    assert.equal(f.xDriveMediaGalleryWriteFraming('unknown'),false)
  })
})

test('same-document and cross-tab framing updates are observed without duplicate writes',()=>{
  withBrowser(({store,events})=>{
    let galleryUpdates = []
    let placesUpdates = []
    const unsubGallery=f.xDriveMediaGalleryObserveFraming(mode=>galleryUpdates.push(mode))
    const unsubPlaces=f.xDriveMediaGalleryObserveFraming(mode=>placesUpdates.push(mode))
    assert.equal(f.xDriveMediaGalleryWriteFraming('contain'),true)
    assert.deepEqual(galleryUpdates,['contain'])
    assert.deepEqual(placesUpdates,['contain'])
    assert.equal(f.xDriveMediaGalleryWriteFraming('contain'),true)
    assert.equal(galleryUpdates.length,1)
    const key = f.XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY
    store.set(key,JSON.stringify({aspectMode:'crop',timeScale:'day'}))
    const event=new Event('storage')
    Object.defineProperty(event,'key',{value:key})
    events.dispatchEvent(event)
    assert.deepEqual(galleryUpdates,['contain','crop'])
    assert.deepEqual(placesUpdates,['contain','crop'])
    unsubGallery()
    unsubPlaces()
    f.xDriveMediaGalleryWriteFraming('contain')
    assert.equal(galleryUpdates.length,2)
    assert.equal(placesUpdates.length,2)
  })
})

test('private-mode denial and malformed storage are safe; framing controls only CSS',()=>{
  withBrowser(({store,localStorage})=>{
    const key=f.XDRIVE_MEDIA_GALLERY_VIEW_PREFERENCES_KEY
    store.set(key,'{invalid')
    assert.equal(f.xDriveMediaGalleryReadFraming(),'crop')
    assert.equal(f.xDriveMediaGalleryWriteFraming('contain'),true)
    assert.equal(f.xDriveMediaGalleryReadFraming(),'contain')
    localStorage.getItem=()=>{throw Error('denied')}
    localStorage.setItem=()=>{throw Error('denied')}
    assert.equal(f.xDriveMediaGalleryReadFraming(),'crop')
    assert.equal(f.xDriveMediaGalleryWriteFraming('contain'),false)
  })
  const contain=f.xDriveMediaGalleryFramingStyles('contain')
  const crop=f.xDriveMediaGalleryFramingStyles('crop')
  const tiles='& [data-xdrive-media-tile] img'
  const progress='& [data-xdrive-media-tile] [data-xdrive-media-loading-progress]'
  assert.equal(contain[tiles].objectFit,'contain')
  assert.equal(crop[tiles].objectFit,'cover')
  assert.equal(contain[progress].maskSize,'contain')
  assert.equal(crop[progress].WebkitMaskSize,'cover')
  assert.deepEqual(Object.keys(contain).sort(),[tiles,progress].sort())
})

test('Gallery and Places share responsive crop/contain controls and visual host',()=>{
  for(const selector of ['crop','contain']){
    assert.ok(controls.includes('data-xdrive-gallery-aspect-'+selector))
    assert.ok(controls.includes('data-xdrive-places-photo-aspect-'+selector))
  }
  assert.match(controls,/aria-label="照片墙显示比例"/)
  assert.match(controls,/aria-pressed=\{framing === 'crop'\}/)
  assert.match(controls,/minHeight:44/)
  assert.match(gallery,/<XDriveMediaGalleryFramingControls\s+surface="gallery"/)
  assert.match(places,/<XDriveMediaGalleryFramingControls\s+surface="places"/)
  assert.match(gallery,/\.\.\.xDriveMediaGalleryFramingStyles\(aspectMode\)/)
  assert.match(gallery,/<XDriveMediaGalleryPhotoWall surface="gallery"\s+framing=\{aspectMode\}/)
  assert.match(places,/<XDriveMediaGalleryPhotoWall surface="places"\s+framing=\{framing\}/)
  assert.match(places,/<XDriveMediaGalleryPhotoWall surface="places" framing=\{framing\}>/)
  assert.match(host,/framing \? xDriveMediaGalleryFramingStyles\(framing\) : \{\}/)
  assert.match(host,/data-xdrive-shared-photo-wall-framing=\{framing\}/)
})

test('framing updates never authorize a media read or overwrite a stale full snapshot',()=>{
  assert.match(gallery,/xDriveMediaGalleryObserveFraming\(next => \{/)
  assert.match(places,/xDriveMediaGalleryObserveFraming\(setFraming\)/)
  assert.match(gallery,/xDriveMediaGalleryWriteFraming\(nextMode\)/)
  assert.match(places,/xDriveMediaGalleryWriteFraming\(next\)/)
  assert.doesNotMatch(gallery,/xDriveWriteMediaGalleryViewPreferences\(viewPreferences\)/)
  assert.match(gallery,/xDriveWriteMediaGalleryViewPreferences\(\{\s*\.\.\.xDriveReadMediaGalleryViewPreferences\(\), timeScale: nextScale/)
  assert.match(places,/onRangeChange: notifyRange/)
  assert.match(places,/phase==='ready' && expanded/)
  assert.match(parent,/hasAcceptedCell\(selection\)/)
  assert.match(parent,/photoOpener\.current\(state\.selection,approved\.scope,item\.node\.id,item\.node\.revision/)
  assert.doesNotMatch(read(policyPath),/fetch\(|URLSession|Authorization|JWT|PhotoKit|MediaItem|NodeID/)
})
