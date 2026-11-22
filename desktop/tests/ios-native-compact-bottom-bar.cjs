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
  // A dedicated VStack row must reserve physical space for the global bar.
  // A TabView.safeAreaInset previously let Files' own quick rail overlap it.
  assert.match(ui, /return VStack\(spacing: 0\) \{/);
  assert.match(ui, /TabView\(selection: \$tab\)/);
  assert.match(ui, /\.toolbar\(\.hidden, for: \.tabBar\)\s*\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/);
  assert.match(ui, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)\s*if XDriveIOSNativeFocusVisibilityPolicy\.showsBar\(/);
  assert.doesNotMatch(ui, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)/);
  assert.match(ui, /nativeBottomBar\s*\}\s*\}\s*\.id\(ownerScopeKey\)/);
  assert.match(ui, /\.id\(ownerScopeKey\)/);
});

test('Launcher search stays above the changing scroll results and keeps keyboard focus', () => {
  const start = ui.indexOf('private var launcher: some View {');
  const end = ui.indexOf('private var dynamicPage', start);
  assert.ok(start >= 0 && end > start);
  const launcher = ui.slice(start, end);
  const editor = launcher.indexOf('TextField("搜索功能", text: $launcherQuery)');
  const scroll = launcher.indexOf('ScrollView {');
  assert.ok(editor >= 0 && scroll > editor, 'Search editor must precede results ScrollView');
  assert.match(launcher, /VStack\(alignment: \.leading, spacing: 0\)/);
  assert.match(launcher, /\.autocorrectionDisabled\(\)/);
  assert.match(launcher, /\.scrollDismissesKeyboard\(\.never\)/);
  assert.match(launcher, /\.accessibilityIdentifier\("native-ios-launcher-scroll"\)/);
});

test('Files navigation geometry covers two real independent no-overlay journeys', () => {
  const nav = fs.readFileSync(
    path.resolve(__dirname, '../../ios/UITests/XDriveIOSNavigationRuntimeUITests.swift'), 'utf8'
  );
  const watcher = fs.readFileSync(
    path.resolve(__dirname, '../../ios/scripts/capture-navigation-smoke-frames.py'), 'utf8'
  );
  for (const name of [
    'testFilesQuickRailNoOverlappingGlobalBarThroughSixNativeTransitions',
    'testFilesRailNoOverlapAfterBackgroundAndGalleryReentry'
  ]) {
    assert.ok(nav.includes('func ' + name + '()'), 'missing real XCTest ' + name);
    assert.ok(watcher.includes('"' + name + '"'), 'missing live frame target ' + name);
  }
  assert.match(nav, /rail\.frame\.maxY, globalBar\.frame\.minY \+ 1/);
  assert.match(nav, /app\.wait\(for: \.runningBackground, timeout: 12\)/);
  assert.match(nav, /app\.wait\(for: \.runningForeground, timeout: 18\)/);
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
  assert.match(ui, /dynamicFeature\?\.title \?\? \(emptyDynamicMapFallback \? "地图" : "最近"\)/);
  assert.match(ui, /title: dynamicSlotTitle/);
  assert.match(ui, /dynamicFeature\?\.symbol \?\? \(emptyDynamicMapFallback \? "map" : "clock\.arrow\.circlepath"\)/);
  assert.match(ui, /symbol: dynamicSlotSymbol/);
  assert.match(ui, /feature\.implemented \? feature\.title :/);
  assert.match(ui, /showRecentPicker = true/);
});

test('Gallery short landscape uses one safe-area row without remounting its active source', () => {
  assert.match(ui, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(ui, /GeometryReader \{ availableSpace in/);
  assert.match(ui, /availableSpace\.size\.width >= 680 &&[\s\S]*?availableSpace\.size\.height < 500 &&[\s\S]*?!dynamicTypeSize\.isAccessibilitySize/);
  const gallery = ui.slice(ui.indexOf('private var gallery: some View {'));
  // The compact backup action stays in the same visible short row; the
  // normal status/backup row appears only in the alternative height branch.
  // The media wall is OUTSIDE both branches, preserving Gallery/Viewer state.
  assert.match(gallery, /if !galleryFocused \{[\s\S]*?if availableSpace\.size\.width >= 680 &&[\s\S]*?availableSpace\.size\.height < 500 &&[\s\S]*?!dynamicTypeSize\.isAccessibilitySize \{[\s\S]*?HStack\(spacing: 0\) \{\s*gallerySourceRow\s*if gallerySource == \.local \|\| gallerySource == \.albums \{\s*gallerySearchAction\s*\}\s*galleryCompactBackupAction\s*\}\s*\.frame\(minHeight: 48\)/);
  assert.match(ui, /NavigationStack \{\s*gallery\s*\.navigationTitle\("图库"\)/);
  assert.match(ui, /private var galleryCompactBackupAction: some View \{[\s\S]*?\.accessibilityIdentifier\("native-ios-gallery-backup-settings-compact"\)/);
  assert.match(ui, /\}\s*else \{\s*galleryStatusRow\s*gallerySourceRow/);
  assert.match(ui, /private var gallerySourceRow: some View \{[\s\S]*?ScrollView\(\.horizontal, showsIndicators: false\)/);
  assert.match(ui, /\.accessibilityValue\([\s\S]*?"自动备份已暂停，需核对收据"/);
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/);
  assert.equal((ui.match(/\.accessibilityIdentifier\("native-ios-gallery-backup-settings-compact"\)/g) || []).length, 1);
  assert.equal((ui.match(/\.accessibilityIdentifier\("native-ios-gallery-backup-settings"\)/g) || []).length, 1);
  assert.equal((ui.match(/switch gallerySource/g) || []).length, 1);
});
