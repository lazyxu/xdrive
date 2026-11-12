'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const browser = source('ios/XDriveIOS/NativeCloudFilesBrowser.swift');
const policy = source('ios/XDriveIOS/NativeFilesNavigationPolicy.swift');
const swiftChecks = source('ios/tests/NativeFilesNavigationChecks.swift');
const ui = source('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift');
const watcher = source('ios/scripts/capture-navigation-smoke-frames.py');

const ownerChangeStart = browser.indexOf('.onChange(of: login.owner) { _ in');
const ownerChangeEnd = browser.indexOf('private func filesNavigationLifecycle(', ownerChangeStart);
assert.ok(ownerChangeStart >= 0 && ownerChangeEnd > ownerChangeStart,
  'Cannot locate the actual Files Owner lifecycle');
const ownerChange = browser.slice(ownerChangeStart, ownerChangeEnd);

test('hidden-tab and inactive-scene Owner requests have a pure Swift gate', () => {
  assert.match(policy, /static func shouldStartOwnerRead\(visible: Bool, active: Bool,\s+hasOwner: Bool\) -> Bool/);
  assert.match(policy, /visible && active && hasOwner/);
  for (const caseName of [
    'visible active Files with Owner can load',
    'hidden Files must not start new Owner reads',
    'inactive scene must not start Owner reads',
    'signed-out Files must not start Owner reads',
  ]) {
    assert.ok(swiftChecks.includes(caseName), 'Missing executable policy case: ' + caseName);
  }
});

test('Owner switch cannot issue home/search requests or restore hidden stack', () => {
  assert.match(ownerChange, /let allowOwnerRead = XDriveIOSNativeFilesNavigationPolicy\.shouldStartOwnerRead/);
  assert.match(ownerChange, /visible: filesViewVisible,\s*active: phase == \.active,\s*hasOwner: login\.owner != nil/);
  assert.match(ownerChange, /if allowOwnerRead \{ searchOptions\.load\(login: login\) \}/);
  assert.match(ownerChange, /if isHome && allowOwnerRead \{ restoreFilesSectionIfNeeded\(\) \}/);
  assert.match(ownerChange, /homeReadAttempted = false\s+if isHome && allowOwnerRead \{\s+homeReadAttempted = true\s+reload\(\)/);
  assert.doesNotMatch(ownerChange, /if login\.owner != nil \{ searchOptions\.load\(login: login\) \}/);
  assert.doesNotMatch(ownerChange, /if isHome && phase == \.active \{\s+homeReadAttempted = true/);
});

test('return-to-active path restores previously blocked saved-folder reads', () => {
  const active = browser.slice(browser.indexOf('.onChange(of: phase) { next in'));
  assert.match(active, /if next == \.active, filesViewVisible, isHome \{\s+restoreFilesSectionIfNeeded\(\)/);
  assert.match(browser, /private func restoreFilesSectionIfNeeded\(\) \{[\s\S]*?guard isHome, let owner = login\.owner, !resumeLoaded/);
});

test('Organizer and Tag sheet dismissals never refetch for stale Owner or hidden tab', () => {
  for (const id of ['showingOrganizeHome', 'showingTagManager']) {
    const marker = '.sheet(isPresented: $' + id + ', onDismiss: {';
    const start = browser.indexOf(marker);
    assert.ok(start >= 0, 'Missing sheet: ' + id);
    const block = browser.slice(start, start + 850);
    assert.match(block, /let sameOwner =/);
    assert.match(block, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, \$0\)/);
    assert.match(block, /XDriveIOSNativeFilesNavigationPolicy\.shouldStartOwnerRead/);
  }
});

const routes = [
  'testOrganizeNestedSavedSearchesGalleryOriginalsFilesReturn',
  'testOrganizeNestedTagsGalleryPeopleFilesReturn',
  'testOrganizeHomeRotationGalleryFilesRoundtrip',
  'testOrganizeHomeReopenAfterNestedChildrenHasNoGhostSheet',
  'testOrganizeHomeDeniedCloudRecoveryThenGalleryFilter',
  'testOrganizeHomeThenFilesQuickRailAndGalleryAlternation',
  'testOrganizeHomeSignoutRelaunchNeverRestoresPrivilegedSheet',
];
test('all seven real XCUITest journeys are compiled and frame-watched by exact name', () => {
  assert.equal(new Set(routes).size, 7);
  for (const name of routes) {
    assert.ok(ui.includes('func ' + name + '()'), 'Missing actual XCTest method: ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'Missing real frame observer registration: ' + name);
  }
  assert.match(ui, /IOS_NATIVE_NAV_TAP_START route=/);
  assert.match(ui, /XCTAttachment\(screenshot: app\.screenshot\(\)\)/);
  assert.match(ui, /assertNonuniformFrame\(app, name\)/);
});

test('Organizer nested child targets use real native screen and owner-fenced UI', () => {
  for (const id of [
    'native-ios-files-organize-home-sheet',
    'native-ios-files-organize-saved-searches',
    'native-ios-files-organize-tags',
  ]) assert.ok(browser.includes('"' + id + '"'), 'Missing production AX route: ' + id);
  assert.ok(ui.includes('native-ios-files-saved-searches-page'));
  assert.ok(ui.includes('native-ios-files-tag-management'));
  assert.ok(ui.includes('native-ios-files-error-page'));
  assert.ok(ui.includes('native-ios-files-organize-home-sheet'));
});
