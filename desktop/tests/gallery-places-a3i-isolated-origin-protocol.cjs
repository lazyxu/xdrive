'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const file = 'ui/shared/src/media-gallery-baidu-isolated-origin-protocol.ts'
const original = fs.readFileSync(path.join(root, file), 'utf8')
const transpiled = ts.transpileModule(original, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
assert.deepEqual(transpiled.diagnostics || [], [])
const m = new Module(file, module)
m.filename = path.join(root, file)
m.paths = module.paths
m._compile(transpiled.outputText, m.filename)
const {
  xDriveValidBaiduIsolatedBoundary,
  xDriveParseBaiduIsolatedChildEvent,
  xDriveCreateBaiduIsolatedCellsMessage,
  xDriveCreateBaiduIsolatedCameraMessage,
  XDRIVE_BAIDU_ISOLATED_MAX_CELLS,
} = m.exports

const childWindow = {}
const childWindowEvil = {}
const nonce = 'abcdef0123456789abcdef0123456789'
const boundary = () => ({
  parentOrigin: 'https://gallery.example.com',
  childOrigin: 'https://baidu-map.example.net',
  childWindow, generation: 7, nonce,
})
const input = (kind, more = {}) => ({
  origin: boundary().childOrigin, source: childWindow,
  data: { version: 1, generation: 7, nonce, kind, ...more },
})
const point = (key = '0123456789abcdef0123456789abcdef') => ({
  key, latitude: 35.24, longitude: 119.61, count: 2,
})

test('independent HTTPS origins are mandatory, never same-document sandbox', () => {
  assert.equal(xDriveValidBaiduIsolatedBoundary(boundary()), true)
  for (const origin of [
    'http://baidu-map.example.net',
    'https://baidu-map.example.net/',
    'https://gallery.example.com',
    'null',
    'javascript:alert(1)',
    'https://user:pass@baidu-map.example.net',
    'https://baidu-map.example.net/a',
  ]) {
    assert.equal(xDriveValidBaiduIsolatedBoundary({
      ...boundary(), childOrigin: origin,
    }), false, origin)
  }
  assert.equal(xDriveValidBaiduIsolatedBoundary({
    ...boundary(), generation: 0,
  }), false)
  assert.equal(xDriveValidBaiduIsolatedBoundary({
    ...boundary(), nonce: '1234',
  }), false)
  assert.equal(xDriveValidBaiduIsolatedBoundary({
    ...boundary(), token: 'should-not-exist',
  }), false)
})

test('every message requires exact origin AND matching WindowProxy generation/nonce', () => {
  const good = input('ready')
  assert.deepEqual(xDriveParseBaiduIsolatedChildEvent(good, boundary()), good.data)
  assert.equal(xDriveParseBaiduIsolatedChildEvent({
    ...good, source: childWindowEvil,
  }, boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent({
    ...good, origin: 'https://gallery.example.com',
  }, boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent({
    ...good, origin: 'null',
  }, boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('ready', {
    generation: 6,
  }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('ready', {
    nonce: '0'.repeat(32),
  }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('ready', {
    jwt: 'sensitive',
  }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('fetch', {
    url: '/api/v1/media/items',
  }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('cancel'), boundary()).kind, 'cancel')
})

test('camera is strictly tagged BD09LL and camera JSON cannot carry secrets', () => {
  const camera = { coordinate_space: 'bd09ll', latitude: 40.12,
    longitude: 116.43, zoom: 14 }
  const packet = xDriveParseBaiduIsolatedChildEvent(input('camera', { camera }), boundary())
  assert.deepEqual(packet.camera, camera)
  for (const invalid of [
    { ...camera, coordinate_space: 'wgs84' },
    { ...camera, latitude: 91 },
    { ...camera, latitude: NaN },
    { ...camera, zoom: 2 },
    { ...camera, zoom: 9.4 },
    { ...camera, originalGPS: 'private EXIF' },
  ]) assert.equal(xDriveParseBaiduIsolatedChildEvent(
    input('camera', { camera: invalid }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('camera', {
    camera, ak: 'must-not-forward',
  }), boundary()), null)
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('ready', {
    filler: 'a'.repeat(4000),
  }), boundary()), null)
})

test('Cell click carries only ephemeral opaque key; cannot authorize media/owner', () => {
  const key = point().key
  assert.equal(xDriveParseBaiduIsolatedChildEvent(input('activate-cell', { key }),
    boundary()).key, key)
  for (const unsafe of [
    input('activate-cell', { key: '5' }),
    input('activate-cell', { key: 'node-12345678901234567890123456789' }),
    input('activate-cell', { key, node_id: 3 }),
    input('activate-cell', { key, asset_id: 9 }),
    input('activate-cell', { key, photo_url: '/private/a.jpg' }),
  ]) assert.equal(xDriveParseBaiduIsolatedChildEvent(unsafe, boundary()), null)
})

test('outbound keeps 64 authorized anonymous BD09 samples only, no URL/pixels', () => {
  const valid = xDriveCreateBaiduIsolatedCellsMessage(boundary(), [point()])
  assert.equal(valid.kind, 'cells')
  assert.equal(valid.cells.length, 1)
  assert.deepEqual(Object.keys(valid.cells[0]).sort(), ['count','key','latitude','longitude'])
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [ { ...point(), node_id: 1 } ]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [ { ...point(), mediaUrl: '/api/v1/blob?token=sensitive' } ]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [ { ...point(), imageData: new Uint8Array(5) } ]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [point(), point()]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [ { ...point(), latitude: -95 } ]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    [ { ...point(), count: 0 } ]), null)
  assert.equal(xDriveCreateBaiduIsolatedCellsMessage(boundary(),
    Array.from({length:XDRIVE_BAIDU_ISOLATED_MAX_CELLS+1},(_,i) =>
      point(i.toString(16).padStart(32,'0')))), null)
})

test('traps malicious getters and never treats the parser as actual isolation', () => {
  const dangerous = Object.create(null)
  Object.defineProperty(dangerous, 'kind', {
    enumerable: true, get: () => { throw new Error('untrusted trap') },
  })
  // Access to objects with thrown getters must fail closed rather than throw
  // from any security-facing caller (the browser structured-clone path itself
  // will not preserve accessors).
  assert.equal(xDriveParseBaiduIsolatedChildEvent({
    origin: boundary().childOrigin, source: childWindow, data: dangerous,
  }, boundary()), null)
  // This contract is inert and cannot replace an independently hosted iframe.
  assert.equal(/appendChild\(script\)/.test(original), false)
})

test('one-time BD09 return camera cannot contain Owner or private EXIF', () => {
  const valid={coordinate_space:'bd09ll',latitude:35.5,longitude:139.4,zoom:12}
  const msg=xDriveCreateBaiduIsolatedCameraMessage(boundary(),valid)
  assert.deepEqual(msg,{version:1,generation:7,nonce,kind:'restore-camera',camera:valid})
  assert.deepEqual(Object.keys(msg.camera).sort(),['coordinate_space','latitude','longitude','zoom'])
  for(const candidate of [
    {...valid,coordinate_space:'wgs84'}, {...valid,photo_url:'/private/blob'},
    {...valid,asset_id:90}, {...valid,latitude:NaN}, {...valid,zoom:19},
    {...valid,zoom:3.5},
  ]) assert.equal(xDriveCreateBaiduIsolatedCameraMessage(boundary(),candidate),null)
  assert.equal(xDriveCreateBaiduIsolatedCameraMessage({...boundary(),nonce:'bad'},valid),null)
})
