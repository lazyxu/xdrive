'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const cloud = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const layout = read('ios/XDriveIOS/NativeMapMarkerVisualPolicy.swift')

test('M11 native and Owner MapKit markers share identical verified cover, badge and touch geometry', () => {
  for (const token of ['frame','centerOffset','imageFrame','placeholderFrame','badgeFrame','coverCornerRadius','badgeCornerRadius','badgeFont','photoBorderWidth','badgeBorderWidth','badgeText']) {
    assert.match(layout, new RegExp('static (?:let|func) ' + token + '\\b'))
    assert.match(local, new RegExp('XDriveIOSNativeMapMarkerVisualPolicy\\.' + token))
    assert.match(cloud, new RegExp('XDriveIOSNativeMapMarkerVisualPolicy\\.' + token))
  }
  assert.match(layout, /minimumTouchTarget: CGFloat = 44/)
  // PhotoKit's live 128px marker poster now uses opportunistic local/iCloud callbacks.
  // Do not require the retired `.fastFormat` token; assert the real poster policy.
  assert.match(local, /options\.isNetworkAccessAllowed = true/)
  assert.match(local, /options\.deliveryMode = \.opportunistic/)
  assert.match(local, /options\.resizeMode = \.fast/)
  // Keep latest master's bounded network/cleanup checks too.
  assert.match(local, /targetSize: CGSize\(width: 128, height: 128\)/)
  assert.match(local, /PHImageManager\.default\(\)\.cancelImageRequest\(request\)/)
  assert.match(local, /PHImageResultIsDegradedKey/)
  assert.match(local, /self\.epoch == snapshot/)
  assert.match(local, /isAccessibilityElement = !provisional/)
  assert.match(cloud, /isAccessibilityElement = enabled/)
  assert.doesNotMatch(layout, /PHAsset|Owner|URLSession|upload|requestAuthorization/)
})

test('M11 exact layout assertions explicitly prohibit inconsistent photo pin numerical frames', () => {
  assert.match(layout, /frame = CGRect\(x: 0, y: 0, width: 68, height: 68\)/)
  assert.match(layout, /badgeFrame = CGRect\(x: 41, y: -7, width: 33, height: 28\)/)
  assert.match(layout, /imageFrame = CGRect\(x: 2, y: 2, width: 64, height: 64\)/)
  assert.match(layout, /badgeText\(count: Int\).*?\{/s)
  assert.doesNotMatch(local, /badge\.frame = CGRect/)
  assert.doesNotMatch(cloud, /badge\.frame = CGRect/)
})
