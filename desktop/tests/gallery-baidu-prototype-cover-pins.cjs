'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '../..')
const modulePath = 'ui/shared/src/media-gallery-baidu-prototype-cover-pins.ts'
const code = ts.transpileModule(fs.readFileSync(path.join(root, modulePath), 'utf8'), {
  fileName: modulePath, reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
assert.deepEqual(code.diagnostics ?? [], [])
const result = { exports: {} }
new Function('module', 'exports', 'require', code.outputText)(
  result, result.exports,
  () => { throw Error('the trusted projection helper must have no runtime imports') },
)
const { xDriveProjectBaiduPrototypeCoverPins: project,
  XDRIVE_BAIDU_PROTOTYPE_COVER_MAX: max, XDRIVE_BAIDU_PROTOTYPE_COVER_MIN_ZOOM: minZoom,
} = result.exports
const place = (id, count, x, y, cover = 50) => ({
  id, name: id, item_count: count, cover_node_id: cover,
  sample_latitude: y, sample_longitude: x,
})
const collection = (...items) => ({
  type: 'FeatureCollection',
  features: items.map(([id, count, x, y]) => ({
    type: 'Feature', id,
    geometry: { type: 'Point', coordinates: [x, y] },
    properties: { place_id: id, photo_count: count },
  })),
})
const BMap = { Point: class { constructor(lng, lat) { this.lng = lng; this.lat = lat } } }
const makeMap = (zoom = minZoom, bounds = null) => ({
  getZoom: () => zoom,
  pointToPixel: p => ({ x: p.lng, y: p.lat }),
  getBounds: bounds ? () => ({
    getSouthWest: () => ({ lng: bounds[0], lat: bounds[1] }),
    getNorthEast: () => ({ lng: bounds[2], lat: bounds[3] }),
  }) : undefined,
})

test('native cluster owns zoom levels 3–16; only unclustered level 17 shows Owner cover pins', () => {
  const p = place('place:5000:3000', 14, 150, 150, 51)
  const data = collection([p.id, p.item_count, 150, 150])
  assert.deepEqual(project(data, [p], makeMap(16), BMap, 600, 500), [])
  assert.deepEqual(project(data, [p], makeMap(17), BMap, 600, 500), [{
    placeID: p.id, nodeID: 51, photoCount: 14, name: p.id, x: 150, y: 150,
  }])
})

test('stale Owner marker, expired count, missing cover or invalid position never produces a thumbnail', () => {
  const a = place('place:5000:3000', 4, 150, 150, 21)
  const b = place('place:5010:3010', 6, 250, 160, 22)
  const data = collection([a.id, 3, 150, 150], [b.id, 6, 250, 160])
  const map = makeMap()
  assert.deepEqual(project(data, [a], map, BMap, 600, 500), [])
  assert.equal(project(data, [a, {...b, cover_node_id: 0}], map, BMap, 600, 500).length, 0)
  const pins = project(data, [a, b], map, BMap, 600, 500)
  assert.deepEqual(pins.map(p => p.nodeID), [22])
  assert.equal(project(collection([b.id, 6, Number.NaN, 160]),
    [b], map, BMap, 600, 500).length, 0)
})

test('overlapping representatives retain highest photo count, and bound all thumbnail work', () => {
  const items = Array.from({length: 180}, (_, n) => {
    const id = 'place:' + (n+1000) + ':1500'
    return place(id, n+1, 120 + n*0.2, 170, 200+n)
  })
  const data = collection(...items.map(p =>
    [p.id, p.item_count, p.sample_longitude, p.sample_latitude]))
  const pins = project(data, items, makeMap(), BMap, 600, 500)
  assert.ok(pins.length <= max)
  assert.equal(pins.length, 1)
  assert.equal(pins[0].photoCount, 180)
})

test('one dense city cannot crowd other visible cities out of limited pins', () => {
  const dense = Array.from({ length: 150 }, (_, n) =>
    place('place:' + (2000+n) + ':1', 100+n, 120+n*0.1, 180, 500+n))
  const remote = place('place:9000:1', 1, 450, 180, 999)
  const items = [...dense, remote]
  const data = { type: 'FeatureCollection',
    features: items.map(p => ({ type: 'Feature', id: p.id,
      geometry: { type: 'Point', coordinates: [p.sample_longitude, p.sample_latitude] },
      properties: { place_id: p.id, photo_count: p.item_count },
    })),
  }
  const pins = project(data, items, makeMap(), BMap, 600, 500)
  assert.equal(pins.length, 2)
  assert.ok(pins.some(p => p.nodeID === 999),
    'other visible cities must remain discoverable')
  assert.ok(pins.some(p => p.photoCount === 249),
    'dense region still uses its most representative photo cover')
})

test('100k non-visible points are excluded before native projection, no full-grid thumbnails', () => {
  const items = Array.from({length:100000}, (_, n) => {
    const id = 'place:' + (n+10000) + ':1'
    return place(id, 1, n === 99999 ? 160 : -100, 150, n+1)
  })
  const data = { type: 'FeatureCollection',
    features: items.map(p => ({ type: 'Feature', id: p.id,
      geometry: { type: 'Point', coordinates: [p.sample_longitude, p.sample_latitude] },
      properties: { place_id: p.id, photo_count: 1 },
    })),
  }
  let projected = 0
  const map = makeMap(18, [100, 100, 200, 200])
  map.pointToPixel = p => {
    projected++
    return {x:p.lng, y:p.lat}
  }
  const pins = project(data, items, map, BMap, 600, 500)
  assert.equal(projected, 1)
  assert.equal(pins.length, 1)
  assert.equal(pins[0].nodeID, 100000)
})

test('SDK projects BD09, never returns credentials or source WGS84 to its GeoJSON', () => {
  const input = fs.readFileSync(path.join(root,
    'ui/shared/src/mui/MediaGalleryBaiduPrototypeMap.tsx'), 'utf8')
  assert.match(input, /clusterMaxZoom: 16/)
  assert.match(input, /runtime\.map\.pointToPixel|map\.pointToPixel/)
  assert.match(input, /<XDriveMediaGalleryCoverThumbnail/)
  assert.match(input, /loadThumbnail=\{loadThumbnail\}/)
  assert.match(input, /<Box component="button"/)
  assert.doesNotMatch(input, /properties: \{[^}]*thumbnailUrl/)
})
