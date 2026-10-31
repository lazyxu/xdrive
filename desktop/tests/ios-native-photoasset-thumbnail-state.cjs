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

  const wall = source.slice(source.indexOf('struct XDriveIOSNativeServerMediaWall: View'))
  assert.match(wall, /ForEach\(page\.items\) \{ item in[\s\S]*?XDriveIOSNativeMediaWallTile\([\s\S]*?\.id\(XDriveIOSNativeMediaWallTileIdentity\(\s*item: item, owner: login\.owner\s*\)\)/)
  assert.match(wall, /\.id\(item\.id\)/, 'keep Node ID for existing Viewer scroll return')
  assert.match(wall, /\.accessibilityFocused\(\$accessibilityFocusedMediaID, equals: item\.id\)/)
})
