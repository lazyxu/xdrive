'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

const loaderFile = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const loaderStart = loaderFile.indexOf('final class XDriveIOSPhotoImageLoader')
const loaderEnd = loaderFile.indexOf("\nstruct XDriveIOSLocalPhotoTile", loaderStart)
assert.notEqual(loaderStart, -1)
assert.notEqual(loaderEnd, -1)
const loader = loaderFile.slice(loaderStart, loaderEnd)
const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const search = read('ios/XDriveIOS/NativePhotoMetadataSearch.swift')

test('PhotoKit iCloud thumbnail access is enabled by default without caller configuration', () => {
  assert.ok(loader.includes('settings.isNetworkAccessAllowed = true'))
  assert.ok(loader.includes('PHImageManager.default().requestImage('))
  assert.ok(loader.includes('targetSize: size'))
  assert.ok(loader.includes('settings.resizeMode = .fast'))
  assert.ok(loader.includes('settings.deliveryMode = .opportunistic'))
  assert.doesNotMatch(loader, /allowICloudThumbnail|requestAVAsset|requestLivePhoto|requestImageDataAndOrientation|PHAssetResourceManager/)
})

test('continuous wall, album covers and local search use default visible-thumbnail loading', () => {
  for (const source of [wall, albums, search]) {
    assert.ok(source.includes('loader.load('))
    assert.ok(!source.includes('allowICloudThumbnail'))
    assert.ok(source.includes('loader.cancel()'))
    assert.ok(source.includes('loader.isLoading'))
    assert.ok(source.includes('.task(id:'))
  }
  assert.ok(wall.includes('size: CGSize(width: 420, height: 420)'))
  assert.ok(search.includes('size: CGSize(width: 420, height: 420)'))
  assert.ok(albums.includes('size: CGSize(width: 220, height: 220)'))
})

test('thumbnail cancellation invalidates callbacks and cancels the PhotoKit request', () => {
  assert.ok(loader.includes('epoch = UUID()'))
  assert.ok(loader.includes('self.epoch == token'))
  assert.ok(loader.includes('PHImageManager.default().cancelImageRequest(request)'))
})
