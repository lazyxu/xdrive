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
