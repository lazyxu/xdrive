'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8'
)

test('modal native map defers Library, Collections and Search route changes until UIKit dismissal', () => {
  const bar = src.slice(src.indexOf('private var nativePhotosBottomBar: some View'),
    src.indexOf('private var galleryBackupStatus', src.indexOf('private var nativePhotosBottomBar')))
  assert.match(bar, /navigatePhotosChrome\(to: \.unified\)/)
  assert.match(bar, /navigatePhotosChrome\(to: \.albums\)/)
  assert.match(bar, /navigatePhotosChrome\(to: \.unified, search: true\)/)
  assert.doesNotMatch(bar, /openGallery\(/)
  const transition = src.slice(src.indexOf('private func navigatePhotosChrome('),
    src.indexOf('private var nativePhotosBottomBar'))
  assert.match(transition, /if presentingUnifiedMap \{[\s\S]*?pendingUnifiedMapDestination = destination[\s\S]*?pendingUnifiedMapOwnerScope = ownerScopeKey[\s\S]*?presentingUnifiedMap = false\s*return\s*\}/)
  assert.match(transition, /if gallerySource != destination \{ openGallery\(destination\) \}/)
})

test('only a completed native modal dismissal can apply an exact Owner-scoped requested route', () => {
  const modal = src.slice(src.indexOf('.fullScreenCover(isPresented: $presentingUnifiedMap'),
    src.indexOf('/// L2 callbacks', src.indexOf('.fullScreenCover(isPresented: $presentingUnifiedMap')))
  assert.match(modal, /onDismiss: \{[\s\S]*?let destination = pendingUnifiedMapDestination[\s\S]*?let requestScope = pendingUnifiedMapOwnerScope/)
  assert.match(modal, /pendingUnifiedMapDestination = nil[\s\S]*?pendingUnifiedMapOwnerScope = nil/)
  assert.match(modal, /guard let destination, requestScope == ownerScopeKey,[\s\S]*?phase == \.active, tab == \.gallery else \{ return \}/)
  // Complete UIKit dismissal before changing source; then route search
  // to PhotoKit when signed out or the Owner-scoped unified editor otherwise.
  assert.match(modal, /if gallerySource != destination \{ openGallery\(destination\) \}[\s\S]*?if wantedSearch \{ openPhotoSearchForCurrentScope\(\) \}/)
  assert.match(src, /private func openPhotoSearchForCurrentScope\(\) \{[\s\S]*?if login\.owner == nil \{[\s\S]*?requestUnifiedPhotoSearch = false[\s\S]*?showingLocalPhotoSearch = true[\s\S]*?\} else \{[\s\S]*?requestUnifiedPhotoSearch = true/)
  assert.doesNotMatch(modal, /if wantedSearch \{ requestUnifiedPhotoSearch = true \}/)
  assert.match(modal, /VStack\(spacing: 0\) \{\s*NavigationStack \{\s*XDriveIOSNativePhotoMapsScreen\([\s\S]*?\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)[\s\S]*?nativePhotosBottomBar\s*\}/)
})

test('signed-out PhotoKit gallery uses actual map and returns to Collections', () => {
  const runtime = fs.readFileSync(path.resolve(
    __dirname,'../../ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift'),'utf8')
  const begin = runtime.indexOf('func testSignedOutLocalPhotoWallMapReturnsToCollectionsWithoutBlank()')
  const end = runtime.indexOf('// The fixture pair must produce an EXACT two-member location Cell', begin)
  assert.ok(begin > 0 && end > begin)
  const journey = runtime.slice(begin,end)
  assert.match(journey,/let app = openLocalMap\(\)/)
  assert.match(journey,/native-ios-map-dismiss[\s\S]*?native-ios-local-gallery-media-filter/)
  assert.match(journey,/NSPredicate\(format: "label == %@", "查看照片"\)/)
  assert.match(journey,/native-ios-local-wall-show-map[\s\S]*?native-ios-full-library-gps-map/)
  assert.match(journey,/native-ios-photos-collections-tab/)
  assert.match(journey,/XCTAssertFalse\(map\.exists\)/)
  assert.match(journey,/XCTAttachment\(screenshot: app\.screenshot\(\)\)/)
  assert.doesNotMatch(journey,/coordinate\(withNormalizedOffset:|syntheticOwner|testOnly|simctl privacy grant/)
})

test('logout, changed Owner and background retire all pending routes without touching media identity', () => {
  const reset = src.slice(src.indexOf('private func resetNavigation()'))
  for (const v of ['pendingUnifiedMapDestination = nil', 'pendingUnifiedMapSearch = false', 'pendingUnifiedMapOwnerScope = nil']) {
    assert.ok(reset.includes(v), v)
  }
  assert.match(src, /guard state == \.active else \{[\s\S]*?pendingUnifiedMapDestination = nil/)
  assert.match(src, /if next != \.gallery \{\s*pendingUnifiedMapDestination = nil/)
  assert.match(src, /\.onChange\(of: ownerScopeKey\) \{ _ in[\s\S]*?resetNavigation\(\)/)
  const helper = src.slice(src.indexOf('private func navigatePhotosChrome('),
    src.indexOf('private var nativePhotosBottomBar'))
  assert.doesNotMatch(helper, /PHAsset|PHPhotoLibrary|URLSession|photoID|signedURL|GPS/)
})
