'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const albums = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')

test('PhotoKit viewer returns to same 64-item page after fresh permission check', () => {
  const wall = local.slice(local.indexOf('struct XDriveIOSNativeLocalGalleryScreen'))
  assert.match(wall, /@State private var savedOffset = 0/)
  assert.match(wall, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/)
  assert.match(wall, /if selected == nil && page == nil && !busy \{ refresh\(at: savedOffset\) \}/)
  assert.match(wall, /if phase == \.active \{ refresh\(at: savedOffset\) \}/)
  assert.match(wall, /load\(offset: max\(0, requestedOffset\)\)/)
  assert.match(wall, /savedOffset = next\.startOffset/)
  assert.match(wall, /if selected != nil \{ suspendForViewer\(\) \}/)
  const phase = wall.slice(wall.indexOf('.onChange(of: phase)'),
    wall.indexOf('.onDisappear', wall.indexOf('.onChange(of: phase)')))
  assert.match(phase, /if new != \.active \{\s*if selected != nil \{[\s\S]*?accessibilityFocusedTileID = nil[\s\S]*?suspendForViewer\(\)\s*page = nil/)
  assert.match(phase, /else \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)\s*\}\s*\} else if selected != nil/)
  assert.match(phase, /if authorization != \.authorized && authorization != \.limited \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)/)
  assert.match(phase, /\} else \{\s*refresh\(at: savedOffset\)\s*\}/)
  assert.doesNotMatch(phase.slice(phase.indexOf('if selected != nil {'),
    phase.indexOf('} else {', phase.indexOf('if selected != nil {'))),
    /selected = nil|viewerReturnID = nil|clearViewerTileAnchor\(\)|invalidate\(\)/)
})

test('album viewer return revalidates the same album and last confirmed offset', () => {
  const wall = albums.slice(albums.indexOf('struct XDriveIOSNativeAlbumContentsScreen'),
    albums.indexOf('struct XDriveIOSNativePhotoAlbumsScreen'))
  assert.match(wall, /@State private var savedOffset = 0/)
  assert.match(wall, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/)
  assert.match(wall, /if selected == nil && page == nil && !loading \{ reload\(\) \}/)
  assert.match(wall, /if phase == \.active \{ reload\(\) \}/)
  assert.match(wall, /load\(offset: savedOffset\)/)
  assert.match(wall, /savedOffset = page\.startOffset/)
  assert.match(wall, /if selected != nil \{ suspendForViewer\(\) \}/)
  assert.match(wall, /\.onChange\(of: libraryMonitor\.revision\)/)
  const phase = wall.slice(wall.indexOf('.onChange(of: phase)'),
    wall.indexOf('.onDisappear', wall.indexOf('.onChange(of: phase)')))
  assert.match(phase, /if state != \.active \{\s*if selected != nil \{[\s\S]*?accessibilityFocusedTileID = nil[\s\S]*?suspendForViewer\(\)\s*page = nil/)
  assert.match(phase, /else \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)\s*\}\s*\} else if selected != nil/)
  assert.match(phase, /if permission != \.authorized && permission != \.limited \{\s*clearViewerTileAnchor\(\)\s*invalidate\(\)/)
  assert.match(phase, /\} else \{\s*reload\(\)\s*\}/)
  assert.doesNotMatch(phase.slice(phase.indexOf('if selected != nil {'),
    phase.indexOf('} else {', phase.indexOf('if selected != nil {'))),
    /selected = nil|viewerReturnID = nil|clearViewerTileAnchor\(\)|invalidate\(\)/)
  assert.match(albums, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
})

test('Owner-specific cloud Viewer retains modal state but clears stale previews', () => {
  assert.match(cloud, /\.fullScreenCover\(item: \$selected, onDismiss: \{/)
  assert.match(cloud, /if selected == nil \{\s*refreshAfterViewer = false\s*model\.invalidate\(\)/)
  assert.match(cloud, /if refreshAfterViewer \{\s*refreshAfterViewer = false\s*model\.reload\(login: login\)/)
  const ownerChangeStart = cloud.lastIndexOf('.onChange(of: login.owner) { _ in')
  assert.ok(ownerChangeStart >= 0)
  const ownerChanged = cloud.slice(ownerChangeStart)
  assert.match(ownerChanged, /refreshAfterViewer = false\s*selected = nil\s*model\.invalidate\(\)/)
  assert.match(cloud, /player\?\.pause\(\)[\s\S]*still = nil[\s\S]*dismiss\(\)/)
  assert.doesNotMatch(local + albums, /UserDefaults\.standard|URLSession\(|UploadSession|WKWebView/)
})
