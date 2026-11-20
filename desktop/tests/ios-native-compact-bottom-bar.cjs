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
  assert.match(ui, /if tab == \.gallery \{\s*nativePhotosBottomBar\s*\} else \{\s*nativeBottomBar/);
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-photos-bottom-bar"\)/);
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-five-slot-bar"\)/);
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
  assert.match(ui, /dynamicFeature\?\.title \?\? \(emptyDynamicMapFallback \? "地图" : "最近"\)/);
  assert.match(ui, /title: dynamicSlotTitle/);
  assert.match(ui, /dynamicFeature\?\.symbol \?\? \(emptyDynamicMapFallback \? "map" : "clock\.arrow\.circlepath"\)/);
  assert.match(ui, /symbol: dynamicSlotSymbol/);
  assert.match(ui, /feature\.implemented \? feature\.title :/);
  assert.match(ui, /showRecentPicker = true/);
});

test('Gallery uses Photos-like Library, Collections and Search instead of stacked toolbars', () => {
  assert.match(ui, /private var nativePhotosBottomBar: some View/);
  assert.match(ui, /native-ios-photos-library-tab/);
  assert.match(ui, /native-ios-photos-collections-tab/);
  assert.match(ui, /native-ios-photos-search/);
  assert.match(ui, /Image\(systemName: "photo\.on\.rectangle"\)/);
  assert.match(ui, /Image\(systemName: "rectangle\.stack\.fill"\)/);
  assert.match(ui, /native-ios-photos-time-/);
  assert.match(ui, /gallerySource == \.unified && galleryTimelineExpanded/);
  assert.match(ui, /galleryTimeScale = scale/);
  assert.match(ui, /requestUnifiedPhotoSearch = true/);
  assert.match(ui, /private var galleryMoreMenu: some View/);
  assert.match(ui, /Section\("图库来源"\)/);
  assert.match(ui, /Section\("备份与管理"\) \{[\s\S]*?if let status = galleryBackupStatus \{[\s\S]*?Button\(status\) \{ openBackup\(\.overview\) \}[\s\S]*?backupMenuItems[\s\S]*?\}/);
  assert.match(ui, /native-ios-gallery-backup-status/);
  assert.match(ui, /Section\("xDrive"\)/);
  assert.doesNotMatch(ui, /private var galleryStatusRow:/);
  assert.doesNotMatch(ui, /private var gallerySourceRow:/);
  assert.match(ui, /gallerySource == \.map \? !mapNavigationExplicitlyShown : galleryFocused/);
  assert.match(ui, /photosChromeCollectionsSelected/);
  assert.match(ui, /mapOpenedFromCollections = tab == \.gallery && gallerySource == \.albums/);
  assert.match(ui, /pendingUnifiedMapDestination = destination[\s\S]*?presentingUnifiedMap = false/);
  assert.match(ui, /if gallerySource != destination \{ openGallery\(destination\) \}/);
  assert.match(ui, /case \.albums:\s*XDriveIOSNativePhotosCollectionsScreen/);
  assert.equal((ui.match(/switch gallerySource/g) || []).length, 1);
});

test('Collections exposes only backed PhotoKit routes without fabricated AI curation', () => {
  assert.match(ui, /struct XDriveIOSNativePhotosCollectionsScreen: View/);
  for (const route of ['native-ios-collections-recent-days', 'native-ios-collections-people',
                      'native-ios-collections-albums', 'native-ios-collections-videos',
                      'native-ios-collections-live']) {
    assert.ok(ui.includes(route), 'missing usable Collections route: ' + route);
  }
  assert.match(ui, /XDriveIOSNativeLocalPhotoTimelineContainer/);
  assert.match(ui, /XDriveIOSNativePhotoAlbumsScreen\(savedOffset: \$savedAlbumOffset\)/);
  assert.doesNotMatch(ui, /Button\("回忆"\)|Button\("旅行"\)/);
});

test('real Simulator journeys use visible Photos or xDrive actions and keep startup recovery strict', () => {
  const root = path.resolve(__dirname, '../..');
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const nav = read('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift');
  const b9 = read('ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift');
  const files = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift');
  const frames = read('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift');
  const login = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift');
  assert.match(nav, /enum XDriveIOSNativePhotosTestNavigator/);
  assert.match(nav, /if direct\.exists && direct\.isHittable \{ direct\.tap\(\); return true \}/);
  assert.match(nav, /let menu = found\("native-ios-gallery-more-menu", in: app\)/);
  assert.match(nav, /"native-ios-tab-files": "文件"/);
  assert.match(nav, /"native-ios-gallery-source-albums": "native-ios-photos-collections-tab"/);
  for (const suite of [nav, files, frames]) {
    assert.match(suite, /XDriveIOSNativePhotosTestNavigator\.tap\(/);
  }
  // The b9 workflow compiles this test file against the archived b9 source.
  // That old published source does not contain the candidate-only navigator.
  // Keep a self-contained visible five-slot/More menu route in this suite.
  assert.doesNotMatch(b9, /XDriveIOSNativePhotosTestNavigator\.tap\(/);
  assert.match(b9, /app\.buttons\.matching\(identifier: "native-ios-five-slot-bar"\)/);
  assert.match(b9, /app\.buttons\.matching\(identifier: "native-ios-gallery-more-menu"\)/);
  assert.match(login, /\.onChange\(of: restoreFinished\) \{ finished in/);
  assert.match(login, /\.onChange\(of: workspaceVisible\) \{ visible in/);
  assert.match(b9, /XCTNSPredicateExpectation\([\s\S]*?"ready"/);
  assert.match(b9, /Workspace stayed at mountingWorkspace/);
  assert.doesNotMatch(nav, /coordinate\(withNormalizedOffset:/);
});

test('native Photos Collections use real bounded PhotoKit cover cards, never invented AI content', () => {
  assert.match(ui, /struct XDriveIOSNativePhotosCollectionCover: View/);
  for (const kind of ['recent', 'videos', 'livePhotos']) {
    assert.match(ui, new RegExp('XDriveIOSNativePhotosCollectionCover\\(kind: \\.' + kind + '\\)'));
  }
  assert.match(ui, /options\.fetchLimit = kind == \.livePhotos \? 96 : 1/);
  assert.match(ui, /PHAsset\.fetchAssets\(with: \.video, options: options\)/);
  assert.match(ui, /asset\.mediaSubtypes\.contains\(\.photoLive\)/);
  assert.match(ui, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/);
  assert.match(ui, /onDisappear \{\s*changes\.stop\(\)\s*loader\.cancel\(\)/);
  assert.match(ui, /onChange\(of: changes\.change\) \{ _ in loadCurrentCover\(\) \}/);
  assert.match(ui, /onChange\(of: phase\) \{ next in[\s\S]*?else \{ loader\.cancel\(\) \}/);
  const cover = ui.slice(ui.indexOf('private struct XDriveIOSNativePhotosCollectionCover: View'),
                         ui.indexOf('/// Collections retains PhotoKit'));
  assert.doesNotMatch(cover, /performChanges|requestImageDataAndOrientation|UploadSession|accessToken|UserDefaults/);
});

test('compact Photos timeline reveals actual tabs before Gallery and Collections navigation', () => {
  const root = path.resolve(__dirname, '../..')
  const nav = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSNavigationRuntimeUITests.swift'), 'utf8')
  const start = nav.indexOf('enum XDriveIOSNativePhotosTestNavigator')
  const end = nav.indexOf('final class XDriveIOSNavigationRuntimeUITests', start)
  assert.ok(start >= 0 && end > start, 'shared native navigator must remain')
  const helper = nav.slice(start, end)
  assert.match(ui, /native-ios-photos-return-tabs/)
  assert.match(helper, /let compact = found\("native-ios-photos-return-tabs", in: app\)/)
  assert.match(helper, /compact\.exists && compact\.isHittable[\s\S]*?compact\.tap\(\)/)
  assert.match(helper, /id == "native-ios-gallery-source-albums"[\s\S]*?native-ios-photos-collections-tab/)
  assert.match(helper, /restored\.waitForExistence\(timeout: 10\) &&[\s\S]*?restored\.isHittable/)
  assert.match(helper, /restored\.tap\(\)[\s\S]*?return true/)
  assert.doesNotMatch(helper, /coordinate\(withNormalizedOffset:|simctl privacy grant/)
})
