'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const map = read('ios/XDriveIOS/NativeOwnerMapClusterAlbum.swift');
const transport = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift');
const policy = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift');

test('Native Owner map date navigation uses the existing authenticated 48-item place Reader', () => {
  assert.match(transport, /let timeline_group_sets: XDriveIOSNativeMediaDateGroupSets\?/);
  assert.match(transport, /placeID != nil && offset == 0 \? 8 \* 1_048_576/);
  assert.match(map, /XDriveIOSNativeOwnerPlaceDateIndexPolicy\.nearestDay/);
  assert.match(map, /load\(XDriveIOSOwnerClusterCursor\([\s\S]*?dateJump: selected\)/);
  assert.match(map, /let root = try await reader\.page\([\s\S]*?offset: 0, placeID: facet\.id/);
  assert.match(map, /fresh\.day\.contains\(where: \{/);
  assert.match(map, /\$0\.key == dateJump\.key &&[\s\S]*?\$0\.start_index == dateJump\.startIndex/);
  assert.match(map, /let fetched = try await reader\.page\([\s\S]*?offset: target\.offset, placeID: facet\.id/);
});

test('full date indices are validated once per first Range, not on each SwiftUI render', () => {
  const section = map.slice(map.indexOf('private var canJumpInCurrentPlace'), map.indexOf('private var selectedPhotoCount'));
  assert.doesNotMatch(section, /\.accepts\(/);
  assert.match(map, /if fetched\.offset == 0 \{[\s\S]*?\.accepts\(/);
  assert.match(policy, /group\.start_index == counted, group\.item_count > 0/);
  assert.match(policy, /group\.item_count <= total - counted/);
  assert.match(policy, /hasUnknown \|\| \(position != 0 && position != groups\.count - 1\)/);
  assert.match(policy, /while low < high/);
  assert.match(policy, /offset: \(chosen\.start_index \/ pageSize\) \* pageSize/);
});

test('Owner switches and revocation fail closed, without reusing stale date or thumbnail identity', () => {
  assert.match(map, /if activeOwner \{[\s\S]*?XDriveIOSNativePhotoWallGrid/);
  assert.match(map, /if target\.placeIndex != departingCursor\.placeIndex \{[\s\S]*?verifiedDateIndex = nil/);
  const invalidate = map.slice(map.indexOf('private func invalidate()'), map.indexOf('private func load('));
  assert.match(invalidate, /verifiedDateIndex = nil/);
  assert.match(invalidate, /dateJumpVisible = false/);
  assert.match(map, /if dateJump != nil \{[\s\S]*?verifiedDateIndex = nil/);
  assert.match(map, /XDriveIOSNativePhotoOwnerScope\.matches\([\s\S]*?auth\.owner, selection\.owner/);
  assert.match(map, /reader\.thumbnail\(item\)/);
});

test('legacy no-index fallback is admitted only for a complete <=48 authorized range', () => {
  assert.match(policy, /page\.offset == 0, page\.total_count > 0, page\.total_count <= 48/);
  assert.match(policy, /page\.items\.count == page\.total_count/);
  assert.match(policy, /guard validKey\(day, scale: \.day\) else \{ return nil \}/);
  assert.match(policy, /return accepts\(sets, total: page\.total_count\) \? sets : nil/);
});

test('date jump uses native accessible controls rather than new web authorizations', () => {
  assert.match(map, /DatePicker\("选择地点照片日期"/);
  assert.match(map, /native-ios-owner-place-full-date-jump/);
  assert.match(map, /native-ios-owner-place-date-picker/);
  assert.match(map, /native-ios-owner-place-date-confirm/);
  assert.match(map, /datePickerStyle\(\.graphical\)/);
  assert.doesNotMatch(map, /URLSession\.shared/);
});
