'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = f => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoMap.swift')
const cloud = read('ios/XDriveIOS/NativeOwnerPhotoMapGallery.swift')
const spatial = read('ios/XDriveIOS/NativeLocalPhotoMapSpatialPolicy.swift')
const ui = read('ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift')
const workflow = read('.github/workflows/ios-native-navigation-runtime.yml')
const scale = read('.github/workflows/ios-mapkit-p0-real-gps-scale.yml')
const script = read('ios/scripts/generate-mapkit-p0-gps-fixtures.py')

test('P0-1 failed PhotoKit refinement retains inert old MapKit annotation and revokes Full Access loss', () => {
  assert.match(local, /@State private var refinementFailureRequiresRefresh = false/)
  assert.match(local, /if live != \.authorized \{[\s\S]*?authorization = live[\s\S]*?invalidate\(\)/)
  assert.match(local, /if keepOldMap \{[\s\S]*?globalCameraMoving = true\s*refinementFailureRequiresRefresh = true/)
  assert.match(local, /guard !refinementFailureRequiresRefresh else \{ return false \}/)
  assert.match(local, /if !refinementFailureRequiresRefresh,\s*let cached = recentVerifiedWindows\.first/)
  assert.match(local, /cover\.isAccessibilityElement = canSelectCells/)
  assert.match(local, /cover\.accessibilityElementsHidden = !canSelectCells/)
})

test('P0-2 world-view or zoomed region disables stale aggregate before first camera callback', () => {
  assert.match(local, /cameraBoundCells: mapScope == \.library/)
  const coordinator = local.slice(local.indexOf('final class Coordinator: NSObject, MKMapViewDelegate'))
  assert.match(coordinator, /func mapView\(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool\)/)
  assert.match(coordinator, /if cameraBoundCells \{[\s\S]*?canSelectCells = false[\s\S]*?cover\.accessibilityElementsHidden = true/)
  assert.match(local, /onCameraWillChange: \{[\s\S]*?globalCameraMoving = true/)
  assert.match(local, /guard !XDriveIOSNativeLocalMapAutoRefinePolicy\.shouldRefine\(\s*visible, scanned: globalViewport/)
  assert.match(spatial, /static let settleNanoseconds: UInt64 = 900_000_000/)
})

test('P0-3 real PhotoKit independent GPS inventory and exact import delta do not pretend synthetic 100k is real', () => {
  assert.match(local, /private func runP0IndependentGPSAudit\(\)/)
  assert.match(local, /PHAsset\.fetchAssets\(with: PHFetchOptions\(\)\)/)
  assert.match(local, /independentlyLocated \+= 1/)
  assert.match(local, /native-ios-map-p0-independent-count/)
  assert.match(ui, /func testP0RealPhotoKitIndependentGPSCountMatchesCurrentMap\(\)/)
  assert.match(ui, /XCTAssertEqual\(real, indexed,/)
  assert.match(script, /choices=\(1, 10, 65, 1000, 10000, 100000\)/)
  assert.match(script, /exif_gps_segment\(latitude, longitude\)/)
  assert.match(script, /b"xDrive-map-P0:"/)
  assert.match(scale, /MAP_P0_GENUINE_PHOTOKIT_DELTA/)
  assert.match(scale, /if after-before!=wanted: raise SystemExit/)
  assert.match(scale, /workflow_dispatch:/)
  assert.match(scale, /'100000'/)
})

test('P0-4 every published Owner map is bound to the exact verified Owner, and HTTP 401/403 clears authority', () => {
  assert.match(cloud, /@State private var verifiedOverviewOwner: XDriveNativeOwnerRoot\?/)
  assert.match(cloud, /XDriveIOSNativePhotoOwnerScope\.matches\(\s*login\.owner, verifiedOverviewOwner\)/)
  const picked = cloud.slice(cloud.indexOf('onPlace: { item in'), cloud.indexOf('onAggregate: {'))
  assert.equal((picked.match(/XDriveIOSNativePhotoOwnerScope\.matches\(\s*expected, verifiedOverviewOwner\)/g) || []).length, 2)
  assert.match(cloud, /verifiedOverviewOwner = expected\s*displayedOverviewOwner = expected\s*verifiedBounds = bounds/)
  assert.match(cloud, /private var displayedOverviewMatchesLogin: Bool \{[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(/)
  assert.match(cloud, /overview:\s*displayedOverviewMatchesLogin \? overview : nil/)
  // UIKit must clear old Owner coordinates even when a SwiftUI Owner switch
  // reaches updateUIView before the onChange closure increments revision.
  const ownerUIView = cloud.slice(cloud.indexOf('func updateUIView(_ map: MKMapView, context: Context)'),
    cloud.indexOf('static func dismantleUIView(_ map: MKMapView'))
  assert.ok(ownerUIView.indexOf('if overview == nil {') > -1)
  assert.ok(ownerUIView.indexOf('map.removeAnnotations(map.annotations.filter') >
    ownerUIView.indexOf('if overview == nil {'))
  assert.ok(ownerUIView.indexOf('if overview == nil {') <
    ownerUIView.indexOf('guard context.coordinator.revision != revision'))
  assert.match(ownerUIView, /context\.coordinator\.revision = nil\s*return/)
  assert.match(cloud, /coverImages:\s*displayedOverviewMatchesLogin \? coverImages : \[:\]/)
  assert.match(cloud, /if let overview, displayedOverviewMatchesLogin/)
  assert.match(cloud, /displayedOverviewOwner = nil/)
  assert.match(cloud, /verifiedOverviewOwner = nil[\s\S]*?verifiedBounds = nil/)
  assert.match(cloud, /if case \.response\(let status\) = failure, status == 401 \|\| status == 403/)
  assert.match(cloud, /case \.revoked:[\s\S]*?group\.cancelAll\(\)[\s\S]*?invalidate\(\)/)
  assert.match(cloud, /guard epoch == ticket[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(auth\.owner, expected\)/)
})

test('P0-5 real Full, externally revoked Denied and system Limited remain distinct; no synthetic authorization', () => {
  assert.match(local, /authorization == \.limited \{/)
  assert.match(local, /authorization == \.denied \|\| authorization == \.restricted/)
  assert.match(local, /guard live == \.authorized else \{\s*recheckExplicitSettingsAuthorization\(\)\s*return\s*\}/)
  assert.match(ui, /func testZP0ExternallyRevokedPhotosRejectOldMapAndRecover\(\)/)
  assert.match(ui, /Limited Photos must be selectable on real Settings/)
  assert.match(ui, /readback\.label\.contains\("rw=4"\)/)
  assert.match(ui, /authorizeFullPhotosInSettings\(app\)/)
  assert.match(workflow, /simctl privacy "\$SMOKE_SIM" revoke photos com\.lazyxu\.xdrive\.ios/)
  assert.match(workflow, /-skip-testing:xDriveIOSNavigationUITests\/XDriveIOSMapNavigationRuntimeUITests\/testZP0ExternallyRevokedPhotosRejectOldMapAndRecover/)
  assert.match(workflow, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSMapNavigationRuntimeUITests\/testZP0ExternallyRevokedPhotosRejectOldMapAndRecover/)
  assert.doesNotMatch(ui, /PHAuthorizationStatus\(rawValue:|fakeAuthorized|bypassFullAccess/)
})

test('P0-6 real MapKit → place photo wall → Viewer → map ×3 keeps screenshots, return and crash gate', () => {
  assert.match(ui, /func testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted\(\)/)
  assert.match(ui, /for pass in 0\.\.<3/)
  assert.match(ui, /native-ios-map-photo-wall-tile/)
  assert.match(ui, /native-ios-local-viewer-back/)
  assert.match(ui, /native-ios-map-place-dismiss/)
  assert.match(ui, /p0-map-after-viewer-return-/)
  assert.match(ui, /map\.pinch\(withScale: 2\.5/)
  assert.match(ui, /XCTAssertEqual\(app\.state, \.runningForeground\)/)
  assert.match(workflow, /Reject candidate xDriveIOS process crash reports/)
  assert.match(workflow, /candidate-mapkit/)
})

test('P0 real Settings return may re-request Full Photos only after an explicit tap and never trusts stale TCC state', () => {
  assert.match(local, /@State private var explicitSettingsAuthorizationRecheck = false/)
  assert.match(local, /private func openPhotoSettings\(\)[\s\S]*?explicitSettingsAuthorizationRecheck = true[\s\S]*?UIApplication\.shared\.open\(url\)/)
  assert.match(local, /private func recheckExplicitSettingsAuthorization\(\)/)
  assert.match(local, /guard explicitSettingsAuthorizationRecheck, phase == \.active else \{ return \}/)
  assert.match(local, /guard status == \.denied \|\| status == \.notDetermined else \{ return \}/)
  assert.match(local, /await PHPhotoLibrary\.requestAuthorization\(for: \.readWrite\)/)
  assert.match(local, /guard phase == \.active, generation == ticket else \{ return \}/)
  assert.match(local, /guard live == \.authorized else \{[\s\S]*?invalidate\(\)[\s\S]*?return/)
  assert.match(local, /recheckExplicitSettingsAuthorization\(\)\s*return/)
  // iOS can terminate the app during a real Settings/TCC permission change.
  // A new Full-only prompt must be handled before the target app readback;
  // only a genuinely OS-stopped process is allowed to relaunch its map route.
  const selection = ui.indexOf('var systemRelaunched = resumeMapAfterSystemPhotosChange(')
  const prompt = ui.indexOf('handleInitialPhotoLibraryPromptIfPresent()', selection)
  const systemStop = ui.indexOf('if app.state == .notRunning {', prompt)
  const secondResume = ui.indexOf('resumeMapAfterSystemPhotosChange(', systemStop)
  const readback = ui.indexOf('recordActualPhotoKitReadback(app, stage: "after-settings")', secondResume)
  const mapGate = ui.indexOf('if !element("native-ios-full-library-gps-map"', readback)
  assert.ok(selection >= 0 && selection < prompt && prompt < systemStop &&
            systemStop < secondResume && secondResume < readback && readback < mapGate)
  assert.match(ui, /if app\.state != \.notRunning \{\s*app\.activate\(\)/)
  assert.match(ui, /The still-running app must resume immediately from Settings/)
  assert.match(ui, /A still-running app must mount real MapKit immediately on Settings return/)
  assert.match(ui, /No restart may be accepted as a substitute/)
  assert.doesNotMatch(ui, /fakeAuthorized|skipFullAccess|forceGrantPhotoKit/)
})


test('system Photos TCC termination preserves real app recovery and crash evidence', () => {
  const diagnoseStart = ui.indexOf('private func diagnose(')
  const resumeStart = ui.indexOf('private func resumeMapAfterSystemPhotosChange(')
  const settingsStart = ui.indexOf('private func authorizeFullPhotosInSettings(')
  const mapStart = ui.search(/private func openLocalMap\(\s*performance: Bool = false, stage: String = "scan"\s*\) -> XCUIApplication/)
  assert.ok(diagnoseStart >= 0 && resumeStart > diagnoseStart &&
            settingsStart > resumeStart && mapStart > settingsStart)
  const diagnostic = ui.slice(diagnoseStart, ui.indexOf('private func xDriveSettingsDetailVisible(', diagnoseStart))
  const resume = ui.slice(resumeStart, settingsStart)
  const settings = ui.slice(settingsStart, mapStart)
  // When TCC has terminated the app, XCTest screenshot() raises a second,
  // misleading error. Preserve original failure and external crash reports.
  assert.match(diagnostic, /if app\.state == \.runningForeground \{[\s\S]*?app\.screenshot\(\)/)
  assert.match(diagnostic, /MAP_ROUTE_DIAGNOSTIC_TARGET_NOT_FOREGROUND/)
  // An OS-terminated target is not the same as a live Settings return.
  assert.match(resume, /if app\.state != \.notRunning \{[\s\S]*?app\.activate\(\)[\s\S]*?return false/)
  assert.match(resume, /app\.launch\(\)[\s\S]*?native-ios-launcher-map[\s\S]*?native-ios-map-source-selector/)
  assert.match(resume, /handleInitialPhotoLibraryPromptIfPresent\(\)/)
  // Only actual Full Access may display MapKit. A live-app refresh failure
  // remains a failing XCTest, not a silently accepted test-driven restart.
  assert.match(settings, /var systemRelaunched = resumeMapAfterSystemPhotosChange\(/)
  assert.match(settings, /if app\.state == \.notRunning \{[\s\S]*?resumeMapAfterSystemPhotosChange\(/)
  assert.match(settings, /MAP_PHOTOS_FULL_ACCESS_REENTRY os_relaunch=/)
  assert.match(settings, /XCTFail\(systemRelaunched/)
  assert.match(settings, /native-ios-full-library-gps-map/)
  assert.doesNotMatch(resume + settings, /fakePhotoKit|fakeAuthorized|skipFullAccess|forceGrantPhotoKit/)
})
