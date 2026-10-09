const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const filename = path.join(root, 'ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts')
const compiled = ts.transpileModule(read('ui/shared/src/mui/MediaGalleryAlbumFolderModel.ts'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const loaded = new Module(filename, module)
loaded.filename = filename
loaded.paths = Module._nodeModulePaths(path.dirname(filename))
loaded._compile(compiled, filename)
const {
  mediaAlbumFolderPath, mediaAlbumFolderChildren,
  mediaAlbumFolderDestinations, mediaAlbumsInFolder, mediaAlbumFolderCanDelete,
} = loaded.exports

const folders = [
  { id: 10, parent_id: 0, name: '旅行', revision: 1 },
  { id: 11, parent_id: 10, name: '日本', revision: 1 },
  { id: 12, parent_id: 11, name: '东京', revision: 2 },
  { id: 20, parent_id: 0, name: '家庭', revision: 1 },
]
const albums = [
  { id: 'manual:a', album_folder_id: 0, name: '根相册' },
  { id: 'manual:b', album_folder_id: 11, name: '京都' },
  { id: 'smart:c', album_folder_id: 12, name: '东京夜景' },
  { id: 'folder:readonly', name: '外部相册' },
]

test('G04 folder breadcrumbs and direct children are bounded and preserve roots', () => {
  assert.deepEqual(mediaAlbumFolderPath(folders, 12).map(x => x.id), [10, 11, 12])
  assert.deepEqual(mediaAlbumFolderPath(folders, 0), [])
  assert.deepEqual(mediaAlbumFolderPath(folders, 999), [])
  assert.deepEqual(mediaAlbumFolderChildren(folders, 0).map(x => x.id), [20, 10])
  assert.deepEqual(mediaAlbumFolderChildren(folders, 10).map(x => x.id), [11])
  const cyclic = [{ id: 1, parent_id: 2 }, { id: 2, parent_id: 1 }]
  assert.deepEqual(mediaAlbumFolderPath(cyclic, 1), [])
})

test('G04 folder mover cannot target itself or descendants', () => {
  assert.deepEqual(mediaAlbumFolderDestinations(folders, 10).map(x => x.id), [20])
  assert.deepEqual(mediaAlbumFolderDestinations(folders, 11).map(x => x.id), [20, 10])
  assert.equal(mediaAlbumFolderDestinations(folders, 0).length, folders.length)
})

test('G04 folder view is direct-only, but album search may span all folders', () => {
  assert.deepEqual(mediaAlbumsInFolder(albums, 0, false).map(x => x.id), ['manual:a', 'folder:readonly'])
  assert.deepEqual(mediaAlbumsInFolder(albums, 11, false).map(x => x.id), ['manual:b'])
  assert.deepEqual(mediaAlbumsInFolder(albums, 12, false).map(x => x.id), ['smart:c'])
  assert.equal(mediaAlbumsInFolder(albums, 12, true).length, albums.length)
  assert.equal(mediaAlbumFolderCanDelete(folders, albums, 11), false)
  assert.equal(mediaAlbumFolderCanDelete(folders, albums, 12), false)
  assert.equal(mediaAlbumFolderCanDelete(folders, albums, 20), true)
})

test('G04 folder browser shares one UI, with revision-fenced mutations end-to-end', () => {
  const browser = read('ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx')
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const adapter = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const web = read('web/src/api.ts')
  const desktop = read('desktop/src/main/index.cts')
  const agent = read('cmd/xdrive-agent/desktop_ipc.go')
  const cloud = read('cmd/xdrive-agent/cloud_files.go')
  for (const field of [
    'data-xdrive-gallery-album-folders', '新建相册文件夹',
    '重命名相册文件夹', '移动相册文件夹', '移动到相册文件夹',
    'mediaAlbumFolderCanDelete', 'data-xdrive-gallery-album-file-into-folder',
  ]) assert.ok(browser.includes(field), field)
  for (const key of ['listAlbumFolders', 'createAlbumFolder', 'updateAlbumFolder', 'deleteAlbumFolder', 'moveAlbumToFolder']) {
    assert.ok(gallery.includes(key), key)
    assert.ok(adapter.includes(key), key)
  }
  assert.match(web, /\/api\/v1\/media\/album-folders/)
  assert.match(web, /headers: \{ 'If-Match':/)
  assert.match(desktop, /agent:move-media-album-to-folder/)
  assert.match(desktop, /requireAgentCapability\(hello, 'media-album-folders'\)/)
  assert.match(agent, /CloudMoveMediaAlbumToFolder/)
  assert.match(agent, /desktopIPCValidAlbumFolderID/)
  assert.match(cloud, /cli\.MoveMediaAlbumToFolder/)
  assert.doesNotMatch(browser, /new Array\(virtualCollection\.itemCount\)/)
  assert.doesNotMatch(browser, /PhotoCollectionAsset|file-system|Blob/)
})
