const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const repo = path.join(__dirname, '..', '..')

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', 'require', output)(
    mod.exports,
    mod,
    (request) => require(request),
  )
  return mod.exports
}

const model = loadTypeScriptModule(path.join(
  repo,
  'ui',
  'shared',
  'src',
  'mui',
  'MediaGalleryPlacesMapModel.ts',
))

const {
  xDriveMediaPlacesCluster,
  xDriveMediaPlacesFitViewport,
  xDriveMediaPlacesNormalizeLongitude,
  xDriveMediaPlacesPanViewport,
  xDriveMediaPlacesProject,
} = model

function place(id, latitude, longitude, itemCount = 1) {
  return {
    id,
    name: id,
    latitude,
    longitude,
    item_count: itemCount,
  }
}

test('Gallery Places fit uses the short dateline arc', () => {
  const viewport = xDriveMediaPlacesFitViewport([
    place('east', 10, 179),
    place('west', 11, -179),
  ])
  assert.ok(
    Math.abs(Math.abs(viewport.centerLongitude) - 180) < 1,
    `center longitude=${viewport.centerLongitude}`,
  )
  assert.ok(viewport.zoom >= 3)
})

test('Gallery Places projection wraps longitude around the viewport center', () => {
  const viewport = {
    centerLatitude: 0,
    centerLongitude: 179,
    zoom: 3,
  }
  const east = xDriveMediaPlacesProject({
    latitude: 0,
    longitude: 179,
    viewport,
    width: 1000,
    height: 400,
  })
  const west = xDriveMediaPlacesProject({
    latitude: 0,
    longitude: -179,
    viewport,
    width: 1000,
    height: 400,
  })
  assert.ok(Math.abs(east.x - west.x) < 100)
})

test('Gallery Places clusters compact facets without loading media rows', () => {
  const places = [
    place('a', 1.350, 103.810, 10),
    place('b', 1.352, 103.812, 20),
    place('c', 31.230, 121.470, 30),
  ]
  const world = xDriveMediaPlacesCluster(places, 0)
  assert.equal(world.length, 2)
  assert.equal(world.reduce((total, cluster) => total + cluster.itemCount, 0), 60)

  const close = xDriveMediaPlacesCluster(places.slice(0, 2), 8)
  assert.ok(close.length >= 1)
  assert.equal(close.reduce((total, cluster) => total + cluster.places.length, 0), 2)
})

test('Gallery Places pan changes only viewport coordinates', () => {
  const start = { centerLatitude: 0, centerLongitude: 0, zoom: 2 }
  const moved = xDriveMediaPlacesPanViewport(start, 200, -100, 1000, 500)
  assert.notEqual(moved.centerLongitude, start.centerLongitude)
  assert.notEqual(moved.centerLatitude, start.centerLatitude)
  assert.equal(moved.zoom, start.zoom)
})

test('Gallery Places longitude normalization remains canonical', () => {
  assert.equal(xDriveMediaPlacesNormalizeLongitude(190), -170)
  assert.equal(xDriveMediaPlacesNormalizeLongitude(-190), 170)
  assert.equal(xDriveMediaPlacesNormalizeLongitude(0), 0)
})
