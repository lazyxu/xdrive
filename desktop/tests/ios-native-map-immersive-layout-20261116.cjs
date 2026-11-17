'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const wrapper = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const focusPolicy = read('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift')

test('entering the native PhotoKit map hides Gallery-only backup/source strips by default', () => {
  assert.doesNotMatch(dashboard, /private var galleryStatusRow:/)
  assert.doesNotMatch(dashboard, /private var gallerySourceRow:/)
  assert.match(dashboard, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/)
  assert.match(focusPolicy, /if tab == "gallery" && gallerySource == "map" \{ return true \}/)
  assert.match(dashboard, /galleryFocused = source == \.map/)
  assert.match(dashboard, /gallerySource == \.map \? !mapNavigationExplicitlyShown : galleryFocused/)
  assert.match(dashboard, /mapNavigationExplicitlyShown = !focused/)
  assert.match(dashboard, /galleryFocused = gallerySource == \.map/)
  assert.match(dashboard, /XDriveIOSNativeFocusVisibilityPolicy\.showsBar\([\s\S]*?focused: galleryPresentationFocused/)
  assert.match(dashboard, /if tab == \.gallery && gallerySource == \.map \{\s*galleryFocused = true/)
})

test('switching local and Owner sources stays immersive without touching PhotoKit admission', () => {
  assert.match(wrapper, /\.onChange\(of: source\) \{ _ in onFocusChange\?\(true\) \}/)
  assert.match(wrapper, /\.onAppear \{\s*if onFocusChange != nil \{\s*focused = true\s*onFocusChange\?\(true\)/)
  assert.match(local, /\.onAppear \{\s*if onFocusChange != nil \{\s*focused = true\s*onFocusChange\?\(true\)/)
  assert.match(local, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(wrapper, /XDriveIOSNativePhotoOwnerScope\.matches/)
})

test('signed-out local PhotoKit map is immersive without granting any cloud Owner focus', () => {
  assert.match(focusPolicy, /if tab == "gallery" && gallerySource == "map" \{ return true \}/)
  assert.match(focusPolicy, /gallerySource == "cloud" && ownerVerified/)
  assert.match(focusPolicy, /callbackSource == "map" \|\|/)
  assert.match(focusPolicy, /callbackSource == "cloud" && ownerVerified/)
})

test('Map no longer offers xDrive five-slot override; only native Photos chrome can appear', () => {
  assert.doesNotMatch(local, /Button\(focused \? "显示底部导航" : "专注地图"/)
  assert.doesNotMatch(wrapper, /Button\(focused \? "显示底部导航" : "专注地图"/)
  assert.match(dashboard, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/)
  assert.match(dashboard, /\.fullScreenCover\(isPresented: \$presentingUnifiedMap,[\s\S]*?\.safeAreaInset\(edge: \.bottom, spacing: 0\) \{\s*nativePhotosBottomBar/)
  assert.match(dashboard, /galleryFocused = gallerySource == \.map/)
})

test('native photo maps do not retain the 8pt outer MapKit gutter', () => {
  // The local permission prompt keeps a readable inset but authorized
  // PhotoKit and signed Owner map canvases reach the horizontal safe area.
  assert.match(local, /\.padding\(\.horizontal, authorization == \.authorized \? 0 : 12\)/)
  const ownerMap = wrapper.slice(wrapper.indexOf('struct XDriveIOSNativeOwnerPhotoMapScreen: View'),
                                  wrapper.indexOf('.navigationTitle("地图")'))
  assert.doesNotMatch(ownerMap.slice(-180), /\.padding\(\.horizontal, 8\)/)
  assert.match(ownerMap, /XDriveIOSOwnerMapSurface\(/)
})
