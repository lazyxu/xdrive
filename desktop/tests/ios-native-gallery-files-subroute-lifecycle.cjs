'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const collection = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeFilesCollections.swift'), 'utf8');
const album = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoAlbumBrowser.swift'), 'utf8');
const between = (source, start, end) => {
  const i = source.indexOf(start);
  assert.ok(i >= 0, 'missing start: ' + start);
  const j = source.indexOf(end, i + start.length);
  assert.ok(j > i, 'missing end: ' + end);
  return source.slice(i, j);
};

test('Files collection grid retains individual tile AX identities', () => {
  assert.match(collection, /listRowSeparator\(\.hidden\)\s*(?:\/\/[^\n]*\n\s*)?\.accessibilityElement\(children: \.contain\)\s*\.accessibilityIdentifier\("native-ios-files-collection-grid"\)/);
  assert.match(collection, /accessibilityIdentifier\("native-ios-files-collection-open-\\\(item\.id\)"\)/);
});
test('Opening Files Viewer arms a single return refresh before presentation', () => {
  assert.match(collection, /returnFile = item\.node\s*viewerRefreshPending = true\s*selectedFile = item/);
});
test('Files Viewer dismissal performs a single foreground read', () => {
  const s = between(collection, '.fullScreenCover(item: $selectedFile, onDismiss:', 'onNavigate: { next in');
  assert.match(s, /let shouldRefresh = viewerRefreshPending\s*viewerRefreshPending = false/);
  assert.match(s, /if shouldRefresh && isVisible && phase == \.active &&\s*!model\.loading && model\.matches\(login\.owner, kind: kind\)/);
  assert.doesNotMatch(s, /if !model\.loading \{ reload\(preserveVerifiedRows: true\) \}/);
});
test('SwiftUI onAppear while Viewer dismisses never races a second GET', () => {
  const s = between(collection, '.onAppear {\n                isVisible = true', '.onDisappear {');
  assert.match(s, /guard phase == \.active, !viewerRefreshPending else \{ return \}/);
});
test('Files collection does not cancel a pending Viewer return onDisappear', () => {
  const s = between(collection, '.onDisappear {\n                isVisible = false', '.onChange(of: phase)');
  assert.match(s, /if !viewerRefreshPending && selectedFile == nil &&/);
});
test('Foreground resume never refreshes behind the collection Viewer', () => {
  const s = between(collection, '.onChange(of: phase) { state in', '.onChange(of: kind)');
  assert.match(s, /selectedFile == nil && !viewerRefreshPending/);
});
test('Owner and collection kind changes revoke pending refresh hints', () => {
  assert.match(collection, /\.onChange\(of: kind\) \{ _ in\s*modeSwitchTicket = UUID\(\)\s*pendingModeSwitchAnchor = nil\s*lastVisibleItemID = nil\s*viewerRefreshPending = false/);
  assert.match(collection, /\.onChange\(of: login\.owner\) \{ _ in\s*modeSwitchTicket = UUID\(\)\s*pendingModeSwitchAnchor = nil\s*lastVisibleItemID = nil\s*viewerRefreshPending = false/);
});
test('PhotoKit revision keeps authorized album Viewer or Map mounted', () => {
  const s = between(album, '.onChange(of: libraryMonitor.revision) { _ in', '.onChange(of: phase) { state in');
  assert.match(s, /else if selected != nil \|\| showingAlbumMap \{/);
  assert.match(s, /viewerPageInvalidated = true\s*suspendForViewer\(\)\s*page = nil\s*total = nil/);
  assert.match(s, /else \{\s*invalidate\(\)/);
});
test('PhotoKit permission revocation remains fail-closed', () => {
  const s = between(album, '.onChange(of: libraryMonitor.revision) { _ in', '.onChange(of: phase) { state in');
  assert.match(s, /if permission != \.authorized && permission != \.limited \{/);
  assert.match(s, /showingAlbumMap = false\s*invalidate\(\)/);
});
test('Stale album Viewer cannot page or accept racing pages', () => {
  const s = between(album, 'onViewed: { next in', '.onAppear {\n            isContentVisible = true');
  for (const name of ['onViewed: { next in', 'onCrossPage: { oldPage, anchor, direction in', 'onCrossedPage: { next, verifiedPage in']) {
    const part = between(s, name, name === 'onViewed: { next in' ? 'onCrossPage:' : name === 'onCrossPage: { oldPage, anchor, direction in' ? 'onCrossedPage:' : '.environment(');
    assert.match(part, /guard !viewerPageInvalidated, phase == \.active/);
  }
  assert.match(s, /await adjacentReader\.reset\(\)\s*guard !viewerPageInvalidated, phase == \.active/);
});
test('PhotoKit changes suppress stale Viewer anchor restoration', () => {
  const s = between(album, 'private func restoreAfterViewer()', 'private func restoreViewerTile(');
  assert.match(s, /let wasInvalidated = viewerPageInvalidated\s*viewerPageInvalidated = false/);
  assert.match(s, /if wasInvalidated \{ clearViewerTileAnchor\(\) \}/);
  assert.match(s, /shouldRestoreViewerTile = !wasInvalidated/);
});
test('Album count updates cannot scroll the wall behind Viewer or Map', () => {
  const s = between(album, '.onChange(of: total) { count in', '.navigationTitle(album.name)');
  assert.match(s, /selected == nil, !showingAlbumMap else \{ return \}/);
  assert.match(s, /guard phase == \.active, selected == nil,\s*!showingAlbumMap else \{ return \}/);
});
