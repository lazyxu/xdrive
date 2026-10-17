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
const galleryMap = compile(uiFile,{
  '@mui/material':stub,
  './useDeferredLoading':hook,
  './MediaGalleryBaiduStaticMap':{
    XDriveMediaGalleryBaiduStaticMap: props =>
      React.createElement('map-fixture',{onViewportChange:props.onViewportChange}),
  },
  '../media-gallery-places-camera-session':{
    xDriveValidPlacesCameraSnapshot:()=>false,
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
