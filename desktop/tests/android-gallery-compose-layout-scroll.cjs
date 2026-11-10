'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const gallery = fs.readFileSync(path.join(root,
  'android/app/src/main/java/com/tfluid/xdrive/GalleryScreens.kt'), 'utf8')
const realUI = fs.readFileSync(path.join(root,
  'android/app/src/androidTest/java/com/tfluid/xdrive/DriveAppTest.kt'), 'utf8')
const start = gallery.indexOf('    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().testTag("gallery-wall"))')
const end = gallery.indexOf('        LazyVerticalGrid(', start)
const body = gallery.slice(start, end)

test('Android Gallery initial index jump resumes after BoxWithConstraints layout frame', () => {
  assert.ok(start >= 0 && end > start)
  assert.match(gallery, /import kotlinx\.coroutines\.android\.awaitFrame/)
  assert.match(body, /if \(state\.galleryJumpIndex != null\) \{[\s\S]*?awaitFrame\(\)\s*gridState\.scrollToItem\(if \(blankTop > 0\.dp\) 1 else 0\)/)
  assert.match(body, /val first = if \(state\.gallerySortDir == "desc"\) 0[\s\S]*?awaitFrame\(\)\s*gridState\.scrollToItem\(first\)/)
})

test('Android Gallery Viewer return checks identity again after the next layout frame', () => {
  assert.match(body, /if \(gridState\.layoutInfo\.visibleItemsInfo\.none \{ it\.key == id \}\) \{[\s\S]*?awaitFrame\(\)\s*if \(gridState\.layoutInfo\.visibleItemsInfo\.none \{ it\.key == id \}\) \{\s*gridState\.scrollToItem\(returnIndex/)
  assert.match(body, /nativeCloudViewerReturnIndex\(/)
  assert.match(body, /state\.gallerySelectedAlbum,\s*state\.gallerySearchQuery/)
})

test('real Android Compose kind-filter and sort UI tests still enforce verified Server state', () => {
  assert.match(realUI, /@Test fun nativeGalleryKindFilterUsesServerAndResetsPositionOnChangedScope\(\)/)
  assert.match(realUI, /galleryMediaKind == "video"/)
  assert.match(realUI, /gallerySearchQuery == "sunset"/)
  assert.match(realUI, /@Test fun nativeGallerySortUsesOwnerRangeAndRestoresChronologicalDefault\(\)/)
  assert.equal((body.match(/gridState\.scrollToItem\(/g) || []).length, 3)
})
