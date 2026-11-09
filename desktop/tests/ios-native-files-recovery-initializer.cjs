'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.resolve(__dirname, '../../ios/XDriveIOS/NativeCloudFilesBrowser.swift'), 'utf8')
const child = source.slice(
  source.indexOf('private struct XDriveIOSNativeFilesNoSessionChild'),
  source.indexOf('/// iOS fixed Files tab:')
)
const browser = source.slice(
  source.indexOf('struct XDriveIOSNativeFilesBrowser: View'),
  source.indexOf('    private var parentID:', source.indexOf('struct XDriveIOSNativeFilesBrowser: View'))
)

test('a no-Session recovery may construct the exact folder browser within its file only', () => {
  // A private type-scoped init is invisible to a sibling view, producing
  // NativeCloudFilesBrowser.swift:945 extra argument 'folder' in call.
  assert.match(source, /private struct XDriveIOSNativeFilesFolder: Hashable/)
  assert.match(browser, /fileprivate init\(login: XDriveIOSNativeOwnerLoginModel,\s*folder: XDriveIOSNativeFilesFolder\)/)
  assert.match(child, /XDriveIOSNativeFilesBrowser\(login: login, folder: targetFolder\)/)
  assert.match(browser, /_pendingNavigationReturnNodeID = State\(initialValue: folder\.anchorID\)/)
})

test('the file-scoped initializer does not bypass reauthorization or Owner fences', () => {
  assert.match(child, /if verifiedForOpen && login\.hasSameOwnerSessionForNavigation &&\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expectedOwner\)/)
  assert.match(child, /let auth = try await login\.verifiedAuthorization\(\)/)
  assert.match(child, /retryEpoch == ticket, isVisible,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expectedOwner\)/)
  assert.match(browser, /self\.folder = folder/)
})


const uiTests = fs.readFileSync(path.resolve(__dirname, '../../ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift'), 'utf8')
test('dynamic Files route IDs interpolate Swift variables rather than literal escaped text', () => {
  // Previously the CI compiler warned that 'section' was unused.
  // The malformed route matched no real SwiftUI element, so the test failed.
  assert.equal(uiTests.includes("\\\\("), false, 'do not double-escape Swift interpolations')
  assert.ok(uiTests.includes("\"native-ios-files-section-\\(section)\""))
  assert.ok(uiTests.includes("\"Missing native route: \\(id)\""))
  assert.ok(uiTests.includes("\"App exited after \\(id)\""))
  assert.ok(uiTests.includes("\"Expected small native no-Session surface \\(id)\""))
})
