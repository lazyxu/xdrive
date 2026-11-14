'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const filepath = 'ui/shared/src/mui/MediaGalleryPhotoWallPreferences.ts'
const js = ts.transpileModule(read(filepath), {
  fileName: filepath,
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText
const mod = {exports:{}}
new Function('exports','module','require',js)(mod.exports,mod,require)
const prefs = mod.exports
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
const visualState = read('ui/shared/src/mui/MediaGalleryPhotoWallState.ts')
const parent = read('ui/shared/src/mui/MediaGalleryBaiduIsolatedPhotoSurface.tsx')
const key = prefs.XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY
const defaultColumns = {year:6,month:5,day:3,all:3}

function withBrowser(fn){
  const previous = global.window
  const store = new Map()
  const target = new EventTarget()
  const storage = {
    getItem(name){return store.get(name)??null},
    setItem(name,value){store.set(name,String(value))},
    removeItem(name){store.delete(name)},
  }
  global.window = {localStorage:storage,
    addEventListener:(...args)=>target.addEventListener(...args),
    removeEventListener:(...args)=>target.removeEventListener(...args),
    dispatchEvent:event=>target.dispatchEvent(event),
  }
  try{return fn({store,target,storage})}
  finally{
    if(previous===undefined)delete global.window
    else global.window=previous
  }
}

test('one Gallery/Places preference port stores only four bounded numeric columns',()=>{
  assert.equal(key,'xdrive.gallery.mobile.columns.v1')
  assert.deepEqual(prefs.XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_DEFAULT,defaultColumns)
  assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),defaultColumns)
  withBrowser(({store})=>{
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),defaultColumns)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('day',7),true)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('year',8),true)
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),
      {year:8,month:5,day:7,all:3})
    assert.deepEqual(JSON.parse(store.get(key)),{year:8,month:5,day:7,all:3})
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('month',50),true)
    assert.equal(prefs.xDriveReadMobileGalleryColumns().month,10)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('all',-2),true)
    assert.equal(prefs.xDriveReadMobileGalleryColumns().all,2)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('day',NaN),false)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('day',Infinity),false)
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('invalid',4),false)
    assert.deepEqual(Object.keys(JSON.parse(store.get(key))).sort(),
      ['all','day','month','year'])
    assert.doesNotMatch(store.get(key),/owner|node|revision|token|media|url/i)
  })
})

test('invalid, malicious, denied or stale browser storage cannot corrupt density',()=>{
  withBrowser(({store,storage})=>{
    store.set(key,'not-json')
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),defaultColumns)
    store.set(key,'null')
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),defaultColumns)
    store.set(key,JSON.stringify({
      year:999,month:-2,day:4.8,all:'9',
      owner:'do-not-copy',node_id:123,photo_url:'secret',
    }))
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),
      {year:10,month:2,day:5,all:3})
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('month',6),true)
    assert.deepEqual(JSON.parse(store.get(key)),
      {year:10,month:6,day:5,all:3})
    storage.getItem = () => {throw Error('storage denied')}
    assert.deepEqual(prefs.xDriveReadMobileGalleryColumns(),defaultColumns)
    storage.setItem = () => {throw Error('storage denied')}
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('day',7),false)
  })
})

test('same-document and cross-tab updates reach both mounted Gallery and Places',()=>{
  withBrowser(({target,store})=>{
    let galleryState=[]
    let placeState=[]
    const unGallery = prefs.xDriveObserveMobileGalleryColumns(
      columns=>galleryState.push(columns))
    const unPlaces = prefs.xDriveObserveMobileGalleryColumns(
      columns=>placeState.push(columns))
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('all',4),true)
    assert.equal(galleryState.length,1)
    assert.deepEqual(placeState[0],{year:6,month:5,day:3,all:4})
    assert.equal(prefs.xDriveWriteMobileGalleryColumn('all',4),true)
    assert.equal(galleryState.length,1,'No duplicate event for no-op write')
    store.set(key,JSON.stringify({year:9,month:8,day:7,all:6}))
    const event = new Event('storage')
    Object.defineProperty(event,'key',{value:key})
    target.dispatchEvent(event)
    assert.equal(galleryState.length,2)
    assert.deepEqual(galleryState[1],{year:9,month:8,day:7,all:6})
    assert.deepEqual(placeState[1],galleryState[1])
    unGallery()
    unPlaces()
    prefs.xDriveWriteMobileGalleryColumn('all',3)
    assert.equal(galleryState.length,2)
    assert.equal(placeState.length,2)
  })
})

test('mounted Gallery and Places both read/observe one preference port',()=>{
  assert.match(gallery,/useXDriveMediaGalleryMobileColumns\(\)/)
  assert.match(drawer,/useXDriveMediaGalleryMobileColumns\(\{/)
  assert.match(visualState,/xDriveReadMobileGalleryColumns\(\)/)
  assert.match(visualState,/xDriveObserveMobileGalleryColumns\(setColumns\)/)
  assert.doesNotMatch(gallery,/xDriveObserveMobileGalleryColumns\(/)
  assert.doesNotMatch(drawer,/xDriveObserveMobileGalleryColumns\(/)
  assert.match(gallery,/xDriveWriteMobileGalleryColumn\(effectiveTimeScale, columns\)/)
  assert.match(drawer,/xDriveWriteMobileGalleryColumn\(timeScale,columns\)/)
  assert.match(drawer,/columns: initialPresentation\?\.columns/)
  assert.match(visualState,/Number\.isFinite\(n\)/)
  assert.match(drawer,/XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_DEFAULT/)
  assert.doesNotMatch(drawer,/window\.localStorage\.(setItem|getItem)/)
  assert.doesNotMatch(gallery,/window\.localStorage\.setItem\(\s*XDRIVE_MEDIA_GALLERY_MOBILE_COLUMNS_KEY/)
  assert.match(parent,/hasAcceptedCell\(selection\)/)
  assert.match(parent,/photoOpener\.current\(state\.selection,approved\.scope,item\.node\.id,item\.node\.revision/)
  assert.doesNotMatch(read(filepath),/fetch\(|Authorization|CellItems|node_id|photo_url|JWT/)
})
