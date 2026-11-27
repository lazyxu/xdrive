'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = p => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const runtime = read('ios/UITests/XDriveIOSNavigationRuntimeUITests.swift')
const b9 = read('ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift')

test('five selected child NavigationStacks each suppress their own system tab bar', () => {
  const start = dashboard.indexOf('private var dashboardTabContent: some View {')
  const end = dashboard.indexOf('// iOS 26 Photos-style', start)
  assert.ok(start >= 0 && end > start, 'real five-tab body must stay mounted')
  const body = dashboard.slice(start, end)
  const stacks = body.split('NavigationStack {').slice(1)
  assert.equal(stacks.length, 5)
  stacks.forEach((stack, i) => assert.ok(stack.includes('.toolbar(.hidden, for: .tabBar)'),
    'Missing child-level TabBar hiding in native destination ' + i))
  assert.ok(dashboard.includes('nativePhotosBottomBar'))
  assert.ok(dashboard.includes('nativeBottomBar'))
})

test('real Simulator rejects any overlapping UIKit TabBar', () => {
  assert.ok(runtime.includes('func testGalleryPhotosBarDoesNotStackSystemTabBar()'))
  for (const id of ['native-ios-photos-library-tab', 'native-ios-photos-collections-tab', 'native-ios-photos-search']) {
    assert.ok(runtime.includes(id))
  }
  assert.ok(runtime.includes('XCTAssertFalse(systemTab.exists && systemTab.isHittable'))
})

test('archived published b9 uses only a real visible UIKit tab, never synthetic screen', () => {
  assert.ok(b9.includes('let systemTab = app.tabBars.buttons'))
  assert.ok(b9.includes('if systemTab.exists && systemTab.isHittable'))
  assert.ok(runtime.includes('let system = app.tabBars.buttons'))
  assert.equal(b9.includes('coordinate(withNormalizedOffset:'), false)
})
