'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const browser = source('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const collection = source('ios/XDriveIOS/NativeFilesCollections.swift')
const style = source('ios/XDriveIOS/NativeFilesUIStyle.swift')
const thumbnail = source('ios/XDriveIOS/NativeFilesThumbnail.swift')
const policy = source('ios/XDriveIOS/NativeFilesViewModePolicy.swift')
const viewer = source('ios/XDriveIOS/NativeFilesViewer.swift')

test('P0: Home is compact and still provides real destinations, search and operations', () => {
  const a = browser.indexOf('private var filesHome: some View')
  const b = browser.indexOf('private var filesHeader: some View', a)
  assert.ok(a >= 0 && b > a)
  const home = browser.slice(a, b)
  assert.doesNotMatch(home, /Text\("我的文件"\)|云端位置 · 收藏目录 · 智能整理/)
  for (const id of ['native-ios-files-home-search','native-ios-files-open-root-location',
    'native-ios-files-open-trash','native-ios-files-open-saved-searches',
    'native-ios-files-open-operations']) assert.ok(home.includes(id), id)
})
test('P1: consistent two-line metadata and shared PWA-like file/icon fallback', () => {
  assert.match(style, /static func compactMetadata\(/)
  assert.match(style, /return parts.joined\(separator: " · "\)/)
  assert.match(style, /XDriveIOSNativeFilesFallbackIcon/)
  assert.match(style, /LinearGradient\(/)
  assert.match(style, /Image\(systemName: "folder.fill"\)/)
  assert.match(browser, /compactMetadata\(entry.node, path: entry.path\)/)
  assert.match(collection, /compactMetadata\(item.node, path: item.path\)/)
  assert.match(thumbnail, /XDriveIOSNativeFilesFallbackIcon/)
  assert.match(thumbnail, /XDriveIOSNativePhotoOwnerScope.matches/)
})
test('P1: view changes capture a verified visual anchor with iOS16-safe geometry', () => {
  for (const s of [browser, collection]) {
    assert.match(s, /XDriveIOSNativeFilesRowFrameReporter/)
    assert.match(s, /XDriveIOSNativeFilesRowFramesKey/)
    assert.match(s, /topVisibleAnchor/)
    assert.match(s, /pendingModeSwitchAlignment = XDriveIOSNativeFilesViewModePolicy\.matchedAlignment/)
    assert.match(s, /UnitPoint\(x: 0.5, y: alignment\)/)
    assert.match(s, /XDriveIOSNativeFilesViewModePolicy.canRestore/)
  }
  assert.match(policy, /static func relativeAlignment/)
  assert.match(policy, /static func matchedAlignment/)
  assert.match(collection, /pendingModeSwitchAnchor == anchor \?/)
  assert.match(collection, /pendingModeSwitchAlignment = nil/)
  assert.match(collection, /visibleModeAnchorID = nil/)
  assert.match(browser, /visibleModeAnchorID = nil/)
  assert.match(style, /allowed.contains\(\$0.key\)/)
  assert.match(browser, /model.canReanchor/)
  assert.match(collection, /model.matches\(login.owner, kind: kind\)/)
})
test('P1: the More hierarchy keeps the same guarded capabilities', () => {
  for (const label of ['显示与排序','新建与上传','浏览与整理','操作与历史']) {
    assert.ok(browser.includes('Label("' + label + '"'), label)
  }
  for (const id of ['native-ios-files-grouping','native-ios-files-quick-upload-folder',
    'native-ios-files-operations','native-ios-files-paste','native-ios-files-go-to-path']) {
    assert.ok(browser.includes(id), id)
  }
})
test('P2: Files-only category switch is below content and replaces selection controls', () => {
  const main = browser.slice(browser.indexOf('private var filesMain: some View'),
    browser.indexOf('private var filesModalsPrimary: some View'))
  assert.ok(main.indexOf('switch quickSection') < main.indexOf('native-ios-files-quick-rail'))
  assert.match(main, /if !selecting \{/)
  assert.match(browser, /if selecting \{ filesSelectionToolbar \}/)
  for (const name of ['recent','browse','favorites']) {
    assert.ok(browser.includes('case .' + name + ':'), name)
  }
})
test('P2: the native Viewer offers authenticated file and technical properties in place', () => {
  for (const marker of ['native-ios-files-viewer-details-action',
    'native-ios-files-viewer-details-sheet','onChange(of: viewed.id)',
    '解码分辨率','视频尺寸','PDF 页数']) assert.ok(viewer.includes(marker), marker)
  assert.match(viewer, /if authorized \{/)
  assert.match(viewer, /ShareLink\(item: staged.fileURL\)/)
  assert.match(viewer, /XDriveIOSNativePhotoVideoSurface/)
  assert.match(viewer, /XDriveIOSNativePDFDocumentSurface/)
})
test('P1: both Files grids have one metadata line; readable Dynamic Type and active filters', () => {
  assert.match(browser, /XDriveIOSNativeFilesUIStyle\.gridMetadata\(entry\.node, path: entry\.path\)/)
  assert.match(collection, /XDriveIOSNativeFilesUIStyle\.gridMetadata\(item\.node, path: item\.path\)/)
  assert.match(style, /static func gridMetadata\(/)
  assert.match(style, /@Environment\(\\\.dynamicTypeSize\)/)
  assert.match(style, /dynamicTypeSize\.isAccessibilitySize \? 2 : 1/)
  assert.match(browser, /native-ios-files-active-filter-count/)
  assert.match(browser, /native-ios-files-clear-active-filters/)
  assert.match(source('ios/XDriveIOS/NativeCloudFilesPolicy.swift'), /var activeFilterCount: Int/)
  assert.match(viewer, /onChange\(of: viewed\.revision\)/)
})

test('P2: native simulator checks Files rail geometry in both orientations and dark appearance', () => {
  const tests = source('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
  const workflow = source('.github/workflows/ios-native-navigation-runtime.yml')
  assert.match(tests, /func testFilesQuickRailAndFiveTabBarDoNotOverlapInPortraitOrLandscape\(\)/)
  assert.match(tests, /filesRail\.frame\.maxY, appBar\.frame\.minY \+ 1/)
  assert.match(tests, /XCUIDevice\.shared/)
  assert.match(tests, /\.landscapeLeft/)
  assert.match(tests, /control\.isHittable/)
  assert.match(workflow, /xcrun simctl ui "\$SMOKE_SIM" appearance dark/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSNavigationRuntimeUITests\/testFilesQuickRailAndFiveTabBarDoNotOverlapInPortraitOrLandscape/)
})

test('P0: Recent/Favorites Viewer preserves exact same-Node viewport when reopening', () => {
  assert.match(collection, /private struct XDriveIOSNativeFilesCollectionViewerViewport/)
  assert.match(collection, /opened: XDriveIOSNativeFilesNode/)
  assert.match(collection, /anchor: XDriveIOSNativeFilesNode/)
  assert.match(collection, /viewerReturnViewport = \.init\(/)
  assert.match(collection, /snapshot\.opened == target &&/)
  assert.match(collection, /snapshot\.query == filterQuery/)
  assert.match(collection, /model\.items\.contains\(where: \{ \$0\.node == snapshot\.anchor \}\)/)
  assert.match(collection, /filteredItems\.contains\(where: \{ \$0\.node == saved\.anchor \}\)/)
  assert.match(collection, /expectedMode: snapshot\.mode, currentMode: viewMode/)
  assert.match(collection, /returnScroll\.scrollTo\(snapshot\.anchor\.id,/)
  assert.match(collection, /anchor: UnitPoint\(x: 0\.5, y: alignment\)/)
  assert.match(collection, /returnScroll\.scrollTo\(target\.id, anchor: \.center\)/)
  assert.match(collection, /viewerReturnViewport = nil\s*returnFile = nil/)
  assert.match(collection, /viewerReturnViewport = nil\s*locateIntent = nil/)
})

test('P0: native Gallery backup action and Files Home editing expose usable AX states', () => {
  const native = source('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
  const gallery = source('ios/XDriveIOS/NativePhotosDashboard.swift')
  const crash = source('ios/UITests/XDriveIOSAllNativePagesCrashSweepUITests.swift')
  const workflow = source('.github/workflows/ios-native-navigation-runtime.yml')
  assert.match(native, /accessibilityValue\(isHomeEditing \? "已开启" : "已关闭"\)/)
  assert.match(gallery, /native-ios-gallery-more-menu/)
  assert.match(gallery, /native-ios-gallery-options-done/)
  assert.match(gallery, /Section\("备份与管理"\)[\s\S]*?backupMenuItems/)
  assert.match(gallery, /Button\("备份设置"\) \{ openBackup\(\.settings\) \}/)
  assert.match(gallery, /showingGalleryOptions = false\s*showThumbnailCacheFromBackup = true/)
  assert.match(crash, /func actualBackupControls\(\) -> \[XCUIElement\]/)
  assert.match(crash, /identifier: "native-ios-gallery-more-menu"/)
  assert.match(crash, /app\.navigationBars\["图库选项"\]/)
  assert.match(crash, /controls \+= app\.buttons\.matching\(/)
  assert.match(crash, /GALLERY_BACKUP_AX_NOT_HITTABLE/)
  assert.match(crash, /value == %@/)
  assert.match(workflow, /matrix\.source == 'candidate-navigation'\) && 100/)
})

test('P1: selected filter chips mirror PWA and cannot show a previous Owner label', () => {
  for (const field of ['kind', 'modified', 'size', 'source', 'tag']) {
    assert.ok(style.includes('id: "' + field + '"'), field + ' selected chip missing')
    assert.ok(style.includes('case "' + field + '":'), field + ' individual clear action missing')
  }
  assert.match(style, /struct XDriveIOSNativeFilesAppliedFiltersBar: View/)
  assert.match(style, /@Binding var filters: XDriveIOSNativeFilesSearchFilterState/)
  assert.match(style, /native-ios-files-applied-filter-chips/)
  assert.match(style, /native-ios-files-applied-filter-.*chip\.id/)
  assert.match(style, /accessibilityLabel\("清除" \+ chip\.label \+ "筛选"\)/)
  assert.match(browser, /XDriveIOSNativeFilesAppliedFiltersBar\(/)
  assert.match(browser, /filters: \$searchFilters,/)
  assert.match(browser, /sourceName: searchSourceFilterTitle/)
  assert.match(browser, /tagName: searchTagFilterTitle/)
  const options = browser.slice(browser.indexOf('private var searchSourceFilterTitle:'),
    browser.indexOf('/// Capture the exact visible Node before List/Grid'))
  assert.match(options, /guard hasVerifiedSearchOptionsForOwner else \{ return "同步文件夹已筛选" \}/)
  assert.match(options, /guard hasVerifiedSearchOptionsForOwner else \{ return "标签已筛选" \}/)
  assert.match(browser, /URLQueryItem\(name: "source_id", value: String\(sourceID\)\)/)
  assert.match(browser, /URLQueryItem\(name: "tag_id", value: String\(tagID\)\)/)
})

test('P0: Browse Viewer returns to the exact verified visible row, never stale Owner pixels', () => {
  assert.match(browser, /private struct XDriveIOSNativeFilesBrowseViewerViewport/)
  const state = browser.slice(browser.indexOf('private struct XDriveIOSNativeFilesBrowseViewerViewport'),
    browser.indexOf('struct XDriveIOSNativeFilesBrowser: View'))
  for (const field of ['opened','anchor','alignment','folderID','mode','query',
    'filters','sort','order','grouping','foldersFirst']) {
    assert.ok(state.includes('let ' + field + ':'), field)
  }
  const open = browser.slice(browser.indexOf('private func openViewer('),
    browser.indexOf('private func gridTile(', browser.indexOf('private func openViewer(')))
  assert.match(open, /viewerReturnViewport = nil/)
  assert.match(open, /model\.canResume\(/)
  assert.match(open, /let anchorID = visibleModeAnchorID/)
  assert.match(open, /viewerReturnViewport = \.init\(/)
  const restore = browser.slice(browser.indexOf('guard let target = lastViewedFile else { return }'),
    browser.indexOf('var body: some View', browser.indexOf('guard let target = lastViewedFile else { return }')))
  assert.match(restore, /model\.canResume\(/)
  assert.match(restore, /saved\.opened == target/)
  assert.match(restore, /saved\.filters == searchFilters/)
  assert.match(restore, /saved\.sort == sort && saved\.order == order/)
  assert.match(restore, /saved\.grouping == grouping/)
  assert.match(restore, /pageValid: model\.entries\.contains\(where: \{ \$0\.node == saved\.anchor \}\)/)
  assert.match(restore, /XDriveIOSNativeFilesViewModePolicy\.canRestore/)
  assert.match(restore, /returnScroll\.scrollTo\(\s*saved\.anchor\.id,/)
  assert.match(restore, /anchor: UnitPoint\(x: 0\.5, y: aligned\)/)
  assert.match(restore, /returnScroll\.scrollTo\(target\.id, anchor: \.center\)/)
  assert.match(restore, /viewerReturnViewport = nil/)
  assert.match(browser, /onChange\(of: login\.owner\)[\s\S]*?viewerReturnViewport = nil/)
})

test('P0: Search and Browse Viewer return the final verified Node without stale pixels', () => {
  const open = browser.slice(browser.indexOf('private func openViewer('),
    browser.indexOf('private func gridTile(', browser.indexOf('private func openViewer(')))
  const modal = browser.slice(browser.indexOf('.fullScreenCover(item: $selectedFile, onDismiss: {'),
    browser.indexOf('}) { initial in', browser.indexOf('.fullScreenCover(item: $selectedFile, onDismiss: {')))
  const visible = browser.slice(browser.indexOf('private var filesList: some View'),
    browser.indexOf('private var filesQuickFeedback:', browser.indexOf('private var filesList: some View')))
  assert.match(visible, /!isHome, !selecting, model\.verifiedPage/)
  assert.doesNotMatch(visible, /!isHome, !isGlobalSearch, !selecting, model\.verifiedPage/)
  assert.match(open, /if !isHome, let folderID = parentID/)
  assert.match(open, /viewerOpeningNode = entry\.node/)
  assert.match(open, /pendingViewerNavigationReturn = nil/)
  assert.match(modal, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/)
  assert.match(modal, /target != opened/)
  assert.match(modal, /model\.entries\.contains\(where: \{ \$0\.node == target \}\)/)
  assert.match(modal, /pendingViewerNavigationReturn = target/)
  assert.match(modal, /reanchorReturnedViewer\(target\)/)
  const restore = browser.slice(browser.indexOf('private func restoreVerifiedViewerNavigationReturn('),
    browser.indexOf('private func filesForegroundLifecycle('))
  assert.match(restore, /model\.canResume\(/)
  assert.match(restore, /model\.entries\.contains\(where: \{ \$0\.node == target \}\)/)
  assert.match(restore, /filesViewVisible, phase == \.active/)
  assert.match(restore, /pendingViewerNavigationReturn == target/)
  assert.match(restore, /transaction\.disablesAnimations = true/)
  assert.match(restore, /returnScroll\.scrollTo\(target\.id, anchor: \.center\)/)
  assert.match(browser, /onChange\(of: pendingViewerNavigationReturn\)/)
  assert.match(browser, /viewerOpeningNode = nil\s*pendingViewerNavigationReturn = nil\s*viewerReturnViewport = nil/)
})

test('P0: one physically reserved native bottom bar and real direct Files Home editing', () => {
  const shell = source('ios/XDriveIOS/NativePhotosDashboard.swift')
  const xctest = source('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
  const crash = source('ios/UITests/XDriveIOSAllNativePagesCrashSweepUITests.swift')
  assert.match(shell, /return VStack\(spacing: 0\) \{/)
  assert.match(shell, /TabView\(selection: \$tab\)/)
  assert.match(shell, /\.toolbar\(\.hidden, for: \.tabBar\)\s*\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  assert.doesNotMatch(shell, /\.safeAreaInset\(edge: \.bottom, spacing: 0\)/)
  assert.match(xctest, /testFilesQuickRailAndFiveTabBarDoNotOverlapInPortraitOrLandscape/)
  assert.match(browser, /Button \{ isHomeEditing\.toggle\(\) \} label: \{/)
  assert.match(browser, /\.accessibilityElement\(children: \.ignore\)\s*\.accessibilityLabel\(isHomeEditing \?/)
  assert.match(browser, /\.accessibilityValue\(isHomeEditing \? "已开启" : "已关闭"\)/)
  assert.match(crash, /Files Home editing did not enter its accessible state/)
  assert.match(shell, /\.textInputAutocapitalization\(\.never\)/)
  assert.match(shell, /\.autocorrectionDisabled\(\)/)
})

test('P0: denied Files History never paints an empty neutral child viewport', () => {
  const history = source('ios/XDriveIOS/NativeFilesOperationHistory.swift')
  const navigation = source('ios/UITests/XDriveIOSGalleryFilesSixSubpageUITests.swift')
  assert.match(history, /!model\.matches\(login\.owner\)/)
  assert.match(history, /native-ios-files-operation-history-no-access/)
  assert.match(history, /native-ios-files-operation-history-empty-state/)
  assert.match(history, /无法验证操作历史/)
  assert.match(history, /当前账户尚未通过验证/)
  assert.match(history, /\.frame\(maxWidth: \.infinity, maxHeight: \.infinity\)/)
  assert.match(history, /\.allowsHitTesting\(false\)/)
  assert.match(navigation, /History denied read left a blank native viewport/)
  assert.match(navigation, /testFilesHistoryForegroundGalleryPeopleBackRetiresSheet/)
})

test('P0: the prior stack-overflow safety fix and native Viewer remain intact', () => {
  assert.match(browser, /private var filesModalsPrimary: some View/)
  assert.match(browser, /AnyView\(filesModalsSecondary\)/)
  assert.match(browser, /AnyView\(filesLoadingLifecycle\(returnScroll: returnScroll\)\)/)
  assert.match(browser, /\.fullScreenCover\(item: \$selectedFile/)
})
