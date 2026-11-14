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
    'ios-clipboard-status', 'native-ios-transfer-overview',
    'native-ios-notes-source-picker', '打开地图'
  ]) assert.ok(route.includes(actual), 'Uncovered dynamic destination: ' + actual);
  assert.match(route, /eligible\.contains\(where: \{ \$0\.exists \}\)/);
  assert.doesNotMatch(route, /app\.segmentedControls\["笔记来源"\]/);
  assert.match(route, /element\("native-ios-notes-source-picker", app: app\)/);
  assert.doesNotMatch(route, /XCTAssertTrue\(app\.buttons\["打开地图"\]/);
});

test('normal cold restart requires real visible startup readiness and preserves recovery', () => {
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  const recovery = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift'), 'utf8');
  // Completion re-enters via the mounted workspace, not a readiness shortcut.
  // The workspace itself still applies restore/visibility/foreground gates.
  assert.match(login, /\.onChange\(of: restoreFinished\) \{ finished in\s*if finished \{ workspaceAppeared\(\) \}/);
  assert.match(login, /private func workspaceAppeared\(\) \{\s*workspaceVisible = true\s*if model\.owner != nil && !startupReady \{[\s\S]*?markPostLogin\([\s\S]*?\.dashboardAppeared[\s\S]*?\}\s*armReadinessAfterMount\(\)/);
  assert.match(login, /private func armReadinessAfterMount\(\) \{\s*guard !startupReady,[\s\S]*?XDriveIOSNativeLaunchCheckpoint\.mayFinishStartup\(/);
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
  assert.ok(allCases.length >= 38, 'All 36 independent Launcher and child-page XCTest routes must all run');
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
  assert.ok(allCases.length >= 38, 'Every independent Launcher and subpage route must remain present');
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
  assert.ok(cases.length >= 38);
  assert.equal(new Set(cases).size, cases.length);
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
  const names = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(match => match[1]);
  assert.ok(names.length >= 41, 'All-pages crash matrix lost an executable journey');
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
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});

test('real login child crash journeys exercise the production root without credentials', () => {
  for (const name of ["testRealSignedOutLoginPasswordToggleAfterForegroundDoesNotExit","testRealSignedOutLANHelpAfterFieldEditDoesNotExit"]) {
    assert.match(swift, new RegExp('func\\s+' + name + '\\s*\\('));
    assert.ok(watcher.includes('"' + name + '"'), 'Missing login root frame evidence: ' + name);
  }
  assert.match(swift, /app\.launchArguments = \["-xdrive\.ios\.native\.launch-checkpoint\.v1", "ready"\]/);
  assert.match(swift, /native-ios-login-password/);
  assert.match(swift, /native-ios-lan-certificate-help/);
  assert.match(swift, /192\.0\.2\.4/);
  assert.doesNotMatch(swift, /-xdrive-ui-navigation-smoke".*launchRealSignedOutWorkspace/);
});

test('Launcher crash frame evidence follows actual child destination tap, not the tab-rail tap', () => {
  assert.ok(watcher.includes('current_case[0].startswith("testLauncher")'));
  assert.ok(watcher.includes('tapped.group(1).startswith("native-ios-launcher-")'));
  assert.ok(watcher.includes('minimal and count == 1 and not is_launcher'));
});

test('production startup recovery safe/retry and real remember-password controls are native crash-tested', () => {
  const recovery = fs.readFileSync(path.join(root, 'ios/XDriveIOS/XDriveIOSApp.swift'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  for (const name of [
    'testRealInterruptedStartupSafeEntryRemainsUsable',
    'testRealInterruptedStartupRetryRendersLoginWithoutExit',
    'testRealSignedOutRememberPasswordToggleForegroundDoesNotExit'
  ]) {
    assert.match(swift, new RegExp('func\\s+' + name + '\\s*\\('));
    assert.ok(watcher.includes('"' + name + '"'), 'No native frame capture for ' + name);
  }
  assert.match(swift, /launchRealInterruptedStartup\("mountingWorkspace"\)/);
  assert.match(swift, /launchRealInterruptedStartup\("restoringSession"\)/);
  assert.match(swift, /app\.launchArguments = \["-xdrive\.ios\.native\.launch-checkpoint\.v1", stage\]/);
  assert.match(swift, /tap\("native-ios-startup-safe-entry", app: app\)/);
  assert.match(swift, /tap\("native-ios-startup-retry", app: app\)/);
  assert.match(swift, /waitRetired\("native-ios-startup-retry", app: app\)/);
  assert.match(swift, /toggle\.tap\(\)/);
  assert.match(recovery, /\.accessibilityIdentifier\("native-ios-startup-recovery"\)/);
  assert.match(recovery, /\.accessibilityIdentifier\("native-ios-startup-safe-entry"\)/);
  assert.match(recovery, /\.accessibilityIdentifier\("native-ios-startup-retry"\)/);
  // The production Toggle intentionally uses a user-action Binding, not
  // direct @Published assignment: only explicit taps may change Keychain intent.
  // Require the real label, guarded get/set and AX identifier as one control.
  assert.match(login, /Toggle\("安全保存当前账号密码", isOn: Binding\(\s*get:\s*\{\s*model\.rememberPassword\s*\},\s*set:\s*\{\s*model\.setRememberPasswordFromUser\(\$0\)\s*\}\s*\)\)\s*\.accessibilityIdentifier\("native-ios-remember-password"\)/);
  assert.doesNotMatch(swift, /fakeOwner|fakeToken|mockServerLogin|XCTSkip/);
});


test('six additional native all-page crash journeys use real subpage taps and strict frame registration', () => {
  const names = [
    'testFilesHomeSavedSearchesForegroundGalleryReturnDoesNotExit',
    'testFilesHomeOperationHistoryRotationNotesReturnDoesNotExit',
    'testFilesHomeTwoSheetsRepeatAcrossGalleryFilesDoesNotExit',
    'testDeniedCloudThenSavedSearchesDoesNotExposePrivateGrid',
    'testRecentFeaturePickerRotationFilesGalleryReturnDoesNotExit',
    'testRealSignedOutPasswordShowHideRotationForegroundDoesNotExit'
  ];
  const allMethods = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(m => m[1]);
  assert.ok(allMethods.length >= 52, 'All-page child routes were silently removed');
  assert.equal(allMethods.length, new Set(allMethods).size,
    'Duplicate XCTest methods mask missing real navigation journeys');
  for (const name of names) {
    assert.ok(allMethods.includes(name), 'Missing real XCTest route: ' + name);
    assert.ok(watcher.includes('"' + name + '"'),
      'Missing tap-adjacent Simulator frame capture: ' + name);
  }
  const helper = swift.slice(swift.indexOf('private func openFilesHomeChild('),
                             swift.indexOf('func testFilesHomeSavedSearchesForegroundGalleryReturnDoesNotExit'));
  for (const id of ['native-ios-files-section-browse', 'native-ios-files-home-list']) {
    assert.ok(helper.includes(id), 'Browse must be the real mounted Files Home: ' + id);
  }
  assert.match(helper, /entry\.exists && entry\.isHittable/);
  assert.match(helper, /home\.swipeUp\(\)/);
  assert.match(helper, /home\.swipeDown\(\)/);
  assert.match(helper, /IOS_NATIVE_NAV_TAP_START route=/);
  assert.match(swift, /native-ios-files-saved-searches-done/);
  assert.match(swift, /native-ios-files-operation-history-done/);
  assert.match(swift, /XCTAssertFalse\(element\("native-ios-files-grid"/);
  assert.match(swift, /launchRealSignedOutWorkspace\(\)/);
  assert.doesNotMatch(swift, /mockServerLogin|fakeToken|forceLogin/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});


test('next five real Launcher/Notes/Backup/Originals/recovery crash journeys remain registered', () => {
  const names = [
    'testLauncherSearchFilterForegroundFilesReturnDoesNotExit',
    'testNotesBackupSourceRotationForegroundFilesReturnDoesNotExit',
    'testBackupDetailsQueueRotationForegroundFilesReturnDoesNotExit',
    'testOriginalsDeniedCloudNotesGalleryReturnDoesNotExit',
    'testCredentialRetirementRecoverySafeModeForegroundDoesNotExit'
  ];
  const methods = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(match => match[1]);
  assert.ok(methods.length >= 52, 'Missing independent all-pages crash journeys');
  assert.equal(methods.length, new Set(methods).size, 'Duplicate XCUITest name hides a case');
  for (const name of names) {
    assert.ok(methods.includes(name), 'Missing real native XCTest: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Unregistered Simulator capture: ' + name);
  }
  assert.match(swift, /search\.typeText\("zzzz-no-native-route"\)/);
  assert.match(swift, /picker\.buttons\["iOS 备份"\]/);
  assert.match(swift, /waitRetired\("native-ios-photo-task-list-done"/);
  assert.match(swift, /launchRealInterruptedStartup\("retiringCredential"\)/);
  assert.match(swift, /XCTAssertFalse\(element\("native-ios-files-grid"/);
  assert.doesNotMatch(swift, /fakeToken|fakeOwner|mockServerLogin|XCTSkip/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});


test('all 63 real all-page XCTest methods are registered and the five new cross-child sweeps fail closed', () => {
  const names = [
    'testFourDeniedFilesChildrenAfterBackgroundCrossTabsDoNotExit',
    'testSignedOutMinePhotosLinkAndDisabledCacheAcrossTabsDoNotExit',
    'testUnavailableLauncherToolsForegroundAndFilesReturnDoNotExit',
    'testRealSignedOutLoginFieldFocusBackgroundDoesNotExit',
    'testClipboardDeniedRecipientTransfersFilesNotesReturnDoesNotExit'
  ];
  const methods = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(match => match[1]);
  assert.ok(methods.length >= 63, 'At least 63 independent real all-page sweeps are required');
  assert.equal(methods.length, new Set(methods).size, 'Duplicate XCTest names hide a route');
  for (const method of methods) {
    assert.ok(watcher.includes('"' + method + '"'),
      'All-page XCTest absent from real Simulator frame watcher: ' + method);
  }
  for (const name of names) {
    assert.ok(methods.includes(name), 'New native child route missing: ' + name);
  }
  for (const id of [
    'native-ios-files-recent-error-page', 'native-ios-files-favorites-error-page',
    'native-ios-files-trash-error-page', 'native-ios-files-error-page',
    'native-ios-files-grid', 'native-ios-mine-server-account',
    'native-ios-login-username', 'native-ios-login-password',
    'ios-clipboard-status', 'native-ios-transfer-overview'
  ]) {
    assert.ok(swift.includes('"' + id + '"'),
      'Real child/Owner-denial assertion missing: ' + id);
  }
  assert.match(swift, /XCUIDevice\.shared\.press\(\.home\)/);
  assert.match(swift, /XCTAssertFalse\(element\("native-ios-files-grid"/);
  assert.doesNotMatch(swift, /fakeToken|mockServerLogin|XCTSkip/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});


test('six more independent Gallery, Files, Notes, Login and Backup crash sweeps remain in real Simulator watcher', () => {
  const names = [
    'testGalleryQueueAndCacheSheetsRepeatedAcrossFilesDoNotExit',
    'testFilesTagsSavedHistorySubpageRetirementDoesNotExit',
    'testNotesSourceTripleToggleClipboardFilesReturnDoesNotExit',
    'testRealSignedOutLANKeyboardRotationForegroundDoesNotExit',
    'testBackupAuditQueueNotesFilesCrossChildReturnDoesNotExit',
    'testUnimplementedLauncherPagesRotateForegroundFilesFailClosed',
  ];
  const methods = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(match => match[1]);
  assert.ok(methods.length >= 63, 'Native all-page crash matrix lost a subpage journey');
  assert.equal(methods.length, new Set(methods).size, 'Duplicate XCTest method hides an independent route');
  for (const name of names) {
    assert.ok(methods.includes(name), 'Actual XCTest method missing: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'No tap-adjacent frame capture for ' + name);
  }
  for (const id of [
    'native-ios-gallery-thumbnail-cache', 'native-ios-photo-task-list-done',
    'native-ios-files-tag-management', 'native-ios-files-saved-searches-page',
    'native-ios-files-operation-history-page', 'native-ios-notes-source-picker',
    'native-ios-lan-certificate-help', 'native-ios-backup-portrait-form'
  ]) assert.ok(swift.includes('"' + id + '"'), 'No actual child assertion: ' + id);
  assert.match(swift, /XCTAssertEqual\(app\.state, \.runningForeground/);
  assert.doesNotMatch(swift, /fakeToken|mockServerLogin|XCTSkip/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
});


test('69 all-page crash XCTest journeys include post-login diagnostic and cross-route recovery', () => {
  const names = [
    'testPostLoginCrashCopyAndDiagnosticForegroundDoesNotExit',
    'testPostLoginCrashFullRetrySignedOutReturnDoesNotExit',
    'testPostLoginCrashSafeEntryRotationDoesNotExit',
    'testMapFilesRecentDenialBackupQueueMapReturnDoesNotExit',
    'testNotesClipboardTransfersFilesForegroundCycleDoesNotExit',
    'testFilesManagementSheetsRotationAndGalleryReturnDoesNotExit'
  ];
  const methods = [...swift.matchAll(/\bfunc\s+(test\w+)\s*\(/g)].map(m => m[1]);
  assert.ok(methods.length >= 69, 'All 69 real native page paths must run');
  assert.equal(new Set(methods).size, methods.length, 'Duplicate XCTest path hides a crash');
  for (const name of names) {
    assert.ok(methods.includes(name), 'Missing native XCTest: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Unregistered live Simulator frames: ' + name);
  }
  const login = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8');
  const recovery = fs.readFileSync(path.join(root, 'ios/XDriveIOS/XDriveIOSApp.swift'), 'utf8');
  assert.match(swift, /-xdrive-ui-postlogin-recovery-fixture/);
  assert.match(swift, /native-ios-postlogin-crash-step/);
  assert.match(swift, /native-ios-startup-diagnostic-login/);
  assert.match(swift, /native-ios-files-recent-error-page/);
  assert.match(swift, /native-ios-map-source-selector/);
  assert.match(swift, /native-ios-notes-source-picker/);
  assert.match(recovery, /native-ios-startup-diagnostic-login/);
  assert.match(login, /diagnosticWorkspace && !showFullWorkspace/);
  assert.match(login, /\.onChange\(of: restoreFinished\)/);
  assert.doesNotMatch(login, /\.onDisappear \{ workspaceDisappeared\(\) \}/);
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllPagesCrashUITests/);
  assert.doesNotMatch(swift, /fakeToken|mockServerLogin|XCTSkip/);
});
