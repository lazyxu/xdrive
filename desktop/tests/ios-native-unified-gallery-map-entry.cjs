'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const map = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const mapPolicy = read('ios/XDriveIOS/NativePhotoMapPolicy.swift')

test('default unified Gallery filter sheet exposes actual existing native map entry', () => {
  assert.match(gallery, /var onShowMap: \(\(XDriveIOSNativePhotoMapCaptureRange\?\) -> Void\)\? = nil/)
  assert.match(gallery, /Section\("地图"\)/)
  assert.match(gallery, /Label\("显示地图", systemImage: "map"\)/)
  assert.match(gallery, /native-ios-unified-gallery-show-map/)
  assert.match(dashboard, /case \.unified:\s*XDriveIOSNativeUnifiedPhotoGallery\(/)
  assert.match(dashboard, /onShowMap: \{ range in/)
})

test('unsupported unified source, filenames and media predicates never silently show an unfiltered map', () => {
  assert.match(gallery, /private var mapUnavailableReason: String\?/)
  assert.match(gallery, /if sourceFilter != nil \{/)
  assert.match(gallery, /if !draft\.isValid \{/)
  assert.match(gallery, /if !draft\.term\.isEmpty \{/)
  assert.match(gallery, /if draft\.media != \.all \{/)
  assert.match(gallery, /\.disabled\(mapUnavailableReason != nil \|\| !draft\.isValid\)/)
  assert.match(gallery, /native-ios-unified-gallery-map-scope/)
  assert.match(gallery, /来源可在地图内切换/)
})

test('the only date predicate mapped to both native map sources is the exact bounded half-open capture interval', () => {
  assert.match(gallery, /if draft\.from != nil \|\| draft\.until != nil/)
  assert.match(gallery, /let from = draft\.from, let until = draft\.until/)
  assert.match(gallery, /XDriveIOSNativePhotoMapCaptureRange\(\s*from: from, to: until, label: "当前图库日期筛选"/)
  assert.match(gallery, /return range\.valid \? range : nil/)
  assert.match(mapPolicy, /from <= capturedAt && capturedAt < to/)
  assert.match(mapPolicy, /to\.timeIntervalSince\(from\) <= 370 \* 86_400/)
  assert.match(dashboard, /inheritedCaptureRange: unifiedMapCaptureRange/)
})

test('filter sheet is fully dismissed before existing MapKit is presented', () => {
  assert.match(gallery, /\.sheet\(isPresented: \$showFilters, onDismiss: \{/)
  assert.match(gallery, /guard openMapAfterFilterDismiss else \{ return \}/)
  assert.match(gallery, /onShowMap\?\(selectedRange\)/)
  assert.match(gallery, /query = draft\s*pendingMapCaptureRange = representableMapCaptureRange\s*openMapAfterFilterDismiss = true\s*showFilters = false/)
  assert.match(dashboard, /\.fullScreenCover\(isPresented: \$presentingUnifiedMap, onDismiss:/)
  assert.match(dashboard, /NavigationStack \{\s*XDriveIOSNativePhotoMapsScreen\(/)
  assert.doesNotMatch(dashboard, /onShowMap: \{ range in[\s\S]*?gallerySource = \.map/)
})

test('one shared native PhotoKit/Owner map, not a duplicate map or a second writer', () => {
  const refs = dashboard.match(/XDriveIOSNativePhotoMapsScreen\(/g) || []
  assert.equal(refs.length, 2, 'existing Gallery .map and modal unified Gallery must reuse same map View')
  assert.match(dashboard, /case \.map:\s*XDriveIOSNativePhotoMapsScreen\(/)
  assert.match(dashboard, /onClose: \{ presentingUnifiedMap = false \}/)
  assert.match(dashboard, /mediaFilter: \.all,\s*inheritedCaptureRange: unifiedMapCaptureRange/)
  assert.match(map, /case \.local:\s*XDriveIOSNativeLocalPhotoMapScreen\(/)
  assert.match(map, /case \.cloud:\s*XDriveIOSNativeOwnerPhotoMapScreen\(/)
  assert.doesNotMatch(gallery, /PHPhotoLibrary\.shared\(\)\.performChanges|UploadSession\(/)
})

test('unified Gallery wall density, query and return anchor survive modal map browsing', () => {
  assert.match(gallery, /@State private var wallDensity: XDriveIOSNativePhotoWallDensity/)
  assert.match(gallery, /@State private var query = XDriveIOSNativeUnifiedGalleryQuery\(\)/)
  assert.match(gallery, /@State private var viewerReturnAnchor: String\?/)
  assert.match(gallery, /\.onDisappear \{\s*photoObserver\.stop\(\)/)
  assert.match(dashboard, /presentingUnifiedMap = true/)
  assert.match(dashboard, /\.fullScreenCover\(isPresented: \$presentingUnifiedMap/)
  assert.match(dashboard, /case \.unified:\s*XDriveIOSNativeUnifiedPhotoGallery\([\s\S]*?case \.map:/)
})

test('late map requests are rejected after source change, Owner switch or scene loss', () => {
  assert.match(dashboard, /guard phase == \.active, tab == \.gallery,\s*gallerySource == \.unified/)
  assert.match(dashboard, /focusOwnerKey == ownerScopeKey,\s*focusGeneration == galleryFocusGeneration/)
  assert.match(dashboard, /private func resetNavigation\(\) \{[\s\S]*?presentingUnifiedMap = false[\s\S]*?unifiedMapCaptureRange = nil/)
  assert.match(gallery, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?openMapAfterFilterDismiss = false/)
  assert.match(dashboard, /unifiedMapCaptureRange = nil/)
  assert.match(map, /guard source == \.cloud, let expectedOwner/)
})
