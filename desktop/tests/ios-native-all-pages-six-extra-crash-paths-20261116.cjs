"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const crash = fs.readFileSync(path.join(root, "ios/UITests/XDriveIOSAllNativePagesCrashSweepUITests.swift"), "utf8");
const watcher = fs.readFileSync(path.join(root, "ios/scripts/capture-navigation-smoke-frames.py"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/ios-native-navigation-runtime.yml"), "utf8");
const app = fs.readFileSync(path.join(root, "ios/XDriveIOS/XDriveIOSApp.swift"), "utf8");
const backup = fs.readFileSync(path.join(root, "ios/XDriveIOS/NativePhotoBackupScreen.swift"), "utf8");
const transfers = fs.readFileSync(path.join(root, "ios/XDriveIOS/NativeTransfers.swift"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "ios/XDriveIOS/NativePhotosDashboard.swift"), "utf8");
const notes = fs.readFileSync(path.join(root, "ios/XDriveIOS/NativeNotesScreen.swift"), "utf8");
const cases = [
  "testInterruptedWorkspaceSafeEntryForegroundNoCrash",
  "testInterruptedSessionFullRetryRendersLoginNoCrash",
  "testTransfersFilesBackupRoundTripAndForegroundNoCrash",
  "testBackupDetailsChildFilesReturnNoCrash",
  "testGalleryFocusedBackupConsentDoesNotAutoUploadNoCrash",
  "testNotesSourcesThreeRoundsClipboardFilesNoCrash",
];
function method(name) {
  const start = crash.indexOf("func " + name + "() {");
  assert.ok(start >= 0, name + " must be an executable XCTest");
  const next = crash.indexOf("\n    func test", start + 6);
  const body = crash.slice(start, next >= 0 ? next : undefined);
  assert.match(body, /ready\(/);
  assert.match(body, /capture\(/);
  return body;
}
test("six independently named real navigation journeys are in mandatory Xcode matrix and frame watcher", () => {
  assert.equal(new Set(cases).size, 6);
  for (const name of cases) {
    method(name);
    assert.ok(watcher.includes('"' + name + '"'), name + " was not frame-registered");
  }
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllNativePagesCrashSweepUITests/);
  assert.match(workflow, /ios-native-all-pages-six-extra-crash-paths-20261116\.cjs/);
});
test("interrupted startup stages use the actual Foundation launch checkpoint and deny unverified workspace", () => {
  assert.match(app, /native-ios-startup-safe-entry/);
  assert.match(app, /native-ios-startup-retry/);
  assert.match(app, /native-ios-startup-phase/);
  assert.match(crash, /launchArguments = \["-xdrive\.ios\.native\.launch-checkpoint\.v1", phase\]/);
  for (const name of cases.slice(0, 2)) {
    const body = method(name);
    assert.match(body, /native-ios-login-server/);
    assert.match(body, /native-ios-five-slot-bar/);
  }
  assert.match(method(cases[0]), /native-ios-startup-safe-mode/);
  assert.match(method(cases[1]), /native-ios-startup-retry/);
});
test("transfer and backup children use real native actions without starting writers", () => {
  assert.match(transfers, /Button\("打开文件", action: openFiles\)/);
  assert.match(transfers, /Button\("打开相册备份", action: openBackup\)/);
  assert.match(backup, /Label\("备份详情"/);
  assert.match(dashboard, /Button\("集中备份（需确认）"\)/);
  assert.match(method(cases[2]), /native-ios-transfer-overview/);
  assert.match(method(cases[3]), /native-ios-backup-portrait-form/);
  assert.match(method(cases[4]), /XCTAssertFalse\(element\("native-ios-photos-focused-progress"/);
  assert.doesNotMatch(method(cases[4]), /native-ios-photos-focused-start|startBackup\(/);
});
test("Notes dual-source and Clipboard/Files return use production SwiftUI routes", () => {
  assert.match(notes, /Picker\("笔记来源"/);
  assert.match(method(cases[5]), /"iOS 备份", "我的备忘录"/);
  assert.match(method(cases[5]), /XCUIDevice\.shared\.orientation/);
  assert.match(method(cases[5]), /openLauncher\("clipboard"/);
  assert.match(method(cases[5]), /native-ios-files-section-browse/);
});
