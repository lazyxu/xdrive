'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

const view = read('ios/XDriveIOS/NativeServerMediaGallery.swift')
const transport = read('ios/XDriveIOS/NativeServerMediaGalleryTransport.swift')
const policy = read('ios/XDriveIOS/NativePhotoAssetRangeCursorPolicy.swift')
const preview = view.slice(view.indexOf('struct XDriveIOSNativeServerMediaPreview: View'),
  view.indexOf('/// Root and album-specific media wall'))
const wall = view.slice(view.indexOf('struct XDriveIOSNativeServerMediaWall: View'),
  view.indexOf('/// Server collection index is distinct'))
const model = view.slice(view.indexOf('final class XDriveIOSNativeMediaWallModel'),
  view.indexOf('/// Retire a tile'))
const reader = transport.slice(transport.indexOf('struct XDriveIOSNativeMediaGalleryReader'),
  transport.indexOf('/// Read-only native PhotoAsset Live playback.'))

test('bounded numeric cursor only permits first/last selected slot of a valid 48-page', () => {
  assert.match(policy, /static let pageSize = 48/)
  assert.match(policy, /static let maximumTotal = 10_000_000/)
  assert.match(policy, /offset % pageSize == 0/)
  assert.match(policy, /count == min\(pageSize, total - offset\)/)
  assert.match(policy, /selectedIndex == count - 1/)
  assert.match(policy, /selectedIndex == 0, current >= pageSize/)
  assert.match(preview, /XDriveIOSNativePhotoAssetRangeCursorPolicy\.adjacentOffset\(/)
  assert.doesNotMatch(policy, /URLSession|token|PhotoKit|NodeID|UploadSession|UserDefaults/)
})

test('current cloud range and media pairs require full version/membership equality', () => {
  for (const text of [
    'node.id == rhs.node.id', 'node.revision == rhs.node.revision',
    'node.name == rhs.node.name', 'node.type == rhs.node.type',
    'node.size == rhs.node.size', 'metadata.media_kind == rhs.metadata.media_kind',
    'metadata.container_kind == rhs.metadata.container_kind',
    'asset_kind == rhs.asset_kind', 'live_photo == rhs.live_photo',
    'resources == rhs.resources', 'total_count == rhs.total_count',
    'zip(items, rhs.items).allSatisfy'
  ]) assert.ok(transport.includes(text), 'missing cloud revision invariant: ' + text)
  assert.match(reader, /func page\(offset: Int, albumID: String\? = nil,/)
  assert.match(view, /previous\.sameVisibleSnapshot\(as: reread\)/)
  assert.match(view, /model\.page\?\.sameVisibleSnapshot\(as: previous\) == true/)
  assert.match(view, /XDriveIOSNativePhotoOwnerScope\.matches\(owner\.owner, opened\)/)
  assert.match(view, /Set\(next\.items\.map\(\\\.id\)\)\.count == next\.items\.count/)
})

test('cross-range requests retain exact album/place/search Owner without background writer', () => {
  assert.match(wall, /onCrossRange: \{ previous, anchor, direction in/)
  assert.match(wall, /selected\?\.id == initial\.id/)
  assert.match(wall, /viewerLoadedRange\?\.sameVisibleSnapshot\(as: previous\)/)
  assert.match(wall, /let owner = try await login\.verifiedAuthorization\(\)/)
  assert.match(wall, /offset: previous\.offset, albumID: album\?\.id,\s*placeID: placeID, search: appliedSearch/)
  assert.match(wall, /offset: targetOffset, albumID: album\?\.id,\s*placeID: placeID, search: appliedSearch/)
  assert.match(wall, /next\.total_count == previous\.total_count/)
  assert.match(wall, /next\.offset == targetOffset/)
  assert.match(wall, /onCrossedRange: \{ next, verifiedRange in/)
  assert.match(model, /func acceptVerifiedViewerRange\(/)
  assert.match(model, /pageAlbumID == albumID, pagePlaceID == placeID/)
  assert.match(model, /pageSearch == search, !busy/)
  assert.match(model, /existing\.sameVisibleSnapshot\(as: previous\)/)
  assert.match(model, /page = next/)
  assert.doesNotMatch(wall, /UploadSession|CASWriter|PhotoSyncEncryptedLedger|PHAssetChangeRequest/)
})

test('Viewer crossing revokes previous signed media and Photos restore before opening next', () => {
  assert.match(preview, /@State private var crossedRange: XDriveIOSNativeMediaRange\?/)
  assert.match(preview, /@State private var rangeCrossingEpoch = UUID\(\)/)
  assert.match(preview, /private func canCrossRange\(_ direction: Int\) -> Bool/)
  assert.match(preview, /private func crossRange\(_ direction: Int\)/)
  assert.match(preview, /let nextPage = try await onCrossRange\(previous, target, direction\)/)
  assert.match(preview, /visibleRange\?\.sameVisibleSnapshot\(as: previous\) == true/)
  assert.match(preview, /guard onCrossedRange\?\(next, nextPage\) == true/)
  assert.match(preview, /cancelPhotosRestore\(\)\s*retirePreview\(\)\s*crossedRange = nextPage\s*activeItem = next/)
  assert.match(preview, /if phase != \.active \{\s*showChrome = true\s*cancelRangeCrossing\(\)\s*\}/)
  assert.match(preview, /\.onChange\(of: login\.owner\) \{ _ in\s*cancelRangeCrossing\(\)/)
  assert.match(preview, /\.onDisappear \{ cancelRangeCrossing\(\) \}/)
  assert.match(preview, /native-ios-photoasset-viewer-range-loading/)
  assert.match(preview, /native-ios-photoasset-viewer-range-error/)
})

test('return wall uses verified adjacent range and last accepted Node revision', () => {
  assert.match(wall, /@State private var viewerLoadedRange: XDriveIOSNativeMediaRange\?/)
  assert.match(wall, /viewerLoadedRange = model\.page/)
  assert.match(wall, /loadedRange: viewerLoadedRange/)
  assert.match(wall, /viewerLoadedItems = verifiedRange\.items/)
  assert.match(wall, /viewerLoadedRange = verifiedRange/)
  assert.match(wall, /lastOpenedMediaID = next\.id\s*lastOpenedRevision = next\.node\.revision/)
  assert.match(wall, /XDriveIOSNativePhotoViewerReturnAnchorPolicy\.cloudTarget\(/)
  assert.match(wall, /viewerLoadedRange = nil/)
  assert.match(preview, /visibleItems: \[XDriveIOSNativeMediaItem\]/)
  assert.match(preview, /crossedRange\?\.items \?\? loadedItems/)
  assert.match(preview, /return visibleItems\[index\]/,
    'after crossing, next and previous MUST read the current range, never the initial range')
  assert.doesNotMatch(preview, /return loadedItems\[index\]/)
  assert.match(preview, /visibleItems\.map/)
})
