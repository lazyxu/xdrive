'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const Renderer = require('react-test-renderer')
const { act } = Renderer
const mapScopeHelper = require('./helpers/load-baidu-map-scope.cjs')
const root = path.resolve(__dirname, '../..')
const mapFile = path.join(root, 'ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
const original = fs.readFileSync(mapFile, 'utf8')

function loadSharedMap() {
  const output = ts.transpileModule(original, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }}).outputText
  const mod = new Module(mapFile, module)
  mod.filename = mapFile
  mod.paths = Module._nodeModulePaths(path.join(root, 'desktop'))
  const requireOriginal = mod.require.bind(mod)
  const mui = Object.fromEntries([
    'Autocomplete', 'Box', 'Button', 'Chip', 'CircularProgress', 'MenuItem', 'Paper', 'Stack',
    'TextField', 'Typography',
  ].map(name => [name, name.toLowerCase()]))
  const injected = {
    '@mui/material': mui,
    '../media-gallery-baidu-map-photo-scope': mapScopeHelper,
    '../media-gallery-baidu-native-camera-session': {
      xDriveValidBaiduNativeCameraSnapshot: camera => Boolean(camera &&
        camera.coordinate_space === 'bd09ll' && Number.isFinite(camera.latitude) &&
        Math.abs(camera.latitude) <= 85 && Number.isFinite(camera.longitude) &&
        Math.abs(camera.longitude) <= 180 && Number.isInteger(camera.zoom) &&
        camera.zoom >= 3 && camera.zoom <= 18),
    },
    '../media-gallery-baidu-diagnostics': {
      xDriveRecordBaiduMapDiagnostic: () => {},
      xDriveClassifyBaiduMapRequestFailure: () => 'status_unavailable',
      xDriveReadBaiduMapDiagnostic: () => null,
      xDriveSubscribeBaiduMapDiagnostics: () => () => {},
      xDriveBaiduMapDiagnosticDetails: {},
      XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS: 10_000,
    },
    '../media-gallery-places-map-mode': {
      xDrivePlacesMapModeFromHref: href => href.includes('places_map_mode=isolated')
        ? 'isolated' : 'prototype',
      xDrivePlacesMapModeNavigationURL: (href, mode) => {
        const url = new URL(href)
        if (mode === 'isolated') url.searchParams.set('places_map_mode', 'isolated')
        else url.searchParams.delete('places_map_mode')
        return url.href
      },
      xDrivePlacesMapScopeHandoffURL: (href, mode, ticket) => {
        if (!/^[a-f0-9]{64}$/.test(ticket)) return null
        const url = new URL(href)
        if (mode === 'isolated') url.searchParams.set('places_map_mode', 'isolated')
        else url.searchParams.delete('places_map_mode')
        url.searchParams.set('places_map_handoff',ticket)
        return url.href
      },
    },
    './MediaGalleryBaiduPrototypeMap': {
      XDriveMediaGalleryBaiduPrototypeMap: props =>
        React.createElement('old-prototype', props),
    },
    './MediaGalleryBaiduIsolatedPhotoSurface': {
      XDriveMediaGalleryBaiduIsolatedPhotoSurface: props =>
        React.createElement('isolated-child', props),
    },
    // P0-01 extracted an opt-in diagnostic. Keep this map-lifecycle test
    // scoped to the map: coverage is exercised by its own contract tests.
    './MediaGalleryMapGPSCoverage': {
      XDriveMediaGalleryMapGPSCoverage: props =>
        React.createElement('gps-coverage', props),
    },
  }
  mod.require = name => Object.hasOwn(injected, name) ? injected[name] : requireOriginal(name)
  mod._compile(output, mapFile)
  return mod.exports.XDriveMediaGalleryPlacesMap
}
global.window = {
  location: { href: 'https://gallery.example.test/gallery', replace(href) { this.href = href } },
  addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
}
const PlacesMap = loadSharedMap()
const place = { id:'place:40:-120', name:'GPS Photo Place',
  sample_latitude:40, sample_longitude:-120 }
const base = {
  places:[place],
  totalCount:1,
  listBaiduNativeCells:async () => ({ cells:[] }),
  mintBaiduIsolatedChildTicket:async () => ({ provider:'baidu-jsapi-4.0',
    child_origin:'https://map.example.test', ticket:'dummy' }),
  onOpenBaiduNativeCell:() => {},
  getBaiduJSAPIPrototype:async () => ({provider:'baidu-jsapi-4.0',browser_ak:'public-browser-ak',revision:1}),
  listPlacesMapOverview:async () => ({items:[],total_photo_count:0,aggregated:false}),
}
async function render(props) {
  let view
  await act(async () => {
    view = Renderer.create(React.createElement(PlacesMap, { ...base, ...props }))
    await Promise.resolve()
  })
  return view
}

test('default Web inline host requires signed release and reuses trusted BD09 Cells surface', async () => {
  global.window.location.href = 'https://gallery.example.test/gallery'
  const denied = await render({})
  assert.equal(denied.root.findAllByType('isolated-child').length, 0)
  assert.equal(denied.root.findAllByType('old-prototype').length, 0)
  await act(async () => denied.unmount())
  const view = await render({ getBaiduJSAPI4Status: async () => ({
    provider:'baidu-jsapi-4.0', enabled:true, activation_state:'authorized_signed_release',
    isolated_child_origin:'https://map.example.test',
  }) })
  const shared = view.root.findAllByType('isolated-child')
  assert.equal(shared.length, 1)
  assert.equal(shared[0].props.mode, 'inline')
  assert.equal(shared[0].props.listOwnerCells, base.listBaiduNativeCells)
  assert.equal(shared[0].props.getInlinePrototypeConfig, base.getBaiduJSAPIPrototype)
  assert.equal(view.root.findAllByType('old-prototype').length, 0)
  await act(async () => view.unmount())
})

test('Server release denial in selected isolation never automatically mounts prototype', async () => {
  global.window.location.href = 'https://gallery.example.test/?places_map_mode=isolated'
  const view = await render({ getBaiduJSAPI4Status: async () => ({
    provider:'baidu-jsapi-4.0', enabled:true, activation_state:'server_release_blocked',
  }) })
  assert.equal(view.root.findAllByType('isolated-child').length, 0)
  assert.equal(view.root.findAll(node => node.props['data-xdrive-baidu-map-unavailable'] !== undefined).length, 1)
  assert.equal(view.root.findAllByType('old-prototype').length, 0)
  assert.doesNotMatch(original, /MediaGalleryBaiduStaticMap/)
  await act(async () => view.unmount())
})

test('Only authorized_signed_release mounts independently isolated HTTPS JSAPI4 child', async () => {
  global.window.location.href = 'https://gallery.example.test/?places_map_mode=isolated'
  const view = await render({ getBaiduJSAPI4Status: async () => ({
    provider:'baidu-jsapi-4.0', enabled:true, activation_state:'authorized_signed_release',
    isolated_child_origin:'https://map.example.test',
  }) })
  const children = view.root.findAllByType('isolated-child')
  assert.equal(children.length, 1)
  assert.equal(children[0].props.childOrigin, 'https://map.example.test')
  assert.equal(view.root.findAll(node => node.props['data-xdrive-baidu-map-unavailable'] !== undefined).length, 0)
  await act(async () => { children[0].props.onFailure() })
  assert.equal(view.root.findAllByType('isolated-child').length, 0)
  assert.equal(view.root.findAll(node => node.props['data-xdrive-baidu-map-unavailable'] !== undefined).length, 1)
  await act(async () => view.unmount())
})

test('GPS place wall navigation remains available when SDK is blocked', async () => {
  global.window.location.href = 'https://gallery.example.test/gallery'
  let opened = ''
  const view = await render({
    getBaiduJSAPI4Status: async () => ({
      provider:'baidu-jsapi-4.0', enabled:false, activation_state:'server_release_blocked',
    }),
    onOpenPlace: p => { opened = p.id },
  })
  const openButtons = view.root.findAll(node =>
    node.type === 'button' && node.props.children === '查看此地点照片')
  assert.equal(openButtons.length, 1)
  await act(async () => { openButtons[0].props.onClick() })
  assert.equal(opened, place.id)
  await act(async () => view.unmount())
})

test('Desktop file renderer offers HTTPS-only map action but never injects third party scripts', async () => {
  global.window.location.href = 'https://gallery.example.test/gallery'
  let opened = 0
  const view = await render({ onOpenSecureDesktopMap: () => { opened++ } })
  assert.equal(view.root.findAllByType('isolated-child').length, 0)
  assert.equal(view.root.findAllByType('old-prototype').length, 0)
  const links = view.root.findAll(node => node.type === 'button' &&
    String(node.props.children).includes('独立 HTTPS 安全窗口'))
  assert.equal(links.length, 1)
  await act(async () => { links[0].props.onClick() })
  assert.equal(opened, 1)
  await act(async () => view.unmount())
})

test('P0-4 scoped mode switch redeems signed Owner ticket before replacing document',async()=>{
  global.window.location.href = 'https://gallery.example.test/gallery'
  let invoked=0
  const restricted={albumKey:'manual:Family',filters:{
    sort_by:'captured',sort_dir:'desc',favorite:true}}
  const view=await render({
    mapPhotoScope:restricted,
    onMapModeHandoff:async(scope,target,signal)=>{
      invoked++
      assert.equal(target,'isolated')
      assert.equal(scope.albumKey,'manual:Family')
      assert.equal(scope.filters.favorite,true)
      assert.equal(signal.aborted,false)
      return 'abcdef0123456789'.repeat(4)
    },
  })
  const button=view.root.findAll(node=>
    node.props['data-xdrive-map-mode-isolated']!==undefined)[0]
  assert.ok(button)
  await act(async()=>{button.props.onClick();await Promise.resolve();await Promise.resolve()})
  assert.equal(invoked,1)
  assert.equal(new URL(global.window.location.href).searchParams.get('places_map_handoff'),
    'abcdef0123456789'.repeat(4))
  assert.equal(new URL(global.window.location.href).searchParams.get('places_map_mode'),'isolated')
  assert.ok(!global.window.location.href.includes('manual:Family'))
  assert.ok(!global.window.location.href.includes('favorite'))
  await act(async()=>view.unmount())
})
test('P0-4 failed authenticated issue preserves the original restricted map',async()=>{
  global.window.location.href='https://gallery.example.test/gallery'
  const original=global.window.location.href
  const view=await render({
    mapPhotoScope:{albumKey:'',filters:{sort_by:'added',sort_dir:'asc',favorite:true}},
    onMapModeHandoff:async()=>{throw Error('deny')}
  })
  const button=view.root.findAll(node=>
    node.props['data-xdrive-map-mode-isolated']!==undefined)[0]
  await act(async()=>{button.props.onClick();await Promise.resolve();await Promise.resolve()})
  assert.equal(global.window.location.href,original)
  assert.ok(view.root.findAll(node=>node.props['data-xdrive-map-mode-scope-warning']!==undefined).length>=1)
  await act(async()=>view.unmount())
})

test('P0-4 preserves unrestricted BD09 camera in both map-mode directions',async()=>{
  const camera={coordinate_space:'bd09ll',latitude:30.135,longitude:119.975,zoom:12}
  const token='abcdef0123456789'.repeat(4)
  const scope={albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}}
  for(const [from,to] of [['prototype','isolated'],['isolated','prototype']]){
    global.window.location.href='https://gallery.example.test/gallery'+
      (from==='isolated'?'?places_map_mode=isolated':'')
    let issued=0
    const view=await render({
      initialNativeCamera:camera,mapPhotoScope:scope,
      onMapModeHandoff:async(actualScope,target,signal,actualCamera)=>{
        issued++
        assert.equal(target,to)
        assert.equal(signal.aborted,false)
        assert.deepEqual(actualScope,scope)
        assert.deepEqual(actualCamera,camera)
        return token
      },
    })
    const button=view.root.findAll(node=>
      node.props['data-xdrive-map-mode-'+to]!==undefined)[0]
    assert.ok(button)
    await act(async()=>{button.props.onClick();await Promise.resolve();await Promise.resolve()})
    assert.equal(issued,1)
    const href=new URL(global.window.location.href)
    assert.equal(href.searchParams.get('places_map_handoff'),token)
    assert.equal(href.searchParams.get('places_map_mode'),to==='isolated'?'isolated':null)
    assert.ok(!href.href.includes('30.135') && !href.href.includes('119.975'))
    await act(async()=>view.unmount())
  }
})

test('unrestricted map without a valid camera switches directly without a ticket',async()=>{
  global.window.location.href='https://gallery.example.test/gallery'
  let issued=0
  const view=await render({
    initialNativeCamera:{coordinate_space:'wgs84',latitude:30,longitude:119,zoom:12},
    mapPhotoScope:{albumKey:'',filters:{sort_by:'captured',sort_dir:'desc'}},
    onMapModeHandoff:async()=>{issued++;throw Error('must not issue')},
  })
  const button=view.root.findAll(node=>
    node.props['data-xdrive-map-mode-isolated']!==undefined)[0]
  await act(async()=>{button.props.onClick();await Promise.resolve()})
  assert.equal(issued,0)
  assert.equal(new URL(global.window.location.href).searchParams.get('places_map_mode'),'isolated')
  assert.equal(new URL(global.window.location.href).searchParams.has('places_map_handoff'),false)
  await act(async()=>view.unmount())
})
