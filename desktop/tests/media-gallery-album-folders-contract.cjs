const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('G04 album-folder hierarchy is authoritative owner-scoped Server data', () => {
  const model = read('internal/meta/photo.go')
  const api = read('internal/api/media_album_folders.go')
  const routes = read('internal/api/router.go')
  const manifest = read('internal/api/router_contract_test.go')
  const migrate = read('cmd/server/main.go')
  assert.match(model, /type PhotoAlbumFolder struct/)
  assert.match(model, /AlbumFolderID\s+uint64/)
  assert.match(model, /uniqueIndex:idx_xd_photo_album_folder_siblings/)
  assert.match(migrate, /&meta\.PhotoAlbumFolder\{\}/)
  assert.match(api, /lockMediaAlbumFolderOwner/)
  assert.match(api, /validMediaAlbumFolderParent/)
  assert.match(api, /errMediaAlbumFolderNotEmpty/)
  assert.match(api, /errMediaAlbumFolderCycle/)
  assert.match(api, /errRevisionConflict/)
  assert.match(api, /PhotoCollectionKindManual, meta\.PhotoCollectionKindSmart/)
  for (const [method, route] of [
    ['GET', '/media/album-folders'],
    ['POST', '/media/album-folders'],
    ['PATCH', '/media/album-folders/:folderID'],
    ['DELETE', '/media/album-folders/:folderID'],
    ['PATCH', '/media/albums/:albumID/folder'],
  ]) {
    assert.ok(routes.includes('"/' + route.slice(1) + '"'), 'Missing route: ' + route)
    assert.ok(manifest.includes('method: "' + method + '", path: "/api/v1' + route + '"'),
      'Missing covered route: ' + route)
  }
  assert.match(read('internal/api/media_album_folders_integration_test.go'),
    /TestAlbumFolderHierarchyAndAlbumMembershipIsolation/)
})

test('Album folders change collection metadata, never membership copies', () => {
  const source = read('internal/api/media_album_folders.go')
  const client = read('internal/client/media.go')
  const model = read('ui/shared/src/models.ts')
  assert.match(source, /album_folder_id/)
  assert.doesNotMatch(source, /Create\(&meta\.PhotoCollectionAsset/)
  assert.doesNotMatch(source, /Create\(&meta\.Node/)
  assert.match(client, /MediaAlbumFolders\(/)
  assert.match(client, /MoveMediaAlbumToFolder\(/)
  assert.match(model, /export interface MediaAlbumFolder/)
  assert.match(model, /album_folder_id\?: number/)
})
