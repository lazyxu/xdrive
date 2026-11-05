'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const legacy = read('ios/XDriveIOS/NativeLocalPhotoTimeline.swift')
const inventory = read('ios/XDriveIOS/LocalPhotoInventoryScreen.swift')
const preview = read('ios/XDriveIOS/PhotoKitScanPreviewScreen.swift')
const timeline = read('ios/XDriveIOS/NativePhotoTimelineBrowser.swift')
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const local = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')

test('all reachable iOS Photos lists are continuous and legacy date entry reuses canonical wall', () => {
  assert.match(dashboard, /case \.local:\s*XDriveIOSNativeLocalPhotoTimelineContainer\(/)
  assert.match(legacy, /XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$savedOffset,\s*mediaFilter: \$mediaFilter/)
  assert.doesNotMatch(legacy, /上一页|下一页|XDriveIOSNativeTimelineReader|当前范围/)
  assert.match(timeline, /XDriveIOSNativeLocalContinuousGalleryScreen\(/)
  assert.match(albums, /continueDirectoryIfReady\(\)/)
  assert.match(local, /XDriveIOSNativePhotoVirtualPagePolicy\.pageCount\(total: total\)/)
  for (const code of [inventory, preview, timeline, albums, local]) {
    assert.doesNotMatch(code, /Button\("上一页"\)|Button\("下一页"\)|Button\("继续检查下一批/)
  }
})

test('inventory opens canonical continuous album directory, not its own manual pager', () => {
  assert.match(inventory, /NavigationLink \{\s*XDriveIOSNativePhotoAlbumsScreen\(\s*savedOffset: \$albumDirectoryOffset/)
  assert.match(inventory, /native-photo-inventory-albums-continuous/)
  assert.doesNotMatch(inventory, /\balbumPage\b|\balbumLoading\b|loadAlbumPage\(/)
})

test('read-only scanner preview lazy-mounts bounded pages and rejects stale generations', () => {
  assert.match(preview, /private struct XDriveIOSNativeScanPreviewWindow: View/)
  assert.match(preview, /ScrollView \{\s*LazyVStack/)
  assert.match(preview, /XDriveIOSNativePhotoVirtualPagePolicy\.pageCount\(/)
  assert.match(preview, /current\.start\(atOffset: offset\)/)
  assert.match(preview, /next\.startOffset == offset/)
  assert.match(preview, /next\.totalAccessibleAssets == expectedTotal/)
  assert.match(preview, /next\.items\.count == next\.nextOffset - offset/)
  assert.match(preview, /\.task\(id: "\\\(generation\)-\\\(offset\)"\)/)
  assert.match(preview, /\.onDisappear \{\s*page = nil\s*if let scanner/)
  assert.match(preview, /generation == staleGeneration/)
  assert.match(preview, /photoLibraryDidChange\(_ change: PHChange\)/)
  assert.match(preview, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.doesNotMatch(preview, /URLSession|UploadSession|stageOriginal|requestImage|requestAVAsset|requestLivePhoto/)
})
