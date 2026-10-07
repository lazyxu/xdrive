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
const sharedGalleryFilters = read('ui', 'shared', 'src', 'mui', 'MediaGalleryFilters.tsx')
const sharedGalleryVirtualGrid = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualGrid.ts')
const sharedGalleryVirtualTimeline = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualTimeline.ts')
const sharedGalleryThumbnailScheduler = read('ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts')
const sharedVirtualCollectionController = read('ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts')
const sharedGallery = [
  sharedGalleryMain,
  sharedGalleryDetails,
  sharedGalleryPreview,
  sharedGalleryUtils,
  sharedGalleryFilters,
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
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
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
  assert.match(sharedModels, /export interface MediaTimelineGroupIndex \{[\s\S]*item_count: number[\s\S]*start_index: number/)
  assert.match(sharedModels, /export interface MediaItemRange \{[\s\S]*total_count: number[\s\S]*offset: number[\s\S]*limit: number[\s\S]*timeline_groups\?: MediaTimelineGroupIndex\[\]/)
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
  assert.match(sharedModels, /person_identity\?: string/)
  assert.match(sharedGallery, /personIdentity: query\.person_identity/)
  assert.match(sharedGallery, /人物 ·/)
  assert.match(sharedGallery, /personIdentityLocked/)
  assert.match(sharedGallery, /!currentAlbum && !currentSuggestedPerson && source\.createSmartAlbum/)
  assert.match(sharedModels, /kind: 'folder' \| 'imported' \| 'manual' \| 'smart' \| string/)
  assert.match(sharedModels, /query\?: MediaGalleryQuery/)
  assert.match(sharedModels, /live_photo\?: boolean/)
  assert.match(sharedModels, /derived_resources\?: MediaDerivedResource\[\]/)
  assert.match(sharedModels, /place\?: string/)
  assert.match(sharedModels, /export interface MediaPlaceFacet/)
  assert.match(sharedModels, /export interface MediaSuggestedPerson/)
  assert.match(sharedModels, /export interface MediaPersonIdentity/)
  assert.match(sharedModels, /export interface MediaPersonSplit/)
  assert.match(sharedModels, /face_count: number/)
  assert.match(sharedModels, /attribution\?: string/)
  assert.match(sharedModels, /attribution_url\?: string/)
  assert.match(sharedGallery, /按本地 GPS 坐标近似聚合，不使用在线地理服务/)
  assert.match(sharedGallery, /地点名称来自本地 GeoNames 数据/)
  assert.match(sharedGallery, /人物建议/)
  assert.match(sharedGallery, /自动聚类建议/)
  assert.match(sharedGallery, /尚未写入手工人物标签/)
  assert.match(sharedGallery, /已保存的长期人物/)
  assert.match(sharedGallery, /保存为人物/)
  assert.match(sharedGallery, /重命名人物/)
  assert.match(sharedGallery, /合并人物/)
  assert.match(sharedGallery, /拆分人物/)
  assert.match(sharedGallery, /设封面/)
  assert.match(sharedGallery, /显示已隐藏/)
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
    "'data' in resource",
    'new Blob(',
    'URL.createObjectURL(resource)',
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
  for (const token of [
    'listItemRange:',
    'listSuggestedPersonItemRange:',
    'listPersonItemRange:',
    'listAlbumItemRange:',
  ]) {
    assert.ok(sharedGalleryAdapter.includes(token), `shared Gallery range adapter missing: ${token}`)
    assert.ok(webAdapter.includes(token), `Web Gallery range adapter missing: ${token}`)
    assert.ok(desktopAdapter.includes(token), `Desktop Gallery range adapter missing: ${token}`)
  }
})

test('Web and Desktop expose the same Gallery data operations', () => {
  assert.match(webAPI, /person_identity/)
  assert.match(agentClient, /person_identity/)
  assert.match(desktopIPC, /person_identity/)

  for (const token of ['mediaItems(', 'mediaItemRange(', 'mediaAlbums()', 'mediaPlaces(', 'mediaSuggestedPeople(', 'mediaSuggestedPersonItems(', 'mediaSuggestedPersonItemRange(', 'mediaPeople(', 'mediaPersonItems(', 'mediaPersonItemRange(', 'adoptMediaSuggestedPerson(', 'updateMediaPerson(', 'mergeMediaPeople(', 'splitMediaPerson(', 'mediaAlbumItems(', 'mediaAlbumItemRange(', 'createMediaAlbum(', 'renameMediaAlbum(', 'deleteMediaAlbum(', 'createSmartMediaAlbum(', 'updateSmartMediaAlbum(', 'deleteSmartMediaAlbum(', 'addMediaAlbumItems(', 'removeMediaAlbumItem(', 'setMediaFavorite(', 'setMediaTags(', 'setMediaPeople(', 'setMediaDescription(', 'mediaThumbnail(', 'mediaLivePhotoMotion(', 'filePreviewURL(', 'appendMediaGalleryQuery(', 'preview-ticket']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'api.mediaItems(',
    'api.mediaItemRange(',
    'api.mediaAlbums()',
    'api.mediaPlaces(',
    'api.mediaSuggestedPeople(',
    'api.mediaSuggestedPersonItems(',
    'api.mediaSuggestedPersonItemRange(',
    'api.mediaPeople(',
    'api.mediaPersonItems(',
    'api.mediaPersonItemRange(',
    'api.adoptMediaSuggestedPerson(',
    'api.updateMediaPerson(',
    'api.mergeMediaPeople(',
    'api.splitMediaPerson(',
    'api.mediaAlbumItems(',
    'api.mediaAlbumItemRange(',
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
    'getMediaItemRange:',
    'getMediaAlbums:',
    'getMediaPlaces:',
    'getMediaSuggestedPeople:',
    'getMediaSuggestedPersonItems:',
    'getMediaSuggestedPersonItemRange:',
    'getMediaPeople:',
    'getMediaPersonItems:',
    'getMediaPersonItemRange:',
    'adoptMediaSuggestedPerson:',
    'updateMediaPerson:',
    'mergeMediaPeople:',
    'splitMediaPerson:',
    'getMediaAlbumItems:',
    'getMediaAlbumItemRange:',
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
    'mediaItemRange(',
    'mediaAlbums()',
    'mediaPlaces(',
    'mediaSuggestedPeople(',
    'mediaSuggestedPersonItems(',
    'mediaSuggestedPersonItemRange(',
    'mediaPeople(',
    'mediaPersonItems(',
    'mediaPersonItemRange(',
    'adoptMediaSuggestedPerson(',
    'updateMediaPerson(',
    'mergeMediaPeople(',
    'splitMediaPerson(',
    'mediaAlbumItems(',
    'mediaAlbumItemRange(',
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
  assert.ok(desktopIPC.includes('GET /v1/media/people/suggestions'))
  assert.ok(desktopIPC.includes('GET /v1/media/people/suggestion-items'))
  assert.ok(desktopIPC.includes('GET /v1/media/people/identities'))
  assert.ok(desktopIPC.includes('GET /v1/media/people/identity-items'))
  assert.ok(desktopIPC.includes('POST /v1/media/people/adopt'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/person'))
  assert.ok(desktopIPC.includes('POST /v1/media/person/merge'))
  assert.ok(desktopIPC.includes('POST /v1/media/person/split'))
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
  assert.match(agentClient, /data: ArrayBuffer/)
  assert.match(agentClient, /mediaLivePhotoMotion\(nodeID: number\): Promise<AgentMediaMotion>/)
  assert.match(agentClient, /requestBinary\(/)
  assert.equal(agentClient.includes('data_base64'), false)
  assert.match(desktopAdapter, /getMediaItems\('', limit, offset, query\)/)
  assert.match(desktopAdapter, /getMediaSuggestedPeople/)
  assert.match(desktopAdapter, /getMediaSuggestedPersonItems/)
  assert.match(desktopAdapter, /getMediaPeople/)
  assert.match(desktopAdapter, /getMediaPersonItems/)
  assert.match(desktopAdapter, /adoptMediaSuggestedPerson/)
  assert.match(desktopAdapter, /updateMediaPerson/)
  assert.match(desktopAdapter, /mergeMediaPeople/)
  assert.match(desktopAdapter, /splitMediaPerson/)
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
  assert.match(preload, /agent:get-media-item-range', kind, limit, offset, query/)
  assert.match(preload, /agent:get-media-suggested-person-item-range/)
  assert.match(preload, /agent:get-media-person-item-range/)
  assert.match(preload, /agent:get-media-album-item-range/)
  assert.match(desktopMain, /agent:get-media-item-range/)
  assert.match(desktopMain, /agent:get-media-suggested-person-item-range/)
  assert.match(desktopMain, /agent:get-media-person-item-range/)
  assert.match(desktopMain, /agent:get-media-album-item-range/)
  assert.match(desktopIPC, /desktopIPCMediaRangeRequested/)
  assert.match(desktopIPC, /CloudMediaItemsRange/)
  assert.match(desktopIPC, /CloudMediaAlbumItemsRange/)
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


test('Gallery delegates filter draft/query mapping and filter-bar presentation to an internal module', () => {
  assert.ok(sharedGalleryMain.includes('<XDriveMediaGalleryFilterBar'), 'Gallery page must render the internal filter bar')
  assert.ok(sharedGalleryFilters.includes('export function XDriveMediaGalleryFilterBar'), 'missing Gallery filter-bar module')
  for (const token of [
    'export type MediaGalleryFilterDraft',
    'emptyMediaGalleryFilterDraft',
    'mediaGalleryQueryFromDraft',
    'mediaGalleryDraftFromQuery',
    'hasMediaGalleryFilters',
    '精确标签',
    '精确人物标签',
    '保存为智能相册',
    '有 GPS',
    '未收藏',
  ]) {
    assert.ok(sharedGalleryFilters.includes(token), `MediaGalleryFilters missing: ${token}`)
  }
  assert.equal(/use(?:State|Effect)\(/.test(sharedGalleryFilters), false, 'Gallery filter module must stay stateless/effect-free')
  assert.equal(sharedGalleryMain.includes('type MediaGalleryFilterDraft ='), false, 'filter draft definition must not remain inline')
  assert.equal(sharedGalleryMain.includes('function MediaGalleryFilterBar('), false, 'filter-bar implementation must not remain inline')
})


test('Gallery grid uses VirtualCollection with stable logical height and bounded metadata', () => {
  for (const token of [
    'useXDriveVirtualCollection<MediaItem>',
    'collectionTargetRef',
    'mediaGalleryCollectionKey(target)',
    'source.listItemRange(',
    'source.listAlbumItemRange(',
    'source.listPersonItemRange',
    'source.listSuggestedPersonItemRange',
    'virtualCollection.reset(mediaGalleryCollectionKey(target))',
    'virtualCollection.primePage({',
    'itemCount: virtualCollection.totalCount ?? items.length',
    'loadedItems: virtualCollection.loadedItems',
    'onRangeChange: virtualCollection.ensureViewport',
    'virtualCollection.updateLoadedItems',
    '<MediaVirtualTileGrid',
    '<MediaVirtualTimeline',
    'timelineGroups={timelineGroups}',
    'positionLabel={previewIndex >= 0 ?',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery VirtualCollection contract missing: ${token}`)
  }

  assert.equal(sharedGalleryMain.includes('hasMore'), false, 'Gallery must not retain append pagination state')
  assert.equal(sharedGalleryMain.includes('onLoadMore'), false, 'Gallery must not retain append pagination callbacks')
  assert.equal(sharedGalleryMain.includes('加载更多'), false, 'Gallery must not expose load-more UI')
  assert.ok(
    sharedVirtualCollectionController.includes('updateLoadedItems'),
    'VirtualCollection must allow bounded in-place metadata updates',
  )
})

test('Gallery virtual grid uses the existing workspace scroll host without materializing logical items', () => {
  for (const token of [
    'xDriveMediaGalleryGridMetrics',
    'xDriveMediaGalleryGridWindow',
    'mediaGalleryScrollParent',
    'ResizeObserver',
    "addEventListener('scroll', update",
    'height: layout.metrics.totalHeight',
    'layout.window.startRow * layout.metrics.rowStep',
    'collection.itemAt(index)',
    'collection.onRangeChange(nextWindow.start, nextWindow.end - 1)',
    'data-xdrive-media-gallery-placeholder',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery virtual surface missing: ${token}`)
  }

  for (const token of [
    'XDRIVE_MEDIA_GALLERY_MIN_TILE_WIDTH = 150',
    'XDRIVE_MEDIA_GALLERY_GRID_GAP = 8',
    'XDRIVE_MEDIA_GALLERY_OVERSCAN_ROWS = 2',
    'export function xDriveMediaGalleryGridMetrics',
    'export function xDriveMediaGalleryGridWindow',
  ]) {
    assert.ok(sharedGalleryVirtualGrid.includes(token), `Gallery grid helper missing: ${token}`)
  }

  assert.equal(
    sharedGalleryMain.includes('new Array(virtualCollection.itemCount)'),
    false,
    'Gallery must never allocate one slot per logical media item',
  )
})

test('Gallery Timeline maps month groups onto the shared sparse VirtualCollection', () => {
  for (const token of [
    'timelineGroups={timelineGroups}',
    'setTimelineGroups(range.timeline_groups ?? [])',
    'function MediaVirtualTimeline({',
    'xDriveMediaGalleryTimelineLayout',
    'xDriveMediaGalleryTimelineWindow',
    'data-xdrive-media-gallery-virtual-timeline',
    'collection.itemAt(index)',
    'collection.onRangeChange(',
    'data-xdrive-media-gallery-timeline-placeholder',
    'xDriveMediaGalleryTimelineIndexVisible',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery Timeline virtualization missing: ${token}`)
  }
  for (const token of [
    'XDRIVE_MEDIA_GALLERY_TIMELINE_HEADER_HEIGHT = 32',
    'XDRIVE_MEDIA_GALLERY_TIMELINE_GROUP_GAP = 20',
    'XDRIVE_MEDIA_GALLERY_TIMELINE_OVERSCAN_ROWS = 2',
    'export function xDriveMediaGalleryTimelineGroupLabel',
    'export function xDriveMediaGalleryTimelineLayout',
    'export function xDriveMediaGalleryTimelineWindow',
  ]) {
    assert.ok(sharedGalleryVirtualTimeline.includes(token), `Gallery Timeline helper missing: ${token}`)
  }
  assert.ok(sharedGalleryMain.includes('mediaTimelineGroups(items)'), 'standalone dense fallback remains available')
  assert.equal(sharedGalleryMain.includes('const loadMore = useCallback'), false, 'Gallery controller must not append dense pages')
})


test('Gallery Grid uses one viewport-priority thumbnail scheduler with scheduler-owned URL lifetime', () => {
  for (const token of [
    'XDriveMediaThumbnailScheduler',
    'thumbnailScheduler = useMemo(',
    'thumbnailScheduler.load(nodeID, thumbnailPriority)',
    'revokeOnDispose={!thumbnailScheduler}',
    'overscanRows: 0',
    'thumbnailPriority: XDriveMediaThumbnailPriority',
    'thumbnailScheduler.setRetention(retainedNodeIDs)',
    'thumbnailScheduler.setRetention([])',
    'thumbnailScheduler={thumbnailScheduler}',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery thumbnail scheduler wiring missing: ${token}`)
  }

  for (const token of [
    'XDRIVE_MEDIA_THUMBNAIL_CONCURRENCY = 6',
    'XDRIVE_MEDIA_THUMBNAIL_CACHE_SIZE = 512',
    'class XDriveMediaThumbnailScheduler',
    'private readonly queued = new Map<number, ThumbnailTask>()',
    'private readonly inFlight = new Map<number, ThumbnailTask>()',
    'private readonly cache = new Map<number, string>()',
    'left.priority - right.priority',
    'queueMicrotask(() => {',
    'setRetention(nodeIDs: Iterable<number>)',
    'this.cancelTask(task)',
    'this.cacheURL(task.nodeID, url)',
    'this.revokeURL(url)',
  ]) {
    assert.ok(sharedGalleryThumbnailScheduler.includes(token), `Gallery scheduler missing: ${token}`)
  }

  assert.ok(
    sharedGalleryPreview.includes('revokeOnDispose = true'),
    'async thumbnail must preserve legacy ownership by default',
  )
  assert.ok(
    sharedGalleryPreview.includes('if (resolved && revokeOnDispose) revokeIfBlob(resolved)'),
    'scheduler-managed URLs must not be revoked by tile unmount',
  )
  assert.equal(
    sharedGalleryMain.includes('new XDriveMediaThumbnailScheduler(loadPreviewURL'),
    false,
    'video poster scheduling remains a separate bounded pipeline',
  )
})
