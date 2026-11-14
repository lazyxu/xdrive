'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = source => fs.readFileSync(path.join(root, source), 'utf8')
const names = [
  'testPeopleChildDeniedFilesReturnKeepsGalleryTree',
  'testCloudOriginalsHelpFilesSearchReturnRetainsChild',
  'testGalleryFilterCancelFilesSectionsKeepsUnifiedWall',
  'testLocalPhotoPermissionFilesForegroundReturnKeepsChild',
  'testFilesRootDenialLandscapeGalleryAlbumsReturn',
  'testOriginalsAlbumsFilesQuickRailThreeCyclesKeepsPages'
]

test('Gallery refuses historical cursor loops atomically before publishing a page', () => {
  const code = read('ios/XDriveIOS/NativeUnifiedGalleryPolicy.swift')
  const start = code.indexOf('mutating func commit(page:')
  const end = code.indexOf('mutating func measure(page:', start)
  assert.ok(start >= 0 && end > start)
  const commit = code.slice(start, end)
  assert.match(commit, /guard !pages\.contains\(where: \{ \$0\.start == next \}\) else \{ return false \}/)
  assert.ok(commit.indexOf('guard !pages.contains(') < commit.indexOf('pages[page].count = count'),
    'A rejected duplicate cursor must never mutate an already visible page')
  assert.match(commit, /return previousCount == count && pages\[page\]\.end == next/)
  const checks = read('ios/tests/NativeUnifiedGalleryChecks.swift')
  assert.match(checks, /twoHop\.commit\(page: 1, count: 48, next: "A"\)/)
  assert.match(checks, /threeHop\.commit\(page: 2, count: 48, next: "A"\)/)
  assert.match(checks, /for n in 0\.\.<2_084/)
})

test('Files cached thumbnail is hidden while Viewer covers it or scene is inactive', () => {
  const tile = read('ios/XDriveIOS/NativeFilesThumbnail.swift')
  assert.match(tile, /visible: !viewerActive && phase == \.active/)
  assert.match(tile, /if identity\.visible, let bitmap, let bitmapIdentity,/)
  assert.match(tile, /bitmapIdentity\.ownerID == identity\.ownerID/)
  assert.match(tile, /bitmapIdentity\.rootNodeID == identity\.rootNodeID/)
  assert.match(tile, /bitmap != nil \{ return \}/)
  assert.match(tile, /guard identity\.visible,/)
  assert.match(tile, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.doesNotMatch(tile, /Data\(contentsOf:|WKWebView|file-preview\//)
})

test('six production iOS Gallery/Files child journeys are executed and filmed by candidate suite', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const flow = read('.github/workflows/ios-native-navigation-runtime.yml')
  const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
  for (const name of names) {
    assert.ok(ui.includes('func ' + name + '('), 'XCTest journey missing: ' + name)
    assert.ok(watcher.includes('"' + name + '"'), 'Frame watcher registration missing: ' + name)
  }
  assert.match(ui, /print\("IOS_NATIVE_NAV_TAP_START route=\\\(id\)"\)/)
  assert.match(ui, /let cgImage = app\.screenshot\(\)\.image\.cgImage/)
  assert.match(ui, /XCTAssertGreaterThan\(unique\.count, 8/)
  assert.match(ui, /native-ios-files-error-page/)
  assert.match(ui, /native-ios-gallery-people-page/)
  assert.match(ui, /native-ios-local-timeline-open/)
  assert.match(ui, /XCUIDevice\.shared\.orientation = \.landscapeLeft/)
  assert.match(ui, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(flow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesTransitionEdgeUITests/)
  assert.match(flow, /ios\/UITests\/XDriveIOSGalleryFilesTransitionEdgeUITests\.swift/)
  assert.doesNotMatch(ui, /WKWebView|fakeToken|mockPhotoKit|Data\(contentsOf:/)
})

test('five additional real Simulator Gallery/Files transitions use source-correct child routes', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
  const flow = read('.github/workflows/ios-native-navigation-runtime.yml')
  const additional = [
    'testMapShortcutThenExplicitUnifiedFilesReturn',
    'testMapShortcutFilesRailThenMapReentryKeepsRoute',
    'testOriginalsHelpFilesDeniedChildThenUnifiedRecovery',
    'testPeopleFilesSectionsBackgroundAndPeopleReentry',
    'testLocalPhotosFilesRecentOriginalsThenLocalReturn',
  ]
  for (const method of additional) {
    assert.ok(ui.includes('func ' + method + '()'), 'Native XCTest missing: ' + method)
    assert.ok(watcher.includes('"' + method + '"'), 'Real frame observer must register: ' + method)
  }
  assert.match(ui, /tap\("native-ios-tab-dynamic", app\)/)
  assert.match(ui, /native-ios-map-source-selector/)
  assert.match(ui, /native-ios-gallery-source-unified/)
  assert.match(ui, /native-ios-files-error-page/)
  assert.match(ui, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(ui, /native-ios-local-timeline-open/)
  assert.match(flow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesTransitionEdgeUITests/)
  assert.doesNotMatch(ui, /mockPhotoKit|fakeToken|Data\(contentsOf:|WKWebView/)
})

test('Originals to Local Photos returns via the real visible source menu', () => {
  const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  assert.match(dashboard, /\(\$0 != \.local && \$0 != \.cloud\) \|\| \$0 == gallerySource/,
    'Dashboard hides Local chip unless Local is already active')
  const start = ui.indexOf('func testLocalPhotosFilesRecentOriginalsThenLocalReturn()')
  assert.ok(start >= 0, 'Missing actual cross-page XCTest journey')
  const route = ui.slice(start, ui.indexOf('\n    }', start))
  const originals = route.indexOf('tap("native-ios-gallery-source-originals", app)')
  const chooser = route.indexOf('tap("native-ios-gallery-source-menu", app)', originals)
  assert.ok(originals >= 0 && chooser > originals,
    'Originals must navigate back using the reachable source chooser')
  assert.match(route.slice(chooser), /app\.buttons\["本机照片"\]\.firstMatch/)
  assert.match(route.slice(chooser), /localReturn\.tap\(\)/)
  assert.match(route.slice(chooser), /XCTAssertEqual\(app\.state, \.runningForeground/)
  assert.doesNotMatch(route.slice(originals), /tap\("native-ios-gallery-source-local", app\)/,
    'The hidden Local chip cannot be tapped from Originals')
})

test('four added Gallery/Files journeys retain real keyboard, filters, denial and three-source cycles', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
  for (const method of [
    'testFilesSearchKeyboardGalleryAlbumsThenBrowseNoBlank',
    'testFilterCancelFilesQuickRailPeopleKeepsWallGeneration',
    'testFilesDeniedForegroundOriginalsAndBrowseRecovery',
    'testAlbumsOriginalsUnifiedFilesThreeCyclesKeepVisibleShells',
  ]) {
    assert.ok(ui.includes('func ' + method + '()'), 'Missing real XCTest: ' + method)
    assert.ok(watcher.includes('"' + method + '"'), 'Unregistered real frame evidence: ' + method)
  }
  assert.match(ui, /app\.searchFields\["搜索全部文件"\]/)
  assert.match(ui, /XCTAssertEqual\(wall\.value as\? String, oldGeneration/)
  assert.match(ui, /native-ios-files-error-page/)
  assert.match(ui, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(ui, /native-ios-gallery-source-originals/)
  assert.match(ui, /native-ios-unified-photo-gallery/)
})

test('iOS 18.5 native date editors and off-screen Files size chip are tested through actual accessible controls', () => {
  const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
  const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  assert.match(gallery, /\.accessibilityIdentifier\("native-ios-gallery-filter-date-start"\)/)
  assert.match(gallery, /\.accessibilityIdentifier\("native-ios-gallery-filter-date-end"\)/)
  assert.match(files, /ScrollView\(\.horizontal, showsIndicators: false\)[\s\S]*?\.accessibilityIdentifier\("native-ios-files-search-filters-scroll"\)/)
  assert.match(ui, /func testGalleryDateDraftCanceledBeforeFilesPeopleReturnKeepsWall\(\)/)
  assert.match(ui, /target\("native-ios-gallery-filter-date-start", app\)/)
  assert.match(ui, /target\("native-ios-gallery-filter-date-end", app\)/)
  assert.match(ui, /private func revealFilesSizeFilter\([\s\S]*?rail\.swipeLeft\(\)/)
  assert.match(ui, /XCTAssertTrue\(control\.exists && control\.isHittable/)
  assert.match(ui, /let restoredSize = revealFilesSizeFilter\(app\)/)
  assert.match(ui, /restoredSize\.label\.contains\("文件大小已筛选"\)/)
  assert.doesNotMatch(ui, /app\.datePickers\["开始"\]/)
  assert.doesNotMatch(ui, /XCTSkip/)
})

test('denied Owner global Files filters stay resettable without showing unverified rows', () => {
  const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  assert.match(files, /if !isHome && !isGlobalSearch && !model\.loading && !model\.verifiedPage/)
  assert.match(files, /if !isGlobalSearch \|\| model\.verifiedPage \{/)
  assert.match(files, /if isGlobalSearch \{ searchOptions\.load\(login: login\) \}/)
  assert.match(files, /\.accessibilityIdentifier\("native-ios-files-search-filters-scroll"\)/)
  assert.match(ui, /let activeSize = revealFilesSizeFilter\(app\)/)
  assert.match(ui, /let restoredSize = revealFilesSizeFilter\(app\)/)
  assert.match(ui, /native-ios-files-search-size-filter-reset/)
})

test('date filter scrolls the real SwiftUI sheet and validates both actual editors', () => {
  const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  assert.match(gallery, /\.accessibilityIdentifier\("native-ios-gallery-filter-form"\)/)
  assert.match(ui, /dateToggle\.value as\? String, "1"/)
  assert.match(ui, /form\.swipeUp\(\)/)
  assert.match(ui, /XCTAssertTrue\(sawStart,/)
  assert.match(ui, /XCTAssertTrue\(sawEnd,/)
  assert.doesNotMatch(ui, /XCTSkip/)
})

test('map date-menu AX label fallback taps the actual surfaced button', () => {
  const map = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')
  assert.match(map, /let actualDateMenu = dateByID\.exists \? dateByID : dateByLabel/)
  assert.match(map, /XCTAssertTrue\(actualDateMenu\.isHittable/)
  assert.match(map, /actualDateMenu\.tap\(\)/)
})

test('native Files filter rail is exposed and reached by real vertical then horizontal scrolling', () => {
  const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const railMarker = '.accessibilityElement(children: .contain)\n                .accessibilityIdentifier("native-ios-files-search-filters-scroll")'
  assert.ok(files.includes(railMarker), 'Lazy List filter rail has no accessible scroll container')
  assert.ok(ui.includes('let homeList = target("native-ios-files-home-list", app)'))
  assert.ok(ui.includes('homeList.swipeDown()'), 'Real Browse List must expose off-screen header')
  assert.ok(ui.includes('rail.swipeLeft()'), 'Size chip must be found with a horizontal rail gesture')
  assert.ok(ui.includes('XCTAssertTrue(rail.exists && rail.isHittable'), 'Unreachable real rail must remain a hard failure')
  assert.ok(ui.includes('FILES_FILTER_RAIL_MISSING AX tree:'), 'Keep real AX hierarchy on failure')
  assert.ok(ui.includes('files-search-filter-rail-missing'), 'Keep actual Simulator frame on failure')
})


test('six added independent real iOS Gallery/Files transitions require live AX, child retirement and visual screenshots', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
  const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
  const cases = [
    'testPeopleFilesSavedSearchesOriginalsReturnRetiresSheet',
    'testFilesOperationHistoryForegroundGalleryAlbumsNoGhostModal',
    'testGalleryFilterCancelFilesTrashRecoveryRetainsWall',
    'testUnifiedDensityAfterFilesHomeSheetsPreservesGeneration',
    'testOriginalsHelpFilesQuickRailCloudDenialHasNoGhostOverlay',
    'testLocalPhotosFilesOrganizerBackgroundReturnKeepsChild',
  ]
  for (const name of cases) {
    assert.match(ui, new RegExp('func ' + name + '\\(\\)'))
    assert.ok(watcher.includes('"' + name + '"'), 'Missing real screenshot watcher registration: ' + name)
  }
  assert.match(ui, /private func openRealFilesHomeSheet\(/)
  assert.match(ui, /native-ios-files-home-list/)
  assert.match(ui, /native-ios-files-saved-searches-page/)
  assert.match(ui, /native-ios-files-operation-history-page/)
  assert.match(ui, /native-ios-files-organize-home-sheet/)
  assert.match(ui, /XCTNSPredicateExpectation/)
  assert.match(ui, /XCTAssertEqual\(wall\.value as\? String, generation/)
  assert.match(ui, /native-ios-files-trash-error-page/)
  assert.match(ui, /native-ios-local-timeline-open/)
  assert.match(ui, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(ui, /assertPixels\(app,/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesTransitionEdgeUITests/)
  assert.doesNotMatch(ui, /XCTSkip|WKWebView|fakeToken|mockPhotoKit/)
})

test('video acceptance requires decoded frames from before and after the real tap', () => {
  const probe = read('ios/scripts/navigation_video_probe.py')
  const cases = read('ios/scripts/test_navigation_video_probe.py')
  assert.match(probe, /info\['first_frame_s'\] > tap - 1\.0/)
  assert.match(probe, /result\['reason'\] = 'no_pre_tap_video'/)
  assert.match(probe, /info\['last_frame_s'\] < tap \+ 2\.0/)
  assert.match(probe, /info\['frame_count'\] < 20/)
  for (const testName of [
    'test_post_tap_only_decoded_frames_cannot_count_as_two_sided_video',
    'test_insufficient_pre_tap_recorded_window_is_rejected',
    'test_recorded_one_second_pre_tap_boundary_remains_eligible',
    'test_missing_first_decoded_frame_cannot_be_accepted',
    'test_pre_tap_rejection_preserves_six_route_requirement',
  ]) assert.ok(cases.includes('def ' + testName + '('))
})
