'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const shell = source('ios/XDriveIOS/NativePhotosDashboard.swift');
const wall = source('ios/XDriveIOS/NativeServerMediaGallery.swift');
const policy = source('ios/XDriveIOS/NativeFocusVisibilityPolicy.swift');

test('only one native L1 bar: scoped Gallery L2 hides the custom bar, not a system tab strip', () => {
  assert.match(shell, /\.toolbar\(\.hidden, for: \.tabBar\)/);
  assert.match(shell, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)/);
  assert.match(shell, /if XDriveIOSNativeFocusVisibilityPolicy\.showsBar\(/);
  assert.match(shell, /gallerySource: gallerySource\.rawValue/);
  assert.match(shell, /focused: galleryFocused/);
  assert.match(shell, /ownerVerified: login\.owner != nil/);
  assert.match(policy, /tab == "gallery"/);
  assert.match(policy, /gallerySource == "cloud"/);
  assert.match(policy, /ownerVerified/);
  assert.doesNotMatch(wall, /\.toolbar\(focusedBrowsing \? \.hidden : \.visible, for: \.tabBar\)/);
});

test('cloud and album Viewer return uses source-local L2 and explicit restore action', () => {
  assert.match(shell, /XDriveIOSNativeServerMediaWall\([\s\S]*?onFocusChange: \{ galleryFocused = \$0 \}/);
  assert.match(wall, /focusedBrowsing\.toggle\(\)\s*onFocusChange\?\(focusedBrowsing\)/);
  assert.match(wall, /focusedBrowsing \? "显示底部导航" : "专注浏览"/);
  assert.match(wall, /onFocusChange: onFocusChange/);
  assert.match(wall, /if selected != nil \{\s*model\.suspendForViewer\(\)/);
  assert.match(wall, /focusedBrowsing = false\s*onFocusChange\?\(false\)\s*accessibilityFocusedMediaID = nil\s*model\.suspendForNavigation\(\)/);
  assert.match(shell, /private func resetNavigation\(\) \{\s*galleryFocused = false/);
  assert.match(shell, /\.onChange\(of: gallerySource\) \{ _ in galleryFocused = false \}/);
  assert.match(shell, /\.onChange\(of: tab\) \{ next in\s*if next != \.gallery \{ galleryFocused = false \}/);
});

test('rotation changes only presentation, not source identity, L2, or L3 Viewer', () => {
  assert.match(shell, /verticalSizeClass == \.compact \? 48 : 56/);
  assert.match(wall, /\.fullScreenCover\(item: \$selected\)/);
  assert.doesNotMatch(shell, /\.onChange\(of: verticalSizeClass\)/);
  assert.match(shell, /case local, albums, cloud, originals, map/);
  assert.match(shell, /case \.originals:\s*openGallery\(\.originals\)/);
  assert.match(shell, /gallerySource = \.originals\s*tab = \.gallery/);
});
