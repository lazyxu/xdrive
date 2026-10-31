'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const reader = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const model = read('ios/XDriveIOS/NativeOwnerPhotoMapOverview.swift')

test('native Owner WGS84 map overview uses existing HTTPS-only bounded authenticated reader', () => {
  assert.match(reader, /func mapOverview\(/)
  assert.match(reader, /XDriveIOSNativeOwnerMapOverviewPolicy\.validBounds\(bounds\)/)
  assert.match(reader, /endpoint\("\/api\/v1\/media\/places\/overview", query: query\)/)
  for (const name of ['west', 'south', 'east', 'north']) {
    assert.ok(reader.includes('URLQueryItem(name: "' + name + '", value: String(bounds.' + name + '))'))
  }
  assert.match(reader, /read\(url, maximum: XDriveIOSNativeOwnerMapOverviewPolicy\.maximumBytes\)/)
  assert.match(reader, /XDriveIOSNativeOwnerMapOverviewPolicy\.valid\(overview\)/)
  assert.match(reader, /components\.scheme == "https"/)
  assert.match(reader, /XDriveIOSNativeMediaRejectRedirect/)
  assert.match(reader, /request\.setValue\("Bearer " \+ accessToken, forHTTPHeaderField: "Authorization"\)/)
})
test('64-cell WGS84 map representatives are bounded and separate from photo GPS or Baidu', () => {
  assert.match(model, /static let maximumCells = 64/)
  assert.match(model, /static let maximumBytes = 2 \* 1_048_576/)
  assert.match(model, /b\.west != b\.east/)
  assert.match(model, /identities\.insert\(item\.id\)\.inserted/)
  assert.match(model, /item\.item_count > 0/)
  assert.match(model, /item\.latitude\.isFinite/)
  assert.match(model, /item\.longitude\.isFinite/)
  assert.match(model, /item\.coordinate_kind == "grid_cell_center"/)
  assert.doesNotMatch(model, /URLSession|Bearer|MKMapView|PHAsset|UserDefaults/)
})
