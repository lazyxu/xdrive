'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const gallery = read('ios/XDriveIOS/NativeUnifiedPhotoGallery.swift')
const policy = read('ios/XDriveIOS/NativeUnifiedGalleryScenePolicy.swift')
const swiftTests = read('ios/tests/NativeUnifiedGalleryScenePolicyChecks.swift')
const ui = read('ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift')
const workflow = read('.github/workflows/ios-unsigned-ipa.yml')
const part = (from, to) => {
  const a = gallery.indexOf(from)
  const b = gallery.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, 'Missing Gallery lifecycle: ' + from)
  return gallery.slice(a, b)
}

test('unchanged foreground activation calls a verified policy instead of blindly resetting the wall', () => {
  const phase = part('.onChange(of: phase) { state in', '.sheet(isPresented: $showFilters)')
  assert.match(phase, /if state == \.active \{\s*[\s\S]*?validateForegroundWall\(\)/)
  assert.doesNotMatch(phase, /timeline\.reset\(\)|wall\.reset\(\)/)
  const appear = part('.onAppear {', '.onDisappear {')
  assert.match(appear, /if !started \{\s*started = true\s*wall\.reset\(\)\s*\} else \{\s*validateForegroundWall\(\)/)
})

test('scene policy refuses old local pixels on a changed PhotoKit permission', () => {
  assert.match(policy, /if permissionChanged \{ return true \}/)
  assert.match(gallery, /let grantChanged = currentGrant != permission/)
  assert.match(gallery, /permissionChanged: grantChanged/)
  assert.match(swiftTests, /reset\(changed: true\)/)
  assert.match(swiftTests, /reset\(changed: true, local: false\)/)
})

test('an unchanged authorized PhotoKit epoch is reused without a rescan', () => {
  assert.match(policy, /return !hasEpoch \|\| !epochCurrent/)
  assert.match(gallery, /let epoch = wall\.library/)
  assert.match(gallery, /XDriveIOSNativePhotoFingerprintIndex\.isCurrent\(\$0\)/)
  assert.match(gallery, /hasEpoch: epoch != nil,\s*epochCurrent: currentEpoch/)
  assert.match(swiftTests, /precondition\(!reset\(\)/)
})

test('changed PhotoKit epoch and missing authorized epoch force safe invalidation', () => {
  assert.match(swiftTests, /reset\(epoch: true, current: false\)/)
  assert.match(swiftTests, /reset\(local: true, epoch: false\)/)
  assert.match(gallery, /if XDriveIOSUnifiedGalleryScenePolicy\.requiresResetOnReturn\([\s\S]*?\) \{\s*reset\(\)/)
})

test('same denied PhotoKit grant leaves safe cloud-only wall mounted', () => {
  assert.match(policy, /if !localAccessGranted \{ return false \}/)
  assert.match(swiftTests, /!reset\(local: false, epoch: false, current: false\)/)
  assert.match(swiftTests, /!reset\(local: false, epoch: true, current: false\)/)
})

test('Owner switch and true PhotoKit mutations still immediately retire the wall', () => {
  assert.match(gallery, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?sourceFilter = nil; query = \.init\(\); draft = \.init\(\); reset\(\)/)
  assert.match(gallery, /\.onChange\(of: photoObserver\.change\) \{ _ in reset\(\) \}/)
})

test('leaving foreground cancels old audits and Viewer but never replaces the wall generation', () => {
  const phase = part('.onChange(of: phase) { state in', '.sheet(isPresented: $showFilters)')
  assert.match(phase, /explicitOriginalAudit = false\s*selected = nil\s*indexRequest = UUID\(\)/)
  assert.doesNotMatch(phase, /wall\.reset\(\)|timeline\.reset\(\)/)
})

test('inactive photos hide pixels but keep exact verified Owner and media cache identity', () => {
  assert.match(gallery, /if displayActive,\s*XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, presentingOwner\),\s*retainedKey == thumbnailKey/)
  assert.match(gallery, /retainWhileCovered: selected != nil \|\|[\s\S]*showingPeople \|\| showingThumbnailCache \|\|\s*phase != \.active/)
  assert.match(gallery, /retainedKey != key \|\| !ownerValid/)
})

test('new native XCTest measures the same wall generation before and after background activation', () => {
  assert.match(gallery, /\.accessibilityValue\(galleryWallGenerationDiagnostic\)/)
  assert.match(gallery, /#if DEBUG[\s\S]*return wall\.generation\.uuidString/)
  assert.match(ui, /func testGalleryUnchangedForegroundRetainsVerifiedWallGeneration\(\)/)
  assert.match(ui, /XCTAssertEqual\(gallery\.value as\? String, before,/)
  assert.match(ui, /assertNotSolidScreen\(app, "Gallery after unchanged PhotoKit foreground return"\)/)
})

test('new regression remains a real IPA preflight and source check, not a fake FPS claim', () => {
  assert.match(workflow, /Verify native unified Gallery foreground page retention/)
  assert.match(workflow, /ios\/XDriveIOS\/NativeUnifiedGalleryScenePolicy\.swift/)
  assert.match(workflow, /ios\/tests\/NativeUnifiedGalleryScenePolicyChecks\.swift/)
  assert.match(workflow, /node --test desktop\/tests\/ios-native-gallery-scene-continuity\.cjs/)
  assert.doesNotMatch(ui, /ZERO_FLICKER_PASS|FPS=60|FPS=120/)
})
