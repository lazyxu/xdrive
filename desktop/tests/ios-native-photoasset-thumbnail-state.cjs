'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(
  path.join(__dirname, '../../ios/XDriveIOS/NativeServerMediaGallery.swift'), 'utf8'
)

test('native PhotoAsset thumbnail state invalidates on revised Node and verified Owner/root', () => {
  const start = source.indexOf('private struct XDriveIOSNativeMediaWallTileIdentity: Hashable')
  const end = source.indexOf('private struct XDriveIOSNativeMediaWallTile: View')
  assert.ok(start >= 0 && end > start, 'PhotoAsset tile must have a versioned Owner identity')
  const identity = source.slice(start, end)
  for (const required of [
    'nodeID = item.id',
    'revision = item.node.revision',
    'origin = owner?.origin',
    'instanceID = owner?.instanceID',
    'ownerID = owner?.ownerID',
    'username = owner?.username',
    'rootNodeID = owner?.rootNodeID'
  ]) {
    assert.ok(identity.includes(required), 'missing thumbnail scope: ' + required)
  }
  // Unrelated root writes must not cause a grid-wide refetch; credentials are not UI state.
  assert.doesNotMatch(identity, /rootRevision|accessToken|refreshToken|Bearer|UserDefaults/)

  const tile = source.slice(end, source.indexOf('/// Fullscreen media View', end))
  assert.match(tile, /@State private var image: UIImage\?/)
  assert.match(tile, /guard !viewerActive, image == nil else \{ return \}/)
  assert.match(tile, /model\.thumbnail\(item, login: login\)/)
  assert.match(tile, /try Task\.checkCancellation\(\)/)
  assert.match(tile, /if !viewerActive \{ image = nil \}/)

  const virtual = source.slice(source.indexOf('private struct XDriveIOSNativeServerVirtualRange: View'),
    source.indexOf('/// Root and album-specific media wall'))
  // Grouping is presentation-only and is built exclusively from the signed
  // current Range. Tile identity must still contain exact Node revision+Owner.
  assert.match(virtual, /verified\.offset == offset, verified\.total_count == expectedTotal/)
  assert.match(virtual, /xdriveIOSNativePhotoWallVisibleSections\(\s*verified\.items, scale: timeScale/)
  assert.match(virtual, /XDriveIOSNativePhotoWallSectionList\([\s\S]*?sections: visibleSections\(verified\)[\s\S]*?items: \{ \$0\.items \}[\s\S]*?XDriveIOSNativeMediaWallTile\([\s\S]*?\.id\(XDriveIOSNativeMediaWallTileIdentity\(\s*item: item, owner: login\.owner\s*\)\)/)
  assert.match(virtual, /\.id\(item\.id\)/, 'keep Node ID for continuous Viewer scroll return')
  assert.match(virtual, /\.accessibilityFocused\(\$focusedTileID, equals: item\.id\)/)
})
