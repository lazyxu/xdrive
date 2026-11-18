'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const focus = read('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const owner = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const swift = read('ios/tests/NativeFocusVisibilityPolicyChecks.swift')
const runtime = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')

test('iOS 26 Photos map has the same one Photos bar as Library and Collections', () => {
  assert.match(focus, /if tab == "gallery" && gallerySource == "map" \{ return true \}/)
  assert.match(dashboard, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/)
  assert.match(dashboard, /private var nativePhotosBottomBar: some View/)
  // Regression for the observed simulator AX tree: parent .accessibilityIdentifier
  // on a bare HStack overrides the individual Library / Collections / Search IDs.
  const bar = dashboard.slice(dashboard.indexOf('private var nativePhotosBottomBar: some View'),
    dashboard.indexOf('private var galleryBackupStatus'))
  assert.match(bar, /native-ios-photos-library-tab/)
  assert.match(bar, /native-ios-photos-collections-tab/)
  assert.match(bar, /native-ios-photos-search/)
  assert.match(bar, /\.accessibilityElement\(children: \.contain\)\s*\.accessibilityIdentifier\("native-ios-photos-bottom-bar"\)/)
  assert.match(runtime, /matching\(identifier: "native-ios-photos-collections-tab"\)/)
  for (const id of ['native-ios-photos-library-tab','native-ios-photos-collections-tab',
                    'native-ios-photos-search','native-ios-photos-bottom-bar']) {
    assert.ok(dashboard.includes(id), id)
  }
  assert.match(swift, /verify\("gallery", "map", true, false, true\)/)
  assert.match(runtime, /The Map must retain only the native Photos Library \/ Collections \/ Search bar/)
  assert.doesNotMatch(local, /Button\(focused \? "显示底部导航" : "专注地图"/)
  assert.doesNotMatch(owner, /Button\(focused \? "显示底部导航" : "专注地图"/)
})

test('modal unified-source Map also gets one Photos bar, not an xDrive bar', () => {
  const cover = dashboard.slice(dashboard.indexOf('.fullScreenCover(isPresented: $presentingUnifiedMap'),
    dashboard.indexOf('/// L2 callbacks'))
  assert.match(cover, /NavigationStack \{[\s\S]*?XDriveIOSNativePhotoMapsScreen\(/)
  assert.match(cover, /\.safeAreaInset\(edge: \.bottom, spacing: 0\) \{\s*nativePhotosBottomBar/)
  assert.doesNotMatch(cover, /nativeBottomBar/)
  assert.match(dashboard, /navigatePhotosChrome\(to: \.unified\)/)
  assert.match(dashboard, /navigatePhotosChrome\(to: \.albums\)/)
  assert.match(dashboard, /navigatePhotosChrome\(to: \.unified, search: true\)/)
  assert.match(dashboard, /pendingUnifiedMapDestination = destination[\s\S]*?presentingUnifiedMap = false/)
  assert.match(dashboard, /guard let destination, requestScope == ownerScopeKey,[\s\S]*?tab == \.gallery else \{ return \}/)
  assert.match(dashboard, /requestUnifiedPhotoSearch = true/)
})

test('Photos bar preserves Collections origin without persisting a PhotoKit ID or Owner credential', () => {
  assert.match(dashboard, /@State private var mapOpenedFromCollections = false/)
  assert.match(dashboard, /mapOpenedFromCollections = tab == \.gallery && gallerySource == \.albums/)
  assert.match(dashboard, /gallerySource == \.map \? mapOpenedFromCollections : gallerySource == \.albums/)
  assert.match(dashboard, /\.accessibilityAddTraits\(photosChromeCollectionsSelected \? \.isSelected : \[\]\)/)
  assert.match(dashboard, /mapOpenedFromCollections = false[\s\S]*?mapReturnGallerySource = nil/)
  const value = dashboard.slice(dashboard.indexOf('private var photosChromeCollectionsSelected'),
    dashboard.indexOf('private var galleryBackupStatus'))
  assert.doesNotMatch(value, /PHAsset|PHPhotoLibrary|URLSession|owner\.id|GPS|credential/)
})
