'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gallery = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoGallery.swift'), 'utf8');
const start = gallery.indexOf('struct XDriveIOSUnifiedPhotoTile: View {');
assert.ok(start >= 0, 'Native unified tile is required');
const tile = gallery.slice(start);
const wall = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoWall.swift'), 'utf8');
const between = (begin, end) => {
  const first = tile.indexOf(begin);
  assert.ok(first >= 0, 'Missing thumbnail lifecycle start: ' + begin);
  const last = tile.indexOf(end, first + begin.length);
  assert.ok(last > first, 'Missing thumbnail lifecycle end: ' + end);
  return tile.slice(first, last);
};

test('Viewer preserves the last authorized PhotoKit pixels before cancelling requests', () => {
  const hidden = between('if !displayActive {', 'if let asset = row.local {');
  assert.match(hidden, /retainedLocal\s*=\s*local\.image\s*\?\?\s*retainedLocal/);
  assert.match(hidden, /fallback\?\.cancel\(\)/);
  assert.match(hidden, /local\.cancel\(\)/);
  assert.ok(hidden.indexOf('retainedLocal =') < hidden.lastIndexOf('local.cancel()'));
});

test('Viewer overlay retains cloud thumbnail for the unchanged Node revision', () => {
  const hidden = between('if !displayActive {', 'if let asset = row.local {');
  assert.doesNotMatch(hidden, /remote\s*=\s*nil/);
  assert.match(tile, /else if let item = row\.cloud, remote == nil\s*\{\s*(?:\/\/[^\n]*\n\s*)*await loadCloud/);
});

test('Viewer return does not initiate another PhotoKit request for cached pixels', () => {
  assert.match(tile, /if local\.image == nil && retainedLocal == nil\s*\{\s*local\.load\(/);
  assert.match(tile, /let image = local\.image \?\? retainedLocal \?\? remote/);
});

test('cache key includes Owner, local modification and cloud Node revision', () => {
  const key = between('private var thumbnailKey: String {', 'var body: some View {');
  for (const part of ['presentingOwner.origin.absoluteString', 'presentingOwner.instanceID',
    'presentingOwner.ownerID', 'row.id', 'row.local?.id',
    'row.local?.modifiedAt', 'row.local?.capturedAt',
    'row.match?.node_id', 'row.cloud?.node.revision',
    'row.cloud?.metadata.thumbnail_version']) {
    assert.ok(key.includes(part), 'Missing thumbnail identity: ' + part);
  }
  assert.match(tile, /retainedKey != key \|\| !ownerValid/);
  assert.match(tile, /retainedKey = ownerValid \? key : nil/);
});

test('Owner change immediately revokes local and remote retained media', () => {
  const change = between('.onChange(of: login.owner) { _ in', '.onDisappear {');
  assert.match(change, /loadGeneration\s*=\s*UUID\(\)/);
  assert.match(change, /fallback\?\.cancel\(\)/);
  assert.match(change, /local\.cancel\(\)/);
  for (const field of ['retainedLocal', 'remote', 'retainedKey']) {
    assert.ok(change.includes(field + ' = nil'), 'Old Owner media not retired: ' + field);
  }
  assert.match(tile, /if displayActive,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, presentingOwner\),\s*retainedKey == thumbnailKey/);
});

test('stale asynchronous thumbnail completion cannot repopulate a hidden or replaced tile', () => {
  const callback = tile.slice(tile.indexOf('private func loadCloud('));
  assert.match(callback, /let expectedKey = thumbnailKey/);
  assert.match(callback, /let ticket = loadGeneration/);
  assert.match(callback, /!Task\.isCancelled, loadGeneration == ticket/);
  assert.match(callback, /displayActive, retainedKey == expectedKey/);
  assert.match(callback, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, owner\)/);
});

test('normal off-screen scrolling drops decoded pixels rather than caching unbounded tiles', () => {
  const disappearance = between('.onDisappear {', 'private func loadCloud(');
  assert.match(disappearance, /if retainWhileCovered, retainedKey == thumbnailKey/);
  assert.match(disappearance, /else\s*\{[\s\S]*local\.cancel\(\)[\s\S]*retainedLocal = nil[\s\S]*remote = nil[\s\S]*retainedKey = nil/);
});

test('hidden or replaced media never initiates a cloud fallback or displays foreign pixels', () => {
  const loading = between('.onChange(of: local.isLoading) { loading in', '.onChange(of: login.owner)');
  assert.match(loading, /displayActive, retainedKey == thumbnailKey, !loading/);
  assert.match(loading, /local\.image == nil, retainedLocal == nil/);
  assert.match(tile, /guard displayActive, retainedKey == expectedKey/);
});

test('People and thumbnail-cache subroutes retain tiles independently of Viewer activity', () => {
  assert.match(gallery, /retainWhileCovered: selected != nil \|\|[\s\S]*showingPeople \|\| showingThumbnailCache/);
  assert.match(wall, /XDriveIOSUnifiedPhotoTile\([\s\S]*?displayActive: displayActive,\s*retainWhileCovered: retainWhileCovered/);
  const disappearance = between('.onDisappear {', 'private func loadCloud(');
  assert.match(disappearance, /if retainWhileCovered, retainedKey == thumbnailKey/);
  assert.doesNotMatch(disappearance, /if !displayActive, retainedKey == thumbnailKey/);
});

test('explicit typed thumbnail identity and Viewer filmstrip compile-sensitive contract', () => {
  for (const name of ['ownerOrigin', 'ownerInstance', 'ownerIdentity', 'photoIdentity',
    'localIdentity', 'localModified', 'localCaptured', 'matchedNode', 'cloudRevision',
    'cloudThumbnail']) {
    assert.match(tile, new RegExp('let ' + name + ': String ='));
  }
  assert.match(tile, /let parts: \[String\] = \[/);
  assert.match(tile, /return parts\.joined\(separator: "\|"\)/);
  const viewer = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativeUnifiedPhotoViewer.swift'), 'utf8');
  assert.match(viewer, /ForEach\(Array\(page\.rows\.enumerated\(\)\), id: \\.element\.id\) \{ index, photo in\s*filmstripCell\(photo, at: index\)/);
  assert.match(viewer, /private func filmstripCell\(/);
  assert.match(viewer, /displayActive: authorized, retainWhileCovered: false/);
});
