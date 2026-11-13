'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const journeys = [
  'testUnifiedPhotoDensityThreeModesKeepsVerifiedWallAcrossFiles',
  'testGalleryDateDraftCanceledBeforeFilesPeopleReturnKeepsWall',
  'testGalleryFilenameFilterAppliedFilesSectionsAndCleared',
  'testFilesSizeFilterOriginalsReturnAndResetWithoutBlank',
  'testFilesOrganizeHomeSheetBackgroundRotationGalleryReturn',
  'testFilesTrashDeniedLandscapeForegroundOriginalsReturnHasNoGhostChild'
]

test('six new native Gallery/Files journeys have unique real XCTest and frame registrations', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')
  const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
  for (const name of journeys) {
    const testcase = new RegExp('func\\s+' + name + '\\s*\\(', 'g')
    assert.equal([...ui.matchAll(testcase)].length, 1, 'Exactly one real XCTest: ' + name)
    assert.equal(watcher.split('"' + name + '"').length - 1, 1,
      'A case must be registered once with the frame watcher: ' + name)
  }
  assert.match(workflow,
    /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesTransitionEdgeUITests/)
  assert.match(ui, /print\("IOS_NATIVE_NAV_TAP_START route=\\\(id\)"\)/)
  assert.doesNotMatch(ui, /mockPhotoKit|fakeToken|WKWebView|XCTSkip/)
})

test('density, filter draft, filename and file size journeys use real production controls', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
  const density = read('ios/XDriveIOS/NativePhotoWallDensityPolicy.swift')
  const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  for (const control of [
    'native-ios-unified-wall-density',
    'native-ios-gallery-open-filters',
    'native-ios-files-search-size-filter'
  ]) {
    assert.ok(ui.includes(control), 'UITest not driving ' + control)
    assert.ok([gallery, files].some(s => s.includes(control)),
      'Missing actual production accessibility route: ' + control)
  }
  for (const title of ['紧凑', '大图', '标准'])
    assert.ok(density.includes('"' + title + '"'), 'Density mode renamed: ' + title)
  assert.match(gallery, /Toggle\("限定日期范围"/)
  assert.match(gallery, /TextField\("文件名", text: \$draft\.text\)/)
  assert.match(files, /Button\("小于 1 MiB"\)/)
  assert.match(files, /Button\("不限大小"\)/)
  assert.match(ui, /XCTAssertEqual\(wall\.value as\? String, filteredGeneration/)
  assert.match(ui, /XCTAssertEqual\(wall\.value as\? String, generation/)
})

test('organizer and trash recovery use real child sheets, rotation and owner denial', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  for (const control of [
    'native-ios-files-organize-home',
    'native-ios-files-organize-home-sheet',
    'native-ios-files-open-trash',
    'native-ios-files-trash-error-page',
    'native-ios-files-trash-error-return'
  ]) {
    assert.ok(ui.includes(control), 'Missing real UI journey action: ' + control)
    assert.ok(files.includes(control), 'Missing native Files production route: ' + control)
  }
  assert.match(ui, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(ui, /XCUIDevice\.shared\.orientation = \.landscapeLeft/)
  assert.match(ui, /XCTAssertFalse\(target\("native-ios-files-trash-error-page", app\)\.exists/)
  assert.match(ui, /XCTAssertFalse\(target\("native-ios-files-organize-home-sheet", app\)\.exists/)
})


test('no-session Trash child has no retry before or after landscape and foreground return', () => {
  const ui = read('ios/UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
  const trash = read('ios/XDriveIOS/NativeFilesTrash.swift')
  const start = ui.indexOf('func testFilesTrashDeniedLandscapeForegroundOriginalsReturnHasNoGhostChild()')
  assert.ok(start >= 0, 'Actual no-session Trash landscape XCUITest must exist')
  const route = ui.slice(start, ui.indexOf('\n    }', start))
  assert.match(trash, /if !login\.hasLocalOwnerSession \{[\s\S]*?XDriveIOSNativeFilesNoSessionRoute\(kind: \.trash\)/)
  assert.match(route, /native-ios-files-trash-no-session/)
  assert.match(route, /XCTAssertFalse\(target\("native-ios-files-trash-retry", app\)\.exists/)
  assert.doesNotMatch(route, /tap\("native-ios-files-trash-retry", app\)/)
  assert.match(route, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(route, /native-ios-files-trash-error-return/)
})
