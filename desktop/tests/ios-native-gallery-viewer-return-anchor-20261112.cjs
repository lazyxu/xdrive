'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Static control-flow regression: does not assert measured Simulator FPS.
const gallery = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoGallery.swift'), 'utf8');
const viewer = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoViewer.swift'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoWall.swift'), 'utf8');
const from = (marker, length = 1000) => {
  const index = gallery.indexOf(marker);
  assert.ok(index >= 0, 'Missing native Gallery section: ' + marker);
  return gallery.slice(index, index + length);
};

test('opening Viewer stores the exact authorized page', () => {
  const section = from('open: { payload, position in', 425);
  assert.match(section, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/);
  assert.match(section, /viewerOpeningPage = payload\.number\s+selected = \.init/);
});
test('same-page Viewer stays mounted until its retained page re-verifies the target', () => {
  const section = from('.onChange(of: selected?.id) { selection in', 850);
  assert.match(section, /if viewerOpeningPage != viewerReturnPage \{/);
  assert.doesNotMatch(section, /scroll\.scrollTo\(anchor, anchor: \.center\)/);
  assert.match(section, /xdrivePhotoWallScrollVerifiedTile\(/);
  assert.match(section, /"unified-page-/);
});
test('cross-page filmstrip navigation materializes target page, then checks member IDs', () => {
  const section = from('.onChange(of: selected?.id) { selection in', 900);
  assert.match(section, /viewerOpeningPage != viewerReturnPage/);
  assert.match(section, /"unified-page-/);
  assert.match(section, /anchor: \.top/);
  const loaded = from('loaded: { verifiedIDs in', 950);
  assert.match(loaded, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/);
  assert.match(loaded, /target, scroll: scroll/);
  assert.match(loaded, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/);
});
test('background and hidden tab never start return scroll', () => {
  assert.match(from('.onChange(of: selected?.id) { selection in'),
    /guard selection == nil, phase == \.active, isTabActive,\s+let anchor = viewerReturnAnchor else \{ return \}/);
});
test('verified page load finishes exact-row restore and retires pending anchor', () => {
  const section = from('loaded: { verifiedIDs in', 1400);
  assert.match(section, /viewerReturnPage == page\.id/);
  assert.match(section, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/);
  assert.match(section, /xdrivePhotoWallScrollVerifiedTile\(target, scroll: scroll\)/);
  assert.match(section, /viewerReturnAnchor = nil\s+viewerOpeningPage = nil/);
  assert.match(page, /loaded\(model\.rows\.map\(\\\.id\)\)/);
  assert.match(page, /acceptedGeneration == ticket, model\.completed/);
});
test('Owner change and page reset invalidate both return identities', () => {
  assert.match(from('private func resetWall()', 210),
    /viewerReturnAnchor = nil\s+viewerOpeningPage = nil\s+wall\.reset\(\)/);
  assert.match(gallery, /\.onChange\(of: login\.owner\)[\s\S]*?reset\(\)/);
});
test('Viewer onViewed reports actual visible photo and page', () => {
  assert.match(gallery, /onViewed: \{ page, id in viewerReturnPage = page; viewerReturnAnchor = id \}/);
  assert.match(viewer, /\.onAppear \{ onViewed\(page\.number, row\.id\) \}/);
});


const nativeNavigation = fs.readFileSync(
  path.join(__dirname, '../../ios/UITests/XDriveIOSNavigationRuntimeUITests.swift'), 'utf8'
);
const frameWatcher = fs.readFileSync(
  path.join(__dirname, '../../ios/scripts/capture-navigation-smoke-frames.py'), 'utf8'
);
const sixJourneys = [
  'testSavedSearchesSheetOriginalsAndFilesReturnKeepsContent',
  'testOperationsHistoryGalleryPeopleAndFilesReturnKeepsContent',
  'testTrashDenialGalleryFilterCancelAndFilesReturnKeepsContent',
  'testFilesHomeEditGallerySourceRoundtripKeepsBrowse',
  'testFilesSearchKeyboardMineCacheReturnKeepsFiles',
  'testSavedSearchSheetRotationThenGalleryFilesReturnKeepsContent',
];
test('six real native cross-page journeys are both XCTest-executable and frame-watched', () => {
  for (const name of sixJourneys) {
    assert.ok(nativeNavigation.includes('func ' + name + '()'), 'Missing XCTest ' + name);
    assert.ok(frameWatcher.includes('"' + name + '"'), 'Missing video/PNG watcher ' + name);
  }
  assert.ok(nativeNavigation.includes('IOS_NATIVE_NAV_TAP_START route='));
  assert.match(nativeNavigation, /XCTAttachment\(screenshot: app\.screenshot\(\)\)/);
});
