'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const native = read('ios/UITests/XDriveIOSGalleryFilesSixSubpageUITests.swift');
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml');
const watcher = read('ios/scripts/capture-navigation-smoke-frames.py');
const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift');
const files = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
const history = read('ios/XDriveIOS/NativeFilesOperationHistory.swift');
const saved = read('ios/XDriveIOS/NativeFilesSavedSearches.swift');

const journeys = [
  'testFilterPeopleDeniedCloudReturnKeepsVerifiedGalleryGeneration',
  'testFilesHistorySavedSearchesAcrossOriginalsHaveNoGhostSheets',
  'testOriginalsHelpTrashDeniedReturnDoesNotReopenAlert',
  'testLocalPhotoDateAndFilesSavedSheetReturnKeepsPhotoKitChild',
  'testMapModalFilesCloudDenialDoesNotRemountUnifiedWall',
  'testFilesSearchKeyboardGalleryPeopleReturnHasNoGhostOverlay',
];

test('all six real native cross-subpage journeys are registered exactly once', () => {
  assert.equal((native.match(/    func test[A-Z]\w*\(\)/g) || []).length, 6);
  assert.equal(new Set(journeys).size, 6);
  for (const name of journeys) {
    assert.equal(native.split('func ' + name + '()').length, 2, name);
    assert.match(watcher, new RegExp('"' + name + '"'));
  }
  assert.match(native, /let app = XCUIApplication\(\)/);
  assert.match(native, /app\.launch\(\)/);
  assert.match(native, /XCTAssertEqual\(app\.state, \.runningForeground/);
  assert.match(native, /IOS_NATIVE_NAV_TAP_START route=/);
  // Actual production Files List has an explicit stable AX identifier.
  // Never assert the first Lazy Cloud Root row stays mounted after sheet return.
  assert.match(native, /control\("native-ios-files-home-list", app\)/);
  assert.doesNotMatch(native, /app\.(?:tables|collectionViews|scrollViews)\.firstMatch/);
  assert.match(files, /accessibilityIdentifier\(isHome \? "native-ios-files-home-list" : "native-ios-files-folder-list"\)/);
  assert.match(native, /XCTAttachment|app\.screenshot\(\)/);
});

test('candidate-gallery-files must actually RUN the six child tests in macOS Xcode', () => {
  assert.match(workflow, /'ios\/UITests\/XDriveIOSGalleryFilesSixSubpageUITests\.swift'/);
  const candidate = workflow.slice(workflow.indexOf('            candidate-gallery-files)'),
    workflow.indexOf('            candidate-no-session)'));
  assert.match(candidate, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesStabilityUITests/);
  assert.match(candidate, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesFrameContinuityUITests/);
  assert.match(candidate, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesSixSubpageUITests/);
  assert.match(workflow, /xcodebuild test/);
  assert.match(workflow, /resultBundlePath/);
  assert.match(workflow, /-parallel-testing-enabled NO/);
  for (const name of journeys) {
    assert.match(watcher, new RegExp('"' + name + '"'));
  }
});

test('the real native child and no-session boundaries are exercised, not mock routes', () => {
  for (const id of [
    'native-ios-gallery-open-filters',
    'native-ios-gallery-people',
    'native-ios-unified-photo-gallery',
    'native-ios-unified-gallery-show-map',
  ]) assert.ok(gallery.includes(id), id);
  for (const id of [
    'native-ios-files-open-root-location',
    'native-ios-files-open-trash',
    'native-ios-files-open-saved-searches',
    'native-ios-files-open-operations',
    'native-ios-files-error-page',
    'native-ios-files-error-return',
  ]) assert.ok(files.includes(id), id);
  assert.match(history, /native-ios-files-operation-history-page/);
  assert.match(history, /native-ios-files-operation-history-done/);
  assert.match(saved, /native-ios-files-saved-searches-page/);
  assert.match(saved, /native-ios-files-saved-searches-done/);
  assert.match(native, /XCTAssertFalse\(control\("native-ios-files-grid", app\)\.exists/);
  assert.match(native, /XCTAssertFalse\(control\("native-ios-cloud-original-tile", app\)\.exists/);
  assert.doesNotMatch(native, /URLSession|Bearer |PHPhotoLibrary\.requestAuthorization|performChanges\(|UploadSession/);
});

test('blank detection samples the child, not only persistent colorful tab chrome', () => {
  assert.match(native, /let width = 96, height = 64/);
  assert.match(native, /for y in \(height \/ 5\)\.\.<\(height \* 4 \/ 5\)/);
  assert.match(native, /for x in \(width \/ 8\)\.\.<\(width \* 7 \/ 8\)/);
  assert.match(native, /XCTAssertGreaterThan\(colors\.count, 8/);
  assert.match(native, /UUID\(uuidString: value\)/);
  assert.match(native, /XCTAssertEqual\(unifiedGeneration\(app\), generation/);
  assert.match(native, /XCTAssertFalse\(app\.keyboards\.firstMatch\.exists/);
  assert.doesNotMatch(native, /provesZeroFlicker|measured120FPS|mockFrame|fakeScreenshot/);
});

test('failed search has explicit recovery without exposing an unverified Owner Node', () => {
  const start = files.indexOf('private var filesChrome: some View {');
  const end = files.indexOf('.modifier(XDriveIOSNativeFilesSearchPresentation(', start);
  assert.ok(start >= 0 && end > start, 'missing real native Files chrome');
  const error = files.slice(start, end);
  assert.match(error, /if !isHome && !model\.loading && !model\.verifiedPage,/);
  assert.match(error, /let failure = model\.errorMessage/);
  assert.match(error, /if isGlobalSearch \{[\s\S]*?Button\("清除搜索并返回浏览"\) \{ clearSearch\(\) \}/);
  assert.match(error, /native-ios-files-error-clear-search/);
  assert.match(error, /native-ios-files-error-page/);
  assert.match(files, /private func clearSearch\(\) \{[\s\S]*?activeQuery = ""/);
});
