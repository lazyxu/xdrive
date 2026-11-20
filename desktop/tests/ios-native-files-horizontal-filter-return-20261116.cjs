'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const source = name => fs.readFileSync(path.join(root, name), 'utf8')
const browse = source('ios/XDriveIOS/NativeCloudFilesBrowser.swift')
const perf = source('ios/UITests/XDriveIOSNativeSubpagePerformanceUITests.swift')
const swift = source('ios/UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift')
const video = source('ios/scripts/files_ui_transition_video.py')
const still = source('ios/scripts/capture-navigation-smoke-frames.py')
const workflow = source('.github/workflows/ios-native-navigation-runtime.yml')
const paths = ["testFilesSizeFilterHorizontalGalleryReturn","testFilesDateThenSizeFiltersKeepNoSessionGuard","testFilesSizeFilterAfterQuickRailReentry","testFilesSizeFilterAfterSavedSearchesDismiss","testFilesSizeFilterAfterCloudDenialReturn","testFilesSizeFilterAfterForegroundResume"]
test('actual native filter strip scrolls horizontally and is used by the 50-route suite', () => {
  assert.match(browse, /ScrollView\(\.horizontal, showsIndicators: false\)/)
  assert.match(browse, /native-ios-files-filter-strip/)
  // All three filters share the real staging branch. An earlier two-filter
  // string silently returned an empty slice after the kind route was added.
  const start = perf.indexOf('case "files.search.date", "files.search.size", "files.search.kind":')
  const end = perf.indexOf('case "files.home.more-organizer":', start)
  assert.ok(start >= 0 && end > start, 'Missing actual shared Files filter staging branch')
  const stage = perf.slice(start, end)
  assert.match(stage, /let id = filesSearchFilterID\(route\)/)
  assert.match(stage, /strip\.swipeLeft\(\)/)
  assert.match(perf, /case "files\.search\.size": return "native-ios-files-search-size-filter"/)
})
test('six independent native Gallery/Files filter journeys are captured by strict H264 and screenshot registries', () => {
  for (const name of paths) {
    const pos = swift.indexOf('func ' + name + '()')
    assert.ok(pos > 0, 'Missing actual XCTest: ' + name)
    const end = swift.indexOf('\n    func test', pos + 5)
    const body = swift.slice(pos, end > 0 ? end : undefined)
    assert.match(body, /waitForRealH264RecordingPrelude\(\)/)
    assert.match(body, /native-ios-tab-files/)
    assert.match(body, /native-ios-tab-gallery/)
    assert.match(body, /assertVisiblePixels\(app,/)
    assert.ok(video.includes('"' + name + '"'), 'Missing H264 target: ' + name)
    assert.ok(still.includes('"' + name + '"'), 'Missing frame target: ' + name)
  }
  // The real Files header is lazy; a sheet return may retain a deep List offset.
  assert.match(swift, /let host: XCUIElement = table\.exists/)
  assert.match(swift, /host\.swipeDown\(\)/)
  assert.match(swift, /strip\.exists && strip\.isHittable/)
  assert.match(workflow, /--minimum 18/)
  assert.match(video, /physical_60_120_hz_verified": False/)
})
