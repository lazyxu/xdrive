'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dashboard = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8');
const swift = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSAllPagesCrashUITests.swift'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ios-native-navigation-runtime.yml'), 'utf8');
const watcher = fs.readFileSync(path.join(root, 'ios/scripts/capture-navigation-smoke-frames.py'), 'utf8');

const implemented = [
  'Local', 'Albums', 'Cloud', 'Originals', 'Map', 'Files',
  'Notes', 'Clipboard', 'Backup', 'Transfers'
];
const placeholders = ['Sync', 'Storage', 'Devices', 'Diagnostics'];

test('every actual Dashboard Launcher destination has an independent real XCTest', () => {
  assert.match(dashboard, /case launcher, dynamic, gallery, files, mine/);
  for (const name of [...implemented, ...placeholders]) {
    const raw = name.toLowerCase();
    assert.ok(dashboard.includes('case .' + raw + ':'), 'Launcher dispatch missing: ' + raw);
    const method = 'func testLauncher' + name +
      (placeholders.includes(name) ? 'Placeholder' : 'Page') + 'DoesNotCrash()';
    assert.ok(swift.includes(method), 'Uncovered Launcher route: ' + raw);
    assert.ok(swift.includes('verifyLauncher("' + raw + '"'),
      'XCTest must actually open Launcher route: ' + raw);
  }
  assert.match(swift, /-xdrive-ui-navigation-smoke/);
  assert.match(swift, /-xdrive-ui-navigation-synthetic-owner/);
  assert.match(swift, /target\.tap\(\)/);
  assert.match(swift, /XCTAssertEqual\(app\.state, \.runningForeground/);
});
test('tool, Owner, lifecycle and native top-tab crash cases run in mandatory Simulator shard', () => {
  const required = [
    'testFiveTabsWithForegroundReturnDoNotCrash',
    'testDynamicRecentPickerSwitchAndDismissDoesNotCrash',
    'testFilesDeniedThenNotesClipboardTransfersDoesNotCrash',
    'testSignedOutMineOwnerControlsFailClosedWithoutCrash',
    'testToolPagesBackgroundAndRotationDoNotCrash'
  ];
  for (const name of required) {
    assert.ok(swift.includes('func ' + name + '()'), 'Missing runtime case: ' + name);
  }
  assert.ok(workflow.includes('ios/UITests/XDriveIOSAllPagesCrashUITests.swift'));
  assert.ok(workflow.includes('-only-testing:xDriveIOSNavigationUITests/XDriveIOSAllPagesCrashUITests'));
  assert.ok(workflow.includes('-only-testing:xDriveIOSNavigationUITests/XDriveIOSPhotoBackupMVPScenarioUITests'));
  assert.match(workflow, /matrix\.source == 'release-c83'/);
  for (const name of [
    'testLauncherMapPageDoesNotCrash',
    'testLauncherCloudPageDoesNotCrash',
    'testLauncherClipboardPageDoesNotCrash',
    ...required
  ]) {
    assert.ok(watcher.includes('"' + name + '"'), 'Missing live-frame diagnostic: ' + name);
  }
  assert.ok(swift.includes('IOS_NATIVE_NAV_TAP_START route='));
  assert.ok(swift.includes('XCTAttachment(screenshot: app.screenshot())'));
});


test('native dynamic slot accepts direct MapKit or the actual selected feature', () => {
  const route = swift.slice(swift.indexOf('func testFiveTabsWithForegroundReturnDoNotCrash'),
                            swift.indexOf('func testDynamicRecentPicker'));
  assert.match(dashboard, /if destination == \.dynamic && emptyDynamicMapFallback \{\s*openGallery\(\.map\)/);
  for (const actual of [
    'native-ios-map-source-selector', 'native-ios-backup-overview',
    'ios-clipboard-status', 'native-ios-transfer-overview', '笔记来源', '打开地图'
  ]) assert.ok(route.includes(actual), 'Uncovered dynamic destination: ' + actual);
  assert.match(route, /eligible\.contains\(where: \{ \$0\.exists \}\)/);
  assert.doesNotMatch(route, /XCTAssertTrue\(app\.buttons\["打开地图"\]/);
});

test('normal cold restart requires real visible startup readiness and preserves recovery', () => {
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  const recovery = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift'), 'utf8');
  assert.match(login, /\.onChange\(of: restoreFinished\) \{ finished in\s*if finished \{ armReadinessAfterMount\(\) \}/);
  assert.match(login, /\.accessibilityValue\(startupReady \? "ready" : "mounting"\)/);
  assert.match(login, /XDriveIOSNativeLaunchCheckpoint\.mark\(\.ready\)/);
  assert.match(recovery, /XCTNSPredicateExpectation\([\s\S]*?predicate: NSPredicate\(format: "value == %@", "ready"\)/);
  assert.match(recovery, /Native startup never entered the real ready state/);
  assert.match(recovery, /Normal restart entered recovery or failed to mount/);
});

test('no-session Files cases select actual Browse and retain strict screenshot rejection', () => {
  const files = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift'), 'utf8');
  assert.match(files, /private func files\(_ app: XCUIApplication\)[\s\S]*?browse\.value as\? String\) != "已选择"[\s\S]*?tap\("native-ios-files-section-browse", app\)/);
  assert.match(files, /Files Browse did not become selected after a real tap/);
  assert.match(files, /native-ios-files-home-list/);
  assert.match(files, /Files Home shortcut was not actually reachable/);
  assert.match(files, /Organizer belongs to the actual Browse Home/);
  assert.match(files, /Files Browse Home action missing\/unreachable/);
  assert.match(files, /let width = 96, height = 64/);
  assert.match(files, /XCTAssertGreaterThan\(colors\.count, 8/);
  assert.match(files, /XCUIDevice\.shared\.orientation = \.portrait/);
});


test('retained Gallery/Files scroll views cannot hijack lazy Launcher navigation', () => {
  assert.match(dashboard, /private var launcher: some View \{[\s\S]*?\.accessibilityIdentifier\("native-ios-launcher-scroll"\)/);
  const helper = swift.slice(swift.indexOf('private func openLauncher('),
                             swift.indexOf('private func verifyLauncher('));
  assert.match(helper, /let host = element\("native-ios-launcher-scroll", app: app\)/);
  assert.doesNotMatch(helper, /app\.scrollViews\.firstMatch/);
  assert.match(helper, /host\.swipeUp\(\)/);
  assert.match(helper, /host\.swipeDown\(\)/);
  assert.match(helper, /target\.exists && target\.isHittable/);
});

test('six more real native tool, backup, Map and Viewer-free navigation journeys are registered', () => {
  const names = [
    'testNotesFilesGalleryNotesThreeCyclesDoNotExit',
    'testClipboardNotesTransfersForegroundRoundTripsDoNotExit',
    'testTransfersRealFileAndBackupDestinationsDoNotExit',
    'testBackupTaskSheetFilesGalleryDynamicReturnDoNotExit',
    'testSignedOutMinePlaceholdersGalleryReturnDoNotExit',
    'testLocalMapFilesNotesClipboardReturnDoNotExit'
  ];
  const allCases = [...swift.matchAll(/func (test\w+)\(\)/g)].map(m => m[1]);
  assert.equal(allCases.length, 36, 'All 36 independent Launcher and child-page XCTest routes must all run');
  for (const name of names) {
    assert.ok(allCases.includes(name), 'Missing tap-driven XCUITest: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Missing tap-adjacent watcher: ' + name);
  }
  assert.match(swift, /XCTNSPredicateExpectation/);
  assert.match(swift, /native-ios-photo-task-list-done/);
  assert.match(swift, /native-ios-transfer-overview/);
  assert.match(swift, /native-ios-map-source-selector/);
  assert.match(swift, /XCTAssertEqual\(app\.state, \.runningForeground/);
  assert.doesNotMatch(swift, /fakeToken|fakeOwner|mockServerLogin/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});



test('eight actual Backup/Gallery/Files/Mine subpage crash journeys are independently recorded', () => {
  const children = [
    'testBackupDetailsChildFilesReturnDoesNotExit',
    'testBackupAuditChildForegroundReturnDoesNotExit',
    'testGalleryBackupSettingsChildReturnDoesNotExit',
    'testGalleryFocusedBackupChildDoesNotStartUpload',
    'testGalleryBackupQueueSheetRetiresDoesNotExit',
    'testGalleryCacheSheetBackgroundDismissDoesNotExit',
    'testFilesTagManagementChildRetiresBeforeNotesDoesNotExit',
    'testMinePhotoWallChildFilesReturnWithoutSignIn'
  ];
  const allCases = [...swift.matchAll(/func (test\w+)\(\)/g)].map(m => m[1]);
  assert.equal(allCases.length, 36, 'Every independent Launcher and subpage route must remain present');
  assert.equal(new Set(allCases).size, allCases.length, 'No duplicate method can silently hide a child');
  for (const name of children) {
    assert.ok(allCases.includes(name), 'Missing actual native XCTest child: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Missing tap-adjacent screenshot watcher: ' + name);
  }
  for (const id of [
    'native-ios-backup-portrait-form',
    'native-ios-photo-task-list-done',
    'native-ios-gallery-thumbnail-cache',
    'native-ios-backup-cache-sheet-close',
    'native-ios-files-tag-management',
    'native-ios-notes-page',
    'native-ios-mine-server-account'
  ]) {
    assert.ok(swift.includes('"' + id + '"'), 'Missing actual child mount check: ' + id);
  }
  assert.match(swift, /private func waitRetired[\s\S]*?XCTNSPredicateExpectation/);
  assert.match(swift, /private func tapNamed[\s\S]*?IOS_NATIVE_NAV_TAP_START route=/);
  assert.match(swift, /XCTAssertFalse\(element\("native-ios-photos-focused-progress"/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
  assert.doesNotMatch(swift, /forceLogin|fakeToken|mockServerLogin/);
});


test('Notes, Clipboard and signed-out Mine real child routes remain registered in native crash shard', () => {
  const children = [
    'testNotesSourceChildrenFilesReturnKeepNativePage',
    'testClipboardUnverifiedRecipientChildFailsClosedWithoutExit',
    'testMineOwnerOnlyThumbnailCacheCannotOpenSignedOut'
  ];
  const cases = [...swift.matchAll(/func (test\w+)\(\)/g)].map(m => m[1]);
  assert.equal(cases.length, 36);
  assert.equal(new Set(cases).size, 36);
  for (const name of children) {
    assert.ok(cases.includes(name), 'Missing real native child route: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Missing tap-adjacent capture: ' + name);
  }
  const notes = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeNotesScreen.swift'), 'utf8');
  const clipboard = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeClipboardScreen.swift'), 'utf8');
  const mine = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8');
  assert.match(notes, /Picker\("笔记来源", selection: \$source\)/);
  assert.match(notes, /Label\("导入 Markdown 和图片"/);
  assert.match(clipboard, /Button\("启用本机设备定向接收"\)/);
  assert.match(clipboard, /accessibilityIdentifier\("ios-clipboard-status"\)/);
  assert.match(mine, /NavigationLink\("缩略图缓存"\)[\s\S]*?\.disabled\(login\.owner == nil\)/);
  assert.match(swift, /XCTAssertFalse\(cache\.isEnabled/);
  assert.match(swift, /XCTAssertFalse\(app\.staticTexts\["设备定向接收已启用"\]/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});


test('real dynamic MapKit source must be closed through native Done before demanding Unified', () => {
  const method = swift.slice(
    swift.indexOf('func testFiveTabsWithForegroundReturnDoNotCrash()'),
    swift.indexOf('func testDynamicRecentPickerSwitchAndDismissDoesNotCrash()'),
  );
  assert.match(method, /var mapOpenedByDynamic = false/);
  assert.match(method, /if tab == "gallery" && mapOpenedByDynamic \{/);
  assert.match(method, /ready\("native-ios-map-source-selector", app: app\)/);
  assert.match(method, /tap\("native-ios-map-dismiss", app: app\)/);
  assert.match(method, /tap\("native-ios-map-close", app: app\)/);
  assert.match(method, /ready\("native-ios-unified-photo-gallery", app: app\)/);
  assert.match(method, /mapOpenedByDynamic = element\("native-ios-map-source-selector", app: app\)\.exists/);
  assert.match(method, /XCTFail\("Real MapKit Gallery source lost its Done action"\)/);
  const map = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalPhotoMap.swift'), 'utf8');
  assert.match(map, /"native-ios-map-dismiss"/);
  assert.match(dashboard, /private func closeGalleryMap\(\)/);
  assert.match(dashboard, /openGallery\(prior \?\? fallback\)/);
});

test('actual mounted signed-out login re-arms the existing guarded readiness, never forces ready', () => {
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  const checkpoint = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLaunchCheckpoint.swift'), 'utf8');
  const b9 = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift'), 'utf8');
  assert.match(login, /loginForm[\s\S]*?\.onAppear \{ workspaceAppeared\(\) \}[\s\S]*?\.task\(id: restoreFinished\) \{/);
  assert.match(login, /guard restoreFinished else \{ return \}[\s\S]*?await MainActor\.run \{ workspaceAppeared\(\) \}/);
  assert.match(login, /XDriveIOSNativeLaunchCheckpoint\.mayFinishStartup\([\s\S]*?restoreComplete: restoreFinished, workspaceVisible: workspaceVisible,[\s\S]*?foreground: phase == \.active/);
  assert.match(login, /Task\.sleep\(nanoseconds: 3_000_000_000\)/);
  assert.match(checkpoint, /restoreComplete && workspaceVisible && foreground/);
  assert.match(b9, /IOS_NATIVE_STARTUP_NOT_READY/);
  assert.match(b9, /record\(app, "visible-login-not-ready"\)/);
  assert.match(b9, /XCTAssertEqual\(result, \.completed/);
  assert.doesNotMatch(login, /UserDefaults\.standard\.set\("ready"/);
});


test('real Simulator regressions keep Gallery backup 44pt, Notes source AX and guarded startup retry', () => {
  const notes = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeNotesScreen.swift'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  const nav = dashboard.slice(dashboard.indexOf('var body: some View'), dashboard.indexOf('private var nativeBottomBar:'));
  assert.match(nav, /\.navigationTitle\("图库"\)[\s\S]*?ToolbarItem\(placement: \.navigationBarTrailing\)[\s\S]*?galleryCompactBackupAction/);
  const row = dashboard.slice(dashboard.indexOf('private var galleryStatusRow:'), dashboard.indexOf('private var backupMenuItems:'));
  assert.doesNotMatch(row, /Menu \{ backupMenuItems \}/);
  const compact = dashboard.slice(dashboard.indexOf('private var galleryCompactBackupAction:'), dashboard.indexOf('private var gallery: some View'));
  assert.match(compact, /\.frame\(minWidth: 64, minHeight: 44\)[\s\S]*?\.contentShape\(Rectangle\(\)\)/);
  assert.match(compact, /\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/);
  assert.equal((dashboard.match(/galleryCompactBackupAction/g) || []).length, 2,
    'The single backup Menu must be declared once and rendered only in the toolbar');
  assert.match(notes, /\.pickerStyle\(\.segmented\)[\s\S]*?\.accessibilityIdentifier\("native-ios-notes-source-picker"\)/);
  assert.match(swift, /let picker = element\("native-ios-notes-source-picker", app: app\)/);
  // A 2-second retry cannot restore a revoked visible lease. Root ownership
  // retains the real restore/visible/foreground gate without polling.
  assert.match(login, /\.onAppear \{ workspaceAppeared\(\) \}\s*\.onDisappear \{\s*workspaceDisappeared\(\)/);
  assert.match(login, /if finished \{ workspaceAppeared\(\) \}/);
  assert.doesNotMatch(login, /Timer\.publish\(every: 2, on: \.main/);
  assert.doesNotMatch(login, /\.onAppear \{ workspaceAppeared\(\) \}\s*\.onDisappear \{ workspaceDisappeared\(\) \}/);
  assert.match(swift, /XCTAssertGreaterThanOrEqual\(backup\.frame\.height, 43/);
  assert.match(swift, /XCTAssertGreaterThanOrEqual\(backup\.frame\.width, 43/);
  assert.match(login, /XDriveIOSNativeLaunchCheckpoint\.mayFinishStartup\([\s\S]*?restoreComplete: restoreFinished, workspaceVisible: workspaceVisible,[\s\S]*?foreground: phase == \.active/);
  assert.match(login, /Task\.sleep\(nanoseconds: 3_000_000_000\)/);
});


test('every independent Launcher and all-pages child crash journey is registered for real Simulator frames', () => {
  const names = [...swift.matchAll(/\\bfunc\\s+(test\\w+)\\s*\\(/g)].map(match => match[1]);
  assert.ok(names.length >= 36, 'All-pages crash matrix lost an executable journey');
  assert.equal(new Set(names).size, names.length, 'Duplicate XCTest method hides an independent route');
  for (const name of names) {
    assert.ok(watcher.includes('"' + name + '"'), 'Missing real Simulator frame watcher: ' + name);
  }
  for (const name of [
    "testLauncherLocalPageDoesNotCrash",
    "testLauncherAlbumsPageDoesNotCrash",
    "testLauncherCloudPageDoesNotCrash",
    "testLauncherOriginalsPageDoesNotCrash",
    "testLauncherMapPageDoesNotCrash",
    "testLauncherFilesPageDoesNotCrash",
    "testLauncherNotesPageDoesNotCrash",
    "testLauncherClipboardPageDoesNotCrash",
    "testLauncherBackupPageDoesNotCrash",
    "testLauncherTransfersPageDoesNotCrash",
    "testLauncherSyncPlaceholderDoesNotCrash",
    "testLauncherStoragePlaceholderDoesNotCrash",
    "testLauncherDevicesPlaceholderDoesNotCrash",
    "testLauncherDiagnosticsPlaceholderDoesNotCrash",
  ]) {
    assert.ok(watcher.includes('"' + name + '"'), 'Launcher missing bounded UI evidence: ' + name);
  }
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\\/XDriveIOSAllPagesCrashUITests/);
});
