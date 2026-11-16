'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const files = fs.readFileSync(
  path.join(root, 'ios/XDriveIOS/NativeCloudFilesBrowser.swift'), 'utf8'
)

function segment(start, end) {
  const a = files.indexOf(start)
  const b = files.indexOf(end, a + start.length)
  assert.ok(a >= 0 && b > a, 'missing bounded Files segment: ' + start)
  return files.slice(a, b)
}

test('iOS 26.6 Files main-thread stack-overflow regression: split every oversized modal and lifecycle generic chain', () => {
  const modal = segment('private var filesModalsPrimary: some View {',
    '/// Save the exact loaded page')
  assert.match(modal, /private var filesModalsPrimary: some View \{\s*AnyView\(filesMain\)/)
  assert.match(modal, /private var filesModalsSecondary: some View \{\s*AnyView\(filesModalsPrimary\)/)
  assert.match(modal, /private var filesModals: some View \{\s*AnyView\(filesModalsSecondary\)/)
  const modifiers = modal.match(/\.(?:sheet|alert|confirmationDialog|fullScreenCover)\(/g) || []
  assert.equal(modifiers.length, 23, 'the original 22 plus the verified quick-info sheet must remain')
  assert.match(modal, /\.sheet\(item: \$quickInfoIntent\) \{ intent in/,
    'quick-info sheet added on master remains mounted')
  for (const name of ['showingOrganizeHome', 'showingFileOperations', 'showingSavedSearches',
    'showingTagManager', 'batchDestinationIntent', 'managementIntent',
    'versionHistoryIntent', 'selectedFile']) {
    assert.ok(modal.includes('$' + name), 'modal or Viewer was removed: ' + name)
  }
  const lifecycles = [
    ['filesForegroundLifecycle', 'AnyView(filesModals)'],
    ['filesOwnerLifecycle', 'AnyView(filesForegroundLifecycle(returnScroll: returnScroll))'],
    ['filesNavigationLifecycle', 'AnyView(filesOwnerLifecycle(returnScroll: returnScroll))'],
    ['filesArrangementLifecycle', 'AnyView(filesNavigationLifecycle(returnScroll: returnScroll))'],
    ['filesLoadingLifecycle', 'AnyView(filesArrangementLifecycle(returnScroll: returnScroll))'],
  ]
  for (const [index, [name, erased]] of lifecycles.entries()) {
    const at = files.indexOf('private func ' + name + '(returnScroll: ScrollViewProxy)')
    const next = index + 1 < lifecycles.length
      ? files.indexOf('private func ' + lifecycles[index + 1][0] +
                      '(returnScroll: ScrollViewProxy)', at + 1)
      : files.indexOf('var body: some View {', at + 1)
    assert.ok(at > 0 && next > at, 'Files lifecycle segment missing: ' + name)
    assert.ok(files.slice(at, next).includes(erased),
      name + ' must erase its nested view type at a stable boundary')
  }
  assert.match(files, /ScrollViewReader \{ returnScroll in\s*AnyView\(filesLoadingLifecycle\(returnScroll: returnScroll\)\)/)
})

test('the stack-depth fix does not weaken verified Owner, no-session or selected row fences', () => {
  const foreground = segment('private func filesForegroundLifecycle(returnScroll:',
    'private func filesOwnerLifecycle(returnScroll:')
  const owner = segment('private func filesOwnerLifecycle(returnScroll:',
    'private func filesNavigationLifecycle(returnScroll:')
  const navigation = segment('private func filesNavigationLifecycle(returnScroll:',
    'private func filesArrangementLifecycle(returnScroll:')
  const loading = segment('private func filesLoadingLifecycle(returnScroll:',
    'var body: some View {')
  assert.match(foreground, /\.onAppear \{/)
  assert.match(foreground, /\.onDisappear \{ suspendVisibleRange\(\) \}/)
  assert.match(owner, /\.onChange\(of: login\.owner\)/)
  assert.match(owner, /model\.invalidate\(\)/)
  assert.match(owner, /selectedIDs\.removeAll\(\)/)
  assert.match(navigation, /\.onChange\(of: model\.verifiedPage\)/)
  assert.match(navigation, /XDriveIOSNativeFilesSelectionPolicy\.conflictingIDs\(/)
  assert.match(loading, /if folder != nil && !login\.hasLocalOwnerSession/)
  assert.match(loading, /XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)/)
  assert.match(loading, /\.onChange\(of: model\.loading\)/)
  assert.match(loading, /XDriveIOSNativePhotoOwnerScope\.matches/)
  assert.doesNotMatch(loading, /XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)[\s\S]*?bypassAuthorization/)
})

test('Files retained list, return scroll and real Viewer still receive original SwiftUI lifecycle', () => {
  assert.match(files, /private var filesModals: some View \{[\s\S]*?\.fullScreenCover\(item: \$selectedFile, onDismiss:/)
  assert.match(files, /ScrollViewReader \{ returnScroll in/)
  assert.match(files, /returnScroll\.scrollTo\(anchor, anchor: \.center\)/)
  assert.match(files, /returnScroll\.scrollTo\(returnID, anchor: \.center\)/)
  assert.match(files, /\.onChange\(of: quickSection\)/)
  assert.match(files, /\.onChange\(of: sort\)/)
  assert.match(files, /\.onChange\(of: grouping\)/)
  assert.match(files, /\.onChange\(of: viewMode\)/)
  assert.match(files, /\.onChange\(of: login\.owner\)/)
  assert.doesNotMatch(files, /id\(UUID\(\)\)/)
})

test('signed-in Gallery never eagerly mounts the Files view graph; first Files visit keeps the same stateful tab after return', () => {
  const dashboard = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8'
  )
  assert.match(dashboard, /@State private var tab: XDriveIOSNativeBottomTab = \.gallery/)
  assert.match(dashboard, /@State private var filesTabActivated = false/)
  const filesTab = dashboard.slice(
    dashboard.indexOf('if tab == .files || filesTabActivated {'),
    dashboard.indexOf('.tag(XDriveIOSNativeBottomTab.files)')
  )
  assert.match(filesTab, /if tab == \.files \|\| filesTabActivated \{\s*[\s\S]*?files\s*\.navigationTitle\("文件"\)/)
  assert.match(filesTab, /else \{\s*Color\.clear\s*\.accessibilityHidden\(true\)/)
  assert.match(dashboard, /\.onChange\(of: tab\) \{ next in\s*if next == \.files \{ filesTabActivated = true \}/)
  assert.match(dashboard, /\.onChange\(of: ownerScopeKey\) \{ _ in[\s\S]*?filesTabActivated = false/)
  assert.match(dashboard, /private func resetNavigation\(\) \{\s*galleryFocusGeneration = UUID\(\)\s*galleryFocused = false\s*filesTabActivated = false/)
  assert.match(dashboard, /\.tag\(XDriveIOSNativeBottomTab\.files\)/)
  assert.match(dashboard, /\.tag\(XDriveIOSNativeBottomTab\.gallery\)/)
  assert.equal((dashboard.match(/XDriveIOSNativeFilesBrowser\(login: login\)/g) || []).length, 1,
    'do not substitute another unauthenticated Files root')
  const restore = dashboard.slice(dashboard.indexOf('private func restoreNavigationIfNeeded()'),
    dashboard.indexOf('private func saveNavigationIfReady()'))
  assert.match(restore, /tab = XDriveIOSNativeBottomTab\(rawValue: snapshot\.selectedTab\) \?\? \.gallery/)
  assert.match(restore, /if tab == \.files \{ tab = \.gallery \}/,
    'cold login must not auto-reopen the known crashing Files view')
  assert.match(restore, /navigationRouteStore\.restore\(scopeHash: scopeHash\)/)
  assert.doesNotMatch(restore, /resumeStore\.clear\(|XDriveIOSNativeFilesResumeStore\(\)\.clear\(/)
})

test('all 14 Launcher destinations and at least 40 native all-page/child process crash journeys run in real Simulator', () => {
  const sweep = fs.readFileSync(
    path.join(root, 'ios/UITests/XDriveIOSAllNativePagesCrashSweepUITests.swift'), 'utf8'
  )
  const watcher = fs.readFileSync(
    path.join(root, 'ios/scripts/capture-navigation-smoke-frames.py'), 'utf8'
  )
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/ios-native-navigation-runtime.yml'), 'utf8'
  )
  const methods = [...sweep.matchAll(/\bfunc\s+(test\w+)\(\)/g)].map(match => match[1])
  assert.ok(methods.length >= 40,
    'at least 40 independent real native crash journeys are mandatory')
  assert.equal(new Set(methods).size, methods.length)
  for (const name of methods) {
    assert.ok(watcher.includes('"' + name + '"'), 'missing bounded Simulator frame watcher: ' + name)
  }
  for (const route of ['local', 'albums', 'cloud', 'originals', 'map', 'files',
                       'notes', 'clipboard', 'backup', 'transfers', 'sync',
                       'storage', 'devices', 'diagnostics']) {
    assert.ok(sweep.includes('"' + route + '"'), 'Launcher path missing: ' + route)
  }
  for (const child of ['native-ios-files-error-page', 'native-ios-files-trash-error-page',
                       'native-ios-files-saved-searches-page', 'native-ios-files-operation-history-page',
                       'native-ios-files-tag-management', 'native-ios-gallery-people-page',
                       'native-ios-map-source-selector', 'native-ios-notes-page',
                       'ios-clipboard-status', 'native-ios-backup-portrait-form']) {
    assert.ok(sweep.includes('"' + child + '"'), 'missing real native child assertion: ' + child)
  }
  assert.match(sweep, /XCTAssertEqual\(app\.state, \.runningForeground/)
  assert.match(sweep, /-xdrive-ui-navigation-synthetic-owner/)
  assert.match(sweep, /-xdrive.ios.native.launch-checkpoint.v1/)
  assert.match(sweep, /native-ios-files-recent-error-page/)
  assert.match(sweep, /native-ios-files-favorites-error-page/)
  assert.ok(sweep.includes('func testFilesFavoriteDisclosureCollapseExpandAndReturnKeepsProcessAlive()'))
  assert.ok(sweep.includes('ensureFavoritesExpanded(app)'))
  assert.ok(sweep.includes('favoritesDisclosure(app)'))
  assert.ok(files.includes('@AppStorage("xdrive.ios.files.home.favorites-expanded.v1")'))
  // The old container-level modifier overwrote ALL descendant route IDs.
  assert.ok(files.includes('DisclosureGroup(isExpanded: $favoriteFoldersExpanded) {'))
  assert.ok(files.includes('Text("收藏夹和常用收藏")\n                    .accessibilityIdentifier("native-ios-files-favorites-disclosure")'))
  assert.ok(!files.includes('            }\n            .accessibilityIdentifier("native-ios-files-favorites-disclosure")'))
  assert.ok(files.includes('.accessibilityValue(favoriteFoldersExpanded ? "已展开" : "已折叠")'))
  const denied = fs.readFileSync(
    path.join(root, 'ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift'), 'utf8')
  assert.ok(denied.includes('expandFavoritesIfNeeded(app)'))
  const login = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8')
  assert.ok(login.includes('.accessibilityValue(startupReady ? "启动完成" : "正在启动")'))
  assert.match(sweep, /native-ios-gallery-thumbnail-cache/)
  assert.match(sweep, /native-ios-backup-cache-sheet-close/)
  assert.match(sweep, /native-ios-login-password/)
  assert.match(sweep, /native-ios-login-lan-ip/)
  assert.match(sweep, /tap\("native-ios-login-advanced-connection", app\)/)
  assert.match(sweep, /tap\("native-ios-lan-certificate-help", app\)/)
  assert.match(sweep, /tap\("native-ios-login-preferences", app\)/)
  assert.match(sweep, /IOS_NATIVE_NAV_TAP_START/)
  assert.match(sweep, /app\.segmentedControls\.firstMatch/)
  assert.match(sweep, /waitRetired\("native-ios-files-saved-searches-page"/)
  assert.doesNotMatch(sweep, /fakeToken|mockServerLogin|XCTSkip|bypassAuthorization/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSAllNativePagesCrashSweepUITests/)
  assert.match(workflow, /candidate-navigation/)
  assert.match(workflow, /ios\/UITests\/XDriveIOSAllNativePagesCrashSweepUITests\.swift/)
})



test('published-b9 cold startup keeps the real compact About readiness without faking baseline', () => {
  const b9 = fs.readFileSync(
    path.join(root, 'ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift'), 'utf8')
  const login = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativeOwnerLoginScreen.swift'), 'utf8')
  const testStart = b9.indexOf('func testPublishedB9RealColdStartAndRestart()')
  const testEnd = b9.indexOf('\n    func test', testStart + 8)
  assert.ok(testStart >= 0 && testEnd > testStart)
  const body = b9.slice(testStart, testEnd)
  assert.match(body, /matching\(identifier: "native-ios-login-about"\)/)
  assert.match(body, /if compactAbout\.exists \{[\s\S]*?compactAbout\.isHittable[\s\S]*?compactAbout\.tap\(\)/)
  assert.match(body, /matching\(identifier: "native-ios-prelogin-build"\)/)
  assert.match(body, /XCTNSPredicateExpectation\(/)
  assert.match(body, /value == %@/)
  assert.match(body, /readiness\.label\.contains\("b9d5f9695826"\)/)
  assert.match(login, /accessibilityIdentifier\("native-ios-login-about"\)/)
  assert.match(login, /accessibilityIdentifier\("native-ios-prelogin-build"\)[\s\S]*?accessibilityValue\(startupReady \? "启动完成" : "正在启动"\)/)
})

test('crash sweep targets the actual mounted Launcher and selected Files Home, never an arbitrary retained ScrollView', () => {
  const sweep = fs.readFileSync(
    path.join(root, 'ios/UITests/XDriveIOSAllNativePagesCrashSweepUITests.swift'), 'utf8'
  )
  const dashboard = fs.readFileSync(
    path.join(root, 'ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8'
  )
  assert.match(sweep, /element\("native-ios-launcher-scroll", app\)/)
  assert.match(sweep, /element\("native-ios-files-home-list", app\)/)
  assert.match(sweep, /tap\("native-ios-files-section-browse", app\)/)
  assert.match(sweep, /XCTNSPredicateExpectation\(/)
  assert.doesNotMatch(sweep, /app\.(scrollViews|collectionViews)\.firstMatch/)
  assert.match(dashboard, /\.accessibilityIdentifier\("native-ios-launcher-scroll"\)/)
  assert.match(files, /\.accessibilityIdentifier\(isHome \? "native-ios-files-home-list" : "native-ios-files-folder-list"\)/)
})
