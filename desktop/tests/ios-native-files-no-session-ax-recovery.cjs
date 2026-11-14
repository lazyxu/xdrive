'use strict'
// Regression for the real XCUITest AX snapshot timeouts observed in the
// cancelled candidate run: Recently Deleted and offline cloud-folder push.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const owner = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const trash = read('ios/XDriveIOS/NativeFilesTrash.swift')
const nav = read('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
const gallery = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')

test('a synthetic Owner with no active native Session is not authorized by local hints', () => {
  assert.match(owner, /var hasLocalOwnerSession: Bool \{\s*guard let active, let owner else \{ return false \}\s*return sameScope\(active\.verifiedOwner, owner\)/)
  assert.match(owner, /func verifiedAuthorization\(\) async throws ->[\s\S]*?guard active != nil else \{ throw XDriveIOSNativeSessionError\.notSignedIn \}/)
})
test('unverified cloud folder bypasses full Files List before any AX enumeration', () => {
  assert.match(browser, /@ViewBuilder private func filesLoadingLifecycle\(returnScroll: ScrollViewProxy\) -> some View \{[\s\S]*?if folder != nil && !login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)/)
  // A fixed AnyView boundary now separates the huge lifecycle generic stack.
  // The no-session condition still must execute BEFORE creating that branch.
  assert.match(browser, /else \{\s*AnyView\(filesArrangementLifecycle\(returnScroll: returnScroll\)\)/)
  assert.match(browser, /kind: \.cloud\)[\s\S]*?\.onAppear \{[\s\S]*?model\.invalidate\(\)[\s\S]*?selectedSnapshots\.removeAll\(\)/)
  assert.match(browser, /var body: some View \{\s*ScrollViewReader \{ returnScroll in\s*AnyView\(filesLoadingLifecycle\(returnScroll: returnScroll\)\)/)
})
test('unverified Trash never mounts its paged destructive List or mutation actions', () => {
  assert.match(trash, /var body: some View \{\s*Group \{[\s\S]*?if !login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.trash\)/)
  assert.match(trash, /else[\s\S]*?if let failure = model\.error,[\s\S]*?else \{\s*List \{/)
  assert.match(trash, /kind: \.trash\)[\s\S]*?\.onAppear \{\s*model\.invalidate\(\)\s*mutation\.invalidate\(\)/)
  assert.match(trash, /private func canActOn\(_ item:[\s\S]*?model\.canDisplay\(owner: login\.owner\)/)
})
test('both denial surfaces have stable accessibility IDs and an explicit dismissal', () => {
  assert.match(browser, /struct XDriveIOSNativeFilesNoSessionRoute: View/)
  for (const id of ['native-ios-files-error-page', 'native-ios-files-trash-error-page',
    'native-ios-files-error-return', 'native-ios-files-trash-error-return']) {
    assert.ok(browser.includes(id), 'missing shared no-Session AX ID: ' + id)
  }
  assert.match(browser, /Button \{\s*dismiss\(\)\s*\} label: \{\s*Label\("返回文件"/)
  const denied = browser.slice(browser.indexOf('struct XDriveIOSNativeFilesNoSessionRoute: View'))
  assert.match(denied, /native-ios-files-trash-no-session/)
  assert.match(denied, /native-ios-files-cloud-no-session/)
  assert.doesNotMatch(denied, /accessibilityIdentifier\("native-ios-files-trash-retry"\)/)
  assert.match(gallery, /testTrashDeniedRetryThenFilesRailAndGalleryReturnKeepsPixels\(\)[\s\S]*?native-ios-files-trash-no-session[\s\S]*?XCTAssertFalse\(target\("native-ios-files-trash-retry"/)
  assert.doesNotMatch(browser.slice(browser.indexOf('struct XDriveIOSNativeFilesNoSessionRoute: View')), /verifiedAuthorization\(\)|accessToken|URLSession|model\.items|ForEach\(/)
})
test('real XCUITests continue checking actual child error pages and returns', () => {
  assert.match(nav, /testSyntheticOwnerRecentlyDeletedReturnKeepsFilesHomeMounted\(\)[\s\S]*?native-ios-files-trash-error-page[\s\S]*?native-ios-files-trash-error-return/)
  assert.match(gallery, /testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit\(\)[\s\S]*?native-ios-files-error-page[\s\S]*?native-ios-files-error-return/)
})
