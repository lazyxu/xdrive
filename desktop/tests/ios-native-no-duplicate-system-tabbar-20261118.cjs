'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const dashboard = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')
const ui = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift'), 'utf8')
const start = dashboard.indexOf('TabView(selection: $tab) {')
const end = dashboard.indexOf('.id(ownerScopeKey)', start)
const content = dashboard.slice(start, end)

test('all five actual TabView roots hide their system bar at content level', () => {
  assert.ok(start >= 0 && end > start)
  assert.match(content, /launcher[\s\S]*?\.navigationTitle\("全部"\)\s*\.toolbar\(\.hidden, for: \.tabBar\)/)
  assert.match(content, /dynamicPage[\s\S]*?\.navigationTitle\(dynamicSlotTitle\)[\s\S]*?\.toolbar\(\.hidden, for: \.tabBar\)\s*\}\s*\.tabItem/)
  assert.match(content, /gallery[\s\S]*?galleryMoreMenu[\s\S]*?\.toolbar\(\.hidden, for: \.tabBar\)\s*\}\s*\.tabItem/)
  assert.match(content, /if tab == \.files \|\| filesTabActivated \{[\s\S]*?files\s*\.navigationTitle\("文件"\)[\s\S]*?\.toolbar\(\.hidden, for: \.tabBar\)/)
  assert.match(content, /mine\s*\.navigationTitle\("我的"\)\s*\.toolbar\(\.hidden, for: \.tabBar\)/)
  // Plus the parent compatibility setting, without ever removing TabView
  // child stack identities or creating a second source reader.
  assert.equal((content.match(/\.toolbar\(\.hidden, for: \.tabBar\)/g) || []).length, 5)
  assert.match(dashboard.slice(end), /\.toolbar\(\.hidden, for: \.tabBar\)\s*\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  assert.match(content, /\.tabItem \{ Label\("文件", systemImage: "folder"\) \}/)
  assert.match(dashboard, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/)
})

test('real Gallery XCUI test rejects any system TabBar overlapping Photos chrome', () => {
  const testStart = ui.indexOf('func testPhotosLibraryCollectionsSearchSelectionAndNoStackedTabBars()')
  const testEnd = ui.indexOf('func testRapidGalleryFilesTabOscillation', testStart)
  assert.ok(testStart >= 0 && testEnd > testStart)
  const journey = ui.slice(testStart, testEnd)
  assert.match(journey, /XCTAssertFalse\(app\.tabBars\.firstMatch\.exists,/)
  assert.match(journey, /XCTAssertFalse\(target\("native-ios-five-slot-bar", in: app\)\.exists/)
  assert.match(journey, /native-ios-photos-library-tab/)
  assert.match(journey, /native-ios-photos-collections-tab/)
  assert.match(journey, /native-ios-photos-search/)
})
