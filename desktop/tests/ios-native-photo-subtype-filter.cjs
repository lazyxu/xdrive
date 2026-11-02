'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const filter = read('ios/XDriveIOS/NativePhotoMediaFilterPolicy.swift')
const scanner = read('ios/XDriveIOS/NativeGalleryMediaScanner.swift')
const timeline = read('ios/XDriveIOS/NativePhotoTimelineBrowser.swift')
const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')

test('Live Photo and screenshot filters have unique PhotoKit-wide source identities', () => {
  assert.match(filter, /case all, photos, videos, favorites, livePhotos, screenshots/)
  assert.match(filter, /case \.livePhotos: return "实况"/)
  assert.match(filter, /case \.screenshots: return "截屏"/)
  assert.match(filter, /case \.photos, \.livePhotos, \.screenshots: return "image"/)
  assert.match(filter, /var requiresLive: Bool \{ self == \.livePhotos \}/)
  assert.match(filter, /var requiresScreenshot: Bool \{ self == \.screenshots \}/)
})

test('whole-library scanner queries real PHFetchResult subtypes and verifies loaded slots', () => {
  assert.match(scanner, /PHAssetMediaSubtype\.photoLive\.rawValue/)
  assert.match(scanner, /PHAssetMediaSubtype\.photoScreenshot\.rawValue/)
  assert.equal((scanner.match(/format: "\(\s*mediaSubtypes & %d\) != 0"/g) || []).length, 2)
  assert.match(scanner, /case \.livePhotos, \.screenshots:\s*result = PHAsset\.fetchAssets\(with: \.image, options: options\)/)
  assert.match(scanner, /filter\.requiresLive && !asset\.mediaSubtypes\.contains\(\.photoLive\)/)
  assert.match(scanner, /filter\.requiresScreenshot &&\s*!asset\.mediaSubtypes\.contains\(\.photoScreenshot\)/)
  assert.match(scanner, /!filter\.requiresLive \|\|\s*asset\.mediaSubtypes\.contains\(\.photoLive\)/)
  assert.match(scanner, /!filter\.requiresScreenshot \|\|\s*asset\.mediaSubtypes\.contains\(\.photoScreenshot\)/)
  assert.match(scanner, /let end = min\(snapshot\.count, start \+ 64\)/)
  assert.match(scanner, /observer\.current\(\) == version/)
  assert.doesNotMatch(scanner, /UploadSession|PhotoSyncLedger|UserDefaults/)
})

test('date jump uses identical live/screenshot predicate and exact filtered slot offsets', () => {
  for (const [name, subtype] of [
    ['livePhotos', 'photoLive'], ['screenshots', 'photoScreenshot']
  ]) {
    assert.match(timeline, new RegExp('mediaFilter\\.requires' + (name === 'livePhotos' ? 'Live' : 'Screenshot')))
    assert.match(timeline, new RegExp('PHAssetMediaSubtype\\.' + subtype + '\\.rawValue'))
  }
  assert.match(timeline, /case \.livePhotos, \.screenshots:\s*snapshot = PHAsset\.fetchAssets\(with: \.image, options: options\)/)
  assert.match(timeline, /mediaFilter\.includes\(kind: kind\)/)
  assert.match(timeline, /asset\.mediaSubtypes\.contains\(\.photoLive\)/)
  assert.match(timeline, /asset\.mediaSubtypes\.contains\(\.photoScreenshot\)/)
  assert.match(timeline, /result\.indexedMediaCount == result\.totalSlots/)
  assert.match(timeline, /model\.indexFilter == mediaFilter/)
  assert.match(timeline, /"所有实况（返回第一页）"/)
  assert.match(timeline, /"所有截屏（返回第一页）"/)
})

test('Gallery category selection is compact, invalidates offsets, and never rewrites backup', () => {
  assert.match(wall, /Picker\("媒体类型", selection: \$mediaFilter\)/)
  assert.match(wall, /ForEach\(XDriveIOSNativePhotoMediaFilter\.allCases\)/)
  assert.match(wall, /\.pickerStyle\(\.menu\)/)
  assert.match(wall, /mediaFilter == \.livePhotos \? "当前已授权图库中没有实况照片。"/)
  assert.match(wall, /mediaFilter == \.screenshots \? "当前已授权图库中没有截屏。"/)
  assert.match(wall, /\.onChange\(of: mediaFilter\) \{ _ in[\s\S]*?selectedCandidates\.removeAll\(\)[\s\S]*?savedOffset = 0\s*reload\(\)/)
  assert.match(wall, /\.task\(id: "\\\(generation\)-\\\(offset\)-\\\(mediaFilter\.rawValue\)"\)/)
  assert.doesNotMatch(wall, /UserDefaults|PhotoSyncLedger|UploadSession/)
})
