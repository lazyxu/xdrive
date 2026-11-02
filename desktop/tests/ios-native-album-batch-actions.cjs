'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const contents = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const source = contents.slice(
  contents.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
  contents.indexOf('/// Photos-first list of local smart/user albums.')
)
const actions = read('ios/XDriveIOS/NativeLocalPhotoActions.swift')
const sharer = read('ios/XDriveIOS/NativeLocalPhotoShare.swift')
const originalAlbumReader = contents.slice(
  contents.indexOf('actor XDriveIOSNativeAlbumPageReader'),
  contents.indexOf('/// Visible album-cover cells')
)

test('album selection only accepts currently authorized, immutable 64-slot page candidates', () => {
  assert.match(source, /@State private var selectionMode = false/)
  assert.match(source, /@State private var selectedCandidates: \[String: XDrivePhotoKitScanCandidate\] = \[:\]/)
  assert.match(source, /native-ios-album-select-mode/)
  assert.match(source, /native-ios-album-selected-actions/)
  assert.match(source, /if selectionMode \{\s*toggleAlbumSelection\(item\)/)
  assert.match(source, /else \{\s*viewerReturnID = item\.id/)
  assert.match(source, /page\?\.items\.contains\(where: \{/)
  assert.match(source, /\$0\.id == item\.id && \$0\.kind == item\.kind/)
  assert.match(source, /\$0\.isLive == item\.isLive && \$0\.capturedAt == item\.capturedAt/)
  assert.match(source, /XDriveIOSNativePhotoSelectionPolicy\.canAdd\(/)
  assert.match(source, /selectedCandidates\[item\.id\] = item/)
  assert.match(source, /let batch = selectedCandidates\.values\.sorted \{ \$0\.id < \$1\.id \}/)
  assert.match(source, /batch\.count <= 64/)
  assert.doesNotMatch(source, /UserDefaults|@AppStorage|persist.*PhotoKit|UploadSession/)
})

test('exact collection membership and full current page are checked before each batch operation', () => {
  const verify = source.slice(
    source.indexOf('private func revalidateAlbumSelection('),
    source.indexOf('private func prepareAlbumShare(')
  )
  assert.match(verify, /batch\.count <= 64/)
  assert.match(verify, /current\.startOffset == expected\.startOffset/)
  assert.match(verify, /current\.totalAccessibleAssets == expected\.totalAccessibleAssets/)
  assert.match(verify, /let verifier = XDriveIOSNativeAlbumPageReader\(\)/)
  assert.match(verify, /let count = try await verifier\.open\(album\)/)
  assert.match(verify, /let now = try await verifier\.page\(offset: expected\.startOffset\)/)
  assert.match(verify, /count == expected\.totalAccessibleAssets/)
  assert.match(verify, /zip\(now\.items, expected\.items\)\.allSatisfy/)
  for (const exact of [
    '$0.0.id == $0.1.id', '$0.0.kind == $0.1.kind',
    '$0.0.isLive == $0.1.isLive', '$0.0.capturedAt == $0.1.capturedAt',
    '$0.0.modifiedAt == $0.1.modifiedAt'
  ]) assert.ok(verify.includes(exact), 'missing full-album page proof ' + exact)
  assert.match(verify, /await verifier\.reset\(\)/)
  assert.match(originalAlbumReader, /PHAsset\.fetchAssets\(in: collection, options: options\)/)
  assert.match(originalAlbumReader, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == status/)
})

test('album batch share uses 8 current originals and explicit iCloud opt-in, never upload', () => {
  const share = source.slice(
    source.indexOf('private func prepareAlbumShare('),
    source.indexOf('private func runAlbumAction(')
  )
  assert.match(source, /Button\("分享选中原件"\)/)
  assert.match(source, /Button\("从 iCloud 下载后分享"\)/)
  assert.match(share, /batch\.count <= XDriveIOSNativeLocalPhotoSharePolicy\.maximumItems/)
  assert.match(share, /try await revalidateAlbumSelection\(batch, expected: sourcePage\)/)
  assert.equal((share.match(/revalidateAlbumSelection\(batch, expected: sourcePage\)/g)||[]).length,2)
  assert.match(share, /XDriveIOSNativeLocalOriginalSharer\.prepare\(\s*batch, allowICloudDownload: allowICloud/)
  assert.match(share, /session\.discard\(\)/)
  assert.match(share, /retainedAlbumShare = session\s*albumShareSession = session/)
  assert.match(source, /\.sheet\(item: \$albumShareSession, onDismiss:/)
  assert.match(source, /retainedAlbumShare\?\.discard\(\)/)
  assert.match(source, /XDriveIOSNativeLocalPhotoActivitySheet\(fileURLs: session\.fileURLs\)/)
  assert.match(sharer, /XDrivePhotoKitOriginalExporter\.stage\(/)
  assert.match(sharer, /\.verifiedAssets\(\[candidate\]\)/)
  assert.doesNotMatch(share, /uploadSession|ledger|UserDefaults|CloudKit|NodeReceipt/)
})

test('album favorite and delete call already verified PhotoKit writes, never cloud deletion', () => {
  const batch = source.slice(
    source.indexOf('private func runAlbumAction('),
    source.indexOf('private func cancelAlbumOperations(')
  )
  assert.match(source, /Button\("收藏选中"\) \{ runAlbumAction\(favorite: true\) \}/)
  assert.match(source, /Button\("取消收藏"\) \{ runAlbumAction\(favorite: false\) \}/)
  assert.match(source, /Button\("删除选中", role: \.destructive\)/)
  assert.match(source, /\.confirmationDialog\(/)
  assert.match(source, /Button\("删除选中照片", role: \.destructive\)/)
  assert.match(batch, /try await revalidateAlbumSelection\(batch, expected: sourcePage\)/)
  assert.match(batch, /XDriveIOSNativeLocalPhotoSelectionActions\.delete\(batch\)/)
  assert.match(batch, /XDriveIOSNativeLocalPhotoSelectionActions\.setFavorite\(\s*batch, to: favorite/)
  assert.match(actions, /PHAssetChangeRequest\.deleteAssets\(assets as NSArray\)/)
  assert.match(actions, /PHAssetChangeRequest\(for: asset\)\.isFavorite = value/)
  assert.match(actions, /PHPhotoLibrary\.shared\(\)\.performChanges/)
  assert.match(batch, /reload\(\)/)
  assert.doesNotMatch(batch, /deleteCloud|uploadSession|PhotoSyncLedger|backupCursor/)
})

test('scene, source/page changes cancel batch tasks and forget selected photo identifiers', () => {
  assert.match(source, /private func cancelAlbumOperations\(\)/)
  assert.match(source, /albumActionTask\?\.cancel\(\)/)
  assert.match(source, /albumShareTask\?\.cancel\(\)/)
  assert.match(source, /selectedCandidates\.removeAll\(\)/)
  assert.match(source, /selectionMode = false/)
  assert.match(source, /private func invalidate\(\) \{\s*cancelAlbumOperations\(\)/)
  assert.match(source, /\.onChange\(of: libraryMonitor\.revision\) \{ _ in[\s\S]*?invalidate\(\)/)
  assert.match(source, /\.onChange\(of: phase\) \{ state in[\s\S]*?if state != \.active/)
  assert.match(source, /if selected != nil \{ suspendForViewer\(\) \}/)
  assert.match(source, /onCrossPage: \{ oldPage, anchor, direction in/)
  assert.match(source, /viewerReturnID = next\.id/)
})
