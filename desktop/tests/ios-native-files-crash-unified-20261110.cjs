'use strict'
// One integrated executable contract: do not regress the real Search/Trash
// Simulator fixes while adding fail-closed Recent/Favorites and blank-frame tests.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const gallery = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
const recovery = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')
const frames = read('ios/scripts/capture-navigation-smoke-frames.py')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const denial = browser.slice(browser.indexOf('struct XDriveIOSNativeFilesNoSessionRoute: View'))

test('iOS 17+ Files search presentation is separate from committed Server query', () => {
  assert.match(browser, /@State private var searchPresented = false/)
  assert.match(browser, /@State private var activeQuery = ""/)
  assert.match(browser, /if #available\(iOS 17\.0, \*\)/)
  assert.match(browser, /text: \$text, isPresented: \$presented/)
  assert.match(browser, /\.modifier\(XDriveIOSNativeFilesSearchPresentation\(/)
  assert.match(browser, /text: \$queryDraft, presented: \$searchPresented/)
})

test('Search Submit dismisses overlay without dismissSearch clearing committed query', () => {
  const start = browser.indexOf('.onSubmit(of: .search) {')
  const end = browser.indexOf('.task(id: queryDraft) {', start)
  assert.ok(start >= 0 && end > start)
  const submit = browser.slice(start, end)
  assert.match(submit, /submitSearch\(\)/)
  assert.match(submit, /searchPresented = false/)
  assert.doesNotMatch(submit, /^\s*dismissSearch\(\)/m)
  assert.match(browser, /private func submitSearch\(\)/)
  assert.match(browser, /searchReturnNodeID/)
})

test('Files root, Owner change and reset retire search presentation', () => {
  assert.ok((browser.match(/searchPresented = false/g) || []).length >= 4)
  assert.match(browser, /private func clearSearch\(\) \{\s*searchPresented = false/)
})

test('all four protected shortcuts fail closed before mounting Recent/Favorites list', () => {
  assert.match(browser, /if login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.recent\)\s*\} else \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.recent\)/)
  assert.match(browser, /if login\.hasLocalOwnerSession \{\s*XDriveIOSNativeFilesCollectionScreen\(login: login, kind: \.favorites\)\s*\} else \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.favorites\)/)
  assert.match(denial, /enum Kind \{ case cloud, trash, recent, favorites \}/)
  for (const id of ['cloud','trash','recent','favorites']) {
    assert.ok(denial.includes('"native-ios-files-' + id + '-no-session"'))
  }
  assert.doesNotMatch(denial, /Button\("重试"\)|deleteNode\(|URLSession|UploadSession/)
})

test('real Simulator requires recovered Files rail and visible screen after search', () => {
  for (const name of ['testFilesSearchFocusThenGalleryReturnPreservesShell',
                      'testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes']) {
    assert.ok(gallery.includes('func ' + name + '()'))
  }
  assert.match(gallery, /assertNotSolidScreen\(app, "Files after Search submit and rail restoration"\)/)
  assert.match(gallery, /assertNotSolidScreen\(app, "Files after Search before Gallery filter"\)/)
  assert.match(gallery, /native-ios-files-trash-no-session/)
})

test('real denied Cloud/Trash/Recent/Favorites and rapid Back UI tests actually run', () => {
  const cases = [...recovery.matchAll(/func test\w+\(\)/g)]
  assert.ok(cases.length >= 24, '24 native no-Session scenarios must be preserved')
  for (const name of ['testNoSessionCloudAndTrashErrorPagesAreNotSolidBlankScreens',
                      'testNoSessionRecentFavoritesDeniedPagesAreNotSolidBlankScreens',
                      'testNoSessionCloudTrashRapidBackDoesNotRepushOldChild']) {
    assert.ok(recovery.includes('func ' + name + '()'))
    assert.ok(frames.includes('"' + name + '"'))
  }
  assert.match(workflow, /candidate-no-session[\s\S]*?XDriveIOSFilesSessionRecoveryUITests/)
  assert.doesNotMatch(recovery, /IOS_NATIVE_.*FPS=60|IOS_NATIVE_.*ZERO_FLICKER_PASS/)
})
