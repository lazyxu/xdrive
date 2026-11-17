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

test("five more actual Map, Files, Backup, Originals and Clipboard crash journeys stay fail closed", () => {
  const extra = [
    "testMapRecentDeniedBackupQueueMapForegroundDoesNotExit",
    "testFilesTagSheetRotationMapReturnDoesNotExit",
    "testOriginalsDeniedCloudNotesGalleryReturnDoesNotExit",
    "testBackupAuditQueueDeniedFilesReturnDoesNotExit",
    "testClipboardDeniedReceiverNotesFilesForegroundDoesNotExit",
  ];
  assert.equal(new Set(extra).size, 5);
  const allNames = [...crash.matchAll(/\bfunc\s+(test\w+)\(\)/g)].map(x => x[1]);
  assert.ok(allNames.length >= 35);
  assert.equal(new Set(allNames).size, allNames.length);
  for (const name of extra) {
    const body = method(name);
    assert.ok(watcher.includes('"' + name + '"'), "no real Simulator frame capture: " + name);
    assert.match(body, /app\.state|ready\(/);
    assert.doesNotMatch(body, /XCTSkip|mockServerLogin|fakeToken|startBackup\(/);
  }
  assert.match(method(extra[0]), /native-ios-map-source-selector/);
  assert.match(method(extra[1]), /native-ios-files-tag-management/);
  assert.match(method(extra[1]), /orientation = \.landscapeLeft/);
  assert.match(method(extra[2]), /native-ios-cloud-original-layout-help/);
  assert.match(method(extra[3]), /native-ios-photo-task-list-done/);
  assert.match(method(extra[4]), /设备定向接收已启用/);
  for (const name of [extra[0], extra[2], extra[3], extra[4]]) {
    assert.match(method(name), /native-ios-files-grid/);
  }
});

test("five additional real signed-out, Launcher, Files and Gallery child journeys remain fail closed", () => {
  const names = [
    "testSignedOutLoginThreeFieldsKeyboardForegroundNoCrash",
    "testUnavailableLauncherFourToolsRotationForegroundFilesNoCrash",
    "testFilesRootDeniedThreeCyclesForegroundGalleryNoCrash",
    "testGalleryBackupQueueCacheTwoRoundsFilesNoCrash",
    "testFilesManagementThreeSheetsRotationGalleryNoCrash",
  ];
  const all = [...crash.matchAll(/\bfunc\s+(test\w+)\(\)/g)].map(m => m[1]);
  assert.ok(all.length >= 40);
  assert.equal(new Set(all).size, all.length);
  for (const name of names) {
    const body = method(name);
    assert.ok(watcher.includes('"' + name + '"'), name + " missing real Simulator watcher");
    assert.match(body, /ready\(/);
    assert.match(body, /capture\(/);
    assert.doesNotMatch(body, /XCTSkip|mockServerLogin|fakeToken|startBackup\(/);
  }
  assert.match(method(names[0]), /native-ios-login-password/);
  assert.match(method(names[0]), /XCUIDevice\.shared\.press\(\.home\)/);
  assert.match(method(names[1]), /"sync", "同步尚未接通"/);
  assert.match(method(names[1]), /orientation = \.landscapeLeft/);
  assert.match(method(names[2]), /cycle in 0\.\.<3/);
  assert.match(method(names[2]), /native-ios-files-error-page/);
  assert.match(method(names[3]), /native-ios-gallery-thumbnail-cache/);
  assert.match(method(names[3]), /native-ios-photo-task-list-done/);
  assert.match(method(names[4]), /native-ios-files-tag-management/);
  assert.match(method(names[4]), /native-ios-files-operation-history-page/);
  for (const name of names.slice(1)) {
    assert.match(method(name), /native-ios-files-grid/);
  }
});


test("five real iOS process cold-relaunch crash paths are XCTest and frame-watcher registered", () => {
  const cold = [
    "testFilesDirectSyntheticOwnerColdRelaunchThreeTimesKeepsShellAlive",
    "testFilesDeniedRootColdRelaunchDoesNotResurrectPrivateGrid",
    "testFilesManagementSheetsAfterColdRelaunchDoNotRestoreStalePresentation",
    "testLauncherPhotoPagesFilesColdRelaunchSurviveNoCrash",
    "testLauncherToolPagesFilesColdRelaunchSurviveNoCrash",
  ];
  assert.equal(new Set(cold).size, 5);
  const all = [...crash.matchAll(/\bfunc\s+(test\w+)\(\)/g)].map(x => x[1]);
  assert.ok(all.length >= 45, "cold restart paths must extend the 40-page matrix");
  assert.equal(new Set(all).size, all.length);
  for (const name of cold) {
    const body = method(name);
    assert.ok(watcher.includes('"' + name + '"'), name + " missing live frame watcher registration");
    assert.match(body, /app\.terminate\(\)/);
    assert.match(body, /app\.launch\(\)/);
    assert.match(body, /native-ios-files-section-browse/);
    assert.doesNotMatch(body, /XCTSkip|mockServerLogin|fakeToken|startBackup\(/);
  }
  for (const name of cold.slice(0, 3)) {
    assert.match(method(name), /native-ios-files-grid/);
  }
  assert.match(method(cold[0]), /-xdrive-ui-files-direct/);
  assert.match(method(cold[1]), /native-ios-files-error-page/);
  assert.match(method(cold[2]), /native-ios-files-saved-searches-page/);
  assert.match(method(cold[2]), /native-ios-files-operation-history-page/);
  assert.match(method(cold[3]), /"local", "native-ios-local-timeline-open"/);
  assert.match(method(cold[4]), /"transfers", "native-ios-transfer-overview"/);
});

test("Six observed P0 native crash-navigation regressions run independently in real Simulator", () => {
  // Five of these genuine XCTest cases failed on the 2026-11-17
  // candidate-navigation shard. A separate short shard catches recurrence
  // without dropping the full AllNativePagesCrashSweep suite.
  const selected = [
    "testFilesHomeEditThenSavedHistorySheetsRetireDoesNotExit",
    "testGalleryBackupQueueCacheTwoRoundsFilesNoCrash",
    "testGalleryBackupSettingsQueueAndFilesReturnDoNotExit",
    "testGalleryFocusedBackupConsentDoesNotAutoUploadNoCrash",
    "testGalleryThumbnailCacheSheetForegroundDismissDoesNotExit",
    "testLauncherSearchKeyboardForegroundFilesReturnDoesNotExit",
  ];
  assert.equal(new Set(selected).size, 6);
  for (const name of selected) {
    assert.match(crash, new RegExp("func " + name + "\\(\\)"),
      "missing real native P0 crash-navigation XCTest " + name);
  }
  const fastStart = workflow.indexOf("            candidate-navigation-p0)");
  const fastEnd = workflow.indexOf("            candidate-gallery-files)", fastStart);
  assert.ok(fastStart >= 0 && fastEnd > fastStart,
    "missing dedicated required real Simulator P0 shard");
  const fastCase = workflow.slice(fastStart, fastEnd);
  assert.equal((fastCase.match(/-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllNativePagesCrashSweepUITests\/test/g) || []).length, 6);
  for (const name of selected) {
    assert.ok(fastCase.includes("-only-testing:xDriveIOSNavigationUITests/XDriveIOSAllNativePagesCrashSweepUITests/" + name),
      "P0 shard must actually execute observed XCTest " + name);
  }
  const fullStart = workflow.indexOf("            candidate-navigation)");
  const fullEnd = workflow.indexOf("            candidate-navigation-p0)", fullStart);
  assert.ok(fullStart >= 0 && fullEnd > fullStart);
  assert.match(workflow.slice(fullStart, fullEnd),
    /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllNativePagesCrashSweepUITests/,
    "complete all-pages native suite must still run");
  assert.match(workflow,
    /continue-on-error: \$\{\{ matrix\.source == 'release-c83' \}\}/,
    "P0 shard must be mandatory, not continue-on-error");
  assert.doesNotMatch(fastCase, /-skip-testing:|continue-on-error|\|\| true/,
    "never mask real native P0 failures");
});


test("iOS 26.5 Files fatal-crash repro is a mandatory, exact-source native Simulator matrix member", () => {
  // The real iOS 26.6 stack-guard SIGSEGV was only exercised on an older
  // iOS 18.5 Simulator before this. 26.5 is the nearest hosted runtime,
  // not signed iOS 26.6 physical-device acceptance.
  assert.match(workflow, /source:\s*\[[^\]\n]*candidate-ios26-files\]/);
  assert.match(workflow, /matrix\.source == 'candidate-ios26-files' && 'macos-26'/);
  assert.match(workflow, /Xcode_26\.6\.app\/Contents\/Developer/);
  assert.match(workflow, /requested="iOS-26-5" if newer else "iOS-18-5"/);
  assert.match(workflow, /signed_ios26_6_verified=false/);
  const start = workflow.indexOf("            candidate-ios26-files)");
  const end = workflow.indexOf('            *) echo "Unsupported UI suite"', start);
  assert.ok(start > 0 && end > start, "iOS 26 Files XCTest case must be in native switch");
  const block = workflow.slice(start, end);
  const selected = [
    "testFilesDeepLifecycleViewStackSurvivesOwnerAndForegroundTransitions",
    "testFilesFirstOpenAndSixGalleryReturnsDoNotExit",
    "testFilesRecentBrowseFavoritesRepeatedWithoutCrash",
    "testFilesHomeEditThenSavedHistorySheetsRetireDoesNotExit",
    "testFilesDirectSyntheticOwnerColdRelaunchThreeTimesKeepsShellAlive",
    "testFilesDeniedRootColdRelaunchDoesNotResurrectPrivateGrid",
    "testInterruptedStartupDisplaysPriorSystemCrashMetadataWithoutOwner",
    "testFilesSearchKeyboardGalleryPeopleReturnHasNoGhostOverlay",
  ];
  assert.equal((block.match(/-only-testing:xDriveIOSNavigationUITests\//g)||[]).length,
    selected.length, "all eight targeted real iOS 26 XCTest journeys stay mandatory");
  for (const name of selected) {
    assert.ok(block.includes("/"+name+'"'), "iOS 26 native crash route missing: " + name);
  }
  assert.match(workflow, /continue-on-error: \${{ matrix\.source == 'release-c83' }}/);
  assert.match(workflow, /matrix\.source != 'release-c83'/);
  assert.doesNotMatch(block, /-skip-testing:|continue-on-error|\|\| true/);
});
