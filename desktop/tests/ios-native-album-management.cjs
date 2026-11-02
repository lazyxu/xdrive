'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const writer = read('ios/XDriveIOS/NativePhotoAlbumMutations.swift')
const picker = read('ios/XDriveIOS/NativeAlbumDestinationPicker.swift')
const browser = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
const wall = read('ios/XDriveIOS/NativeLocalContinuousGallery.swift')
const pager = read('ios/XDriveIOS/PhotoKitAlbumPager.swift')
const namePolicy = read('ios/XDriveIOS/NativePhotoAlbumNamePolicy.swift')
const directory = browser.slice(browser.indexOf('struct XDriveIOSNativePhotoAlbumsScreen: View'))
const members = browser.slice(
  browser.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View'),
  browser.indexOf('/// Photos-first list of local smart/user albums.')
)

test('only fresh, user-owned PhotoKit albums may change; smart albums are not mutable', () => {
  assert.match(writer, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)/)
  assert.match(writer, /album\.kind == "用户相册"/)
  assert.match(writer, /PHAssetCollection\.fetchAssetCollections\(/)
  assert.match(writer, /collection\.assetCollectionType == \.album/)
  assert.match(writer, /collection\.localIdentifier == album\.collectionIdentifier/)
  assert.match(writer, /collection\.localizedTitle\?\.trimmingCharacters/)
  assert.match(writer, /collection\.canPerform\(operation\)/)
  for (const op of ['.rename', '.delete', '.addContent', '.removeContent']) {
    assert.ok(writer.includes('operation: ' + op), 'missing native capability: ' + op)
  }
  assert.match(directory, /if album\.kind == "用户相册" \{/)
  assert.match(directory, /native-ios-album-manage-menu/)
})

test('create, rename and delete use native change blocks and verified readback, not cloud Nodes', () => {
  for (const name of ['create', 'rename', 'delete']) {
    assert.match(writer, new RegExp('static func ' + name + '\\('))
  }
  assert.match(writer, /XDriveIOSNativeAlbumNamePolicy\.normalized/)
  assert.match(writer, /PHAssetCollectionChangeRequest\.creationRequestForAssetCollection/)
  assert.match(writer, /PHAssetCollectionChangeRequest\(for: current\)\?\.title = name/)
  assert.match(writer, /PHAssetCollectionChangeRequest\.deleteAssetCollections\(\[current\] as NSArray\)/)
  assert.match(writer, /confirmedAlbum\(album\.collectionIdentifier\)\?\.localizedTitle == name/)
  assert.match(writer, /confirmedAlbum\(album\.collectionIdentifier\) == nil/)
  assert.match(writer, /PHPhotoLibrary\.shared\(\)\.performChanges/)
  assert.match(directory, /native-ios-album-create/)
  assert.match(directory, /\.alert\("新建相簿"/)
  assert.match(directory, /\.alert\("重命名相簿"/)
  assert.match(directory, /Button\("只删除相簿", role: \.destructive\)/)
  assert.match(directory, /runAlbumMutation\(success:/)
  assert.match(directory, /if phase == \.active && !albumMutationBusy \{ reload\(\) \}/)
})

test('album removal does not delete original assets and is distinct from Photos library delete', () => {
  assert.match(members, /Button\("从此相簿移除"\)/)
  assert.match(members, /runAlbumAction\(removeFromAlbum: true\)/)
  assert.match(members, /try await revalidateAlbumSelection\(batch, expected: sourcePage\)/)
  assert.match(members, /XDriveIOSNativePhotoAlbumMutations\.remove\(/)
  assert.match(writer, /hasMembers\(originals, in: current, every: true\)/)
  assert.match(writer, /PHAssetCollectionChangeRequest\(for: current\)\?\.removeAssets\(originals as NSArray\)/)
  assert.match(writer, /hasMembers\(originals, in: updated, every: false\)/)
  const remove = writer.slice(writer.indexOf('static func remove('))
  assert.doesNotMatch(remove, /PHAssetChangeRequest\.deleteAssets|deleteAssetCollections/)
  assert.match(members, /Button\("删除选中照片", role: \.destructive\)/)
})

test('add from timeline or album uses bounded destination picker and exact asset revision proof', () => {
  assert.match(wall, /Button\("添加到相簿"\)/)
  assert.match(wall, /XDriveIOSNativeAlbumDestinationPicker\(/)
  assert.match(members, /Button\("添加到其他相簿"\)/)
  assert.match(members, /excludingCollectionID: album\.collectionIdentifier/)
  assert.match(picker, /XDriveLocalPhotoAlbumPager\.readPage\(/)
  assert.match(picker, /XDriveLocalPhotoAlbumPager\.pageSize/)
  assert.match(picker, /\$0\.kind == "用户相册"/)
  assert.match(picker, /XDriveIOSNativePhotoAlbumMutations\.add\(/)
  assert.match(writer, /XDriveIOSNativeLocalPhotoSelectionActions\.verifiedAssets\(/)
  assert.match(writer, /PHAssetCollectionChangeRequest\(for: current\)\?\.addAssets\(originals as NSArray\)/)
  assert.match(writer, /hasMembers\(originals, in: updated, every: true\)/)
  assert.match(picker, /stopRead\(\)/)
  assert.match(picker, /phase == \.active/)
  assert.match(pager, /static let pageSize = 32/)
})

test('album names are bounded; original, cloud and backup writers remain isolated', () => {
  assert.match(namePolicy, /maximumCharacters = 80/)
  assert.match(namePolicy, /maximumUTF8Bytes = 255/)
  assert.match(namePolicy, /CharacterSet\.controlCharacters/)
  const allowed = [writer,picker,directory,wall].join('\n').replace(/^\s*\/\/[^\n]*/gm, '')
  assert.doesNotMatch(allowed, /UploadSession|PhotoSyncLedger|ServerMedia|signedTicket|URLSession|WKWebView/)
  assert.doesNotMatch(writer, /PHAssetChangeRequest\.deleteAssets/)
})
