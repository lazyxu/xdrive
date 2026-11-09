'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const collection = read('ios/XDriveIOS/NativeFilesCollections.swift')
const login = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const ui = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
const watcher = read('ios/scripts/capture-navigation-smoke-frames.py')

function section(source, start, finish) {
  const i = source.indexOf(start)
  const j = source.indexOf(finish, i + start.length)
  assert.ok(i >= 0 && j > i, 'Swift scope boundary not found: ' + start)
  return source.slice(i, j)
}
const recent = section(browser,
  '// Do not mount a complex Recent AX/List tree',
  '.accessibilityIdentifier("native-ios-files-open-recent")')
const favorites = section(browser,
  'NavigationLink {\n                    if login.hasLocalOwnerSession',
  '.accessibilityIdentifier("native-ios-files-open-favorites")')
const denial = browser.slice(browser.indexOf('struct XDriveIOSNativeFilesNoSessionRoute: View'))

test('unverified synthetic Owner alone is not a local Session', () => {
  assert.match(login, /var hasLocalOwnerSession: Bool \{\s*guard let active, let owner else \{ return false \}\s*return sameScope\(active\.verifiedOwner, owner\)/)
  assert.match(collection, /verifiedAuthorization\(\)/)
  assert.match(collection, /XDriveIOSNativePhotoOwnerScope\.matches\(/)
})

test('Recent native navigation denies locally missing Session before list construction', () => {
  assert.match(recent, /if login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.recent\)/)
  assert.match(recent, /\} else \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.recent\)/)
  assert.doesNotMatch(recent, /verifiedAuthorization\(\)|URLSession/)
})

test('Favorites native navigation denies locally missing Session before list construction', () => {
  assert.match(favorites, /if login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.favorites\)/)
  assert.match(favorites, /\} else \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.favorites\)/)
  assert.doesNotMatch(favorites, /verifiedAuthorization\(\)|URLSession/)
})

test('all four denial pages and their explicit back buttons keep separate AX identifiers', () => {
  for (const id of [
    'native-ios-files-error-page', 'native-ios-files-error-return',
    'native-ios-files-trash-error-page', 'native-ios-files-trash-error-return',
    'native-ios-files-recent-error-page', 'native-ios-files-recent-error-return',
    'native-ios-files-favorites-error-page', 'native-ios-files-favorites-error-return'
  ]) assert.ok(denial.includes('"' + id + '"'), 'missing ' + id)
  assert.match(denial, /enum Kind \{ case cloud, trash, recent, favorites \}/)
  assert.match(denial, /Label\("返回文件", systemImage: "chevron\.left"\)/)
  assert.match(denial, /@Environment\(\\\.dismiss\) private var dismiss/)
})

test('locally denied route cannot render protected list, retry, mutations or network requests', () => {
  assert.match(denial, /当前没有有效的原生登录会话/)
  assert.match(denial, /Label\(errorTitle, systemImage: "lock\.shield"\)/)
  assert.doesNotMatch(denial, /Button\("重试"\)|deleteNode\(|UploadSession|XDriveIOSNativeFilesCollectionScreen\(|URLSession|\.onAppear \{ reload\(/)
})

test('authorized collection remains the same canonical Owner-verified server reader', () => {
  assert.match(recent, /XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.recent\)/)
  assert.match(favorites, /XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.favorites\)/)
  assert.match(collection, /private func reload\(preserveVerifiedRows: Bool = false\)/)
  assert.match(collection, /model\.load\(kind, login: login, preserveVerifiedRows: preserveVerifiedRows\)/)
})

test('seven real XCUITest denial and return cases are included, not only source assertions', () => {
  const cases = [
    'testRecentShortcutNoSessionShowsReadOnlyNativeRecovery',
    'testFavoritesShortcutNoSessionShowsReadOnlyNativeRecovery',
    'testRecentAfterTrashDeniedKeepsGalleryMounted',
    'testFavoritesAfterCloudDeniedKeepsGalleryMounted',
    'testRecentFavoritesQuickRailDeniedThenAlbumsRemainUsable',
    'testRecentFavoritesRepeatedDenialsNeverRetainOldScope',
    'testRecentFavoritesErrorScreensHaveActualSimulatorEvidence'
  ]
  for (const name of cases) {
    assert.ok(ui.includes('func ' + name + '()'), 'missing XCUITest ' + name)
    assert.ok(watcher.includes('"' + name + '"'), 'missing live frame target ' + name)
  }
  assert.match(ui, /IOS_NATIVE_NAV_TAP_START route=/)
  assert.match(ui, /XCTAssertFalse\(element\("native-ios-files-favorites-retry", app\)\.exists\)/)
  assert.match(ui, /XCTAssertFalse\(element\("native-ios-files-recent-retry", app\)\.exists\)/)
})

test('frame watcher remains bounded to active test case and tap, not stale next test', () => {
  assert.match(watcher, /TAP_FRAME_OFFSETS_SECONDS = \(0\.15, 0\.55\)/)
  assert.match(watcher, /if key not in active:\s*continue/)
  assert.match(watcher, /if count < 3:/)
  assert.match(watcher, /"capture_mode": "tap-adjacent"/)
})
