'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const browser = read('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const ui = read('ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift')

test('cloud Home routes a synthetic or missing Session to the bounded read-only error page before mounting a Reader', () => {
  const start = browser.indexOf('private var filesHome: some View')
  const end = browser.indexOf('Section("个人收藏文件夹")', start)
  assert.ok(start >= 0 && end > start)
  const home = browser.slice(start, end)
  assert.match(home,
    /NavigationLink\s*\{[\s\S]*?if login\.hasLocalOwnerSession\s*\{\s*XDriveIOSNativeFilesBrowser\([\s\S]*?folderID: owner\.rootNodeID,[\s\S]*?folderName: "xDrive 云端"\s*\)\s*\} else \{\s*XDriveIOSNativeFilesNoSessionRoute\(kind: \.cloud\)\s*\}/)
  assert.match(home, /\.accessibilityIdentifier\("native-ios-files-open-root-location"\)/)
  const noSession = browser.slice(browser.indexOf('struct XDriveIOSNativeFilesNoSessionRoute: View'))
  assert.match(noSession, /case \.cloud: return "native-ios-files-error-page"/)
  assert.match(noSession, /case \.cloud: return "native-ios-files-error-return"/)
  assert.match(noSession, /case \.cloud: return "native-ios-files-cloud-no-session"/)
  assert.match(noSession, /\.accessibilityIdentifier\(errorPageID\)/)
  assert.doesNotMatch(noSession, /model\.load\(|URLSession|Reader|fetch\(/)
})

test('actual no-Session XCUITest verifies the cloud denial before Favorites and Gallery, retaining its strict child return', () => {
  const scenario = ui.slice(
    ui.indexOf('func testFavoritesAfterCloudDeniedKeepsGalleryMounted()'),
    ui.indexOf('func testRecentFavoritesQuickRailDeniedThenAlbumsRemainUsable()')
  )
  assert.match(scenario, /tap\("native-ios-files-open-root-location", app\)/)
  assert.match(scenario, /expect\("native-ios-files-cloud-no-session", app\)/)
  assert.match(scenario, /expect\("native-ios-files-error-page", app\)/)
  assert.match(scenario, /tap\("native-ios-files-error-return", app\)/)
  assert.match(scenario, /expect\("native-ios-files-favorites-error-page", app\)/)
  assert.match(scenario, /expect\("native-ios-gallery-source-unified", app\)/)
})
