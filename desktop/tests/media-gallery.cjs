const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedGalleryMain = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const sharedGalleryDetails = read('ui', 'shared', 'src', 'mui', 'MediaGalleryDetails.tsx')
const sharedGalleryPreview = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPreviewMedia.tsx')
const sharedGalleryUtils = read('ui', 'shared', 'src', 'mui', 'MediaGalleryUtils.ts')
const sharedGallery = [
  sharedGalleryMain,
  sharedGalleryDetails,
  sharedGalleryPreview,
  sharedGalleryUtils,
].join('\n')
const sharedLivePhotoSurface = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
const sharedGalleryAdapter = read('ui', 'shared', 'src', 'mui', 'MediaGalleryAdapter.ts')
const sharedModels = read('ui', 'shared', 'src', 'models.ts')
const sharedSidebar = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const sharedRoute = read('ui', 'shared', 'src', 'mui', 'WorkspaceRoute.ts')
const webApp = read('web', 'src', 'App.tsx')
const webAPI = read('web', 'src', 'api.ts')
const webAdapter = read('web', 'src', 'mediaGalleryAdapter.ts')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopAdapter = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
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
  assert.match(sharedGallery, /XDriveLivePhotoSurface/)
  assert.match(sharedGallery, /loadPreviewURL/)
  assert.match(sharedGallery, /XDriveFilePreviewSurface/)
  assert.match(sharedGallery, /AsyncVideoPoster/)
  assert.match(sharedGallery, /IntersectionObserver/)
  assert.match(sharedGallery, /drawImage/)
  assert.match(sharedGallery, /toDataURL\('image\/jpeg'/)
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
  assert.equal(sharedGallery.includes('<video'), false, 'Gallery MediaDetails must not keep a second standalone Live Photo video player')
  assert.equal(sharedGallery.includes('loadVideo'), false, 'Gallery must not retain a video-specific ordinary-media source contract')

  assert.equal((webApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal((desktopApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.ok(sharedGallery.includes('<XDriveWorkspaceSurface presentation="page" title="图库">'), 'shared Gallery page must own workspace chrome')
  assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopGalleryPage.tsx')), false, 'Desktop must not keep a pass-through Gallery wrapper')
  assert.equal(webApp.includes('<Paper variant="outlined"'), false, 'Web Gallery must not add a platform-only Paper shell around shared content')
  assert.equal(webApp.includes('function MediaGallery'), false)
  assert.equal(desktopApp.includes('function MediaGallery'), false)
})

test('Live Photo is one press-and-hold Gallery surface', () => {
  for (const token of [
    'export function XDriveLivePhotoSurface',
    'onPointerDown={handlePointerDown}',
    'onPointerUp={handlePointerRelease}',
    'onPointerCancel={handlePointerRelease}',
    'onPointerLeave={stopPlayback}',
    'onKeyDown={handleKeyDown}',
    'onKeyUp={handleKeyUp}',
    'video.play()',
    'video.pause()',
    'video.currentTime = 0',
    'controls={false}',
    'playsInline',
    'preload="auto"',
    '按住播放',
    'aria-pressed={playing}',
  ]) {
    assert.ok(sharedLivePhotoSurface.includes(token), 'Live Photo surface missing: ' + token)
  }
  assert.equal(sharedLivePhotoSurface.includes('muted'), false, 'Live Photo motion must preserve audio capability')
  assert.equal(sharedGallery.includes('实况视频'), false, 'Gallery must not render Live Photo as a separate video section')
  assert.ok(sharedGallery.includes('loadMotion={loadSelectedLivePhotoMotion}'), 'Gallery must delegate Live Photo motion loading to the shared surface')
  assert.match(sharedGallery, /still=\{\([\s\S]*?<XDriveFilePreviewSurface/, 'Live Photo still image should reuse the Preview Engine before thumbnail fallback')
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
  assert.match(sharedModels, /attribution\?: string/)
  assert.match(sharedModels, /attribution_url\?: string/)
  assert.match(sharedGallery, /按本地 GPS 坐标近似聚合，不使用在线地理服务/)
  assert.match(sharedGallery, /地点名称来自本地 GeoNames 数据/)
  assert.match(sharedGallery, /place\.attribution/)
  assert.match(sharedGallery, /地点/)
  assert.match(sharedGallery, /RAW 组合/)
  assert.match(sharedGallery, /连拍/)
  assert.match(sharedGallery, /资产资源/)
  assert.equal(sharedModels.includes('source_item_id: number\n  metadata: MediaMetadata'), false)
})

test('shared Gallery adapter factory normalizes Web and Desktop transports', () => {
  for (const token of [
    'export interface XDriveMediaGalleryPort',
    'XDriveMediaGalleryTransportResult',
    'XDriveMediaGalleryBinaryResource',
    'createXDriveMediaGalleryDataSource',
    'loadPreviewURL',
    'resolveXDriveTransport',
    "'data_base64' in resource",
    'URL.createObjectURL(resource)',
    'data_base64',
    'result.tags',
    'result.people',
    'result.description',
  ]) {
    assert.ok(sharedGalleryAdapter.includes(token), `shared Gallery adapter missing: ${token}`)
  }

  assert.ok(webAdapter.includes('createXDriveMediaGalleryDataSource({'), 'Web must consume the shared Gallery adapter factory')
  assert.ok(desktopAdapter.includes('createXDriveMediaGalleryDataSource({'), 'Desktop must consume the shared Gallery adapter factory')
  assert.ok(webApp.includes('createWebMediaGalleryDataSource(api)'), 'Web App must consume its thin Gallery transport adapter')
  assert.ok(desktopApp.includes('createDesktopMediaGalleryDataSource(window.xdriveDesktop.agent)'), 'Desktop App must consume its thin Gallery transport adapter')
  assert.equal(webApp.includes('listItems: (limit, offset, query)'), false, 'Web App must not compose Gallery data source methods inline')
  assert.equal(desktopApp.includes('listItems: async (limit, offset, query)'), false, 'Desktop App must not compose Gallery data source methods inline')
})

test('Web and Desktop expose the same Gallery data operations', () => {
  for (const token of ['mediaItems(', 'mediaAlbums()', 'mediaPlaces(', 'mediaAlbumItems(', 'createMediaAlbum(', 'renameMediaAlbum(', 'deleteMediaAlbum(', 'createSmartMediaAlbum(', 'updateSmartMediaAlbum(', 'deleteSmartMediaAlbum(', 'addMediaAlbumItems(', 'removeMediaAlbumItem(', 'setMediaFavorite(', 'setMediaTags(', 'setMediaPeople(', 'setMediaDescription(', 'mediaThumbnail(', 'mediaLivePhotoMotion(', 'filePreviewURL(', 'appendMediaGalleryQuery(', 'preview-ticket']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'api.mediaItems(',
    'api.mediaAlbums()',
    'api.mediaPlaces(',
    'api.mediaAlbumItems(',
    'api.createMediaAlbum(',
    'api.createSmartMediaAlbum(',
    'api.updateSmartMediaAlbum(',
    'api.deleteSmartMediaAlbum(',
    'api.renameMediaAlbum(',
    'api.deleteMediaAlbum(',
    'api.addMediaAlbumItems(',
    'api.removeMediaAlbumItem(',
    'api.setMediaFavorite(',
    'api.setMediaTags(',
    'api.setMediaPeople(',
    'api.setMediaDescription(',
    'api.mediaThumbnail(',
    'api.mediaLivePhotoMotion(',
    'api.filePreviewURL(',
  ]) {
    assert.ok(webAdapter.includes(token), `Web Gallery adapter missing ${token}`)
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
    'cloudFilePreviewURL:',
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
    'cloudFilePreviewTicket(nodeID:',
  ]) {
    assert.ok(agentClient.includes(token), `Desktop Agent client missing ${token}`)
  }

  assert.ok(desktopIPC.includes('"media-gallery"'))
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
  assert.ok(desktopIPC.includes('"file-preview-stream"'))
  assert.ok(desktopIPC.includes('GET /v1/cloud/file-preview-ticket'))
  assert.ok(desktopIPC.includes('GET /v1/media/thumbnail'))
  assert.ok(desktopIPC.includes('GET /v1/media/live-photo-motion'))
  assert.match(desktopAdapter, /cloudFilePreviewURL/)
  assert.match(desktopAdapter, /getMediaItems\('', limit, offset, query\)/)
  assert.match(desktopAdapter, /getMediaAlbumItems\([\s\S]*query\)/)
  assert.match(desktopAdapter, /setPeople/)
  assert.match(desktopAdapter, /setDescription/)
  assert.match(desktopAdapter, /loadPreviewURL/)
  assert.equal(webAdapter.includes('mediaVideoURL'), false, 'Web Gallery adapter must use generic file preview URLs')
  assert.equal(desktopAdapter.includes('getMediaVideoURL'), false, 'Desktop Gallery adapter must use generic file preview URLs')
  assert.equal(webAPI.includes('mediaVideoURL('), false, 'Web API must not keep the legacy media playback helper')
  assert.equal(agentClient.includes('mediaVideoURL('), false, 'Desktop Agent client must not keep the legacy media playback helper')
  assert.equal(agentClient.includes('media_token'), false, 'Desktop discovery must not keep a second media token')
  assert.equal(desktopIPC.includes('"media-video-stream"'), false, 'Agent must expose only the generic file-preview stream capability')
  assert.equal(desktopIPC.includes('/v1/media/video'), false, 'Agent must not keep the legacy media video stream route')
  assert.equal(preload.includes('getMediaVideoURL'), false, 'Desktop preload must not expose the legacy media video URL bridge')
  assert.match(preload, /agent:get-media-items', kind, limit, offset, query/)
  assert.match(agentClient, /appendAgentMediaQuery\(query, filters\)/)
  assert.match(agentClient, /query\.set\('tag', filters\.tag\.trim\(\)\)/)
  assert.match(agentClient, /query\.set\('person', filters\.person\.trim\(\)\)/)
  assert.match(desktopIndexHTML, /media-src 'self' data: blob: http:\/\/127\.0\.0\.1:\*/)
})

test('Desktop navigation exposes Gallery as a first-class view', () => {
  assert.ok(desktopApp.includes("type View = XDriveWorkspaceViewKey<'overview' | 'conflicts' | 'diagnostics'>"), 'Desktop must extend the shared workspace route model')
  assert.ok(sharedRoute.includes("'gallery'"), 'shared workspace route model must expose Gallery')
  assert.ok(sharedGallery.includes('title="图库"'), 'shared Gallery page must own its workspace title')
  assert.ok(desktopApp.includes('<XDriveWorkspaceSidebar'), 'Desktop must expose Gallery through the shared workspace sidebar')
  assert.ok(desktopApp.includes('selected={view}'), 'Desktop must use its unified workspace key directly')
  assert.ok(sharedSidebar.includes("selected={selected === 'gallery'}"), 'shared core navigation must own Gallery selection')
  assert.ok(sharedSidebar.includes('primary="图库"'), 'shared core navigation must own the Gallery label')
})

test('Web exposes files, Gallery, Sync Folders, and Cloud Storage as first-class workspace views', () => {
  assert.ok(webApp.includes('type AppView = XDriveRemoteWorkspaceViewKey<'), 'Web workspace view type must extend the shared remote route model')
  assert.ok(webApp.includes("useState<AppView>('files')"), 'Files should remain the initial Web workspace')
  for (const view of ['files', 'gallery', 'sources', 'cloud-storage']) {
    assert.ok(sharedRoute.includes(`'${view}'`), `shared workspace route missing first-class workspace: ${view}`)
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


test('Gallery delegates MediaDetails and preview-media helpers to internal modules', () => {
  assert.ok(sharedGalleryMain.includes('<XDriveMediaDetailsDialog'), 'Gallery must render the internal media-details dialog')
  assert.ok(sharedGalleryDetails.includes('export function XDriveMediaDetailsDialog'), 'missing MediaGallery details module')
  assert.equal(sharedGalleryMain.includes('function MediaDetails('), false, 'MediaDetails implementation must not remain inline')
  for (const token of [
    'XDriveFilePreviewSurface',
    'XDriveLivePhotoSurface',
    '保存标签',
    '保存人物',
    '保存描述',
    '从当前相册移除',
    '资产资源',
    '视频编码',
    '缩略图',
  ]) {
    assert.ok(sharedGalleryDetails.includes(token), `MediaGalleryDetails missing: ${token}`)
  }
  for (const token of [
    'export function XDriveMediaAsyncThumbnail',
    'export function XDriveMediaAsyncVideoPoster',
    'IntersectionObserver',
    'drawImage',
    "toDataURL('image/jpeg'",
    'export function xDriveMediaFallback',
  ]) {
    assert.ok(sharedGalleryPreview.includes(token), `MediaGalleryPreviewMedia missing: ${token}`)
  }
  assert.ok(sharedGalleryUtils.includes('export function xDriveMediaGalleryErrorMessage'), 'shared Gallery error helper is missing')
  assert.ok(sharedGalleryUtils.includes('export function xDriveMediaFormatDuration'), 'shared Gallery duration helper is missing')
})
