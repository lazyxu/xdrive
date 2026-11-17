'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const viewer = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeUnifiedPhotoViewer.swift'), 'utf8')
const policy = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoFilmstripScrubPolicy.swift'), 'utf8')
const local = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalPhotoViewerFilmstrip.swift'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeCloudPhotoAssetViewerFilmstrip.swift'), 'utf8')

test('unified Viewer reuses the same native bounded filmstrip and scroll geometry', () => {
  assert.match(viewer, /XDriveIOSNativePhotoWallViewerFilmstripScroll \{/)
  assert.match(viewer, /ScrollViewReader \{ scroll in/)
  assert.match(viewer, /highPriorityGesture\([\s\S]*?DragGesture\(minimumDistance: 18, coordinateSpace: \.local\)/)
  assert.match(viewer, /native-ios-unified-viewer-filmstrip/)
  assert.match(viewer, /onChange\(of: row\.id\) \{ id in[\s\S]*?guard authorized else \{ return \}[\s\S]*?scroll\.scrollTo\(id, anchor: \.center\)/)
  assert.match(local, /XDriveIOSNativePhotoWallViewerFilmstripScroll/)
  assert.match(cloud, /XDriveIOSNativePhotoWallViewerFilmstripScroll/)
})

test('scrubbing never widens source permissions, crosses an unverified page, or selects duplicate IDs', () => {
  const scrub = viewer.slice(viewer.indexOf('private func scrubChanged('),
                              viewer.indexOf('private func show(page:'))
  assert.match(scrub, /guard authorized, !busy, page\.rows\.count > 1, page\.rows\.count <= 48/)
  assert.match(scrub, /page\.rows\.indices\.contains\(position\)/)
  assert.match(scrub, /page\.rows\.filter\(\{ \$0\.id == row\.id \}\)\.count == 1/)
  assert.match(scrub, /XDriveIOSNativePhotoFilmstripScrubPolicy\.targetIndex\(/)
  assert.match(scrub, /page\.rows\.indices\.contains\(target\), target != position/)
  assert.match(scrub, /page\.rows\.filter\(\{ \$0\.id == targetID \}\)\.count == 1/)
  assert.match(scrub, /show\(page: page, at: target\)/)
  assert.doesNotMatch(scrub, /wall\.read\(|URLSession|PHAsset\.fetchAssets|UserDefaults|requestImageData/)
  assert.match(policy, /abs\(dx\) > abs\(dy\) \* 1\.5/)
  assert.match(policy, /minimumHorizontal: CGFloat = 18/)
})

test('viewer retargets only a unique authorized item and resets scrub on page/scene exit', () => {
  assert.match(viewer, /private func show\(page: XDriveIOSNativeUnifiedGalleryPage, at index: Int\)/)
  assert.match(viewer, /page\.rows\.filter\(\{ \$0\.id == selectedID \}\)\.count == 1/)
  assert.match(viewer, /onChange\(of: page\.number\) \{ _ in resetScrub\(\) \}/)
  assert.match(viewer, /\.onDisappear \{ resetScrub\(\); cancel\(\) \}/)
  assert.match(viewer, /onChange\(of: wall\.generation\) \{ _ in cancel\(\); dismiss\(\) \}/)
})
