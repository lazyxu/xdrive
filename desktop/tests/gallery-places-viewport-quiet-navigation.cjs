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
    '../media-gallery-baidu-native-camera-session': {
      xDriveValidBaiduNativeCameraSnapshot: () => false,
    },
    '../media-gallery-baidu-diagnostics': {
      xDriveRecordBaiduMapDiagnostic: () => {},
      xDriveClassifyBaiduMapRequestFailure: () => 'status_unavailable',
      xDriveReadBaiduMapDiagnostic: () => null,
      xDriveSubscribeBaiduMapDiagnostics: () => () => {},
      xDriveBaiduMapDiagnosticDetails: {},
      XDRIVE_BAIDU_DIAGNOSTIC_TTL_MS: 10_000,
    },
    './MediaGalleryBaiduIsolatedPhotoSurface': {
      XDriveMediaGalleryBaiduIsolatedPhotoSurface: props =>
        React.createElement('isolated-child', props),
    },
  }
  mod.require = name => Object.hasOwn(injected, name) ? injected[name] : requireOriginal(name)
  mod._compile(output, mapFile)
  return mod.exports.XDriveMediaGalleryPlacesMap
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
}
async function render(props) {
  let view
  await act(async () => {
    view = Renderer.create(React.createElement(PlacesMap, { ...base, ...props }))
    await Promise.resolve()
  })
  return view
}

test('Server release denial does not mount native SDK or any static/legacy fallback', async () => {
  const view = await render({ getBaiduJSAPI4Status: async () => ({
    provider:'baidu-jsapi-4.0', enabled:true, activation_state:'server_release_blocked',
  }) })
  assert.equal(view.root.findAllByType('isolated-child').length, 0)
  assert.equal(view.root.findAll(node => node.props['data-xdrive-baidu-map-unavailable'] !== undefined).length, 1)
  assert.doesNotMatch(original, /MediaGalleryBaiduStaticMap|MediaGalleryBaiduPrototypeMap/)
  await act(async () => view.unmount())
})

test('Only authorized_signed_release mounts independently isolated HTTPS JSAPI4 child', async () => {
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
  let opened = 0
  const view = await render({ onOpenSecureDesktopMap: () => { opened++ } })
  assert.equal(view.root.findAllByType('isolated-child').length, 0)
  const links = view.root.findAll(node => node.type === 'button' &&
    String(node.props.children).includes('独立 HTTPS 安全窗口'))
  assert.equal(links.length, 1)
  await act(async () => { links[0].props.onClick() })
  assert.equal(opened, 1)
  await act(async () => view.unmount())
})
