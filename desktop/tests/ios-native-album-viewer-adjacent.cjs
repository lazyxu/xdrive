'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const album = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoAlbumBrowser.swift'), 'utf8')
const viewer = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativeLocalPhotoGallery.swift'), 'utf8')
const timeline = fs.readFileSync(path.join(root, 'ios/XDriveIOS/NativePhotoTimelinePolicy.swift'), 'utf8')
const actor = album.slice(
  album.indexOf('actor XDriveIOSNativeAlbumPageReader'),
  album.indexOf('/// Visible album-cover cells')
)
const contents = album.slice(
  album.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
  album.indexOf('/// existing 32-at-a-time')
)

test('native album Viewer shares the tested one-neighbor callback, not a full album cache', () => {
  assert.match(viewer, /var onCrossPage: \(\(/)
  assert.match(viewer, /var onCrossedPage: \(\(XDrivePhotoKitScanCandidate, XDrivePhotoKitScanPage\)/)
  assert.match(contents, /loadedPage: viewerPage \?\? page/)
  assert.match(contents, /onCrossPage: \{ oldPage, anchor, direction in/)
  assert.match(contents, /let adjacentReader = XDriveIOSNativeAlbumPageReader\(\)/)
  assert.match(contents, /try await adjacentReader\.open\(album\)/)
  assert.match(contents, /adjacentReader\.adjacentPage\(/)
  assert.match(contents, /await adjacentReader\.reset\(\)/)
  assert.match(contents, /onCrossedPage: \{ next, verifiedPage in/)
  assert.match(timeline, /static func adjacentOffset\(current: Int, total: Int, direction: Int\)/)
  assert.doesNotMatch(actor, /UploadSession|NativePhotoBackup|UserDefaults|PhotoSyncEncryptedLedger/)
})

test('album cursor validates all 64 original members, exact edge, and bounded adjacent page', () => {
  assert.match(actor, /func adjacentPage\(/)
  assert.match(actor, /try verify\(permission\)/)
  assert.match(actor, /current\.totalAccessibleAssets == total/)
  assert.match(actor, /current\.limitedAuthorization == \(permission == \.limited\)/)
  assert.match(actor, /current\.startOffset % 64 == 0/)
  assert.match(actor, /current\.items\.count == min\(64, total - current\.startOffset\)/)
  assert.match(actor, /current\.nextOffset == current\.startOffset \+ current\.items\.count/)
  assert.match(actor, /Self\.sameCandidate\(edge, selected\)/)
  assert.match(actor, /for \(index, expected\) in current\.items\.enumerated\(\)/)
  for (const guard of [
    'asset.localIdentifier == expected.id',
    'asset.creationDate == expected.capturedAt',
    'asset.modificationDate == expected.modifiedAt',
    'kind == expected.kind',
    'expected.isLive == (kind == "image" &&'
  ]) assert.ok(actor.includes(guard), 'missing per-member epoch/identity check: ' + guard)
  assert.match(actor, /XDriveIOSNativePhotoVirtualPagePolicy\.adjacentOffset\(/)
  assert.match(actor, /let neighbor = try page\(offset: offset\)/)
  assert.match(actor, /Do not silently skip an all-unsupported album page/)
})

test('album viewer returns exact last-viewed tile on the crossed page, then forgets it', () => {
  assert.match(contents, /@State private var viewerPage: XDrivePhotoKitScanPage\?/)
  assert.match(contents, /viewerPage = page[\s\S]*?selected = item/)
  assert.match(contents, /viewerPage\?\.items\.contains\(where:/)
  assert.match(contents, /viewerPage = verifiedPage\s+savedOffset = verifiedPage\.startOffset\s+viewerReturnID = next\.id/)
  assert.match(contents, /private func restoreAfterViewer\(\) \{\s*viewerPage = nil/)
  assert.match(contents, /private func invalidate\(\) \{[\s\S]*?viewerPage = nil/)
  assert.match(contents, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.target\(/)
  assert.match(contents, /scroll\.scrollTo\(target, anchor: \.center\)/)
  assert.doesNotMatch(contents, /savedAssetIDs|persist.*localIdentifier|sendPhotoKitIDs/)
})

test('album cursor stays inside same named PhotoKit collection and authorized generation', () => {
  assert.match(actor, /fetchAssetCollections\(\s*withLocalIdentifiers: \[album\.collectionIdentifier\]/)
  assert.match(actor, /currentName == album\.name, kind == album\.kind/)
  assert.match(actor, /PHAsset\.fetchAssets\(in: collection, options: options\)/)
  assert.match(actor, /observer\.current\(\) == version/)
  assert.match(actor, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == status/)
  assert.match(contents, /guard phase == \.active, selected\?\.id == initial\.id/)
  assert.match(contents, /\.onChange\(of: libraryMonitor\.revision\)/)
  assert.match(contents, /\.onChange\(of: phase\)/)
})
