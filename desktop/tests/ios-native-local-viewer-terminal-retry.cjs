'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname,
  '../../ios/XDriveIOS/NativeLocalPhotoGallery.swift'), 'utf8')
const model = source.slice(
  source.indexOf('final class XDriveIOSLocalPhotoDetailModel'),
  source.indexOf('private struct XDriveIOSNativeLivePhotoView'),
)
const detail = source.slice(
  source.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
  source.indexOf('struct XDriveIOSNativeLocalGalleryScreen: View'),
)

test('terminal PhotoKit still failure is not an infinite local Viewer spinner', () => {
  assert.match(model, /options\.isNetworkAccessAllowed = false/)
  assert.match(model, /let degraded = info\?\[PHImageResultIsDegradedKey\] as\? Bool == true/)
  assert.match(model, /let cancelled = info\?\[PHImageCancelledKey\] as\? Bool == true/)
  assert.match(model, /else if !degraded && !cancelled &&[\s\S]*?self\.still == nil && self\.live == nil \{\s*self\.message =/)
  assert.match(model, /guard let self, self\.epoch == token/)
  assert.match(model, /self\.still = picture\s*self\.message = nil/)
})

test('manual local Viewer retry revalidates current scene and PhotoKit permissions', () => {
  assert.match(detail, /else if let message = model\.message \{[\s\S]*?Button\("重试"\)/)
  assert.match(detail, /guard phase == \.active,[\s\S]*?PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)[\s\S]*?else \{ return \}\s*model\.load\(candidate\)/)
  assert.match(detail, /accessibilityIdentifier\("native-ios-local-viewer-retry"\)/)
  assert.match(model, /func load\(_ candidate: XDrivePhotoKitScanCandidate\) \{\s*cancel\(\)/)
  assert.match(model, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[candidate\.id\]/)
  assert.doesNotMatch(model + detail, /URLSession|UploadSession|Keychain|UserDefaults|isNetworkAccessAllowed = true/)
})

test('local Viewer still retires media when scene or PhotoKit authorization changes', () => {
  assert.match(detail, /onChange\(of: changes\.generation\) \{ _ in[\s\S]*?model\.cancel\(\)\s*dismiss\(\)/)
  assert.match(detail, /onChange\(of: phase\) \{ state in[\s\S]*?if state != \.active \{[\s\S]*?model\.cancel\(\)/)
  assert.match(detail, /onDisappear \{\s*changes\.stop\(\)\s*model\.cancel\(\)/)
})
