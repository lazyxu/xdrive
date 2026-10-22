'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const code = read('ui/shared/src/media-gallery-baidu-jsapi4-markers.ts')
const compiled = ts.transpileModule(code, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText
const mod = { exports: {} }
new Function('module', 'exports', compiled)(mod, mod.exports)
const { xDrivePrepareBaiduJSAPI4MarkerWindow: prepare,
  xDriveConvertBaiduJSAPI4MarkerWindow: convert,
  XDRIVE_BAIDU_JSAPI4_MAX_MARKER_CELLS: maxCells,
  XDRIVE_BAIDU_JSAPI4_CONVERSION_BATCH: batchSize } = mod.exports

function page(n) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: 'place:' + i + ':' + i,
    latitude: 81, longitude: 81, // synthetic GRID CENTER: must never become Marker GPS
    coordinate_kind: 'grid_cell_center',
    sample_latitude: i / 100, sample_longitude: i / 100,
    item_count: 2, name: 'fictional',
  }))
  return { items, total_count: n, total_photo_count: n * 2, offset: 0,
    limit: maxCells, has_more: false }
}

test('A3b3a3a only real WGS84 samples enter bounded markers, including GPS 0/0', () => {
  const p = page(2)
  const result = prepare(p)
  assert.equal(result.kind, 'ready')
  assert.equal(result.totalPhotoCount, 4)
  assert.deepEqual(result.markers[0], { placeID: 'place:0:0', latitude: 0,
    longitude: 0, photoCount: 2 })
  assert.deepEqual(result.markers[1], { placeID: 'place:1:1', latitude: 0.01,
    longitude: 0.01, photoCount: 2 })
  assert.deepEqual(prepare(page(0)), { kind: 'ready', markers: [], totalPhotoCount: 0 })
})

test('A3b3a3a 100k cell count never materializes or misrepresents partial cluster', () => {
  const p = page(maxCells)
  p.total_count = 100000
  p.total_photo_count = 200000
  p.has_more = true
  assert.deepEqual(prepare(p), { kind: 'incomplete',
    totalCells: 100000, totalPhotoCount: 200000 })
  const short = page(10)
  short.total_count = 11
  short.total_photo_count = 22
  short.has_more = true
  assert.equal(prepare(short).kind, 'incomplete')
  assert.equal(prepare({ ...page(10), offset: 10 }).kind, 'incomplete')
  assert.equal(prepare({ ...page(10), has_more: true }).kind, 'incomplete')
  assert.equal(prepare({ ...page(10), items: [...page(10).items, ...page(10).items] }).kind, 'incomplete')
  assert.equal(prepare(page(101)).kind, 'invalid')
})

test('A3b3a3a rejects absent/mismatched metadata rather than inventing coordinates', () => {
  const cases = [
    { sample_latitude: undefined }, { sample_longitude: undefined },
    { sample_latitude: NaN }, { sample_longitude: Infinity },
    { sample_latitude: 0.02 }, { sample_longitude: -0.001 },
    { sample_longitude: 181 }, { sample_latitude: 91 },
    { coordinate_kind: 'photo' }, { item_count: 0 },
    { item_count: 1.5 }, { id: 'place:00:0' }, { id: 'place:9001:0' },
    { id: 'place:1:1' },
  ]
  for (const update of cases) {
    const p = page(2)
    p.items[0] = { ...p.items[0], ...update }
    assert.equal(prepare(p).kind, 'invalid', JSON.stringify(update))
  }
  assert.equal(prepare({ ...page(2), total_photo_count: 3 }).kind, 'invalid')
  assert.equal(prepare({ ...page(2), limit: 101 }).kind, 'invalid')
  assert.equal(prepare({ ...page(2), limit: 1 }).kind, 'invalid')
  const pole = page(1)
  pole.items[0].sample_latitude = 90
  pole.items[0].id = 'place:9000:0'
  assert.equal(prepare(pole).kind, 'out-of-map-range')
  const cancelled = new AbortController()
  cancelled.abort()
  assert.equal(prepare(page(1), cancelled.signal).kind, 'cancelled')
})

test('A3b3a3a official WGS84(1) to BD09(5) conversion only, 10-cell chunks', async () => {
  const source = page(23)
  const ready = prepare(source)
  assert.equal(ready.kind, 'ready')
  const calls = []
  // Fictional transformer fixture, NOT the real BD-09 correction.
  const convertor = { translate(points, from, to, callback) {
    calls.push({ n: points.length, from, to })
    callback({ status: 0, points: points.map(p => ({ lng: p.lng + 0.01, lat: p.lat + 0.01 })) })
  } }
  const converted = await convert(ready, convertor, (lng, lat) => ({ lng, lat }))
  assert.deepEqual(calls, [{ n: 10, from: 1, to: 5 },
    { n: 10, from: 1, to: 5 }, { n: 3, from: 1, to: 5 }])
  assert.equal(batchSize, 10)
  assert.equal(converted.type, 'FeatureCollection')
  assert.equal(converted.features.length, 23)
  assert.deepEqual(converted.features[0], {
    type: 'Feature', id: 'place:0:0',
    geometry: { type: 'Point', coordinates: [0.01, 0.01] },
    properties: { place_id: 'place:0:0', photo_count: 2 },
  })
  assert.equal(source.items[0].sample_latitude, 0, 'never overwrite source WGS84')
  assert.equal(source.items[0].latitude, 81, 'never use grid center for conversion')
})

test('bounded server map-region samples use official conversion with exact 8x8 validation', async () => {
  const marker = { placeID:'map-region:-180:-85:180:85:4:1',
    latitude:20, longitude:-100, photoCount:42 }
  const convertor = { translate(points, from, to, callback) {
    assert.equal(from,1);assert.equal(to,5)
    callback({status:0, points:points.map(p=>({lng:p.lng+0.005,lat:p.lat+0.005}))})
  } }
  const output = await convert({kind:'ready',markers:[marker],totalPhotoCount:42},
    convertor,(lng,lat)=>({lng,lat}))
  assert.equal(output.features.length,1)
  assert.equal(output.features[0].properties.photo_count,42)
  assert.equal(output.features[0].id,marker.placeID)
  for(const invalid of [
    {...marker,placeID:'map-region:-180:-85:180:85:2:1'},
    {...marker,placeID:'map-region:-180:-85:180:85:4:8'},
    {...marker,placeID:'map-region:-180:-85:180:85:4:1:forged'},
    {...marker,latitude:90},
    {...marker,photoCount:0},
  ]) await assert.rejects(
    convert({kind:'ready',markers:[invalid],totalPhotoCount:invalid.photoCount},
      convertor,(lng,lat)=>({lng,lat})),
    /markers_unavailable/,
  )
})


test('Jinhua adaptive Owner region IDs retain multiple real GPS positions in JSAPI', async () => {
  // The old global 8x8 encoded one 45-degree longitude bucket for all of
  // these locations. Only the SERVER chooses real fitted bounds; the client
  // validates each region and still uses only the official Convertor.
  const coords=[
    [29.08,119.27],[29.21,119.54],[29.34,119.81],[29.45,120.08],
    [28.95,119.72],[29.52,119.36],[29.75,119.89],[29.12,120.15],
  ]
  const west=119.26,south=28.94,east=120.16,north=29.76
  const markers=coords.map(([lat,lon],index)=>{
    const row=Math.min(7,Math.floor((lat-south)/(north-south)*8))
    const col=Math.min(7,Math.floor((lon-west)/(east-west)*8))
    return {placeID:`map-region:${west}:${south}:${east}:${north}:${row}:${col}`,
      latitude:lat,longitude:lon,photoCount:10+index}
  })
  const unique=new Set(markers.map(m=>m.placeID))
  assert.equal(unique.size,8,'distinct real GPS region IDs must not share world bucket')
  const sourceOnly=markers.reduce((sum,m)=>sum+m.photoCount,0)
  const calls=[]
  const translated=await convert({kind:'ready',markers,totalPhotoCount:sourceOnly},
    {translate(points,from,to,callback){
      calls.push({length:points.length,from,to})
      callback({status:0,points:points.map(point=>({
        lng:point.lng+0.005,lat:point.lat+0.005
      }))})
    }},(lng,lat)=>({lng,lat}))
  assert.equal(translated.features.length,8)
  assert.equal(new Set(translated.features.map(f=>f.id)).size,8)
  assert.deepEqual(calls,[{length:8,from:1,to:5}])
  assert.equal(translated.features.reduce((sum,f)=>sum+f.properties.photo_count,0),
    sourceOnly)
  const [longitude,latitude]=translated.features[0].geometry.coordinates
  assert.ok(Math.abs(longitude-119.275)<1e-9)
  assert.ok(Math.abs(latitude-29.085)<1e-9)
})

test('A3b3a3a converter fails closed on provider failure, cancellation and forged huge input', async () => {
  const ready = prepare(page(1))
  const point = (lng, lat) => ({ lng, lat })
  await assert.rejects(convert(ready, { translate(_p, _f, _t, cb) {
    cb({ status: 1, points: [{ lng: 0, lat: 0 }] })
  } }, point), /conversion_unavailable/)
  await assert.rejects(convert(ready, { translate(_p, _f, _t, cb) {
    cb({ status: 0, points: [] })
  } }, point), /conversion_unavailable/)
  await assert.rejects(convert(ready, { translate(_p, _f, _t, cb) {
    cb({ status: 0, points: [{ lng: NaN, lat: 0 }] })
  } }, point), /conversion_unavailable/)
  await assert.rejects(convert(ready, { translate() { throw Error('raw GPS or AK must never escape') } },
    point), /conversion_unavailable/)
  await assert.rejects(convert({ kind: 'incomplete', totalCells: 101, totalPhotoCount: 202 },
    { translate() { throw Error('should not be invoked') } }, point), /markers_unavailable/)
  const huge = { kind: 'ready', markers: Array.from({ length: 100000 },
    (_, i) => ({ placeID: 'place:' + i + ':0', latitude: 0, longitude: 0, photoCount: 1 })),
    totalPhotoCount: 100000 }
  await assert.rejects(convert(huge,
    { translate() { throw Error('must never invoke provider') } }, point), /markers_unavailable/)

  const abort = new AbortController()
  let deferred
  const pending = convert(ready, { translate(_p, _f, _t, cb) { deferred = cb } },
    point, abort.signal)
  abort.abort()
  await assert.rejects(pending, /conversion_cancelled/)
  deferred({ status: 0, points: [{ lng: 0, lat: 0 }] }) // late result is discarded
})

test('A3b3a3a no JSAPI runtime, alternate basemap, AK leak or unauthorized data source', () => {
  const policy = read('internal/baidumapjsapi/resource_policy.go')
  const pageSource = read('ui/shared/src/mui/MediaGallery.tsx')
  const mapSource = read('ui/shared/src/mui/MediaGalleryPlacesMap.tsx')
  assert.match(policy, /return ErrGateClosed/)
  assert.match(policy, /reviewedJSAPI4ChildResourceCount = 1/)
  assert.match(pageSource, /listPlacesViewport=\{source\.listPlacesViewport\}/)
  assert.match(mapSource, /listPlacesViewport\(viewportBounds, 24, viewportOffset, controller\.signal\)/)
  assert.doesNotMatch(code, /BMAP_PROXY_URL|api\.map\.baidu\.com|new BMap\.|localStorage|fetch\(/)
  const prepOnly = code.slice(code.indexOf('export function xDrivePrepare'),
    code.indexOf('export interface XDriveBaiduOfficialPoint'))
  assert.doesNotMatch(prepOnly, /item\.latitude\b|item\.longitude\b/)
})
