'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = name => fs.readFileSync(path.join(__dirname, '../../ios/XDriveIOS', name + '.swift'), 'utf8')
const dashboard = read('NativePhotosDashboard')
const gallery = read('NativeUnifiedPhotoGallery')
const wall = read('NativeUnifiedPhotoWall')
const ui = fs.readFileSync(path.join(__dirname,
  '../../ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift'), 'utf8')

test('TabView explicitly tells unified Gallery whether it is foreground-selected', () => {
  assert.match(dashboard, /case \.unified:[\s\S]*?XDriveIOSNativeUnifiedPhotoGallery\([\s\S]*?isTabActive: tab == \.gallery/)
  assert.match(gallery, /let isTabActive: Bool/)
})

test('native Gallery never starts hidden-tab thumbnail reads', () => {
  assert.match(gallery, /displayActive: selected == nil && phase == \.active && isTabActive/)
  assert.match(gallery, /if displayActive,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, presentingOwner\)/)
})

test('covered tab retains its same bounded verified photo wall while visible Gallery scroll evicts', () => {
  assert.match(gallery, /retainWhileCovered: selected != nil \|\|[\s\S]*?showingPeople \|\| showingThumbnailCache \|\|[\s\S]*?phase != \.active \|\| !isTabActive/)
  assert.match(wall, /\.onDisappear \{\s*visible = false\s*if !retainWhileCovered \{[\s\S]*?model\.reset\(\)/)
})

test('tab return does not bypass Owner, PhotoKit epoch, or permission revalidation', () => {
  assert.match(gallery, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?reset\(\)/)
  assert.match(gallery, /private func validateForegroundWall\(\) \{[\s\S]*?PHPhotoLibrary\.authorizationStatus/)
  assert.match(gallery, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(\$0\)/)
  assert.match(gallery, /if XDriveIOSUnifiedGalleryScenePolicy\.requiresResetOnReturn\(/)
})

test('seven distinct real Gallery/Files journeys assert generation AND nonblank pixels', () => {
  const cases = [
    'testUnifiedWallGenerationPersistsThroughSixFilesTabRoundTrips',
    'testUnifiedWallGenerationPersistsAfterRecentFavoritesBrowseNavigation',
    'testUnifiedWallGenerationPersistsAfterFilterCancelAndFilesReturn',
    'testUnifiedWallGenerationPersistsAfterPeopleChildAndFilesReturn',
    'testUnifiedWallGenerationPersistsAfterBackgroundAndFilesReturn',
    'testUnifiedWallGenerationPersistsAfterFilesSearchSubmitAndReturn',
    'testUnifiedWallGenerationPersistsAfterDeniedCloudChildAndReturn'
  ]
  const frameWatcher = fs.readFileSync(path.join(__dirname,
    '../../ios/scripts/capture-navigation-smoke-frames.py'), 'utf8')
  const tapTargets = frameWatcher.slice(frameWatcher.indexOf('NAV_TARGETS = {'),
    frameWatcher.indexOf('TARGETS.update(NAV_TARGETS)'))
  for (const name of cases) {
    assert.match(ui, new RegExp('func ' + name + '\\(\\)'))
    assert.ok(tapTargets.includes('"' + name + '"'),
      'The real Simulator must capture tap-adjacent frames for ' + name)
  }
  assert.match(ui, /XCTAssertEqual\(verifiedUnifiedGeneration\(app\), before/)
  assert.match(ui, /assertNotSolidScreen\(app, label\)/)
  assert.match(ui, /UUID\(uuidString: value\) != nil/)
})

test('test cases are genuinely part of the current native candidate-gallery-files shard', () => {
  const workflow = fs.readFileSync(path.join(__dirname,
    '../../.github/workflows/ios-native-navigation-runtime.yml'), 'utf8')
  assert.match(workflow, /candidate-gallery-files\)[\s\S]*?XDriveIOSGalleryFilesStabilityUITests/)
  assert.doesNotMatch(ui, /ZERO_FLICKER_PASS|FPS=60|FPS=120/)
})
