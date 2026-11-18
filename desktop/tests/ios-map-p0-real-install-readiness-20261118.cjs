'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, '../../.github/workflows/ios-mapkit-p0-real-gps-scale.yml'), 'utf8'
)

test('a real installed app is launchable before running independent PhotoKit GPS XCTest', () => {
  const setup = source.slice(source.indexOf('      - name: Build and install real native app for baseline'),
                             source.indexOf('      - name: Real PhotoKit baseline with explicit user Full Access'))
  assert.match(setup, /xcrun simctl install "\$MAP_P0_SIM" "\$app"/)
  assert.match(setup, /for attempt in 1 2 3 4 5 6; do/)
  assert.match(setup, /xcrun simctl launch "\$MAP_P0_SIM" com\.lazyxu\.xdrive\.ios/)
  assert.match(setup, /\*"is installing or uninstalling"\*/)
  assert.match(setup, /xcrun simctl terminate "\$MAP_P0_SIM" com\.lazyxu\.xdrive\.ios/)
  assert.match(setup, /if \[\[ "\$ready" != 1 \]\]; then[\s\S]*?exit 1/)
  assert.match(setup, /xcrun simctl privacy "\$MAP_P0_SIM" reset all com\.lazyxu\.xdrive\.ios/)
  assert.ok(setup.indexOf('xcrun simctl privacy') > setup.indexOf('MAP_P0_REAL_APP_INSTALL_READY'))
  assert.doesNotMatch(setup, /simctl privacy .* grant|continue-on-error|exit 0 #|fake|skip/)
})
test('the real Full Access, independent GPS count and 100k branches stay required', () => {
  assert.match(source, /-only-testing:xDriveIOSNavigationUITests\/XDriveIOSMapNavigationRuntimeUITests\/testP0RealPhotoKitIndependentGPSCountMatchesCurrentMap/)
  assert.match(source, /MAP_P0_COUNT/)
  assert.match(source, /import_real_gps_photos\.py/)
  assert.match(source, /MAP_P0_GENUINE_PHOTOKIT_DELTA/)
  assert.match(source, /--count "\$MAP_P0_COUNT"/)
})
