'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const zoom = read('ios/XDriveIOS/NativeZoomablePhotoView.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')

test('local and cloud still detail use one native UIKit zoom viewer', () => {
  assert.match(zoom, /UIViewRepresentable/)
  assert.match(zoom, /UIScrollViewDelegate/)
  assert.match(local, /XDriveIOSNativeZoomablePhotoView\(image: image\)/)
  assert.match(cloud, /XDriveIOSNativeZoomablePhotoView\(image: still\)/)
  assert.match(local, /PHLivePhotoView/)
  assert.match(local, /VideoPlayer\(player: player\)/)
  assert.match(cloud, /VideoPlayer\(player: player\)/)
})

test('pinch pan and double tap are bounded and reset for new media', () => {
  assert.match(zoom, /func viewForZooming\(in scrollView: UIScrollView\)/)
  assert.match(zoom, /scroll\.minimumZoomScale = 1/)
  assert.match(zoom, /scroll\.maximumZoomScale = 5/)
  assert.match(zoom, /scroll\.bouncesZoom = true/)
  assert.match(zoom, /doubleTap\.numberOfTapsRequired = 2/)
  assert.match(zoom, /scroll\.zoom\(to: CGRect/)
  assert.match(zoom, /if photo\.image !== image \{/)
  assert.match(zoom, /scroll\.setZoomScale\(scroll\.minimumZoomScale, animated: false\)/)
})

test('zoom remains read only and preserves media ownership lifecycle', () => {
  assert.doesNotMatch(zoom, /URLSession|UploadSession|PHPhotoLibrary|accessToken|Bearer|Keychain|WKWebView/)
  assert.match(cloud, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
  assert.match(local, /\.onDisappear \{\s*changes\.stop\(\)\s*model\.cancel\(\)\s*\}/)
  assert.match(local, /\.onChange\(of: changes\.generation\) \{ _ in[\s\S]*?model\.cancel\(\)\s*dismiss\(\)/)
})
