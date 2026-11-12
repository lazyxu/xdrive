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
