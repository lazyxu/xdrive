'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const TestRenderer = require('react-test-renderer')
const { act } = TestRenderer
const root = path.resolve(__dirname, '../..')
const uiFile = path.join(root, 'ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const source = fs.readFileSync(uiFile, 'utf8')

function compile(sourcePath, overrides) {
  const js = ts.transpileModule(fs.readFileSync(sourcePath,'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX},
  }).outputText
  const loaded = new Module(sourcePath, module)
  loaded.filename = sourcePath
  loaded.paths = Module._nodeModulePaths(path.join(root,'desktop'))
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = request => Object.prototype.hasOwnProperty.call(overrides,request)
    ? overrides[request] : originalRequire(request)
  loaded._compile(js,sourcePath)
  return loaded.exports
}

const stub = {
  Autocomplete:'autocomplete', Box:'box', Button:'button', Chip:'chip',
  CircularProgress:'progress', Paper:'paper', Stack:'stack',
  TextField:'input', Typography:'typography',
}
const hookPath = path.join(root,'ui/shared/src/mui/useDeferredLoading.ts')
const hook = compile(hookPath,{})
// The original mounted React test must load the REAL compiled diagnostic
// module. Do not silently stub it out: static fallback may not publish
// foreign Owner, SDK, or credential data.
const diagnosticsPath = path.join(root,'ui/shared/src/media-gallery-baidu-diagnostics.ts')
const diagnostics = compile(diagnosticsPath,{})
const galleryMap = compile(uiFile,{
  '@mui/material':stub,
  './useDeferredLoading':hook,
  '../media-gallery-baidu-diagnostics':diagnostics,
  // A3 adds an optional shared native Map, but this existing Places
  // viewport test deliberately has NO production authorized runtime.
  // Keep static map ownership and the original Server Range contract.
  './MediaGalleryBaiduJSAPI4Surface': {
    XDriveMediaGalleryBaiduJSAPI4Surface: () => null,
  },
  // This legacy mounted React test deliberately has no Server-authorized
  // Session/Native Photo port. Resolve the optional dynamic import but throw
  // if it is EVER rendered, preserving the real static viewport coverage.
  './MediaGalleryBaiduJSAPI4PhotoSurface': {
    XDriveMediaGalleryBaiduJSAPI4PhotoSurface: () => {
      throw new Error('native photo layer must not mount without signed Server status')
    },
  },
  './MediaGalleryBaiduIsolatedPhotoSurface': {
    XDriveMediaGalleryBaiduIsolatedPhotoSurface: () => {
      throw new Error('isolated child must not mount without signed Server authority')
    },
  },
  './MediaGalleryBaiduPrototypeMap': {
    XDriveMediaGalleryBaiduPrototypeMap: props => {
      assert.equal(Object.prototype.hasOwnProperty.call(props, 'places'), false,
        'unverified parent Owner GPS must not be passed to the SDK component')
      // This fixture tests the REAL parent adapter/key lifecycle, and models
      // only a child's abortable Owner request (never mocks a Provider proof).
      const [confirmed, setConfirmed] = React.useState([])
      React.useEffect(() => {
        const request = new AbortController()
        void props.listPlacesMapOverview({ west:-180, south:-85, east:180, north:85 },
          false, request.signal).then(page => {
            if (!request.signal.aborted) setConfirmed(page.items)
          })
        return () => request.abort()
      }, [props.listPlacesMapOverview])
      return React.createElement('prototype-map-fixture', { ...props, places: confirmed })
    },
  },
  './MediaGalleryBaiduStaticMap':{
    XDriveMediaGalleryBaiduStaticMap: props =>
      React.createElement('map-fixture',{onViewportChange:props.onViewportChange}),
  },
  '../media-gallery-places-camera-session':{
    xDriveValidPlacesCameraSnapshot:()=>false,
  },
  // W3b1 Native BD09 camera is a separate optional Owner-only dependency.
  // This original mounted legacy Static Map fixture deliberately has no
  // signed Native Map session and must never instantiate the new runtime.
  '../media-gallery-baidu-native-camera-session':{
    xDriveValidBaiduNativeCameraSnapshot:()=>false,
  },
})
const MapView = galleryMap.XDriveMediaGalleryPlacesMap
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function deferred() {
  let resolve,reject
  const promise=new Promise((a,b)=>{resolve=a;reject=b})
  return {promise,resolve,reject}
}
function place(id,name) {return {id,name}}
function result(name, photoCount=3) {
  return {items:[place('place:'+name,name)],offset:0,limit:24,
    total_count:1,total_photo_count:photoCount,has_more:false}
}
function renderedNames(view) {
  const list=view.root.findAll(node=>node.props['data-xdrive-places-viewport-results']!==undefined)[0]
  return list?list.findAllByType('button').map(node=>
    node.findAllByType('typography')[0]?.props.children):[]
}
function renderedStale(view) {
  const list=view.root.findAll(node=>node.props['data-xdrive-places-viewport-results']!==undefined)[0]
  return list?.props['data-xdrive-places-viewport-stale']
}

test('viewport pan keeps accepted rows, aborts old request and shows only delayed overlay',async()=>{
  const calls=[]
  const port=(bounds,limit,offset,signal)=>{
    const task=deferred()
    calls.push({...task,bounds,limit,offset,signal})
    return task.promise
  }
  let view
  const props={places:[place('place:root','Root')],totalCount:1,
    listPlacesViewport:port,onOpenPlace:()=>{}}
  const a={west:0,south:0,east:10,north:10}
  const b={west:10,south:10,east:20,north:20}
  await act(async()=>{view=TestRenderer.create(React.createElement(MapView,props))})
  const move=()=>view.root.findByType('map-fixture').props.onViewportChange
  await act(async()=>{move()(a)})
  assert.equal(calls.length,1,'authenticated request starts immediately')
  assert.equal(calls[0].limit,24)
  assert.deepEqual(renderedNames(view),[],'first unverified range has no false results')
  assert.equal(view.root.findAllByType('progress').length,0,'quick pending must not flash')
  await act(async()=>{calls[0].resolve(result('A'));await Promise.resolve()})
  assert.deepEqual(renderedNames(view),['A'])
  assert.equal(renderedStale(view),undefined)
  await act(async()=>{move()(b)})
  assert.equal(calls.length,2)
  assert.equal(calls[0].signal.aborted,true,'old viewport canceled')
  assert.deepEqual(renderedNames(view),['A'],'accepted tiles survive an unconfirmed pan')
  assert.equal(renderedStale(view),'true','previous scope must be labeled correctly')
  assert.equal(view.root.findAllByType('progress').length,0,'new pending disarms old feedback')
  await act(async()=>{await sleep(330)})
  assert.equal(view.root.findAllByType('progress').length,1,
    'a sustained real Server wait has visible overlay progress')
  assert.deepEqual(renderedNames(view),['A'],'spinner never replaces old tiles')
  await act(async()=>{calls[1].resolve(result('B',8));await Promise.resolve()})
  assert.deepEqual(renderedNames(view),['B'])
  assert.equal(renderedStale(view),undefined)
  assert.equal(view.root.findAllByType('progress').length,0)
  await act(async()=>{view.unmount()})
})

test('failed viewport and account/port rotation cannot publish false empty or other owner rows',async()=>{
  const calls=[]
  function portFactory() {
    return (bounds,limit,offset,signal)=>{
      const task=deferred();calls.push({...task,bounds,limit,offset,signal})
      return task.promise
    }
  }
  const first=portFactory(), second=portFactory()
  const bounds={west:1,south:1,east:2,north:2}
  const moved={west:2,south:2,east:3,north:3}
  let view
  const props={places:[place('place:root','Root')],listPlacesViewport:first,onOpenPlace:()=>{}}
  await act(async()=>{view=TestRenderer.create(React.createElement(MapView,props))})
  const move=()=>view.root.findByType('map-fixture').props.onViewportChange
  await act(async()=>{move()(bounds)})
  await act(async()=>{calls[0].resolve(result('owner-one'));await Promise.resolve()})
  await act(async()=>{move()(moved)})
  await act(async()=>{calls[1].reject(new Error('network failure'));await Promise.resolve()})
  assert.deepEqual(renderedNames(view),['owner-one'],'true network error retains last verified data')
  assert.ok(view.root.findAll(node=>node.props.role==='alert').length>0)
  const displayed=view.root.findAll(node=>node.props['data-xdrive-places-viewport-results']!==undefined)[0]
  const feedback=view.root.findAll(node=>node.props['data-xdrive-places-viewport-error']!==undefined)[0]
  assert.ok(feedback,'the real Server viewport failure must remain visible')
  assert.equal(feedback.props.sx.position,'absolute')
  assert.equal(feedback.props.sx.pointerEvents,'none')
  assert.ok(feedback.props.sx.top>=44)
  assert.equal(feedback.parent.props['data-xdrive-gallery-places-viewport'],true,
    'error must be a sibling of the result Stack: MUI Stack spacing selectors include absolute siblings')
  assert.equal(view.root.findAll(node=>node.props['data-xdrive-places-viewport-results']!==undefined)[0],displayed,
    'the error receipt must not replace the previously accepted viewport result owner')
  await act(async()=>{view.update(React.createElement(MapView,{...props,listPlacesViewport:second}))})
  assert.deepEqual(renderedNames(view),[],'new owner cannot see old GPS result')
  assert.ok(calls.length>=3,'new port starts its own Server read')
  await act(async()=>{calls.at(-1).resolve(result('owner-two'));await Promise.resolve()})
  assert.deepEqual(renderedNames(view),['owner-two'])
  await act(async()=>{view.unmount()})
})

test('source contracts preserve canonical Server range and scroll-camera ownership',()=>{
  for(const token of [
    'source: listPlacesViewport',
    'viewportResult.source === listPlacesViewport',
    'data-xdrive-places-viewport-stale',
    'showingPreviousViewport ?',
    'data-xdrive-places-viewport-first-read',
    'useXDriveDeferredLoading(',
    'data-xdrive-places-viewport-loading',
    "position: 'absolute', top: 2",
    'viewportLoading || !currentViewportResult',
    'activeRequest.current?.abort()',
    'listPlacesViewport(viewportBounds, 24, viewportOffset, controller.signal)',
    'sameViewport(viewportResult.bounds, viewportBounds)',
    'onCameraChange?.({ ...cameraRef.current, viewportOffset: nextOffset })',
  ])assert.ok(source.includes(token),token)
  assert.equal(source.includes('保留上一视窗结果，当前视窗尚未确认。'),false)
})


test('P112: cold failed map viewport preserves the original 96px silent slot and truthful error', async () => {
  const task=deferred()
  const port=()=>task.promise
  let view
  try {
    await act(async()=>{view=TestRenderer.create(React.createElement(MapView,{
      places:[place('place:root','Root')],listPlacesViewport:port,onOpenPlace:()=>{},
    }))})
    const bounds={west:1,south:1,east:2,north:2}
    await act(async()=>{view.root.findByType('map-fixture').props.onViewportChange(bounds)})
    const before=view.root.findAll(node=>node.props['data-xdrive-places-viewport-first-read']!==undefined)[0]
    assert.ok(before)
    assert.equal(before.props.sx.minHeight,96)
    await act(async()=>{task.reject(new Error('viewport offline'));await Promise.resolve()})
    const after=view.root.findAll(node=>node.props['data-xdrive-places-viewport-first-read']!==undefined)[0]
    assert.equal(after,before, 'real first-page failure cannot remove or replace the stable map viewport slot')
    assert.equal(after.props.sx.minHeight,96)
    const errors=view.root.findAll(node=>node.props['data-xdrive-places-viewport-error']!==undefined)
    assert.equal(errors.length,1)
    assert.equal(errors[0].props.role,'alert')
    assert.equal(errors[0].props.sx.position,'absolute')
    assert.equal(errors[0].parent.props['data-xdrive-gallery-places-viewport'],true,
      'cold error cannot become a spacing Stack child and shift the next row')
    assert.deepEqual(renderedNames(view),[], 'unverified viewport error is not a fake empty result')
  } finally {if(view)await act(async()=>{view.unmount()})}
})


test('P112: an absolutely positioned error cannot be a MUI spaced Stack child', () => {
  const container = source.indexOf('<Box component="section" data-xdrive-gallery-places-viewport')
  const error = source.indexOf('<Typography data-xdrive-places-viewport-error', container)
  const results = source.indexOf('<Stack spacing={1} aria-busy={viewportLoading}>', container)
  const firstTile = source.indexOf('data-xdrive-places-viewport-results', results)
  assert.ok(container >= 0 && error > container && results > error && firstTile > results,
    'original error must be a sibling BEFORE the result Stack, not its child')
  assert.ok(source.slice(error, results).includes('</Typography>'),
    'the entire error element must close before the original Stack begins')
  assert.equal(source.slice(results, firstTile).includes('data-xdrive-places-viewport-error'), false,
    'MUI Stack sibling margin selectors must not see an absolutely positioned error child')
})


test('bounded native map cancels a prior Owner generation before a new Owner appears', async () => {
  const first = deferred(), second = deferred()
  const calls = []
  const port = (bounds, detail, signal) => {
    const pending = calls.length === 0 ? first : second
    calls.push({ bounds, detail, signal })
    return pending.promise
  }
  const oldOwner = { id: 'place:1:1', name: 'old-owner', item_count: 1,
    sample_latitude: 0.01, sample_longitude: 0.01 }
  const newOwner = { id: 'place:2:2', name: 'new-owner', item_count: 2,
    sample_latitude: 0.02, sample_longitude: 0.02 }
  const config = async () => ({ provider: 'baidu-jsapi-4.0', browser_ak: 'test', revision: 1 })
  const props = { places: [oldOwner], diagnosticScope: 'user-one',
    listPlacesMapOverview: port, getBaiduJSAPIPrototype: config, onOpenPlace: () => {} }
  let view
  try {
    await act(async () => { view = TestRenderer.create(React.createElement(MapView, props)) })
    const native = () => view.root.findByType('prototype-map-fixture')
    assert.deepEqual(native().props.places, [])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].detail, false)
    assert.deepEqual(calls[0].bounds, {west:-180,south:-85,east:180,north:85})
    assert.ok(!Object.hasOwn(native().props, 'placesFromParent'),
      'parent must never pass unverified Owner GPS points to Baidu SDK')
    await act(async () => {
      view.update(React.createElement(MapView, {
        ...props, diagnosticScope: 'user-two', places: [oldOwner],
      }))
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].signal.aborted, true, 'old Owner request must be aborted')
    assert.deepEqual(native().props.places, [], 'new Owner remount starts with no old GPS')
    await act(async () => {
      first.resolve({ items:[oldOwner], total_photo_count:1, aggregated:true })
      await Promise.resolve()
    })
    assert.deepEqual(native().props.places, [],
      'delayed first Owner reply must not repopulate the new native map')
    await act(async () => {
      second.resolve({ items:[newOwner], total_photo_count:2, aggregated:true })
      await Promise.resolve()
    })
    assert.deepEqual(native().props.places.map(p => p.id), [newOwner.id])
    const nativeSource = fs.readFileSync(path.join(root,
      'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'),'utf8')
    assert.ok(nativeSource.includes('listPlacesMapOverview(bounds, detail, controller.signal)'))
    assert.ok(nativeSource.includes('request?.abort()'))
    assert.ok(nativeSource.includes('if (disposed || controller.signal.aborted) return'))
    assert.ok(!source.includes('listPlacesPage(100,offset)'))

  } finally {
    if (view) await act(async () => { view.unmount() })
  }
})
