const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedGallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const sharedModels = read('ui', 'shared', 'src', 'models.ts')
const sharedSidebar = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const webApp = read('web', 'src', 'App.tsx')
const webAPI = read('web', 'src', 'api.ts')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx') + read('desktop', 'src', 'renderer', 'DesktopGalleryPage.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')

test('Gallery is one shared MUI surface for Web and Desktop', () => {
  assert.match(sharedGallery, /export function XDriveMediaGalleryPage/)
  assert.match(sharedGallery, /export function XDriveMediaGallery/)
  assert.match(sharedGallery, /所有 xDrive 图片和视频，包括普通上传和同步文件夹文件/)
  assert.match(sharedGallery, /onOpenAlbum/)
  assert.match(sharedGallery, /图片/)
  assert.match(sharedGallery, /视频/)
  assert.match(sharedGallery, /GPS/)
  assert.match(sharedGallery, /视频编码/)
  assert.match(sharedGallery, /缩略图/)
  assert.match(sharedGallery, /实况/)
  assert.match(sharedGallery, /loadLivePhotoMotion/)
  assert.match(sharedGallery, /<video/)

  assert.equal((webApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal((desktopApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.ok(webApp.includes('<XDriveWorkspaceSurface presentation="page" title="图库">'), 'Web Gallery must use the shared workspace surface')
  assert.ok(desktopApp.includes('<XDriveWorkspaceSurface presentation="page" title="图库">'), 'Desktop Gallery must use the shared workspace surface')
  assert.equal(webApp.includes('<Paper variant="outlined"'), false, 'Web Gallery must not add a platform-only Paper shell around shared content')
  assert.equal(webApp.includes('function MediaGallery'), false)
  assert.equal(desktopApp.includes('function MediaGallery'), false)
})

test('Gallery contracts are node-level and connector-neutral', () => {
  assert.match(sharedModels, /export interface MediaItem \{\s*node: Node\s*metadata: MediaMetadata/s)
  assert.match(sharedModels, /rotation_degrees\?: number/)
  assert.match(sharedModels, /latitude\?: number/)
  assert.match(sharedModels, /longitude\?: number/)
  assert.match(sharedModels, /thumbnail_width\?: number/)
  assert.match(sharedModels, /thumbnail_height\?: number/)
  assert.match(sharedModels, /container_kind\?: string/)
  assert.match(sharedModels, /asset_kind\?: PhotoAssetKind/)
  assert.match(sharedModels, /resources\?: MediaResource\[\]/)
  assert.match(sharedModels, /live_photo\?: boolean/)
  assert.match(sharedModels, /derived_resources\?: MediaDerivedResource\[\]/)
  assert.match(sharedGallery, /RAW 组合/)
  assert.match(sharedGallery, /连拍/)
  assert.match(sharedGallery, /资产资源/)
  assert.equal(sharedModels.includes('source_item_id: number\n  metadata: MediaMetadata'), false)
})

test('Web and Desktop expose the same Gallery data operations', () => {
  for (const token of ['mediaItems(', 'mediaAlbums()', 'mediaAlbumItems(', 'mediaThumbnail(', 'mediaLivePhotoMotion(']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'getMediaItems:',
    'getMediaAlbums:',
    'getMediaAlbumItems:',
    'getMediaThumbnail:',
    'getMediaLivePhotoMotion:',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload missing ${token}`)
  }

  for (const token of [
    "mediaItems(kind = ''",
    'mediaAlbums()',
    'mediaAlbumItems(albumID:',
    'mediaThumbnail(nodeID:',
    'mediaLivePhotoMotion(nodeID:',
  ]) {
    assert.ok(agentClient.includes(token), `Desktop Agent client missing ${token}`)
  }

  assert.ok(desktopIPC.includes('"media-gallery"'))
  assert.ok(desktopIPC.includes('GET /v1/media/items'))
  assert.ok(desktopIPC.includes('GET /v1/media/albums'))
  assert.ok(desktopIPC.includes('GET /v1/media/thumbnail'))
  assert.ok(desktopIPC.includes('GET /v1/media/live-photo-motion'))
})

test('Desktop navigation exposes Gallery as a first-class view', () => {
  assert.match(desktopApp, /type View = [^\n]*'gallery'/)
  assert.ok(desktopApp.includes('title="图库"'), 'Desktop Gallery page must own its shared workspace title')
  assert.ok(desktopApp.includes('<XDriveCoreWorkspaceNavItems'), 'Desktop must expose Gallery through shared core navigation')
  assert.ok(desktopApp.includes("selected={view === 'cloud' ? 'files' : view}"), 'Desktop must map Files to the shared files key while preserving local/cloud storage keys')
  assert.ok(sharedSidebar.includes("selected={selected === 'gallery'}"), 'shared core navigation must own Gallery selection')
  assert.ok(sharedSidebar.includes('primary="图库"'), 'shared core navigation must own the Gallery label')
})

test('Web exposes files, Gallery, Sync Folders, Local Storage, and Cloud Storage as first-class workspace views', () => {
  assert.ok(webApp.includes('type AppView ='), 'Web workspace view type should remain explicit')
  assert.ok(webApp.includes("useState<AppView>('files')"), 'Files should remain the initial Web workspace')
  for (const view of ['files', 'gallery', 'sources', 'local-storage', 'cloud-storage']) {
    assert.ok(webApp.includes(`| '${view}'`), `AppView missing first-class workspace: ${view}`)
  }
  assert.ok(webApp.includes('<XDriveCoreWorkspaceNavItems'), 'Web must expose first-class workspaces through shared core navigation')
  assert.ok(webApp.includes('selected={appView}'), 'Web must pass its active workspace to shared core navigation')
  for (const label of ['primary="文件"', 'primary="图库"', 'primary="同步文件夹"', 'primary="本地存储"', 'primary="云端存储"']) {
    assert.ok(sharedSidebar.includes(label), `shared core navigation missing: ${label}`)
  }
  assert.match(webApp, /<ExternalSourcesPanel[\s\S]*defaultTargetNodeID=/)
  assert.ok(webApp.includes('<XDriveLocalStoragePage source={localStorageSource} />'), 'Web local storage must use the shared workspace')
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Web cloud storage must use the shared workspace')
  assert.equal(webApp.includes('setSourcesOpen'), false)
  assert.equal(webApp.includes("setStorageStatsScope('self')"), false)
  assert.ok(webApp.includes('<WebFileExplorer'), 'Web files workspace should use the shared Explorer adapter')
  assert.equal((webApp.match(/<Paper className="file-card"/g) || []).length, 0, 'legacy Web file-card must not return')
})
