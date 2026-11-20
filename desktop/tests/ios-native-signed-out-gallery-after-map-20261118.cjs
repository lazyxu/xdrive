'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const dashboard = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')
const mapUITest = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift'), 'utf8')
const localGallery = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalContinuousGallery.swift'), 'utf8')
const ownerWall = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeUnifiedPhotoGallery.swift'), 'utf8')

test('default Photos Library uses real bounded local PhotoKit gallery while signed out', () => {
  const body = dashboard.slice(dashboard.indexOf('private var gallery: some View'),
                               dashboard.indexOf('/// L2 callbacks', dashboard.indexOf('private var gallery: some View')))
  assert.match(body, /case \.unified:\s*if login\.owner == nil \{[\s\S]*?XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$localGalleryPageOffset,\s*mediaFilter: \$localGalleryMediaFilter/)
  assert.match(body, /\} else \{\s*XDriveIOSNativeUnifiedPhotoGallery\(/)
  assert.match(body, /case \.local:\s*XDriveIOSNativeLocalPhotoTimelineContainer\(/)
  assert.match(ownerWall, /if let owner = login.owner \{\s*ForEach\(wall.index.pages\)/)
  assert.match(localGallery, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(localGallery, /Button \{ onSelect\(candidate, page\) \} label:/)
  assert.match(localGallery, /candidate\.kind == "video" \? "播放视频" : "查看照片"/)
  assert.doesNotMatch(body, /staticOwner|mockOwner|grantPhotos|simctl privacy grant/)
})

test('Photos search follows local PhotoKit when signed out and Owner when verified', () => {
  const helper = dashboard.slice(dashboard.indexOf('private func openPhotoSearchForCurrentScope()'),
                                 dashboard.indexOf('private var nativePhotosBottomBar:', dashboard.indexOf('private func openPhotoSearchForCurrentScope()')))
  assert.match(helper, /if login\.owner == nil \{\s*requestUnifiedPhotoSearch = false\s*showingLocalPhotoSearch = true\s*\} else \{\s*requestUnifiedPhotoSearch = true/)
  assert.match(dashboard, /if search \{ openPhotoSearchForCurrentScope\(\) \}/)
  assert.match(dashboard, /if wantedSearch \{ openPhotoSearchForCurrentScope\(\) \}/)
  assert.match(dashboard, /\.sheet\(isPresented: \$showingLocalPhotoSearch\) \{\s*XDriveIOSNativePhotoSearchScreen\(\)/)
  assert.match(dashboard, /private func resetNavigation\(\) \{[\s\S]*?requestUnifiedPhotoSearch = false/)
})

test('real GPS MapKit-to-signed-out Library XCUITest requires visible genuine photo tile', () => {
  const begin = mapUITest.indexOf('func testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted()')
  const end = mapUITest.indexOf('func testZP0ExternallyRevokedPhotosRejectOldMapAndRecover()', begin)
  assert.ok(begin>=0 && end>begin)
  const body=mapUITest.slice(begin,end)
  assert.match(body, /let done = element\("native-ios-map-dismiss", in: app\)[\s\S]*?done\.tap\(\)/)
  assert.match(body, /NSPredicate\(format: "label == %@", "查看照片"\)/)
  assert.match(body, /XCTAssertTrue\(photo\.exists && photo\.isHittable,/)
  assert.match(body, /Signed-out Photos Library blank after MapKit Done/)
  assert.match(body, /p0-map-done-signed-out-photokit-library-not-blank/)
  assert.doesNotMatch(body, /simctl privacy grant|synthetic-owner|TestOnlyPhoto/)
})
