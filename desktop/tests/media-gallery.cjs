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
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopIPC = read('cmd', 'xdrive-agent', 'desktop_ipc.go')
const desktopIndexHTML = read('desktop', 'src', 'renderer', 'index.html')

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
  assert.match(sharedGallery, /loadVideo/)
  assert.match(sharedGallery, /AsyncVideoPoster/)
  assert.match(sharedGallery, /IntersectionObserver/)
  assert.match(sharedGallery, /drawImage/)
  assert.match(sharedGallery, /toDataURL\('image\/jpeg'/)
  assert.match(sharedGallery, /视频播放/)
  assert.match(sharedGallery, /动图预览/)
  assert.match(sharedGallery, /image\/gif/)
  assert.match(sharedGallery, /image\/webp/)
  assert.match(sharedGallery, /搜索/)
  assert.match(sharedGallery, /资产类型/)
  assert.match(sharedGallery, /拍摄自/)
  assert.match(sharedGallery, /拍摄至/)
  assert.match(sharedGallery, /有 GPS/)
  assert.match(sharedGallery, /无 GPS/)
  assert.match(sharedGallery, /收藏/)
  assert.match(sharedGallery, /已收藏/)
  assert.match(sharedGallery, /未收藏/)
  assert.match(sharedGallery, /标签/)
  assert.match(sharedGallery, /保存标签/)
  assert.match(sharedGallery, /精确标签/)
  assert.match(sharedGallery, /人物标签/)
  assert.match(sharedGallery, /保存人物/)
  assert.match(sharedGallery, /精确人物标签/)
  assert.match(sharedGallery, /描述 \/ 备注/)
  assert.match(sharedGallery, /保存描述/)
  assert.match(sharedGallery, /StarIcon/)
  assert.match(sharedGallery, /新建相册/)
  assert.match(sharedGallery, /重命名/)
  assert.match(sharedGallery, /删除相册/)
  assert.match(sharedGallery, /从当前相册移除/)
  assert.match(sharedGallery, /album\.kind === 'manual'/)
  assert.match(sharedGallery, /mediaGalleryQueryFromDraft/)
  assert.match(sharedGallery, /保存为智能相册/)
  assert.match(sharedGallery, /保存规则/)
  assert.match(sharedGallery, /智能相册/)
  assert.match(sharedGallery, /时间轴/)
  assert.match(sharedGallery, /日期未知/)
  assert.match(sharedGallery, /mediaTimelineGroups/)
  assert.match(sharedGallery, /captured_at/)
  assert.match(sharedGallery, /MediaTileGrid/)
  assert.match(sharedGallery, /<video/)

  assert.equal((webApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal((desktopApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.ok(sharedGallery.includes('<XDriveWorkspaceSurface presentation="page" title="图库">'), 'shared Gallery page must own workspace chrome')
  assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopGalleryPage.tsx')), false, 'Desktop must not keep a pass-through Gallery wrapper')
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
  assert.match(sharedModels, /export interface MediaGalleryQuery/)
  assert.match(sharedModels, /search\?: string/)
  assert.match(sharedModels, /captured_from\?: string/)
  assert.match(sharedModels, /captured_to\?: string/)
  assert.match(sharedModels, /has_location\?: boolean/)
  assert.match(sharedModels, /favorite\?: boolean/)
  assert.match(sharedModels, /tags\?: string\[\]/)
  assert.match(sharedModels, /people\?: string\[\]/)
  assert.match(sharedModels, /description\?: string/)
  assert.match(sharedModels, /tag\?: string/)
  assert.match(sharedModels, /person\?: string/)
  assert.match(sharedModels, /kind: 'folder' \| 'imported' \| 'manual' \| 'smart' \| string/)
  assert.match(sharedModels, /query\?: MediaGalleryQuery/)
  assert.match(sharedModels, /live_photo\?: boolean/)
  assert.match(sharedModels, /derived_resources\?: MediaDerivedResource\[\]/)
  assert.match(sharedModels, /place\?: string/)
  assert.match(sharedModels, /export interface MediaPlaceFacet/)
  assert.match(sharedGallery, /按本地 GPS 坐标近似聚合，不使用在线地理服务/)
  assert.match(sharedGallery, /地点/)
  assert.match(sharedGallery, /RAW 组合/)
  assert.match(sharedGallery, /连拍/)
  assert.match(sharedGallery, /资产资源/)
  assert.equal(sharedModels.includes('source_item_id: number\n  metadata: MediaMetadata'), false)
})

test('Web and Desktop expose the same Gallery data operations', () => {
  for (const token of ['mediaItems(', 'mediaAlbums()', 'mediaPlaces(', 'mediaAlbumItems(', 'createMediaAlbum(', 'renameMediaAlbum(', 'deleteMediaAlbum(', 'createSmartMediaAlbum(', 'updateSmartMediaAlbum(', 'deleteSmartMediaAlbum(', 'addMediaAlbumItems(', 'removeMediaAlbumItem(', 'setMediaFavorite(', 'setMediaTags(', 'setMediaPeople(', 'setMediaDescription(', 'mediaThumbnail(', 'mediaLivePhotoMotion(', 'mediaVideoURL(', 'appendMediaGalleryQuery(', 'playback-ticket']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'getMediaItems:',
    'getMediaAlbums:',
    'getMediaPlaces:',
    'getMediaAlbumItems:',
    'createMediaAlbum:',
    'renameMediaAlbum:',
    'deleteMediaAlbum:',
    'createSmartMediaAlbum:',
    'updateSmartMediaAlbum:',
    'deleteSmartMediaAlbum:',
    'addMediaAlbumItems:',
    'removeMediaAlbumItem:',
    'setMediaFavorite:',
    'setMediaTags:',
    'setMediaPeople:',
    'setMediaDescription:',
    'getMediaThumbnail:',
    'getMediaLivePhotoMotion:',
    'getMediaVideoURL:',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload missing ${token}`)
  }

  for (const token of [
    'mediaItems(',
    'mediaAlbums()',
    'mediaPlaces(',
    'mediaAlbumItems(',
    'createMediaAlbum(name:',
    'renameMediaAlbum(albumID:',
    'deleteMediaAlbum(albumID:',
    'createSmartMediaAlbum(name:',
    'updateSmartMediaAlbum(',
    'deleteSmartMediaAlbum(albumID:',
    'addMediaAlbumItems(albumID:',
    'removeMediaAlbumItem(albumID:',
    'setMediaFavorite(nodeID:',
    'setMediaTags(nodeID:',
    'setMediaPeople(nodeID:',
    'setMediaDescription(nodeID:',
    'mediaThumbnail(nodeID:',
    'mediaLivePhotoMotion(nodeID:',
    'mediaVideoURL(nodeID:',
  ]) {
    assert.ok(agentClient.includes(token), `Desktop Agent client missing ${token}`)
  }

  assert.ok(desktopIPC.includes('"media-gallery"'))
  assert.ok(desktopIPC.includes('"media-video-stream"'))
  assert.ok(desktopIPC.includes('GET /v1/media/items'))
  assert.ok(desktopIPC.includes('GET /v1/media/albums'))
  assert.ok(desktopIPC.includes('GET /v1/media/places'))
  assert.ok(desktopIPC.includes('POST /v1/media/albums'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/album'))
  assert.ok(desktopIPC.includes('DELETE /v1/media/album'))
  assert.ok(desktopIPC.includes('POST /v1/media/smart-albums'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/smart-album'))
  assert.ok(desktopIPC.includes('DELETE /v1/media/smart-album'))
  assert.ok(desktopIPC.includes('POST /v1/media/album/items'))
  assert.ok(desktopIPC.includes('DELETE /v1/media/album/item'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/favorite'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/tags'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/people'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/description'))
  assert.ok(desktopIPC.includes('GET /v1/media/thumbnail'))
  assert.ok(desktopIPC.includes('GET /v1/media/live-photo-motion'))
  assert.ok(desktopIPC.includes('GET /v1/media/video'))
  assert.ok(desktopIPC.includes('"media-video-stream"'))
  assert.match(desktopApp, /getMediaVideoURL/)
  assert.match(desktopApp, /getMediaItems\('', limit, offset, query\)/)
  assert.match(desktopApp, /getMediaAlbumItems\([\s\S]*query,[\s\S]*\)/)
  assert.match(desktopApp, /setPeople/)
  assert.match(desktopApp, /setDescription/)
  assert.match(desktopApp, /loadVideo/)
  assert.match(preload, /agent:get-media-items', kind, limit, offset, query/)
  assert.match(agentClient, /appendAgentMediaQuery\(query, filters\)/)
  assert.match(agentClient, /query\.set\('tag', filters\.tag\.trim\(\)\)/)
  assert.match(agentClient, /query\.set\('person', filters\.person\.trim\(\)\)/)
  assert.match(desktopIndexHTML, /media-src 'self' data: blob: http:\/\/127\.0\.0\.1:\*/)
})

test('Desktop navigation exposes Gallery as a first-class view', () => {
  assert.match(desktopApp, /type View = [^\n]*'gallery'/)
  assert.ok(sharedGallery.includes('title="图库"'), 'shared Gallery page must own its workspace title')
  assert.ok(desktopApp.includes('<XDriveWorkspaceSidebar'), 'Desktop must expose Gallery through the shared workspace sidebar')
  assert.ok(desktopApp.includes('selected={view}'), 'Desktop must use its unified workspace key directly')
  assert.ok(sharedSidebar.includes("selected={selected === 'gallery'}"), 'shared core navigation must own Gallery selection')
  assert.ok(sharedSidebar.includes('primary="图库"'), 'shared core navigation must own the Gallery label')
})

test('Web exposes files, Gallery, Sync Folders, and Cloud Storage as first-class workspace views', () => {
  assert.ok(webApp.includes('type AppView ='), 'Web workspace view type should remain explicit')
  assert.ok(webApp.includes("useState<AppView>('files')"), 'Files should remain the initial Web workspace')
  for (const view of ['files', 'gallery', 'sources', 'cloud-storage']) {
    assert.ok(webApp.includes(`| '${view}'`), `AppView missing first-class workspace: ${view}`)
  }
  assert.ok(webApp.includes('<XDriveWorkspaceSidebar'), 'Web must expose first-class workspaces through the shared workspace sidebar')
  assert.ok(webApp.includes('selected={appView}'), 'Web must pass its active workspace to shared core navigation')
  for (const label of ['primary="文件"', 'primary="图库"', 'primary="同步文件夹"', 'primary="云端存储"']) {
    assert.ok(sharedSidebar.includes(label), `shared core navigation missing: ${label}`)
  }
  assert.match(webApp, /<XDriveSourceManager[\s\S]*defaultTargetNodeID=/)
  assert.equal(fs.existsSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx')), false, 'Web must not keep a pass-through Source manager wrapper')
  assert.equal(webApp.includes('LocalStoragePage'), false, 'Web must not expose Desktop-only Local Storage')
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Web cloud storage must use the shared workspace')
  assert.equal(webApp.includes('setSourcesOpen'), false)
  assert.equal(webApp.includes("setStorageStatsScope('self')"), false)
  assert.ok(webApp.includes('<WebFileExplorer'), 'Web files workspace should use the shared Explorer adapter')
  assert.equal((webApp.match(/<Paper className="file-card"/g) || []).length, 0, 'legacy Web file-card must not return')
})
