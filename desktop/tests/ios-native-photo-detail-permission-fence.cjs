'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '../..')
const local = fs.readFileSync(path.join(repo, 'ios/XDriveIOS/NativeLocalPhotoGallery.swift'), 'utf8')
const monitor = local.slice(local.indexOf('private final class XDriveIOSNativePhotoDetailChangeMonitor:'),
  local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'))
const detail = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoDetail: View'),
  local.indexOf('/// Read-only, 64-at-a-time PhotoKit grid'))

test('fullscreen detail owns a real PhotoKit change observer while source scans pause', () => {
  assert.match(monitor, /PHPhotoLibraryChangeObserver/)
  assert.match(monitor, /PHPhotoLibrary\.shared\(\)\.register\(self\)/)
  assert.match(monitor, /PHPhotoLibrary\.shared\(\)\.unregisterChangeObserver\(self\)/)
  assert.match(monitor, /func photoLibraryDidChange\(_ change: PHChange\)/)
  assert.match(detail, /@StateObject private var changes = XDriveIOSNativePhotoDetailChangeMonitor\(\)/)
  assert.match(detail, /\.onAppear \{ changes\.start\(\) \}/)
  assert.match(detail, /\.onDisappear \{\s*changes\.stop\(\)\s*model\.cancel\(\)/)
})

test('mutation and app background immediately clear still Live and video resources', () => {
  assert.match(detail, /\.onChange\(of: changes\.generation\) \{ _ in\s*model\.cancel\(\)\s*dismiss\(\)/)
  assert.match(detail, /\.onChange\(of: phase\) \{ state in\s*if state != \.active \{[\s\S]*?model\.cancel\(\)/)
  assert.match(detail, /\.task\(id: candidate\.id\) \{\s*if phase == \.active \{ model\.load\(candidate\) \}/)
  assert.match(local, /func cancel\(\) \{\s*epoch = UUID\(\)[\s\S]*?player\?\.pause\(\)[\s\S]*?player = nil\s*live = nil\s*still = nil/)
  assert.match(local, /self\.epoch == token/)
  assert.doesNotMatch(monitor+detail, /URLSession|UploadSession|WebKit|Keychain|accessToken/)
})

test('resume verifies currently authorized PhotoKit subset before fetching a fresh candidate', () => {
  assert.match(detail, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(detail, /model\.load\(candidate\)/)
  assert.match(detail, /else \{\s*model\.cancel\(\)\s*dismiss\(\)/)
  assert.match(local, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers: \[candidate\.id\]/)
  assert.match(local, /if candidate\.kind == "video"/)
  assert.match(local, /if candidate\.isLive/)
})
