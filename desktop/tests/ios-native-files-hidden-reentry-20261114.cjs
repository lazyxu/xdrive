'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativeFilesCollections.swift'), 'utf8');
function between(start, end) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, 'missing start: ' + start);
  const j = source.indexOf(end, i + start.length);
  assert.ok(j > i, 'missing end: ' + end);
  return source.slice(i, j);
}
test('01 locating child dismissal never refetches a hidden or retired Owner', () => {
  const s = between('.sheet(item: $locateIntent, onDismiss:', '}) { selected in');
  assert.match(s, /if isVisible && phase == \.active && login\.owner != nil &&\s*!model\.matches\(login\.owner, kind: kind\) \{ reload\(\) \}/);
});
test('02 Viewer dismissal revalidates one visible, current-Owner collection only', () => {
  const s = between('.fullScreenCover(item: $selectedFile, onDismiss:', '}) { initial in');
  assert.match(s, /let shouldRefresh = viewerRefreshPending\s*viewerRefreshPending = false/);
  assert.match(s, /if shouldRefresh && isVisible && phase == \.active &&\s*!model\.loading && model\.matches\(login\.owner, kind: kind\)/);
});
test('03 tab return cannot launch a collection read beneath Quick Info or Rename', () => {
  const s = between('.onAppear {\n                isVisible = true', '.onDisappear {');
  assert.match(s, /selectedFile == nil && locateIntent == nil &&\s*managementIntent == nil && quickInfoIntent == nil &&\s*quickRenameIntent == nil/);
});
test('04 foreground resume never refreshes behind a collection modal', () => {
  const s = between('.onChange(of: phase) { state in', '.onChange(of: kind) { _ in');
  assert.match(s, /locateIntent == nil && managementIntent == nil &&\s*quickInfoIntent == nil && quickRenameIntent == nil/);
  assert.match(s, /model\.matches\(login\.owner, kind: kind\)/);
});
test('05 a hidden Recent/Favorites kind switch invalidates stale rows without hidden GET', () => {
  const s = between('.onChange(of: kind) { _ in', '.onChange(of: login.owner) { _ in');
  assert.match(s, /model\.invalidate\(\)\s*favorites\.invalidate\(\)\s*recentClear\.invalidate\(\)/);
  assert.match(s, /if isVisible && phase == \.active && login\.owner != nil \{ reload\(\) \}/);
});
test('06 recent/favorite file Viewer tap checks active visibility and matching Owner/kind', () => {
  const s = between('private func openFile(_ item:', '/// The same verified collection items');
  assert.match(s, /guard isVisible, phase == \.active, model\.verified, !model\.loading,\s*model\.matches\(login\.owner, kind: kind\)/);
  assert.match(s, /filteredItems\.contains\(item\),\s*model\.items\.contains\(item\)/);
});
test('07 location navigation rejects stale Owner and any presented sheets', () => {
  const s = between('private func showLocation(for item:', 'private func openFile(_ item:');
  assert.match(s, /guard isVisible, phase == \.active, model\.verified, !model\.loading,\s*model\.matches\(login\.owner, kind: kind\)/);
  assert.match(s, /managementIntent == nil, quickInfoIntent == nil,\s*quickRenameIntent == nil/);
});
test('08 quick info panel cannot present old-Owner collection metadata', () => {
  const s = between('private func openQuickInfo(for item:', 'private func openManagement(');
  assert.match(s, /guard isVisible, phase == \.active, model\.verified, !model\.loading,\s*model\.matches\(login\.owner, kind: kind\)/);
  assert.match(s, /filteredItems\.contains\(item\), model\.items\.contains\(item\)/);
});
test('09 management actions cannot race a quick rename or quick info route', () => {
  const s = between('private func openManagement(', '/// Recent and Favorite server projections');
  assert.match(s, /guard isVisible, phase == \.active, model\.verified, !model\.loading,\s*model\.matches\(login\.owner, kind: kind\)/);
  assert.match(s, /managementIntent == nil, quickInfoIntent == nil,\s*quickRenameIntent == nil/);
});
test('10 pending layout restores still verify current Owner, view and ticket', () => {
  const s = between('.onChange(of: viewMode) { next in', '.confirmationDialog(');
  assert.match(s, /ticketCurrent: ticket == modeSwitchTicket/);
  assert.match(s, /ownerValid: XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/);
  assert.match(s, /screenVisible: isVisible/);
  assert.match(s, /active: phase == \.active && isVisible/);
});
