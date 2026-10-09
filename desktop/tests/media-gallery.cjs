const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const sharedGalleryMain = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const sharedWorkspaceSurface = read('ui', 'shared', 'src', 'mui', 'WorkspaceSurface.tsx')
const sharedGalleryDetails = read('ui', 'shared', 'src', 'mui', 'MediaGalleryDetails.tsx')
const sharedGalleryInspector = read('ui', 'shared', 'src', 'mui', 'MediaGalleryInspector.tsx')
const sharedGalleryPreview = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPreviewMedia.tsx')
const sharedGalleryVideoPoster = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVideoPoster.ts')
const sharedGalleryUtils = read('ui', 'shared', 'src', 'mui', 'MediaGalleryUtils.ts')
const sharedGalleryFilters = read('ui', 'shared', 'src', 'mui', 'MediaGalleryFilters.tsx')
const sharedGalleryNavigation = read('ui', 'shared', 'src', 'mui', 'MediaGalleryNavigation.tsx')
const sharedGalleryMemories = read('ui', 'shared', 'src', 'mui', 'MediaGalleryMemories.tsx')
const sharedGalleryCleanup = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCleanup.tsx')
const sharedGalleryPets = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPets.tsx')
const sharedGalleryPlacesMap = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPlacesMap.tsx')
const sharedGalleryPlacesMapModel = read('ui', 'shared', 'src', 'mui', 'MediaGalleryPlacesMapModel.ts')
const sharedGallerySelectionToolbar = read('ui', 'shared', 'src', 'mui', 'MediaGallerySelectionToolbar.tsx')
const sharedGalleryFilmstrip = read('ui', 'shared', 'src', 'mui', 'MediaGalleryFilmstrip.tsx')
const sharedGalleryViewer = read('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
const sharedMediaViewerContent = read('ui', 'shared', 'src', 'mui', 'MediaViewerContent.tsx')
const sharedGalleryEditDialog = read('ui', 'shared', 'src', 'mui', 'MediaGalleryEditDialog.tsx')
const sharedGalleryCreativeDialog = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCreativeDialog.tsx')
const sharedGalleryCollageDialog = read('ui', 'shared', 'src', 'mui', 'MediaGalleryCollageDialog.tsx')
const sharedGalleryMusicPickerDialog = read('ui', 'shared', 'src', 'mui', 'MediaGalleryMusicPickerDialog.tsx')
const sharedGalleryMovieDialog = read('ui', 'shared', 'src', 'mui', 'MediaGalleryMovieDialog.tsx')
const sharedFilePreviewSurface = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx') +
  read('ui', 'shared', 'src', 'mui', 'FilePreviewImage.tsx')
const sharedFilePreviewTransformed = read('ui', 'shared', 'src', 'mui', 'FilePreviewTransformedMedia.tsx')
const sharedMediaEdit = read('ui', 'shared', 'src', 'media-edit.ts')
const sharedGalleryVirtualGrid = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualGrid.ts')
const sharedGalleryVirtualTimeline = read('ui', 'shared', 'src', 'mui', 'MediaGalleryVirtualTimeline.ts')
const sharedGalleryThumbnailScheduler = read('ui', 'shared', 'src', 'mui', 'MediaGalleryThumbnailScheduler.ts')
const sharedVirtualCollectionController = read('ui', 'shared', 'src', 'mui', 'VirtualCollectionController.ts')
const sharedGallery = [
  sharedGalleryMain,
  sharedGalleryDetails,
  sharedGalleryInspector,
  sharedGalleryPreview,
  sharedGalleryVideoPoster,
  sharedGalleryUtils,
  sharedGalleryFilters,
  sharedGalleryNavigation,
  sharedGalleryMemories,
  sharedGalleryCleanup,
  sharedGalleryPets,
  sharedGalleryPlacesMap,
  sharedGalleryPlacesMapModel,
  sharedGallerySelectionToolbar,
  sharedGalleryFilmstrip,
  sharedGalleryViewer,
  sharedMediaViewerContent,
  sharedGalleryEditDialog,
  sharedGalleryCreativeDialog,
  sharedGalleryCollageDialog,
  sharedGalleryMusicPickerDialog,
  sharedGalleryMovieDialog,
].join('\n')
const sharedLivePhotoSurface = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
const sharedGalleryAdapter = read('ui', 'shared', 'src', 'mui', 'MediaGalleryAdapter.ts')
const sharedModels = read('ui', 'shared', 'src', 'models.ts')
const sharedSidebar = read('ui', 'shared', 'src', 'mui', 'SidebarNav.tsx')
const sharedWorkspaceNavigation = read('ui', 'shared', 'src', 'mui', 'WorkspaceNavigation.tsx')
const sharedRoute = read('ui', 'shared', 'src', 'mui', 'WorkspaceRoute.ts')
const webApp = read('web', 'src', 'App.tsx')
const webAPI = read('web', 'src', 'api.ts')
const webAdapter = read('web', 'src', 'mediaGalleryAdapter.ts')
const desktopApp = read('desktop', 'src', 'renderer', 'App.tsx')
const desktopAdapter = read('desktop', 'src', 'renderer', 'mediaGalleryAdapter.ts')
const preload = read('desktop', 'src', 'preload', 'index.cts')
const agentClient = read('desktop', 'src', 'main', 'agent_client.cts')
const desktopMain = read('desktop', 'src', 'main', 'index.cts')
const desktopPreviewProxy = read('desktop', 'src', 'main', 'file_preview_proxy.cts')
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
  assert.match(sharedGallery, /toBlob/)
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
  assert.match(sharedGallery, /data-xdrive-gallery-time-scale/)
  assert.match(sharedGallery, /\['year', '年'\]/)
  assert.match(sharedGallery, /\['month', '月'\]/)
  assert.match(sharedGallery, /\['day', '日'\]/)
  assert.match(sharedGallery, /\['all', '所有照片'\]/)
  assert.match(sharedGallery, /缩略图大小/)
  assert.match(sharedGallery, /<Slider/)
  assert.match(sharedGallery, /日期未知/)
  assert.match(sharedGallery, /mediaTimelineGroups/)
  assert.match(sharedGallery, /captured_at/)
  assert.match(sharedGallery, /MediaTileGrid/)
  assert.equal(sharedGallery.includes('<video'), false, 'Gallery MediaDetails must not keep a second standalone Live Photo video player')
  assert.equal(sharedGallery.includes('loadVideo'), false, 'Gallery must not retain a video-specific ordinary-media source contract')

  assert.ok(sharedGallery.includes('XDriveLivePhotoGlyph'), 'Gallery must use the shared Live Photo glyph instead of a generic play icon')
  assert.ok(sharedMediaViewerContent.includes("kind !== 'live_photo'"), 'shared media content must admit the LIVP still preview kind')
  assert.ok(webAdapter.includes('api.mediaLivePhotoStillURL(nodeID)'), 'Web Gallery must use the signed LIVP still source')
  assert.ok(desktopAdapter.includes('agent.getMediaLivePhotoStill(nodeID)'), 'Desktop Gallery must use the protected LIVP still source')

  assert.equal((webApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.equal((desktopApp.match(/<XDriveMediaGalleryPage/g) || []).length, 1)
  assert.ok(sharedGallery.includes('<XDriveWorkspaceSurface presentation="page" title="图库" showPageHeader={false}>'), 'shared Gallery page must own workspace chrome without duplicating its title')
  assert.equal(fs.existsSync(path.join(repo, 'desktop', 'src', 'renderer', 'DesktopGalleryPage.tsx')), false, 'Desktop must not keep a pass-through Gallery wrapper')
  assert.equal(webApp.includes('<Paper variant="outlined"'), false, 'Web Gallery must not add a platform-only Paper shell around shared content')
  assert.equal(webApp.includes('function MediaGallery'), false)
  assert.equal(desktopApp.includes('function MediaGallery'), false)
})

test('Gallery IA keeps photo browsing primary and moves advanced controls behind shared navigation', () => {
  for (const label of ['图库', '回忆', '人物与宠物', '地点', '相册', '收藏', '媒体类型', '清理建议', '回收站']) {
    assert.ok(sharedGalleryNavigation.includes(label), 'Gallery navigation missing: ' + label)
  }
  assert.match(sharedGalleryNavigation, /value: 'memories'/)
  assert.doesNotMatch(sharedGalleryNavigation, /value: 'memories'[\s\S]{0,160}disabled: true/)
  for (const token of [
    'XDriveMediaGalleryMemories',
    "case 'recent_day':",
    "case 'on_this_day':",
    "case 'trip':",
    'data-xdrive-media-gallery-memory',
    "kind: 'memory'",
    'source.listMemoryItemRange',
    'xDriveMediaDayKey(new Date(), mediaTimeZoneRef.current)',
    'mediaTimeZoneRef.current',
  ]) {
    assert.ok(sharedGallery.includes(token), `Gallery Memories contract missing: ${token}`)
  }
  for (const token of [
    'XDriveMediaGalleryCleanup',
    'data-xdrive-media-gallery-cleanup',
    'data-xdrive-media-cleanup-duplicate',
    'data-xdrive-media-cleanup-burst',
    'data-xdrive-media-cleanup-recommended',
    "case 'duplicate-review':",
    "case 'burst-review':",
    'source.listDuplicateItemRange',
    'source.listBurstReviewItemRange',
    'currentCleanupReview ? \'all\' : timeScale',
    'xDrive CAS 按内容去重',
    '删除操作仍然先进入回收站',
  ]) {
    assert.ok(sharedGallery.includes(token), `Gallery cleanup contract missing: ${token}`)
  }
  for (const token of [
    'XDriveMediaGalleryPets',
    'data-xdrive-media-gallery-pets',
    "kind: 'pet'",
    "case 'pet':",
    'source.listPetItemRange',
    '本地视觉类型集合',
    '待确认建议',
    '暂不处理',
    '添加到已有人物',
    'showDismissedSuggestions',
    "review_state === 'dismissed'",
    "onReviewSuggestedPerson(person, 'pending')",
    "onReviewSuggestedPerson(person, 'dismissed')",
  ]) {
    assert.ok(sharedGallery.includes(token), `Gallery People/Pets contract missing: ${token}`)
  }
  assert.match(sharedGalleryFilters, /export function XDriveMediaGalleryFilterToolbar/)
  assert.match(sharedGalleryFilters, /<Popover/)
  assert.match(sharedGalleryFilters, /showSearch=\{false\}/)
  assert.match(sharedGalleryFilters, /placeholder="搜索照片、对象、场景或文字"/)
  assert.match(sharedGalleryMain, /section=\{section\}/)
  assert.match(sharedGalleryMain, /showAlbumIndex/)
  assert.match(sharedGalleryMain, /showPlacesIndex/)
  assert.match(sharedGalleryMain, /showPeopleIndex/)
  assert.match(sharedGalleryMain, /showMediaTypeIndex/)
  assert.match(sharedGalleryMain, /showPhotoCollection/)
  assert.match(sharedGalleryMain, /lockedFavorite=\{section === 'favorites'\}/)
  assert.match(sharedGalleryMain, /lockedAssetKind=\{[\s\S]*section === 'media-types'[\s\S]*activeMediaType !== 'gif'[\s\S]*activeMediaType !== 'panorama'/)
  assert.match(sharedGalleryMain, /mediaGalleryMediaTypes/)
  assert.match(sharedGalleryMain, /你收藏的照片和视频/)
  assert.match(sharedGalleryMain, /按媒体资产类型快速进入照片集合/)
})

test('Gallery workspace separates collection failures from empty results and keeps controls compact', () => {
  assert.match(sharedWorkspaceSurface, /showPageHeader = true/)
  assert.match(sharedWorkspaceSurface, /mt: showPageHeader \? 2 : 0/)
  assert.match(sharedGalleryMain, /showPageHeader=\{false\}/)
  assert.match(sharedGalleryMain, /collectionError=\{collectionError\}/)
  assert.match(sharedGalleryMain, /setCollectionError\(message\)/)
  assert.match(sharedGalleryMain, /blockingCollectionError/)
  assert.match(sharedGalleryMain, /data-xdrive-gallery-load-error/)
  assert.match(sharedGalleryMain, /图库加载失败/)
  assert.match(sharedGalleryMain, />\s*重试\s*</)
  assert.match(sharedGalleryMain, /data-xdrive-gallery-empty/)
  assert.match(sharedGalleryMain, /没有符合当前条件的照片或视频/)
  assert.match(sharedGalleryMain, /onClearFilters/)
  assert.match(sharedGalleryMain, />\s*清除筛选\s*</)
  assert.match(sharedGalleryMain, /data-xdrive-gallery-header/)
  assert.match(sharedGalleryMain, /data-xdrive-gallery-toolbar/)
  assert.match(sharedGalleryMain, /logicalItemCount\.toLocaleString\('zh-CN'\)/)
  assert.doesNotMatch(
    sharedGalleryMain,
    /<Typography variant="subtitle1" fontWeight=\{700\} sx=\{\{ mb: 1\.25 \}\}>\s*所有照片和视频/,
    'root Gallery must not spend a standalone row repeating the collection title',
  )
})

test('Gallery photo wall keeps ordinary media quiet while preserving semantic badges and touch controls', () => {
  for (const token of [
    'data-xdrive-media-tile',
    'data-xdrive-media-tile-badges',
    'borderRadius: 0',
    'border: 0',
    'const mediaBadgeLabel = mediaAssetChipLabel(item)',
    'return null',
    'className="media-favorite"',
    'opacity: compactTouch || item.favorite ? 1 : 0',
    'left: selectionMode || selectedForAction ? (compactTouch ? 52 : 42) : 8',
    'opacity: 0',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), 'Gallery photo-wall contract missing: ' + token)
  }
  assert.ok(
    (sharedGalleryMain.match(/gap: `\$\{XDRIVE_MEDIA_GALLERY_GRID_GAP\}px`/g) || []).length >= 3,
    'dense, sparse and timeline grids must share one compact gap',
  )
  assert.match(sharedGalleryPreview, /<Skeleton[\s\S]*animation=\{false\}[\s\S]*borderRadius: 0/)
  assert.equal(
    sharedGalleryPreview.includes('CircularProgress'),
    false,
    'dense Gallery thumbnail loading should not render one spinner per tile',
  )
})

test('Gallery camera and format facets stay lazy, shared, and wired across Web/Desktop', () => {
  for (const token of ['cameras?: string[]', 'formats?: string[]', 'MediaGalleryFacets']) {
    assert.ok(sharedModels.includes(token), 'Gallery facet model missing: ' + token)
  }
  for (const token of [
    '<Autocomplete',
    'label="拍摄设备"',
    'label="文件格式"',
    'option.item_count.toLocaleString',
    'onRequestFacets?.(draft)',
    'facetsAvailable',
  ]) {
    assert.ok(sharedGalleryFilters.includes(token), 'Gallery facet UI missing: ' + token)
  }
  assert.match(sharedGalleryMain, /listFacets\?:/)
  assert.match(sharedGalleryMain, /const requestFacets = useCallback/)
  assert.match(sharedGalleryMain, /source\.listFacets\(facetQuery, albumID\)/)
  const loadFirstPageStart = sharedGalleryMain.indexOf('const loadFirstPage = useCallback')
  const loadMemoriesStart = sharedGalleryMain.indexOf('const loadMemories = useCallback', loadFirstPageStart)
  assert.equal(
    sharedGalleryMain.slice(loadFirstPageStart, loadMemoriesStart).includes('listFacets('),
    false,
    'first Gallery range load must not aggregate camera/format facets',
  )

  assert.match(webAPI, /mediaFacets\(/)
  assert.match(webAPI, /\/api\/v1\/media\/facets/)
  assert.match(webAPI, /values\.append\('camera'/)
  assert.match(webAPI, /values\.append\('format'/)
  assert.match(webAdapter, /listFacets: \(query, albumID\) => api\.mediaFacets\(query, albumID\)/)

  assert.match(agentClient, /mediaFacets\(/)
  assert.match(agentClient, /query\.append\('camera'/)
  assert.match(agentClient, /query\.append\('format'/)
  assert.match(desktopIPC, /GET \/v1\/media\/facets/)
  assert.match(desktopIPC, /CloudMediaFacets/)
  assert.match(desktopMain, /agent:get-media-facets/)
  assert.match(preload, /getMediaFacets:/)
  assert.match(desktopAdapter, /listFacets: \(query, albumID\) => agent\.getMediaFacets\(query, albumID\)/)
  assert.equal(
    (preload.match(/cameras\?: string\[\]/g) || []).length,
    (preload.match(/formats\?: string\[\]/g) || []).length,
    'Desktop preload must expose cameras/formats together on every Gallery query shape',
  )
  assert.ok(
    (preload.match(/cameras\?: string\[\]/g) || []).length >= 11,
    'Desktop preload must expose facets on range/person/album/smart-album query contracts',
  )
  assert.doesNotMatch(sharedGalleryFilters, /onOpen=\{onRequestFacets\}/)
  assert.match(sharedGalleryFilters, /onRequestFacets\?\.\(nextDraft\)/)
  assert.match(sharedGalleryMain, /facetRequestID\.current \+= 1/)
})

test('Gallery sync-folder browser stays lazy, direct-directory scoped, and shared', () => {
  for (const token of [
    'folder_id?: number',
    'MediaSyncFolder',
    'MediaFolderView',
    'MediaFolderBreadcrumb',
  ]) {
    assert.ok(sharedModels.includes(token), 'Gallery folder model missing: ' + token)
  }
  for (const token of [
    'listSyncFolders?:',
    'getSyncFolder?:',
    'const loadSyncFolders = useCallback',
    'const openSyncFolderDirectory = useCallback',
    "if (nextSection === 'albums') void loadSyncFolders()",
    'folder_id: view.current.id',
    'currentFolderView ? { folder_id: currentFolderView.current.id } : {}',
    'data-xdrive-gallery-sync-folders',
    'data-xdrive-gallery-folder-browser',
    '同步文件夹',
    '子目录',
    '当前目录不会递归展开子目录照片',
    '!currentAlbum && !currentFolderView && !currentSuggestedPerson',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), 'Gallery folder browser contract missing: ' + token)
  }
  const firstPageStart = sharedGalleryMain.indexOf('const loadFirstPage = useCallback')
  const memoriesStart = sharedGalleryMain.indexOf('const loadMemories = useCallback', firstPageStart)
  assert.equal(
    sharedGalleryMain.slice(firstPageStart, memoriesStart).includes('listSyncFolders('),
    false,
    'Gallery first visible range must not load synchronization-folder roots',
  )
  assert.match(sharedGalleryMain, /target\.kind === 'all' && !target\.query\.folder_id/)
  assert.match(webAPI, /mediaSyncFolders\(\)/)
  assert.match(webAPI, /\/api\/v1\/media\/sync-folders/)
  assert.match(webAPI, /values\.set\('folder_id'/)
  assert.match(webAdapter, /listSyncFolders: \(\) => api\.mediaSyncFolders\(\)/)
  assert.match(agentClient, /mediaSyncFolders\(\)/)
  assert.match(agentClient, /query\.set\('folder_id'/)
  assert.match(desktopIPC, /GET \/v1\/media\/sync-folders/)
  assert.match(desktopIPC, /GET \/v1\/media\/sync-folder/)
  assert.match(desktopMain, /agent:get-media-sync-folders/)
  assert.match(preload, /getMediaSyncFolders:/)
  assert.match(desktopAdapter, /listSyncFolders: \(\) => agent\.getMediaSyncFolders\(\)/)

  const selectSectionStart = sharedGalleryMain.indexOf('const selectSection = useCallback')
  const requestFacetsStart = sharedGalleryMain.indexOf('const requestFacets = useCallback', selectSectionStart)
  assert.equal(
    sharedGalleryMain.slice(selectSectionStart, requestFacetsStart).includes('folder_id'),
    false,
    'leaving synchronization-folder browsing via section navigation must clear folder scope',
  )
  assert.match(
    sharedGalleryMain.slice(selectSectionStart, requestFacetsStart),
    /syncFolderRequestID\.current \+= 1/,
    'section navigation must invalidate an in-flight synchronization-folder request',
  )

  const clearFiltersStart = sharedGalleryMain.indexOf('const clearFilters = useCallback')
  const createAlbumStart = sharedGalleryMain.indexOf('const createAlbum = useCallback', clearFiltersStart)
  assert.match(
    sharedGalleryMain.slice(clearFiltersStart, createAlbumStart),
    /currentFolderView \? \{ folder_id: currentFolderView\.current\.id \} : \{\}/,
    'clearing filters inside a synchronization folder must retain the directory scope',
  )

  const openAlbumStart = sharedGalleryMain.indexOf('const openAlbum = useCallback')
  const openPlaceStart = sharedGalleryMain.indexOf('const openPlace = useCallback', openAlbumStart)
  assert.match(
    sharedGalleryMain.slice(openAlbumStart, openPlaceStart),
    /syncFolderRequestID\.current \+= 1/,
    'opening a normal album must invalidate an in-flight synchronization-folder request',
  )
})

test('Gallery Viewer 2.0 is shared and reuses existing platform actions', () => {
  for (const token of [
    '<XDriveMediaGalleryViewer',
    'previewFilmstripEntries',
    'previewIndex - 6',
    'previewIndex + 6',
    'onToggleFavorite={onSetFavorite ? toggleFavorite : undefined}',
    'onInfo={openPreviewInfo}',
    'onDownload={onDownloadItems',
    'onShare={onShareItem}',
    'onDelete={onDeleteItems',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery Viewer wiring missing: ${token}`)
  }

  for (const token of [
    '<XDriveOpenPreviewDialog',
    '<XDriveMediaGalleryFilmstrip',
    'interactiveImage',
    'fullScreen={fullScreen}',
    'immersive',
    '收藏',
    '查看属性',
    '下载媒体',
    '分享媒体',
    '删除媒体',
  ]) {
    assert.ok(sharedGalleryViewer.includes(token), `shared Gallery Viewer missing: ${token}`)
  }

  assert.ok(sharedGalleryFilmstrip.includes('data-xdrive-gallery-filmstrip'))
  assert.match(webApp, /shareDialog=\{\{[\s\S]*adapter: shareDialogAdapter[\s\S]*expiryMode: 'datetime'/)
  assert.match(desktopApp, /shareDialog=\{\{[\s\S]*adapter: desktopShareDialogAdapter[\s\S]*expiryMode: 'days'/)
  assert.match(sharedGalleryMain, /<XDriveShareDialog[\s\S]*adapter=\{shareDialog\.adapter\}/)
  assert.equal(sharedGalleryViewer.includes('createShare'), false, 'Viewer must not create a parallel share implementation')
})

test('Gallery multi-select and Selection Toolbar stay shared across Web and Desktop', () => {
  for (const token of [
    'selectionMode',
    'selectedMediaItems',
    'selectionAnchorIndex',
    'handleMediaSelect',
    'rangeDistance <= 1000',
    'selectedNodeIDs',
    '<XDriveMediaGallerySelectionToolbar',
    'data-xdrive-gallery-selection-toolbar',
    'onSetFavoriteBatch',
    'onAddTagsBatch',
    'onAddItemsToAlbum',
    'onDeleteItems',
    'onDownloadItems',
  ]) {
    assert.ok(sharedGallery.includes(token), `Gallery selection contract missing: ${token}`)
  }

  for (const token of [
    '已选择',
    '添加到相册',
    '标签',
    '下载',
    '删除',
    '不会覆盖已有标签',
    '任务中心查看和取消',
  ]) {
    assert.ok(sharedGallerySelectionToolbar.includes(token), `Selection Toolbar missing: ${token}`)
  }

  assert.match(sharedGalleryAdapter, /setFavoriteBatch\?:/)
  assert.match(sharedGalleryAdapter, /addTagsBatch\?:/)
  assert.match(sharedGalleryAdapter, /deleteItems\?:/)
  assert.match(sharedGalleryAdapter, /downloadItems\?:/)

  assert.match(webAPI, /setMediaFavoriteBatch\(/)
  assert.match(webAPI, /addMediaTagsBatch\(/)
  assert.match(webAdapter, /api\.createFileOperation\(\s*'delete'/)
  assert.match(webAdapter, /api\.downloadArchive\(/)
  assert.match(desktopAdapter, /agent\.cloudCreateFileOperation\(\s*'delete'/)
  assert.match(desktopAdapter, /agent\.cloudDownloadArchive\(/)

  assert.match(preload, /setMediaFavoriteBatch:/)
  assert.match(preload, /addMediaTagsBatch:/)
  assert.match(agentClient, /setMediaFavoriteBatch\(/)
  assert.match(agentClient, /addMediaTagsBatch\(/)
  assert.match(desktopMain, /agent:set-media-favorite-batch/)
  assert.match(desktopMain, /agent:add-media-tags-batch/)
  assert.match(desktopIPC, /PATCH \/v1\/media\/favorites/)
  assert.match(desktopIPC, /POST \/v1\/media\/tags\/batch/)
})

test('Gallery Trash and reliable media collections stay shared and evidence-based', () => {
  for (const token of [
    "'trash'",
    '回收站',
    'listTrashItemRange',
    'restoreTrashItems',
    'permanentlyDeleteTrashItems',
    "section === 'trash'",
    '回收站为空',
    'GIF / 动图',
    '全景',
    'GPano/XMP',
    "activeMediaType === 'gif'",
    "activeMediaType === 'panorama'",
  ]) {
    assert.ok(sharedGallery.includes(token), `Gallery phase-4 surface missing: ${token}`)
  }

  for (const token of [
    'onRestore',
    'onPermanentDelete',
    '恢复',
    '永久删除',
    '对应 ',
    '包含已删除文件夹',
    '文件夹内的全部内容也会一起删除',
    '此操作无法撤销',
  ]) {
    assert.ok(sharedGallerySelectionToolbar.includes(token), `Trash toolbar missing: ${token}`)
  }

  assert.match(sharedModels, /trash_root\?: Node/)
  assert.match(sharedModels, /category\?: string/)
  assert.match(sharedGalleryAdapter, /xDriveMediaGalleryTrashRoots/)
  assert.match(sharedGalleryAdapter, /const root = item\.trash_root \?\? item\.node/)
  assert.match(webAdapter, /xDriveMediaGalleryTrashRoots/)
  assert.match(desktopAdapter, /xDriveMediaGalleryTrashRoots/)
  assert.match(webAdapter, /api\.restoreTrash/)
  assert.match(webAdapter, /api\.permanentlyDeleteTrash/)
  assert.match(desktopAdapter, /agent\.cloudRestoreTrash/)
  assert.match(desktopAdapter, /agent\.cloudDeleteTrash/)

  assert.match(sharedGalleryMain, /collectionSetFavorite = isTrashSection \? undefined/)
  assert.match(sharedGalleryMain, /collectionPreviewURL = isTrashSection \? undefined/)
  assert.match(sharedGalleryMain, /loadLivePhotoMotion=\{isTrashSection \? undefined/)
  assert.match(sharedGalleryMain, /if \(section === 'trash'\) \{\s*setSelected\(item\)\s*return\s*\}/, 'Trash click must open read-only Properties without launching Viewer')
  assert.match(sharedGalleryMain, /!isTrashSection && timeScale !== 'all'/)

  assert.match(webAPI, /values\.set\('category'/)
  assert.match(agentClient, /query\.set\('category'/)
  assert.match(desktopMain, /\['gif', 'panorama'\]/)

  for (const guessed of ['自拍', '截图', '录屏']) {
    assert.equal(
      sharedGalleryMain.includes(`label: '${guessed}'`),
      false,
      `${guessed} must not be exposed before deterministic local evidence exists`,
    )
  }
})

test('Gallery Places map is shared, local-first, and bounded to compact facets', () => {
  for (const token of [
    '<XDriveMediaGalleryPlacesMap',
    'placesExpandedRef',
    'source.listPlaces(placesExpandedRef.current ? 1000 : 24)',
    'places.slice(0, 24)',
    '地点列表',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery map wiring missing: ${token}`)
  }

  for (const token of [
    'data-xdrive-gallery-places-map',
    '本地 GPS 聚合',
    '不请求在线地图瓦片',
    'xDriveMediaPlacesCluster',
    'xDriveMediaPlacesFitViewport',
    'xDriveMediaPlacesPanViewport',
    'ResizeObserver',
    'onPointerDown',
    'onWheel',
  ]) {
    assert.ok(sharedGalleryPlacesMap.includes(token), `shared Places map missing: ${token}`)
  }

  for (const token of [
    'xDriveMediaPlacesProject',
    'xDriveMediaPlacesCluster',
    'xDriveMediaPlacesFitViewport',
    'xDriveMediaPlacesNormalizeLongitude',
  ]) {
    assert.ok(sharedGalleryPlacesMapModel.includes(token), `Places map model missing: ${token}`)
  }

  assert.equal(sharedGalleryPlacesMap.includes('tile.openstreetmap'), false)
  assert.equal(sharedGalleryPlacesMap.includes('maps.google'), false)
  assert.equal(sharedGalleryPlacesMap.includes('mapbox'), false)
  assert.equal(sharedGalleryPlacesMap.includes('https://'), false)
  assert.equal(sharedGalleryPlacesMap.includes('http://'), false)
})

test('Live Photo is one press-and-hold Gallery surface', () => {
  for (const token of [
    'export function XDriveLivePhotoSurface',
    'onPointerDown={handlePointerDown}',
    'onPointerUp={handlePointerRelease}',
    'onPointerCancel={handlePointerRelease}',
    'onPointerLeave={endHold}',
    'onKeyDown={handleKeyDown}',
    'onKeyUp={handleKeyUp}',
    'video.play()',
    'video.pause()',
    'video.currentTime = 0',
    'controls={false}',
    'playsInline',
    'preload="metadata"',
    'loadStartedRef.current',
    'loader(onProgress)',
    "variant={loadProgress === null ? 'indeterminate' : 'determinate'}",
    '按住播放，松开停止',
    'aria-pressed={playing}',
    'aria-busy={loading}',
  ]) {
    assert.ok(sharedLivePhotoSurface.includes(token), 'Live Photo surface missing: ' + token)
  }
  assert.equal(sharedLivePhotoSurface.includes('muted'), false, 'Live Photo motion must preserve audio capability')
  assert.match(webAPI, /live-photo-motion-ticket/)
  assert.match(webAPI, /mediaLivePhotoMotionURL\(nodeID: number\)/)
  assert.equal(webAPI.includes('responseBlobWithProgress'), false, 'Web Live Photo motion must not buffer the complete response Blob')
  assert.match(preload, /agent:media-live-photo-motion-progress/)
  assert.match(desktopMain, /agent:media-live-photo-motion-progress/)
  assert.match(desktopPreviewProxy, /coveredRanges/)
  assert.match(desktopPreviewProxy, /createURLFromTicket/)
  assert.match(desktopPreviewProxy, /releaseURL\(value: string\)/)
  assert.match(webAdapter, /mediaLivePhotoMotionURL\(nodeID\)/)
  assert.match(desktopAdapter, /getMediaLivePhotoMotion\(nodeID, onProgress\)/)
  assert.equal(sharedGallery.includes('实况视频'), false, 'Gallery must not render Live Photo as a separate video section')
  assert.ok(sharedGallery.includes('loadMotion={loadSelectedLivePhotoMotion}'), 'Gallery must delegate Live Photo motion loading to the shared surface')
  assert.match(sharedGallery, /still=\{\([\s\S]*?<XDriveFilePreviewSurface/, 'Live Photo still image should reuse the Preview Engine before thumbnail fallback')
})

test('Gallery basic non-destructive editing is one shared Preview Engine contract', () => {
  for (const token of [
    'export interface MediaEditRecipe',
    'export interface MediaEditRecipeInput',
    'edit_recipe?: MediaEditRecipe',
  ]) {
    assert.ok(sharedModels.includes(token), `media edit model missing: ${token}`)
  }

  for (const token of [
    'xDriveDefaultMediaEditInput',
    'xDriveMediaEditInputFromRecipe',
    'xDriveMediaEditPreviewTransform',
    'xDriveMediaItemSupportsBasicEditing',
  ]) {
    assert.ok(sharedMediaEdit.includes(token), `media edit helper missing: ${token}`)
  }

  for (const token of [
    'EditRoundedIcon',
    'XDriveMediaGalleryEditDialog',
    'onSaveEditRecipe',
    'onResetEditRecipe',
  ]) {
    assert.ok(sharedGalleryViewer.includes(token), `Viewer edit action contract missing: ${token}`)
  }
  assert.ok(
    sharedMediaViewerContent.includes('xDriveMediaEditPreviewTransform(item.edit_recipe)'),
    'shared media content must apply the saved edit recipe',
  )

  for (const token of [
    '原文件不会被改写',
    '当前“下载”仍下载原始文件',
    '裁剪时间',
    '水平翻转',
    '垂直翻转',
    '曝光',
    '对比度',
    '饱和度',
    'mediaTransform={xDriveMediaEditPreviewTransform(draft)}',
  ]) {
    assert.ok(sharedGalleryEditDialog.includes(token), `Edit dialog missing: ${token}`)
  }

  for (const token of [
    'mediaTransform?: XDriveFilePreviewMediaTransform',
    'XDriveTransformedImagePreview',
    'XDriveTransformedVideoPreview',
  ]) {
    assert.ok(sharedFilePreviewSurface.includes(token), `Preview transform wiring missing: ${token}`)
  }
  for (const token of [
    'component="canvas"',
    'context.drawImage(',
    'context.filter',
    'trimStart',
    'trimEnd',
    'video.currentTime',
    'rotationDegrees',
  ]) {
    assert.ok(sharedFilePreviewTransformed.includes(token), `transformed renderer missing: ${token}`)
  }

  for (const token of [
    'saveEditRecipe?:',
    'resetEditRecipe?:',
    'patchLoadedItems',
    'setPreviewItem',
    'setSelectedMediaItems',
    'data-xdrive-media-edited',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery edit controller missing: ${token}`)
  }
  assert.match(sharedGalleryDetails, /mediaTransform=\{xDriveMediaEditPreviewTransform\(item\.edit_recipe\)\}/)

  for (const token of ['saveEditRecipe:', 'resetEditRecipe:']) {
    assert.ok(sharedGalleryAdapter.includes(token), `shared adapter missing: ${token}`)
    assert.ok(webAdapter.includes(token), `Web adapter missing: ${token}`)
    assert.ok(desktopAdapter.includes(token), `Desktop adapter missing: ${token}`)
  }
  for (const token of [
    'saveMediaEditRecipe(',
    'resetMediaEditRecipe(',
    '/edit',
    "method: 'PUT'",
    "method: 'DELETE'",
  ]) {
    assert.ok(webAPI.includes(token), `Web media edit transport missing: ${token}`)
  }
  for (const token of [
    'agent:get-media-edit',
    'agent:save-media-edit',
    'agent:reset-media-edit',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload edit contract missing: ${token}`)
    assert.ok(desktopMain.includes(token), `Desktop main edit contract missing: ${token}`)
  }
  for (const token of [
    '/v1/media/edit',
    'saveMediaEditRecipe(',
    'resetMediaEditRecipe(',
  ]) {
    assert.ok(agentClient.includes(token), `Agent edit transport missing: ${token}`)
  }
  for (const token of [
    'GET /v1/media/edit',
    'PUT /v1/media/edit',
    'DELETE /v1/media/edit',
  ]) {
    assert.ok(desktopIPC.includes(token), `Desktop Agent IPC edit route missing: ${token}`)
  }

  assert.equal(
    sharedGalleryEditDialog.toLowerCase().includes('ffmpeg'),
    false,
    'shared editing must not require FFmpeg',
  )
})

test('Gallery Creative Tools expose shared durable Cutout and Smart Erase', () => {
  for (const token of [
    'AutoFixHighRoundedIcon',
    'XDriveMediaGalleryCreativeDialog',
    'xDriveMediaItemSupportsCreative',
    'aria-label="创作图片"',
    'onCreateCreativeGeneration',
    'onGetCreativeGeneration',
    'onCancelCreativeGeneration',
  ]) {
    assert.ok(sharedGalleryViewer.includes(token) || sharedGalleryMain.includes(token),
      `Viewer Creative Tools contract missing: ${token}`)
  }

  for (const token of [
    'data-xdrive-media-creative-dialog',
    'AI 抠图',
    '智能消除',
    '保留主体',
    '排除区域',
    'cutout_mode: \'object\'',
    'cutout_expand',
    'cutout_feather',
    '边缘调整',
    '羽化',
    'cutoutPointDragRef',
    'startCutoutPointDrag',
    "kind: 'cutout'",
    "kind: 'erase'",
    'strokes',
    '取消任务',
    '结果已保存到原图所在文件夹',
    '结果保存为新文件，原图不会被修改',
    'if (!terminalCreativeStates.has(next.state)) poll()',
  ]) {
    assert.ok(sharedGalleryCreativeDialog.includes(token),
      `Creative dialog contract missing: ${token}`)
  }

  assert.match(sharedModels, /cutout_expand\?: number/)
  assert.match(sharedModels, /cutout_feather\?: number/)
  assert.match(agentClient, /cutout_expand\?: number/)
  assert.match(agentClient, /cutout_feather\?: number/)

  for (const token of [
    'createCreativeGeneration:',
    'getCreativeGeneration:',
    'cancelCreativeGeneration:',
  ]) {
    assert.ok(sharedGalleryAdapter.includes(token), `shared creative adapter missing: ${token}`)
    assert.ok(webAdapter.includes(token), `Web creative adapter missing: ${token}`)
    assert.ok(desktopAdapter.includes(token), `Desktop creative adapter missing: ${token}`)
  }

  for (const token of [
    'createMediaCreativeGeneration(',
    'mediaCreativeGeneration(',
    'cancelMediaCreativeGeneration(',
    '/creative',
  ]) {
    assert.ok(webAPI.includes(token), `Web creative transport missing: ${token}`)
    assert.ok(agentClient.includes(token), `Agent creative transport missing: ${token}`)
  }

  for (const token of [
    'agent:create-media-creative',
    'agent:get-media-creative',
    'agent:cancel-media-creative',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload creative contract missing: ${token}`)
    assert.ok(desktopMain.includes(token), `Desktop main creative contract missing: ${token}`)
  }

  for (const token of [
    'POST /v1/media/creative',
    'GET /v1/media/creative',
    'POST /v1/media/creative/cancel',
  ]) {
    assert.ok(desktopIPC.includes(token), `Desktop Agent creative route missing: ${token}`)
  }
})

test('Gallery Collage is a shared multi-selection creative workflow', () => {
  for (const token of [
    'XDriveMediaGalleryCollageDialog',
    'xDriveMediaItemSupportsCollage',
    'collageSelectionEligible',
    'selectedMedia.length >= 2',
    'selectedMedia.length <= 9',
    'setCollageDialogItems([...selectedMedia])',
    'onCreateCollage=',
  ]) {
    assert.ok(
      sharedGalleryMain.includes(token) || sharedGallerySelectionToolbar.includes(token),
      `collage Gallery contract missing: ${token}`,
    )
  }

  for (const token of [
    'data-xdrive-gallery-collage-dialog',
    '拼图',
    "kind: 'collage'",
    'source_node_ids',
    'collage_template',
    '2–9 张普通照片',
    "loadPreviewURL(generation.output_node_id, 'image')",
    'if (!terminalCollageStates.has(next.state)) poll()',
    'collageActionGenerationRef',
    'actionGeneration === collageActionGenerationRef.current',
  ]) {
    assert.ok(sharedGalleryCollageDialog.includes(token), `collage dialog contract missing: ${token}`)
  }

  assert.match(sharedModels, /collage_template\?: 'grid' \| 'featured' \| 'columns' \| 'rows'/)
  for (const source of [webAdapter, desktopAdapter, sharedGalleryAdapter]) {
    assert.ok(source.includes('createCreativeGeneration'))
    assert.equal(source.includes('createCollage'), false)
  }
})

test('Gallery music picker reuses shared FileExplorer and thin platform listing adapters', () => {
  for (const token of [
    'data-xdrive-gallery-music-picker',
    'XDriveFileExplorer',
    'xDriveMediaGalleryMusicNodeSupported',
    'AAC、FLAC、M4A、MP3、OGG、WAV、WMA',
    'onSelectionChange',
    'onOpenItem',
    'onCrumbClick',
  ]) {
    assert.ok(sharedGalleryMusicPickerDialog.includes(token), `music picker contract missing: ${token}`)
  }
  for (const token of ['loadMusicRoot', 'listMusicChildren']) {
    assert.ok(sharedGalleryMain.includes(token) || sharedGalleryAdapter.includes(token))
  }
  assert.ok(webAdapter.includes('loadMusicRoot: () => api.root()'))
  assert.ok(webAdapter.includes('listMusicChildren: (parentID) => api.list(parentID)'))
  assert.ok(desktopAdapter.includes('loadMusicRoot: () => agent.cloudRoot()'))
  assert.ok(desktopAdapter.includes('listMusicChildren: (parentID) => agent.cloudChildren(parentID)'))
})

test('Gallery Automatic Movie is a shared multi-selection creative workflow', () => {
  for (const token of [
    'XDriveMediaGalleryMovieDialog',
    'xDriveMediaItemSupportsAutoMovie',
    'movieSelectionEligible',
    'selectedMedia.length >= 2',
    'selectedMedia.length <= 30',
    'setMovieDialogItems([...selectedMedia])',
    'onCreateMovie=',
  ]) {
    assert.ok(
      sharedGalleryMain.includes(token) || sharedGallerySelectionToolbar.includes(token),
      `automatic movie Gallery contract missing: ${token}`,
    )
  }

  for (const token of [
    'data-xdrive-gallery-movie-dialog',
    '自动电影',
    "kind: 'movie'",
    'source_node_ids',
    'movie_template',
    'music_node_id',
    '经典适配',
    '满屏裁切',
    'Ken Burns',
    '选择音乐',
    'XDriveMediaGalleryMusicPickerDialog',
    'frame_duration_ms',
    'transition_ms',
    '2–30 张普通照片',
    '本地 FFmpeg 编码',
    "loadPreviewURL(generation.output_node_id, 'video')",
    'if (!terminalMovieStates.has(next.state)) poll()',
  ]) {
    assert.ok(
      sharedGalleryMovieDialog.includes(token),
      `automatic movie dialog contract missing: ${token}`,
    )
  }

  assert.match(sharedModels, /MediaCreativeKind = 'cutout' \| 'erase' \| 'movie' \| 'collage'/)
  assert.match(sharedModels, /source_node_ids\?: number\[\]/)
  assert.match(sharedModels, /movie_template\?: 'classic' \| 'fill' \| 'ken_burns'/)
  assert.match(sharedModels, /music_node_id\?: number/)
  assert.match(sharedModels, /frame_duration_ms\?: number/)
  assert.match(sharedModels, /transition_ms\?: number/)

  for (const source of [webAdapter, desktopAdapter, sharedGalleryAdapter]) {
    assert.ok(
      source.includes('createCreativeGeneration'),
      'automatic movie must reuse the existing shared creative transport',
    )
    assert.equal(
      source.includes('createMovie'),
      false,
      'automatic movie must not introduce a platform-specific movie endpoint',
    )
  }
})

test('Gallery contracts are node-level and connector-neutral', () => {
  assert.match(sharedModels, /export interface MediaItem \{\s*node: Node\s*metadata: MediaMetadata/s)
  assert.match(sharedModels, /export interface MediaTimelineGroupIndex \{[\s\S]*item_count: number[\s\S]*start_index: number/)
  assert.match(sharedModels, /export interface MediaTimelineGroupSets/)
  assert.match(sharedModels, /year: MediaTimelineGroupIndex\[\]/)
  assert.match(sharedModels, /month: MediaTimelineGroupIndex\[\]/)
  assert.match(sharedModels, /day: MediaTimelineGroupIndex\[\]/)
  assert.match(sharedModels, /export interface MediaItemRange \{[\s\S]*total_count: number[\s\S]*offset: number[\s\S]*limit: number[\s\S]*timeline_groups\?: MediaTimelineGroupIndex\[\][\s\S]*timeline_group_sets\?: MediaTimelineGroupSets/)
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
  assert.match(sharedGallery, /!currentAlbum && !currentFolderView && !currentSuggestedPerson && source\.createSmartAlbum/)
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
  assert.match(sharedGallery, /待确认建议/)
  assert.match(sharedGallery, /本地人脸聚类快照；确认后成为长期人物/)
  assert.match(sharedGallery, /暂不处理/)
  assert.match(sharedGallery, /已确认人物/)
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
    'listTrashItemRange:',
    'listSuggestedPersonItemRange:',
    'listPersonItemRange:',
    'listMemoryItemRange:',
    'listDuplicateItemRange:',
    'listBurstReviewItemRange:',
    'listPetItemRange:',
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
  assert.match(webAPI, /category/)
  assert.match(agentClient, /category/)
  assert.match(desktopIPC, /Category/)

  for (const token of ['mediaItems(', 'mediaItemRange(', 'mediaFacets(', 'mediaTrashRange(', 'mediaAlbums()', 'mediaPlaces(', 'mediaMemories(', 'mediaMemoryItemRange(', 'mediaDuplicateGroups(', 'mediaDuplicateItemRange(', 'mediaBurstReviews(', 'mediaBurstReviewItemRange(', 'mediaPets()', 'mediaPetItemRange(', 'mediaSuggestedPeopleWithReview(', 'reviewMediaSuggestedPerson(', 'addMediaSuggestedPersonToPerson(', 'mediaSuggestedPeople(', 'mediaSuggestedPersonItems(', 'mediaSuggestedPersonItemRange(', 'mediaPeople(', 'mediaPersonItems(', 'mediaPersonItemRange(', 'adoptMediaSuggestedPerson(', 'updateMediaPerson(', 'mergeMediaPeople(', 'splitMediaPerson(', 'mediaAlbumItems(', 'mediaAlbumItemRange(', 'createMediaAlbum(', 'renameMediaAlbum(', 'deleteMediaAlbum(', 'createSmartMediaAlbum(', 'updateSmartMediaAlbum(', 'deleteSmartMediaAlbum(', 'addMediaAlbumItems(', 'removeMediaAlbumItem(', 'setMediaFavorite(', 'setMediaTags(', 'setMediaPeople(', 'setMediaDescription(', 'mediaThumbnail(', 'mediaLivePhotoMotionURL(', 'filePreviewURL(', 'appendMediaGalleryQuery(', 'preview-ticket']) {
    assert.ok(webAPI.includes(token), `Web API missing ${token}`)
  }

  for (const token of [
    'api.mediaItems(',
    'api.mediaItemRange(',
    'api.mediaFacets(',
    'api.mediaTrashRange(',
    'api.mediaAlbums()',
    'api.mediaPlaces(',
    'api.mediaMemories(',
    'api.mediaMemoryItemRange(',
    'api.mediaDuplicateGroups(',
    'api.mediaDuplicateItemRange(',
    'api.mediaBurstReviews(',
    'api.mediaBurstReviewItemRange(',
    'api.mediaPets(',
    'api.mediaPetItemRange(',
    'api.mediaSuggestedPeopleWithReview(',
    'api.reviewMediaSuggestedPerson(',
    'api.addMediaSuggestedPersonToPerson(',
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
    'api.mediaLivePhotoMotionURL(',
    'api.filePreviewURL(',
  ]) {
    assert.ok(webAdapter.includes(token), `Web Gallery adapter missing ${token}`)
  }

  for (const token of [
    'getMediaItems:',
    'getMediaItemRange:',
    'getMediaFacets:',
    'getMediaTrash:',
    'getMediaAlbums:',
    'getMediaPlaces:',
    'getMediaMemories:',
    'getMediaMemoryItemRange:',
    'getMediaDuplicateGroups:',
    'getMediaDuplicateItemRange:',
    'getMediaBurstReviews:',
    'getMediaBurstReviewItemRange:',
    'getMediaPets:',
    'getMediaPetItemRange:',
    'getMediaSuggestedPeopleWithReview:',
    'reviewMediaSuggestedPerson:',
    'addMediaSuggestedPersonToPerson:',
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
    'releaseMediaLivePhotoMotion:',
    'cloudFilePreviewURL:',
  ]) {
    assert.ok(preload.includes(token), `Desktop preload missing ${token}`)
  }

  for (const token of [
    'mediaItems(',
    'mediaItemRange(',
    'mediaTrash(',
    'mediaAlbums()',
    'mediaPlaces(',
    'mediaMemories(',
    'mediaMemoryItemRange(',
    'mediaDuplicateGroups(',
    'mediaDuplicateItemRange(',
    'mediaBurstReviews(',
    'mediaBurstReviewItemRange(',
    'mediaPets()',
    'mediaPetItemRange(',
    'mediaSuggestedPeopleWithReview(',
    'reviewMediaSuggestedPerson(',
    'addMediaSuggestedPersonToPerson(',
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
    'mediaLivePhotoStillTicket(',
    'mediaLivePhotoMotionTicket(',
    'cloudFilePreviewTicket(nodeID:',
  ]) {
    assert.ok(agentClient.includes(token), `Desktop Agent client missing ${token}`)
  }

  assert.ok(
    agentClient.includes('mediaLivePhotoMotionTicket(nodeID: number)'),
    'Desktop Agent client must request a Live Photo motion stream ticket',
  )
  assert.equal(
    agentClient.includes('mediaLivePhotoMotion(\n    nodeID: number,'),
    false,
    'Desktop Agent client must not buffer Live Photo motion bytes',
  )

  assert.ok(desktopIPC.includes('"media-gallery"'))
  assert.ok(desktopIPC.includes('GET /v1/media/items'))
  assert.ok(desktopIPC.includes('GET /v1/media/trash'))
  assert.ok(desktopIPC.includes('GET /v1/media/albums'))
  assert.ok(desktopIPC.includes('GET /v1/media/places'))
  assert.ok(desktopIPC.includes('GET /v1/media/memories'))
  assert.ok(desktopIPC.includes('GET /v1/media/memory-items'))
  assert.ok(desktopIPC.includes('GET /v1/media/duplicates'))
  assert.ok(desktopIPC.includes('GET /v1/media/duplicate-items'))
  assert.ok(desktopIPC.includes('GET /v1/media/bursts'))
  assert.ok(desktopIPC.includes('GET /v1/media/burst-items'))
  assert.ok(desktopIPC.includes('GET /v1/media/pets'))
  assert.ok(desktopIPC.includes('GET /v1/media/pet-items'))
  assert.ok(desktopIPC.includes('PATCH /v1/media/people/suggestion-review'))
  assert.ok(desktopIPC.includes('POST /v1/media/people/add-suggestion'))
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
  assert.ok(desktopIPC.includes('GET /v1/media/live-photo-still-ticket'))
  assert.ok(desktopIPC.includes('GET /v1/media/live-photo-motion-ticket'))
  assert.match(desktopAdapter, /cloudFilePreviewURL/)
  assert.match(agentClient, /data: ArrayBuffer/)
  assert.match(
    agentClient,
    /mediaLivePhotoMotionTicket\(nodeID: number\)[\s\S]*AgentFilePreviewTicket/,
  )
  assert.ok(desktopMain.includes('filePreviewProxy.createURLFromTicket('))
  assert.ok(desktopMain.includes("'agent:get-media-live-photo-still'"))
  assert.ok(preload.includes('getMediaLivePhotoStill:'))
  assert.ok(webAPI.includes('mediaLivePhotoStillURL('))
  assert.ok(desktopMain.includes("'agent:release-media-live-photo-motion'"))
  assert.ok(preload.includes('mediaLivePhotoProgressByURL'))
  assert.ok(preload.includes('releaseMediaLivePhotoMotion:'))
  assert.ok(desktopAdapter.includes('releaseMediaLivePhotoMotion(result.data)'))
  assert.ok(desktopPreviewProxy.includes('mergeByteRanges'))
  assert.ok(desktopPreviewProxy.includes('ticket.controllers'))
  assert.match(agentClient, /requestBinary\(/)
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
  assert.equal(agentClient.includes('data_base64'), false)
  assert.equal(agentClient.includes('media_token'), false, 'Desktop discovery must not keep a second media token')
  assert.equal(desktopIPC.includes('"media-video-stream"'), false, 'Agent must expose only the generic file-preview stream capability')
  assert.equal(desktopIPC.includes('GET /v1/media/video'), false, 'Agent must not keep the legacy media video stream route')
  assert.ok(desktopIPC.includes('PUT /v1/media/video-poster'), 'Agent must expose the bounded video-poster cache backfill route')
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
  assert.match(sharedWorkspaceNavigation, /key: 'gallery',\s*label: '图库'/, 'shared core navigation model must expose Gallery with its label')
  assert.ok(sharedSidebar.includes('xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage, showGlobalTasks })'), 'shared sidebar must consume the canonical core navigation model')
  assert.ok(sharedSidebar.includes('selected={selected === destination.key}'), 'shared core navigation must select Gallery by its destination key')
  assert.ok(sharedSidebar.includes('primary={destination.label}'), 'shared sidebar must render the Gallery label from its destination')
})

test('Web exposes Home, files, Gallery, Sync Folders, Local Storage, and Cloud Storage as first-class workspace views', () => {
  assert.ok(webApp.includes('type AppView = XDriveWorkspaceViewKey<'), 'Web workspace view type must include Local Storage')
  assert.ok(webApp.includes('useXDriveWebAppRuntime()'), 'Web workspace selection must come from the Web App Runtime')
  assert.ok(webApp.includes("?? 'overview'"), 'Home should remain the fallback initial Web workspace')
  assert.ok(webApp.includes("key: 'overview'") && webApp.includes("label: '主页'"), 'Web must expose Home before the shared core')
  for (const view of ['files', 'gallery', 'sources', 'local-storage', 'cloud-storage']) {
    assert.ok(sharedRoute.includes(`'${view}'`), `shared workspace route missing first-class workspace: ${view}`)
  }
  assert.ok(webApp.includes('<XDriveWorkspaceSidebar'), 'Web must expose first-class workspaces through the shared workspace sidebar')
  assert.ok(webApp.includes('selected={appView}'), 'Web must pass its active workspace to shared core navigation')
  assert.ok(sharedSidebar.includes('xDriveCoreWorkspaceDestinations({ transferBadge, showLocalStorage, showGlobalTasks })'), 'shared sidebar must consume the canonical core navigation model')
  assert.ok(sharedSidebar.includes('primary={destination.label}'), 'shared sidebar must render each label from its core destination')
  for (const label of ['文件', '图库', '同步文件夹', '本地存储', '云端存储']) {
    assert.ok(sharedWorkspaceNavigation.includes(`label: '${label}'`), `shared core navigation model missing label: ${label}`)
  }
  assert.match(webApp, /<XDriveSourceManager[\s\S]*defaultTargetNodeID=/)
  assert.equal(fs.existsSync(path.join(repo, 'web', 'src', 'ExternalSources.tsx')), false, 'Web must not keep a pass-through Source manager wrapper')
  assert.ok(webApp.includes('<XDriveLocalStoragePage source={localStorageSource} />'), 'Web must render shared Local Storage')
  assert.ok(webApp.includes('<XDriveCloudStoragePage source={cloudStorageSource} />'), 'Web cloud storage must use the shared workspace')
  assert.equal(webApp.includes('setSourcesOpen'), false)
  assert.equal(webApp.includes("setStorageStatsScope('self')"), false)
  assert.ok(webApp.includes('<WebFileExplorer'), 'Web files workspace should use the shared Explorer adapter')
  assert.equal((webApp.match(/<Paper className="file-card"/g) || []).length, 0, 'legacy Web file-card must not return')
})


test('Gallery media details use shared responsive Inspector and Drawer instead of a modal', () => {
  assert.ok(sharedGalleryMain.includes('<XDriveMediaDetailsInspector'), 'Gallery must render the shared media inspector')
  assert.ok(sharedGalleryDetails.includes('export function XDriveMediaDetailsContent'), 'missing reusable MediaGallery details content')
  assert.equal(sharedGalleryDetails.includes('<Dialog'), false, 'MediaGallery details content must not own a modal Dialog')
  assert.equal(sharedGalleryMain.includes('<XDriveMediaDetailsDialog'), false, 'legacy media-details Dialog must be removed')
  assert.match(sharedGalleryMain, /pr: \{ lg: selected && !previewItem \? '380px' : 0 \}/)
  assert.match(sharedGalleryMain, /overlayZIndex=\{previewItem \? 1400 : undefined\}/)
  assert.match(sharedGalleryMain, /onSetFavorite=\{!isTrashSection && onSetFavorite/)

  for (const token of [
    'export function XDriveMediaDetailsInspector',
    "theme.breakpoints.up('lg')",
    'data-xdrive-media-inspector',
    '<Drawer',
    'anchor="bottom"',
    'data-xdrive-media-details-drawer',
    '<XDriveMediaDetailsContent',
  ]) {
    assert.ok(sharedGalleryInspector.includes(token), `Gallery Inspector missing: ${token}`)
  }

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
    'xDriveCaptureVideoPosterBlob',
    'revokeIfBlob',
    'export function xDriveMediaFallback',
  ]) {
    assert.ok(sharedGalleryPreview.includes(token), `MediaGalleryPreviewMedia missing: ${token}`)
  }
  assert.ok(sharedGalleryVideoPoster.includes('URL.createObjectURL'), 'Persisted video poster resolver must own cold Blob URL creation')
  for (const token of [
    'export function xDriveCaptureVideoPosterBlob',
    'xDriveMediaVideoPosterGeometry',
    'drawImage',
    'toBlob',
  ]) {
    assert.ok(sharedGalleryVideoPoster.includes(token), `MediaGalleryVideoPoster missing: ${token}`)
  }
  assert.ok(sharedGalleryUtils.includes('export function xDriveMediaGalleryErrorMessage'), 'shared Gallery error helper is missing')
  assert.ok(sharedGalleryUtils.includes('export function xDriveMediaFormatDuration'), 'shared Gallery duration helper is missing')
})


test('Gallery delegates filter mapping and advanced-filter presentation to the shared filter module', () => {
  assert.ok(sharedGalleryMain.includes('<XDriveMediaGalleryFilterToolbar'), 'Gallery page must render the compact shared filter toolbar')
  assert.ok(sharedGalleryFilters.includes('export function XDriveMediaGalleryFilterBar'), 'missing Gallery advanced filter form')
  assert.ok(sharedGalleryFilters.includes('export function XDriveMediaGalleryFilterToolbar'), 'missing Gallery filter toolbar')
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
  assert.match(sharedGalleryFilters, /useState<HTMLElement \| null>/, 'shared filter toolbar must own Popover anchor state')
  assert.match(sharedGalleryFilters, /<Popover/, 'advanced Gallery filters must live behind the shared Popover')
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
    'timelineGroupSets={timelineGroupSets}',
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
    'XDRIVE_MEDIA_GALLERY_GRID_GAP = 4',
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

test('Gallery time scales map compact group indexes onto the shared sparse VirtualCollection', () => {
  for (const token of [
    'timelineGroupSets={timelineGroupSets}',
    'setTimelineGroupSets(mediaTimelineGroupSetsFromRange(range))',
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
  assert.ok(sharedGalleryMain.includes('mediaTimelineGroups(items, effectiveTimeScale, sortBy, sortDir, timeZone)'), 'standalone dense fallback uses current order without materializing the sparse collection')
  assert.equal(sharedGalleryMain.includes('const loadMore = useCallback'), false, 'Gallery controller must not append dense pages')
  for (const token of [
    'searchActive={Boolean(query.search?.trim())}',
    'searchActive || currentCleanupReview',
    "? 'all' : timeScale",
    'showCollectionTimeScale',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery relevance-mode contract missing: ${token}`)
  }
  assert.match(sharedModels, /search_order\?: 'relevance' \| 'time' \| string/)
})

test('Gallery time-scale preferences persist per scale and preserve the browsing anchor', () => {
  for (const token of [
    "xdrive.gallery.view-preferences.v1",
    'year: 96',
    'month: 144',
    'day: 192',
    'all: 144',
    'densityByScale',
    'restoreAnchorIndex',
    'restoreAnchorRevision',
    'onVisibleAnchorChange',
    'data-xdrive-gallery-sticky-date',
    'data-xdrive-gallery-timeline-jump',
    'xDriveMediaGalleryTimelineGroupLabel',
    'window.localStorage.setItem',
  ]) {
    assert.ok(sharedGalleryMain.includes(token), `Gallery date-browsing memory missing: ${token}`)
  }
  assert.ok(
    sharedGalleryMain.includes('viewAnchorIndexRef.current = Math.max(0, Math.trunc(group.start_index))'),
    'timeline jump must preserve logical sparse indexes instead of materializing media',
  )
  assert.ok(
    sharedGalleryMain.includes('collection.onRangeChange('),
    'anchor restore must stay on the existing sparse VirtualCollection range contract',
  )
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


test('Desktop Live Photo motion streams through the protected Range proxy instead of renderer buffers', () => {
  assert.ok(desktopMain.includes('mediaLivePhotoMotionTicket(nodeID)'))
  assert.ok(desktopMain.includes('filePreviewProxy.createURLFromTicket('))
  assert.ok(desktopPreviewProxy.includes("headers: req.headers.range ? { Range: req.headers.range } : undefined"))
  assert.ok(desktopPreviewProxy.includes('responseByteRange(upstream)'))
  assert.ok(desktopPreviewProxy.includes('mergeByteRanges'))
  assert.ok(preload.includes('cleanupMediaLivePhotoProgress'))
  assert.ok(preload.includes('releaseMediaLivePhotoMotion:'))
  assert.ok(desktopAdapter.includes('dispose: () =>'))
  assert.equal(agentClient.includes('Promise<AgentMediaMotion>'), false)
  assert.equal(desktopMain.includes('runAgentAction<AgentMediaMotion>'), false)
})
