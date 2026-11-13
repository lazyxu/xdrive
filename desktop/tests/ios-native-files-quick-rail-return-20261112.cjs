'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeCloudFilesBrowser.swift'), 'utf8')
const nav = fs.readFileSync(path.join(root, 'ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift'), 'utf8')
const main = source.slice(source.indexOf('private var filesMain: some View {'), source.indexOf('private var filesModals: some View {'))

test('Files quick rail remains above every child view across TabView returns', () => {
  assert.ok(main.includes('native-ios-files-quick-rail'))
  assert.ok(main.indexOf('native-ios-files-quick-rail') < main.indexOf('switch quickSection'))
  assert.doesNotMatch(main, /if !selecting\s*\{\s*HStack/)
  assert.match(main, /guard !selecting, !batchTrash\.busy, !batchTarget\.busy/)
  assert.match(main, /\.disabled\(selecting\)/)
  assert.match(main, /\.frame\(maxWidth: \.infinity, minHeight: 44\)/)
  assert.match(main, /native-ios-files-section-/)
  assert.match(main, /\.accessibilityValue\(quickSection == option \? "已选择" : "未选择"\)/)
})

test('the real Files/Mine/Gallery tab-oscillation XCTest remains mandatory', () => {
  assert.match(nav, /func testAlternatingGalleryFilesSettledFramesAcrossThreeTabs\(\)/)
  assert.match(nav, /select\("native-ios-tab-files", in: app\)/)
  assert.match(nav, /select\("native-ios-tab-mine", in: app\)/)
  assert.match(nav, /checkFilesHome\(app\)/)
  assert.match(nav, /Files quick rail disappeared/)
})
