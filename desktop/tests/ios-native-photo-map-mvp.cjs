'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const map = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const scanner = read('ios/XDriveIOS/PhotoKitBoundedSnapshotScanner.swift')
const focus = read('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift')
const policy = read('ios/XDriveIOS/NativePhotoMapPolicy.swift')

test('real native Gallery map uses MapKit and existing local Viewer, no WebView', () => {
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.match(map, /MKMapView\(\)/)
  assert.match(map, /MKClusterAnnotation/)
  assert.match(map, /clusteringIdentifier = identifier == "photo"/)
  assert.match(map, /XDriveIOSNativeLocalPhotoDetail\(candidate: \$0\)/)
  assert.match(focus, /gallerySource == "map"/)
  assert.doesNotMatch(map, /WKWebView|URLSession|UploadSession|Keychain|UserDefaults/)
})

test('only a fresh authorized PhotoKit 64-slot scan supplies local map pins', () => {
  assert.match(scanner, /func nextLocatedPage\(\) throws -> XDrivePhotoKitLocatedPage/)
  assert.match(scanner, /let page = try nextPage\(\)/)
  assert.match(scanner, /snapshot\.object\(at: page\.startOffset \+ offset\)/)
  assert.match(scanner, /asset\.location/)
  assert.match(scanner, /try ensureCurrent\(expected\)/)
  assert.match(map, /仅当前64条范围，不是完整云端地图/)
  assert.match(map, /items\.prefix\(XDriveIOSNativePhotoMapPolicy\.pageSize\)/)
  assert.match(map, /isNetworkAccessAllowed = false/)
  assert.match(map, /cancelImageRequest\(request\)/)
  assert.match(map, /onChange\(of: changes\.revision\)/)
  assert.match(map, /if state == \.active \{ changes\.start\(\); refresh\(at: offset\) \}/)
  assert.match(policy, /static let pageSize = 64/)
  assert.match(policy, /latitude\.isFinite && longitude\.isFinite/)
  assert.doesNotMatch(map, /localStorage|\.write\(|Authorization:|postMessage\(/)
})

test('a presented cluster keeps PhotoKit change observation until dismissal', () => {
  assert.match(map, /\.onDisappear \{\s*\/\/ A presented cluster sheet/)
  assert.match(map, /if selection == nil \{\s*changes\.stop\(\)/)
  assert.match(map, /\} else \{ suspendForSheet\(\) \}/)
  assert.match(map, /onChange\(of: changes\.revision\) \{ _ in\s*invalidate\(\)/)
})

test('Swift catch does not shadow the map screen state error value', () => {
  assert.match(map, /if generation == ticket \{ self\.error = "照片权限或位置已变化，请刷新重试。"/)
})

test('native Launcher marks the real local map available, not as an unavailable placeholder', () => {
  const available = dashboard.match(/var available: Bool \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(available, 'native launcher route availability must remain explicit')
  assert.match(available, /case \.local, \.albums, \.cloud, \.originals, \.map, \.backup: return true/)
  assert.match(dashboard, /case \.map:\s*openGallery\(\.map\)/)
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.match(dashboard, /if !route\.available \{\s*Text\("未接入"\)/)
})

test('late map annotation selection cannot reopen a photo from the previous page', () => {
  assert.match(map, /let currentPage = self\.page/)
  assert.match(map, /XDriveIOSNativePhotoMapPolicy\.acceptsSelection\(/)
  assert.match(map, /selectedIDs: selected\.map\(\\\.id\)/)
  assert.match(map, /currentPageIDs: currentPage\.items\.map\(\\\.id\)/)
  assert.match(policy, /static func acceptsSelection\(/)
  assert.match(policy, /selectedSet\.isSubset\(of: pageSet\)/)
  assert.match(policy, /selectedSet\.count == selectedIDs\.count/)
  assert.match(policy, /pageSet\.count == currentPageIDs\.count/)
  assert.match(map, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})
