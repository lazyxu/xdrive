'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('fresh MapKit PhotoKit import retries only an isolated erased simulator and still fails closed', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname,
    '../../.github/workflows/ios-native-navigation-runtime.yml'), 'utf8')
  const seed = workflow.split('      - name: Seed two independent real GPS PhotoKit samples')[1]
    ?.split('      - name: Install candidate and reset Photos for system authorization prompt')[0]
  assert.ok(seed, 'real GPS PhotoKit seed gate must be present')
  for (const required of [
    "matrix.source == 'candidate-mapkit'",
    'test "$SMOKE_SIM" = "$MAPKIT_CREATED_SIM"',
    'for attempt in 1 2 3; do',
    'xcrun simctl addmedia "$SMOKE_SIM"',
    'synthetic-gps-map.jpg',
    'synthetic-gps-map-second.jpg',
    'xcrun simctl shutdown "$SMOKE_SIM"',
    'xcrun simctl erase "$SMOKE_SIM"',
    'xcrun simctl boot "$SMOKE_SIM"',
    '"bootstatus",os.environ["SMOKE_SIM"],"-b"',
    'timeout=240,check=True',
    'if [[ "$attempt" -eq 3 ]]; then',
    'exit 1',
  ]) assert.ok(seed.includes(required), 'missing fail-closed fresh PhotoKit gate: ' + required)
  assert.ok(!seed.includes('continue-on-error') && !seed.includes('|| true') &&
    !seed.includes('simctl privacy grant'), 'PhotoKit import must not be waived or faked')
})

test('PhotoKit Viewer return and scene retirement use real GPS-seeded MapKit media', () => {
  const map = fs.readFileSync(path.resolve(__dirname,
    '../../ios/UITests/XDriveIOSMapNavigationRuntimeUITests.swift'), 'utf8')
  const watcher = fs.readFileSync(path.resolve(__dirname,
    '../../ios/scripts/capture-navigation-smoke-frames.py'), 'utf8')
  for (const name of [
    'testBRealPhotoKitViewerFilesGalleryReturnRemainsMounted',
    'testCRealPhotoKitViewerBackgroundRetiresOldSheet',
  ]) {
    assert.ok(map.includes('func ' + name + '()'), 'Missing seeded PhotoKit Viewer journey: ' + name)
    assert.ok(watcher.includes('"' + name + '"'), 'Missing Viewer screenshot registration: ' + name)
  }
  assert.match(map, /private func openRealSeededPhotoViewer\(_ app: XCUIApplication\)/)
  assert.match(map, /native-ios-map-photo-wall-tile/)
  assert.match(map, /native-ios-local-viewer-back/)
  assert.match(map, /native-ios-files-section-browse/)
  assert.match(map, /XCUIDevice\.shared\.press\(\.home\)/)
  assert.match(map, /XCTAssertGreaterThan\(colors\.count, 8/)
  assert.doesNotMatch(map, /mockPhotoKit|fakeToken|simctl privacy grant/)
})
