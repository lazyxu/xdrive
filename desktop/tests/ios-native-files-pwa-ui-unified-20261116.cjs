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

test('P0: the prior stack-overflow safety fix and native Viewer remain intact', () => {
  assert.match(browser, /private var filesModalsPrimary: some View/)
  assert.match(browser, /AnyView\(filesModalsSecondary\)/)
  assert.match(browser, /AnyView\(filesLoadingLifecycle\(returnScroll: returnScroll\)\)/)
  assert.match(browser, /\.fullScreenCover\(item: \$selectedFile/)
})
