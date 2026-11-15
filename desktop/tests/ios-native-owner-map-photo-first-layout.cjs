'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const map = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift'), 'utf8')
const screen = map.slice(map.indexOf('struct XDriveIOSNativeOwnerPhotoMapScreen: View'),
                         map.indexOf('private func openSinglePhoto('))

test('Owner cloud map keeps MapKit dominant and relocates refresh to a verified toolbar menu', () => {
  assert.match(screen, /XDriveIOSOwnerMapSurface\([\s\S]*?\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  const footer = screen.slice(screen.indexOf('.accessibilityIdentifier("native-ios-owner-cloud-photo-map")'),
                              screen.indexOf('.toolbar {'))
  assert.doesNotMatch(footer, /Button\("刷新当前视窗"\)/)
  assert.match(screen, /Menu \{[\s\S]*?Button\("刷新当前视窗"\) \{ reload\(\) \}[\s\S]*?\.disabled\(busy \|\| login\.owner == nil \|\| phase != \.active\)/)
  assert.match(screen, /Label\("地图操作", systemImage: "ellipsis.circle"\)/)
  assert.match(screen, /accessibilityIdentifier\("native-ios-owner-map-actions"\)/)
})

test('compact map status does not crowd ordinary portrait, but keeps truthful state and accessibility', () => {
  assert.match(screen, /if !compactMap && dynamicTypeSize\.isAccessibilitySize \{\s*Text\("当前 Server Owner 已索引/)
  assert.match(screen, /if !compactMap && dynamicTypeSize\.isAccessibilitySize \{\s*Text\("选择真实地点后/)
  // Native Dynamic Type must not truncate truthful map totals to one line.
  // Keep distinct verified/stale AX targets; do not restore old lineLimit(1).
  assert.match(screen, /Text\("当前视窗已有 [\s\S]*?\.font\(\.caption\)\.monospacedDigit\(\)[\s\S]*?\.fixedSize\(horizontal: false, vertical: true\)[\s\S]*?native-ios-owner-map-verified-count/)
  assert.match(screen, /Text\("上次验证视窗有 [\s\S]*?\.foregroundStyle\(\.secondary\)[\s\S]*?\.fixedSize\(horizontal: false, vertical: true\)[\s\S]*?native-ios-owner-map-stale-count/)
  assert.match(screen, /Text\("区域仍为聚合结果[\s\S]*?\.fixedSize\(horizontal: false, vertical: true\)/)
  const countBlock = screen.slice(screen.indexOf('if let overview, displayedOverviewMatchesLogin {'),
                                   screen.indexOf('if let activeCaptureRange'))
  assert.doesNotMatch(countBlock, /\.lineLimit\(1\)/)
  assert.match(screen, /if busy \{ ProgressView\("核对当前 Owner 地图位置…"\) \}/)
  assert.match(screen, /if let error \{ Text\(error\)/)
  assert.match(screen, /Button\(focused \? "显示底部导航" : "专注地图"\)/)
  assert.match(screen, /Label\("地图说明", systemImage: "info.circle"\)/)
})

test('new map layout retains the exact Owner camera and cluster access contracts', () => {
  assert.match(screen, /markersEnabled: mapMarkersEnabled/)
  assert.match(screen, /onCameraWillChange: \{ revokeCameraAuthorization\(\) \}/)
  assert.match(screen, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedPlace\(/)
  assert.match(screen, /XDriveIOSNativeOwnerMapSelectionPolicy\.acceptsSelectedCluster\(/)
  assert.match(screen, /let expected = login\.owner/)
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(screen, /\.sheet\(item: \$selectedCluster/)
  assert.doesNotMatch(screen, /WKWebView|UploadSession|BaiduMap|URLSession\(/)
})
