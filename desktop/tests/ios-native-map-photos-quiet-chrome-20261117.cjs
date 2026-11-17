'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const source = read('ios/XDriveIOS/NativeUnifiedSourcePhotoMap.swift')
const shared = read('ios/XDriveIOS/NativePhotoWallComponents.swift')

function bottomLeftOverlay(code, viewName) {
  const view = code.indexOf(viewName)
  assert.ok(view >= 0, 'expected native map view: ' + viewName)
  const start = code.indexOf('.overlay(alignment: .bottomLeading)', view)
  assert.ok(start > view, 'expected existing map progress overlay')
  return code.slice(start, start + 860)
}

test('all three Apple Photos-style maps expose only transient scan progress at bottom left', () => {
  for (const [code, name] of [
    [local, 'struct XDriveIOSNativeLocalPhotoMapScreen: View'],
    [owner, 'struct XDriveIOSNativeOwnerPhotoMapScreen: View'],
    [source, 'struct XDriveIOSNativeUnifiedSourcePhotoMapScreen: View']
  ]) {
    const overlay = bottomLeftOverlay(code, name)
    assert.match(overlay, /if busy \{[\s\S]*?ProgressView\(/)
    assert.doesNotMatch(overlay, /XDriveIOSNativePhotoMapStatusPill\(/)
    assert.doesNotMatch(overlay, /native-ios-(?:map-verified-count|owner-map-verified-count|unified-source-map-total)/)
  }
})

test('the verified summary is accessible without introducing a new map banner', () => {
  const grid = shared.slice(shared.indexOf('struct XDriveIOSNativePhotoMapGridAction: View'),
                            shared.indexOf('/// Photo-first, accessible location header'))
  assert.match(grid, /var verifiedSummary: String\? = nil/)
  assert.match(grid, /\.accessibilityValue\(verifiedSummary \?\? ""\)/)
  assert.match(grid, /\.accessibilityHint\("仅打开当前已核验地图范围内的照片"\)/)
  assert.match(local, /verifiedSummary: globalComplete && refinedViewportIsCurrent/)
  assert.match(owner, /verifiedSummary: mapMarkersEnabled && verifiedBounds != nil/)
  assert.match(source, /verifiedSummary: currentProof/)
  assert.match(local, /XDriveIOSNativePhotoMapPlaceHeader\(/)
  assert.match(source, /XDriveIOSNativePhotoMapPlaceHeader\(/)
})

test('legacy bounded PhotoKit page keeps MapKit full height and moves paging to More', () => {
  const view = local.slice(local.indexOf('struct XDriveIOSNativeLocalPhotoMapScreen: View'))
  const mapStart = view.indexOf('} else if let page {')
  const mapEnd = view.indexOf('} else if busy {', mapStart)
  const pageCanvas = view.slice(mapStart, mapEnd)
  assert.match(pageCanvas, /XDriveIOSMapKitPhotoPage\(/)
  assert.match(pageCanvas, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  assert.match(pageCanvas, /\.overlay\(alignment: \.topLeading\)/)
  assert.doesNotMatch(pageCanvas, /Button\("上一页"\)|Button\("下一页"\)/)
  assert.doesNotMatch(pageCanvas, /Text\("当前页 ·/)
  assert.doesNotMatch(pageCanvas, /当前页暂无有效 GPS 照片，可以切换下一页/)
  const actions = view.slice(view.indexOf('Label("地图日期", systemImage: "calendar")'),
                              view.indexOf('if mapScope == .library && globalComplete'))
  assert.match(actions, /if mapScope == \.page \{[\s\S]*?Section\("当前页 ·/)
  assert.match(actions, /Button\("上一页"\)[\s\S]*?Button\("下一页"\)/)
  assert.match(actions, /Button\("查找下一批有定位照片"\)/)
  assert.match(actions, /native-ios-map-find-next-gps-page/)
  assert.match(actions, /Button\("刷新当前页"\)/)
  assert.match(actions, /Picker\("底图样式", selection: \$mapType\)/)
  assert.match(view, /XDriveIOSNativeMapViewerAdmission\.allows\(/)
  assert.match(view, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})

test('the quieter map does not remove permission-scoped membership or emergency recovery', () => {
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(local, /runP0IndependentGPSAudit\(\)/)
  assert.match(local, /native-ios-map-full-library-scan-progress/)
  assert.match(owner, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.match(owner, /native-ios-owner-map-basemap-unavailable/)
  assert.match(source, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent/)
  assert.match(source, /native-ios-unified-source-map-retry/)
  for (const code of [local, owner, source]) {
    assert.match(code, /XDriveIOSNativePhotoMapGridAction\(/)
    assert.match(code, /XDriveIOSNativePhotoMapFloatingTools\(/)
  }
})
