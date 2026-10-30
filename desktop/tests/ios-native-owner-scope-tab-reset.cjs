'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativePhotosDashboard.swift'),
  'utf8'
);

test('all Owner, Server instance and root changes reset parent navigation state', () => {
  // Rebuilding only a TabView using .id does not reset @State of its parent.
  assert.match(source, /\.id\(ownerScopeKey\)/);
  assert.match(source, /owner\.origin\.absoluteString/);
  assert.match(source, /owner\.instanceID/);
  assert.match(source, /owner\.ownerID/);
  assert.match(source, /owner\.rootNodeID/);
  assert.match(source, /\.onChange\(of: ownerScopeKey\)\s*\{\s*_ in[\s\S]*?resetNavigation\(\)\s*\}/);
  const reset = source.match(/private func resetNavigation\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(reset, 'missing parent navigation reset');
  for (const field of ['gallerySource = .local', 'dynamicFeature = nil',
    'recentDynamic = []', 'tab = .gallery', 'launcherQuery = ""',
    'showRecentPicker = false']) {
    assert.ok(reset[1].includes(field), 'reset missing ' + field);
  }
});

test('signed-out dismissal remains separate from route reset', () => {
  assert.match(source, /\.onChange\(of: login\.owner\)\s*\{ owner in\s*if owner == nil\s*\{[\s\S]*?dismiss\(\)/);
  assert.match(source, /XDriveIOSNativePhotoBackupScreen\(login: login, controller: backup\)/);
  assert.doesNotMatch(source, /WKWebView|document\.cookie/);
});
