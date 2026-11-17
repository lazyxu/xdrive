'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const native = read('ios/UITests/XDriveIOSGalleryFilesSixSubpageUITests.swift');
const frameContinuity = read('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift');
const stability = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift');
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml');
const watcher = read('ios/scripts/capture-navigation-smoke-frames.py');
const h264 = read('ios/scripts/files_ui_transition_video.py');
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

const extendedJourneys = [
  'testFilesMoreOrganizerGalleryReturnPreservesBrowseHome',
  'testFilesQuickRailRotationPeopleReturnKeepsNativeShell',
  'testGalleryFilterFilesHistoryForegroundKeepsWallGeneration',
  'testLocalPhotoDateSheetFilesQuickSectionsThenReopen',
  'testGalleryMapFilesSavedSearchesReturnKeepsGeneration',
  'testGalleryPeopleFiltersFilesTrashDenialReturnWithoutGhost',
];

test('all twelve real native cross-subpage journeys are registered exactly once', () => {
  assert.equal((native.match(/    func test[A-Z]\w*\(\)/g) || []).length, 12);
  assert.equal(new Set([...journeys, ...extendedJourneys]).size, 12);
  for (const name of [...journeys, ...extendedJourneys]) {
    assert.equal(native.split('func ' + name + '()').length, 2, name);
    assert.match(watcher, new RegExp('"' + name + '"'));
    assert.match(h264, new RegExp('"' + name + '"'),
      name + ' must be included in real 30-Hz H.264 video audit');
    const start = native.indexOf('func ' + name + '()');
    assert.match(native.slice(start, start + 160),
      /let app = launch\([^\n]*\)\s*waitForRealH264RecordingPrelude\(\)/,
      name + ' must wait until actual recorder has started before first tap');
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
  assert.match(workflow, /--minimum 50/,
    'all 50 separate real navigation clips must be audited without opt-out');
  for (const name of [...journeys, ...extendedJourneys]) {
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
  assert.match(native, /tap\("native-ios-files-error-clear-search", app\)/);
  assert.match(native, /native-ios-files-folder-list/);
  assert.match(files, /private func clearSearch\(\) \{[\s\S]*?activeQuery = ""/);
});

test('six additional real Files/Gallery transitions are H.264-audited, including rotation and search', () => {
  const cases = [
    'testFilesHomeDeepScrollTabReturnKeepsQuickNavigation',
    'testFilesSearchFocusThenGalleryReturnPreservesShell',
    'testGalleryFilesRotateLandscapeAndReturnPortrait',
    'testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank',
    'testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes',
    'testFilesHomeAfterRepeatedNativeGallerySourceChanges',
  ];
  assert.equal(new Set(cases).size, 6);
  for (const name of cases) {
    assert.match(h264, new RegExp('"' + name + '"'), name + ' must have a real video target');
    const start = stability.indexOf('func ' + name + '()');
    assert.ok(start >= 0, name + ' actual XCUITest is missing');
    const next = stability.indexOf('\n    func test', start + 5);
    const body = stability.slice(start, next >= 0 ? next : undefined);
    assert.match(body, /waitForRealH264RecordingPrelude\(\)/, name + ' missing recorder pre-roll');
    assert.match(body, /select\("native-ios-tab-/,
      name + ' must tap a real native Gallery or Files tab');
  }
  assert.match(workflow, /--minimum 50/);
});

test('both existing Gallery/Files native suites audit child viewport rather than colorful tab chrome', () => {
  const cases = [
    [stability, 'assertNotSolidScreen'],
    [frameContinuity, 'assertVisiblePixels'],
  ];
  for (const [source, helper] of cases) {
    const start = source.indexOf('private func ' + helper);
    assert.ok(start >= 0, helper + ' must still inspect live native screenshots');
    const end = source.indexOf('\n    func test', start);
    const body = source.slice(start, end >= 0 ? end : undefined);
    assert.match(body, /let width = 96, height = 64/);
    assert.match(body, /for y in \(height \/ 5\)\.\.<\(height \* 4 \/ 5\)/);
    assert.match(body, /for x in \(width \/ 8\)\.\.<\(width \* 7 \/ 8\)/);
    assert.match(body, /XCTAssertGreaterThan\(unique\.count, 8/);
    assert.doesNotMatch(body, /Set\(stride\(from: 0, to: pixels\.count/,
      'persistent system tab chrome must not satisfy child-content assertion');
  }
});

test('real native UI test suites still cover six independent subpage return situations', () => {
  const routes = [
    [stability, 'testFilesHomeDeepScrollTabReturnKeepsQuickNavigation'],
    [stability, 'testFilesSearchFocusThenGalleryReturnPreservesShell'],
    [stability, 'testGalleryFilesRotateLandscapeAndReturnPortrait'],
    [stability, 'testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank'],
    [frameContinuity, 'testLocalPhotoTimelineSheetRepeatedAfterFilesReturns'],
    [frameContinuity, 'testHistoryForegroundAlbumsReturnWithoutGhostSheet'],
  ];
  for (const [source, name] of routes) {
    const match = source.match(new RegExp('func ' + name + '\\(\\)'));
    assert.ok(match, 'missing independently executed native XCTest ' + name);
    const body = source.slice(source.indexOf('func ' + name + '()'));
    const next = body.indexOf('\n    func test');
    assert.match(body.slice(0, next >= 0 ? next : undefined),
      /assertNotSolidScreen\(app|assertVisiblePixels\(app|checkGallery\(app|checkFilesHome\(app/,
      'route must inspect a real native child, not just appear in a test name');
  }
});

test('six existing Gallery/Files high-frequency returns now sample child pixels', () => {
  const required = [
    'testRapidGalleryFilesTabOscillationPreservesBothShells',
    'testFilesQuickRailAlternatingSectionsReturnsToBrowse',
    'testGallerySourcesAlternateWithoutLosingSourceRail',
    'testRepeatedFilterDismissalRestoresSameGallery',
    'testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource',
    'testGalleryFilterCancelAfterTabAndSourceRoundTrips',
  ];
  for (const name of required) {
    const begin = stability.indexOf('func ' + name + '()');
    assert.ok(begin > 0, 'Missing real native XCTest: ' + name);
    const after = stability.indexOf('\n    func test', begin + 4);
    const code = stability.slice(begin, after > 0 ? after : undefined);
    assert.match(code, /assertNotSolidScreen\(app,/,
      name + ' must verify child pixels after native navigation, not only the tab rail');
    assert.match(code, /select\("native-ios-/,
      name + ' must navigate via a real native control');
  }
  assert.match(stability, /for y in \(height \/ 5\)\.\.<\(height \* 4 \/ 5\)/);
  assert.match(stability, /for x in \(width \/ 8\)\.\.<\(width \* 7 \/ 8\)/);
});

test('six additional high-risk Gallery/Files transitions require true H264 evidence', () => {
  const required = [
    'testGallerySourcesAlternateWithoutLosingSourceRail',
    'testRepeatedFilterDismissalRestoresSameGallery',
    'testGalleryFilterCancelAfterTabAndSourceRoundTrips',
    'testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource',
    'testFilesBackgroundResumeKeepsQuickRailAndPixels',
    'testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank',
  ];
  for (const name of required) {
    const inStability = stability.includes('func ' + name + '()');
    const source = inStability ? stability : frameContinuity;
    const matches = source.match(new RegExp('func ' + name + '\\(\\)', 'g')) || [];
    assert.equal(matches.length, 1, name + ' requires one genuine XCTest method');
    const begin = source.indexOf('func ' + name + '()');
    const end = source.indexOf('\n    func test', begin + 5);
    const body = source.slice(begin, end >= 0 ? end : undefined);
    assert.match(body, /let app = launch\([^\n]*\)\s*waitForRealH264RecordingPrelude\(\)/,
      name + ' must not tap during real recorder startup');
    assert.match(body, /(?:select|tap)\("native-ios-/,
      name + ' must generate actual native touch markers');
    assert.match(body, /assertNotSolidScreen\(app|assertVisiblePixels\(app/,
      name + ' must check real native content pixels');
    assert.ok(h264.includes('"' + name + '"'), name + ' missing bounded real H264 watcher');
  }
  assert.match(workflow, /--minimum 50/, 'all 50 clips must be real and audited');
  assert.match(h264, /MAX_CLIP_SECONDS = 210/,
    'long genuine XCTest must not be truncated by old 120-second clip limit');
});


test('every mandatory real H264 target belongs to exactly one executable XCTest and live frame watcher', () => {
  // The active video gate grew from 44 to 50 actual journeys. Verify source
  // parity from the target registry, rather than hardcoding a stale count.
  const targets = [...h264.matchAll(/^\s*"(test\w+)",?$/gm)].map(m => m[1]);
  assert.equal(targets.length, 50, 'never silently reduce the mandatory H.264 case set');
  assert.equal(new Set(targets).size, targets.length, 'duplicate video targets are invalid');
  const suites = [stability, frameContinuity, native];
  const methods = suites.flatMap(code =>
    [...code.matchAll(/^\s*func (test\w+)\(\)/gm)].map(m => m[1])
  );
  for (const name of targets) {
    assert.equal(methods.filter(method => method === name).length, 1,
      name + ' must exist in exactly one executed native UI suite');
    const source = suites.find(code => code.includes('func ' + name + '()'));
    const start = source.indexOf('func ' + name + '()');
    const next = source.indexOf('\n    func test', start + 5);
    const journey = source.slice(start, next < 0 ? undefined : next);
    assert.match(journey, /waitForRealH264RecordingPrelude\(\)/,
      name + ' must wait for actual recorder startup before the first tap');
    assert.ok(watcher.includes('"' + name + '"'),
      name + ' must have live Simulator frame sampling');
  }
  assert.match(workflow, /files_ui_transition_video\.py" audit[\s\S]*?--minimum 50/,
    'all 50 distinct actual video clips must remain mandatory');
});
