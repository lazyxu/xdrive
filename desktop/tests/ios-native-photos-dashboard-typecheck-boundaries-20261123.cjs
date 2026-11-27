'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS/NativePhotosDashboard.swift'), 'utf8')

test('Photos dashboard splits costly SwiftUI TabView, sheets and lifecycle into separately typed views', () => {
  assert.match(source, /var body: some View \{\s*VStack\(spacing: 0\) \{[\s\S]*?dashboardLifecycleContent/)
  for (const [name, child] of [
    ['dashboardLifecycleContent','dashboardSceneLifecycleContent'],
    ['dashboardSceneLifecycleContent','dashboardModalContent'],
    ['dashboardModalContent','dashboardEnvironmentContent'],
    ['dashboardEnvironmentContent','dashboardTabContent']
  ]) {
    assert.match(source, new RegExp('private var ' + name + ': some View \\{\\s*' +
      (name === 'dashboardEnvironmentContent'
        ? 'let expectedRouteOwnerKey = ownerScopeKey\\s*return '
        : '') + child))
  }
  assert.equal((source.match(/TabView\(selection: \$tab\)/g) || []).length, 1)
  assert.match(source, /private var dashboardTabContent: some View \{\s*TabView\(selection: \$tab\)/)
  assert.match(source, /\.tag\(XDriveIOSNativeBottomTab\.gallery\)/)
  assert.match(source, /\.tag\(XDriveIOSNativeBottomTab\.files\)/)
  assert.match(source, /\.id\(ownerScopeKey\)/)
  assert.match(source, /\.environment\(\\\.xdriveOpenNativeLocalMap, \{ jump in/)
  assert.match(source, /pendingUnifiedMapOwnerScope = nil/)
  assert.match(source, /if next == \.files \{ filesTabActivated = true \}/)
  assert.match(source, /dashboardLifecycleContent[\s\S]*?nativePhotosBottomBar[\s\S]*?nativeBottomBar/)
  assert.doesNotMatch(source, /simctl privacy grant|mockOwner|bypassAuthorization/)
})
