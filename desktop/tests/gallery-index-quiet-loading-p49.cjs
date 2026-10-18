const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname,'../..')
const code = fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGallery.tsx'),'utf8')
const hook = fs.readFileSync(path.join(root,'ui/shared/src/mui/useDeferredLoading.ts'),'utf8')
const albums = fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGalleryAlbumOrganizer.tsx'),'utf8')
const map = fs.readFileSync(path.join(root,'ui/shared/src/mui/MediaGalleryPlacesMap.tsx'),'utf8')

test('Gallery sync-folder index renders only accepted cards, never an interim loading row',()=>{
  assert.ok(code.includes("import { useXDriveDeferredPendingLoading } from './useDeferredLoading'"))
  assert.ok(code.includes('showAlbumIndex && syncFolders.length > 0 ? ('))
  assert.equal(code.includes('showAlbumIndex && (showDelayedSyncFolders || syncFolders.length > 0)'),false)
  assert.equal(code.includes('showDelayedSyncFolders'),false)
  assert.equal(code.includes('正在加载同步文件夹…'),false)
  assert.ok(code.includes('data-xdrive-gallery-sync-folders aria-busy={syncFoldersLoading || undefined}'))
  assert.ok(code.includes('syncFolders.map((folder)'))
  assert.ok(code.includes("indexPending={!indexFacetsVerified && (loading || placesStatus === 'loading' || syncFoldersLoading)}"),
    'index remains honest while the first Owner read is unverified')
  assert.ok(hook.includes('XDRIVE_WORKSPACE_LOADING_FEEDBACK_DELAY_MS = 300'),
    'Places and other real delayed feedback must remain unchanged')
  assert.ok(albums.includes('aria-busy={currentFolderLoading || undefined}'),
    'real folder index remains visibly stable and accessible while pending')
  assert.equal(albums.includes('showDelayedFolderLoading'),false,
    'a slow folder list request must not insert a decorative spinner')
})

test('Places first read has stable 160px geometry and delayed only visual progress',()=>{
  assert.ok(code.includes("showPlacesIndex && placesStatus === 'loading' && places.length === 0"))
  assert.ok(code.includes("showDelayedPlacesInitial = useXDriveDeferredPendingLoading("))
  assert.ok(code.includes("showPlacesIndex && placesStatus === 'loading' && places.length === 0)"))
  assert.equal(code.includes("showPlacesIndex && placesStatus === 'loading' ? ("), false,
    'a refresh with already accepted place cards cannot mount a second pending panel')
  assert.ok(code.includes('showDelayedPlacesInitial = useXDriveDeferredPendingLoading('))
  assert.ok(code.includes('data-xdrive-gallery-places-first-read'))
  assert.ok(code.includes('aria-busy="true"'))
  assert.ok(code.includes('minHeight: 160, display: \'grid\', placeItems: \'center\', p: 3'))
  assert.ok(code.includes('showDelayedPlacesInitial ? ('))
  assert.ok(code.includes('没有带地点信息的照片'))
  assert.ok(code.includes("placesStatus === 'ready'"))
})

test('Places page changes never inject an in-flow progress caption, keep last accepted cards',()=>{
  const pagination = code.indexOf('data-xdrive-places-pagination')
  const next = code.indexOf('      {showPeopleIndex ? (',pagination)
  assert.ok(pagination>0 && next>pagination)
  const section = code.slice(pagination,next)
  assert.ok(section.includes('data-xdrive-places-pagination-quiet-status'))
  assert.ok(section.includes('aria-busy={placesPagePending || undefined}'))
  assert.ok(section.includes('width: 18, height: 18, flexShrink: 0'))
  assert.ok(section.includes("pointerEvents: 'none'"))
  assert.ok(section.includes('showDelayedPlacesPage'))
  assert.ok(section.includes('placesPageError'))
  assert.ok(code.slice(code.indexOf('地点列表'),pagination).includes('places.map((place) => ('))
  assert.equal(section.includes('<Typography role="status" variant="caption">正在加载地点…</Typography>'),false)
  assert.ok(code.includes('disabled={placesPagePending || placesPageOffset === 0}'))
  assert.ok(map.includes("useXDriveDeferredLoading"),
    'the existing camera/map viewport uses the generation-scoped hook independently')
  assert.ok(map.includes('viewportLoading, loadFeedbackGeneration,'),
    'camera/viewport must use its own true request generation')
  assert.ok(hook.includes('visibleGeneration === requestGeneration'),
    'generation-scoped pending must reject stale visual progress')
  assert.ok(code.includes('XDriveMediaGalleryCoverThumbnail'),
    'original network thumbnails remain')
})
