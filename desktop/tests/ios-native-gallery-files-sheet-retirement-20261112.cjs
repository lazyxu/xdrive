'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ui = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ios-native-navigation-runtime.yml'), 'utf8');
const section = (start, end) => {
  const a = ui.indexOf(start);
  const b = ui.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Cannot isolate original XCTest: ' + start);
  return ui.slice(a, b);
};
const noSession = section('func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()', 'func testFilesOperationHistoryBackgroundThenFilesGalleryReturn()');
const foreground = section('func testFilesOperationHistoryBackgroundThenFilesGalleryReturn()', 'func testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels()');
const helper = section('private func awaitOperationsSheetRetired(', 'func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()');

test('Sheet Done must wait for the genuine modal page to retire, not merely an underlying Files tab', () => {
  assert.match(helper, /native-ios-files-operation-history-page/);
  assert.match(helper, /XCTNSPredicateExpectation/);
  assert.match(helper, /exists == false/);
  assert.match(helper, /XCTWaiter\.wait\(for: \[dismissed\], timeout: 12\)/);
  assert.match(helper, /XCTAssertEqual\(status, \.completed/);
  assert.match(helper, /XCTAssertEqual\(app\.state, \.runningForeground/);
  for (const t of [noSession, foreground]) {
    assert.match(t, /done\.tap\(\)\s*awaitOperationsSheetRetired\(app\)\s*assertFiles\(app\)/);
    assert.match(t, /tap\("native-ios-tab-gallery", app: app\)/);
  }
});
test('background-return failure preserves actual native screenshot and a strict missing Gallery failure', () => {
  assert.match(foreground, /gallery\.waitForExistence\(timeout: 15\)/);
  assert.match(foreground, /gallery-not-mounted-after-operations-foreground/);
  assert.match(foreground, /XCTFail\("Gallery source rail was lost after operations Sheet retirement"\)/);
  assert.match(foreground, /assertVisiblePixels\(app, route: "Gallery after operations foreground"\)/);
  assert.doesNotMatch(foreground, /XCTSkip|return true|forceUnwrap/);
});
test('both original operation-history routes remain in the required native Simulator candidate', () => {
  assert.ok(ui.includes('func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages()'));
  assert.ok(ui.includes('func testFilesOperationHistoryBackgroundThenFilesGalleryReturn()'));
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSGalleryFilesFrameContinuityUITests/);
});
