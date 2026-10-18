const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const organizer = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx'), 'utf8')
const gallery = fs.readFileSync(path.join(root, 'ui/shared/src/mui/MediaGallery.tsx'), 'utf8')

test('Gallery album folder first read is quiet and does not insert spinner rows', () => {
  assert.ok(organizer.includes('const currentFolderLoading = folderBusyState.scope === folderActionScope && foldersLoading'))
  assert.ok(organizer.includes('aria-busy={currentFolderLoading || undefined}'))
  assert.ok(organizer.includes("position: 'relative', minHeight: 88"))
  assert.equal(organizer.includes('showDelayedFolderLoading'), false)
  assert.equal(organizer.includes('data-xdrive-gallery-folder-loading'), false)
  assert.equal(organizer.includes('加载相册文件夹…'), false)
  assert.equal(organizer.includes('foldersLoading && <Stack direction="row"'), false)
  assert.ok(organizer.includes('showDelayedIndexRead'), 'real Album index latency is still reported separately')
})
test('only accepted current-account and current-port folder lists claim empty or folder count', () => {
  for(const token of [
    'acceptedFolderList?.scope === accountScope',
    'acceptedFolderList.list === folderActions?.list',
    'const scopedFolders = foldersVerified ? folders : []',
    'const visibleFolderID = foldersVerified ? activeFolderID : 0',
    'setAcceptedFolderList({ scope: accountScope, list: load })',
    "visibility: foldersVerified ? 'visible' : 'hidden'",
    '!currentFolderLoading && (!folderActions || foldersVerified)',
  ]) assert.ok(organizer.includes(token), token)
  assert.ok(organizer.includes('mediaAlbumFolderChildren(scopedFolders, visibleFolderID)'))
  assert.ok(organizer.includes('mediaAlbumFolderCanDelete(scopedFolders, albums, folder.id)'))
  assert.ok(organizer.includes('visibleFolderError && <Alert'))
})
test('same shared Gallery and folder writes retain authoritative behavior', () => {
  for(const token of ['folderActions?.list','folderActions?.create','folderActions?.update',
    'folderActions?.remove','folderActions?.moveAlbum','readMediaAlbumPreferences(accountScope)',
    'XDriveMediaGalleryCoverThumbnail','mediaAlbumFolderPath','mediaAlbumFolderDestinations'])
    assert.ok(organizer.includes(token), token)
  assert.ok(gallery.includes('<XDriveMediaGalleryAlbumOrganizer'))
})
