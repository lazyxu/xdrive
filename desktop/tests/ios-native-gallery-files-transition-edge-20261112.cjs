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
