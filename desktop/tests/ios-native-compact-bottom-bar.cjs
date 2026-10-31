'use strict'
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = fs.readFileSync(
  path.resolve(__dirname, '../../ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8'
);

test('five stable native bottom positions own the same feature-local TabView stacks', () => {
  const expected = [
    'navigationButton(.launcher, title: "全部"',
    'navigationButton(\n                .dynamic,',
    'navigationButton(.gallery, title: "图库"',
    'navigationButton(.files, title: "文件"',
    'navigationButton(.mine, title: "我的"'
  ];
  const at = expected.map(value => ui.indexOf(value));
  assert.ok(at.every((i, n) => i >= 0 && (n === 0 || i > at[n - 1])));
  assert.match(ui, /TabView\(selection: \$tab\)/);
  assert.match(ui, /\.toolbar\(\.hidden, for: \.tabBar\)/);
  assert.match(ui, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)\s*\{\s*if XDriveIOSNativeFocusVisibilityPolicy\.showsBar\(/);
  assert.match(ui, /nativeBottomBar\s*\}\s*\}\s*\.id\(ownerScopeKey\)/);
  assert.match(ui, /\.id\(ownerScopeKey\)/);
});

test('landscape is compact horizontal icon-and-label and target is at least 44pt', () => {
  assert.match(ui, /@Environment\(\\\.verticalSizeClass\) private var verticalSizeClass/);
  assert.match(ui, /verticalSizeClass == \.compact \? 48 : 56/);
  assert.match(ui, /if verticalSizeClass == \.compact \{[\s\S]*?HStack\(spacing: 5\)[\s\S]*?Image\(systemName: symbol\)[\s\S]*?Text\(title\)/);
  assert.match(ui, /\.frame\(maxWidth: \.infinity, minHeight: 44\)/);
  assert.match(ui, /\.accessibilityLabel\(title\)/);
});

test('dynamic long press opens recent features and has an accessible picker', () => {
  assert.match(ui, /\.contextMenu \{[\s\S]*?showRecentPicker = true[\s\S]*?ForEach\(recentDynamic\)/);
  assert.match(ui, /\.accessibilityAction\(named: Text\("最近功能"\)\)/);
  assert.match(ui, /dynamicFeature\?\.title \?\? "最近"/);
  assert.match(ui, /dynamicFeature\?\.symbol \?\? "clock\.arrow\.circlepath"/);
  assert.match(ui, /feature\.implemented \? feature\.title :/);
  assert.match(ui, /showRecentPicker = true/);
});

test('Gallery short landscape uses one safe-area row without remounting its active source', () => {
  assert.match(ui, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(ui, /GeometryReader \{ availableSpace in/);
  assert.match(ui, /availableSpace\.size\.width >= 680 &&[\s\S]*?availableSpace\.size\.height < 500 &&[\s\S]*?!dynamicTypeSize\.isAccessibilitySize/);
  assert.match(ui, /if !galleryFocused \{[\s\S]*?HStack\(spacing: 0\) \{\s*gallerySourceRow\s*galleryCompactBackupAction\s*\}/);
  assert.match(ui, /else \{\s*galleryStatusRow\s*gallerySourceRow/);
  assert.match(ui, /private var gallerySourceRow: some View \{[\s\S]*?ScrollView\(\.horizontal, showsIndicators: false\)/);
  assert.match(ui, /\.accessibilityValue\([\s\S]*?"自动备份已暂停，需核对收据"/);
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-gallery-backup-settings-compact"\)/);
  assert.equal((ui.match(/switch gallerySource/g) || []).length, 1);
});
