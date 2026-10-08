const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const openPreview = read('ui', 'shared', 'src', 'mui', 'FileOpenPreviewDialog.tsx')
const quickLook = read('ui', 'shared', 'src', 'mui', 'FileQuickLookDialog.tsx')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const galleryViewer = read('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
const mediaViewerContent = read('ui', 'shared', 'src', 'mui', 'MediaViewerContent.tsx')
const galleryFilmstrip = read('ui', 'shared', 'src', 'mui', 'MediaGalleryFilmstrip.tsx')
const preview = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const livePhoto = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
const previewModel = read('ui', 'shared', 'src', 'file-preview.ts')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const webViewers = read('web', 'src', 'WebFileViewerApps.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const actions = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const docs = read('docs', 'preview-engine.md')

test('FileExplorer and Gallery share one open-preview dialog shell', () => {
  assert.ok(index.includes("export * from './FileOpenPreviewDialog'"), 'shared MUI index must export OpenPreviewDialog')
  assert.ok(openPreview.includes('export function XDriveOpenPreviewDialog'), 'shared OpenPreviewDialog is missing')
  assert.ok(quickLook.includes('<XDriveOpenPreviewDialog'), 'Quick Look must reuse OpenPreviewDialog')
  assert.ok(gallery.includes('<XDriveMediaGalleryViewer'), 'Gallery must delegate media open to the shared Gallery Viewer')
  assert.ok(galleryViewer.includes('<XDriveOpenPreviewDialog'), 'Gallery Viewer must reuse OpenPreviewDialog')
  assert.ok(galleryViewer.includes('<XDriveMediaViewerContent'), 'Gallery Viewer must delegate semantic media rendering to the shared content layer')
  assert.ok(quickLook.includes('<XDriveFilePreviewSurface'), 'Quick Look must keep the shared Preview Engine renderer')
  assert.ok(mediaViewerContent.includes('<XDriveFilePreviewSurface'), 'shared media content must keep the shared Preview Engine renderer')
  assert.ok(preview.includes('xDriveClassifyFilePreview'), 'ordinary open preview must inherit the canonical preview classifier')
})

test('Web ordinary Open dispatches Web programs while explicit Download remains separate', () => {
  const openStart = web.indexOf('const openWebNode = (node: Node, item?: XDriveFileExplorerItem) =>')
  const downloadStart = web.indexOf('const downloadSelected = async')
  assert.ok(openStart >= 0 && downloadStart > openStart, 'Web Open/Download adapters are missing')
  const openBlock = web.slice(openStart, downloadStart)
  assert.ok(openBlock.includes('onOpenFile(') && openBlock.includes('browseContextForItem(item)'), 'Web Open must dispatch to the Web App Resolver')
  assert.equal(openBlock.includes('api.download('), false, 'Web Open must not implicitly download')
  assert.ok(web.includes('await api.download(plan.file)'), 'explicit single-file Download must remain available')
  assert.ok(web.includes('await api.downloadArchive(plan.ids, plan.filename)'), 'explicit archive Download must remain available')
  assert.equal(web.includes('XDriveOpenPreviewDialog'), false, 'Web FileExplorer must not keep an ordinary local preview dialog')
  assert.ok(webViewers.includes('export function xDriveWebOpenRouteForNode'), 'Web viewer resolver is missing')
  assert.ok(webViewers.includes("app: 'media-viewer'"), 'media files must resolve to media-viewer')
  assert.ok(webViewers.includes("app: 'text-viewer'"), 'text files must resolve to text-viewer')
  assert.ok(webViewers.includes("app: 'pdf-viewer'"), 'PDF files must resolve to pdf-viewer')
  assert.ok(webViewers.includes("app: 'audio-player'"), 'audio files must resolve to audio-player')
})

test('Desktop FileExplorer ordinary Open uses the OS while Quick Look stays shared', () => {
  for (const token of [
    "onOpen: node.type === 'file'",
    'void openLocalNode(node)',
    'onReveal: () => { void openLocalNode(node, true) }',
    'loadTextPreview={textPreviewSupported ? loadTextPreview : undefined}',
    'loadPreviewURL={previewStreamSupported ? loadPreviewURL : undefined}',
    'loadLivePhotoMotion={loadLivePhotoMotion}',
  ]) {
    assert.ok(desktop.includes(token), 'Desktop open/Quick Look contract missing: ' + token)
  }
  assert.equal(desktop.includes('openPreviewNode'), false, 'Desktop ordinary Open must not create an xDrive preview dialog')
  assert.equal(desktop.includes('XDriveOpenPreviewDialog'), false, 'Desktop ordinary Open dialog must be removed from the adapter')
  assert.equal(desktop.includes("onSystemOpen: node.type === 'file'"), false, 'Desktop must not duplicate ordinary Open with an explicit system-open item')
  assert.ok(actions.includes("id: 'system-open'"), 'shared menu primitive may retain optional system-open support for other adapters')
})

test('Gallery single click keeps media details while selection gestures stay distinct', () => {
  for (const token of [
    'const clickTimerRef = useRef<number | null>(null)',
    'const openDetails = () =>',
    'const openPreview = () =>',
    'onClick={(event) =>',
    'if (selectionMode || event.ctrlKey || event.metaKey || event.shiftKey)',
    'openDetails()',
    'onDoubleClick={(event) =>',
    'if (!selectionMode) openPreview()',
    'onPreview(item)',
    'const [selected, setSelected] = useState<MediaItem | null>(null)',
    'const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)',
    'onOpen={openMediaItem}',
    'onPreview={openMediaPreview}',
    '<XDriveMediaDetailsInspector',
    '<XDriveMediaGalleryViewer',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery open/details split missing: ' + token)
  }
})

test('Gallery Live Photo keeps semantic motion inside the shared open-preview shell', () => {
  for (const token of [
    'livePhoto && loadLivePhotoMotion',
    '<XDriveLivePhotoSurface',
    'loadMotion={loadOpenLivePhotoMotion}',
    'still={(',
    '<XDriveFilePreviewSurface',
    "previewKind === 'live_photo'",
    'loadLivePhotoMotion={loadSurfaceLivePhotoMotion}',
  ]) {
    assert.ok(mediaViewerContent.includes(token), 'shared media Live Photo preview missing: ' + token)
  }
  assert.ok(galleryViewer.includes('<XDriveMediaViewerContent'), 'Gallery Viewer must use shared semantic media content')
  assert.ok(livePhoto.includes('video.play()'), 'Live Photo semantic motion surface must remain intact')
  assert.ok(mediaViewerContent.includes('onProgress?: Parameters<MediaMotionLoader>[1]'), 'shared media content must preserve lazy Live Photo byte progress')
  assert.equal(openPreview.includes('loadMotion'), false, 'OpenPreviewDialog must stay media-semantic neutral')
})

test('Gallery Viewer 2.0 adds immersive chrome, fullscreen, bounded filmstrip and optional image zoom', () => {
  for (const token of [
    'actions?: ReactNode',
    'footer?: ReactNode',
    'immersive?: boolean',
    'fullScreen?: boolean',
    'onFullScreenChange?:',
    'data-xdrive-preview-chrome="header"',
    'data-xdrive-preview-chrome="footer"',
    'chromeAutoHideMs = 2200',
  ]) {
    assert.ok(openPreview.includes(token), 'OpenPreviewDialog immersive shell missing: ' + token)
  }

  for (const token of [
    'interactiveImage?: boolean',
    'data-xdrive-preview-zoom',
    'data-xdrive-preview-zoom-controls',
    'setPointerCapture',
    'releasePointerCapture',
    'onWheel={handleImageWheel}',
    'setImageZoom(imageScale > 1 ? 1 : 2)',
    'imagePointersRef',
    'imagePinchRef',
    'imageSwipeRef',
    'data-xdrive-preview-pinch',
    'data-xdrive-preview-swipe',
    'Math.min(6, Math.max(1',
  ]) {
    assert.ok(preview.includes(token), 'shared image zoom/pan contract missing: ' + token)
  }

  for (const token of [
    'data-xdrive-gallery-filmstrip',
    'activeIndex',
    'onSelect(index)',
  ]) {
    assert.ok(galleryFilmstrip.includes(token), 'Gallery filmstrip missing: ' + token)
  }

  for (const token of [
    'immersive',
    'fullScreen={fullScreen}',
    'onFullScreenChange={setFullScreen}',
    '<XDriveMediaGalleryFilmstrip',
    'interactiveImage',
    '收藏',
    '媒体信息',
    '下载媒体',
    '分享媒体',
    '删除媒体',
  ]) {
    assert.ok(galleryViewer.includes(token), 'Gallery Viewer 2.0 missing: ' + token)
  }

  assert.ok(gallery.includes('previewIndex - 6'), 'Gallery Viewer neighbor prefetch must stay bounded')
  assert.ok(gallery.includes('previewIndex + 6'), 'Gallery Viewer neighbor prefetch must stay bounded')
  assert.ok(gallery.includes('previewIndex - 5'), 'Gallery filmstrip must render a small local window')
  assert.ok(gallery.includes('previewIndex + 5'), 'Gallery filmstrip must render a small local window')
  assert.equal(gallery.includes('new Array(logicalItemCount)'), false, 'Viewer must not materialize the whole Gallery')
})

test('FileExplorer LIVP preview reuses the shared Live Photo surface on Web and Desktop', () => {
  for (const token of [
    "previewKind === 'live_photo'",
    '<XDriveLivePhotoSurface',
    'loadLivePhotoMotion',
  ]) assert.ok(preview.includes(token), 'shared LIVP preview missing: ' + token)

  assert.ok(
    web.includes('api.mediaLivePhotoStillURL(Number(item.id))'),
    'Web FileExplorer must use the signed LIVP still preview before thumbnail fallback',
  )
  assert.ok(
    desktop.includes('getMediaLivePhotoStill(Number(item.id))'),
    'Desktop FileExplorer must use the protected LIVP still preview before thumbnail fallback',
  )
  assert.ok(
    preview.includes("kind: Exclude<XDriveFilePreviewKind, 'none' | 'text'>"),
    'shared Preview Engine must admit live_photo through the signed preview URL loader',
  )
  assert.ok(
    preview.includes('<XDriveDecodedImagePreview') &&
      preview.includes('loadImagePreview={loadImagePreview}'),
    'LIVP still preview must share the decode-gated original/thumbnail renderer',
  )

  for (const source of [web, desktop]) {
    assert.ok(source.includes('const loadLivePhotoMotion = useCallback'), 'FileExplorer adapter must load LIVP motion')
    assert.ok(source.includes('XDriveByteProgressHandler'), 'FileExplorer LIVP loader must preserve the shared progress-capable contract')
    assert.ok(source.includes('loadLivePhotoMotion={loadLivePhotoMotion}'), 'FileExplorer must pass LIVP motion into shared preview')
  }
  const webMotionStart = web.indexOf('const loadLivePhotoMotion = useCallback')
  const webMotionEnd = web.indexOf('const loadPropertiesStats', webMotionStart)
  assert.ok(webMotionStart >= 0 && webMotionEnd > webMotionStart)
  const webMotionBlock = web.slice(webMotionStart, webMotionEnd)
  assert.ok(
    webMotionBlock.includes('api.mediaLivePhotoMotionURL(Number(item.id))') &&
      !webMotionBlock.includes('URL.createObjectURL(') &&
      !webMotionBlock.includes('new Blob('),
    'Web LIVP motion must use the signed streaming URL rather than a complete Blob',
  )
  assert.ok(
    preview.includes('loadLivePhotoMotion(target, onProgress)'),
    'shared FilePreviewSurface must forward byte progress into LIVP transport',
  )
  assert.ok(
    livePhoto.includes('loadMotion(onProgress)') && livePhoto.includes('按住播放，松开停止'),
    'shared Live Photo surface must fetch motion only after the first hold and preserve hold/release semantics',
  )
  assert.ok(
    previewModel.includes('XDriveLivePhotoMotionSource') &&
      livePhoto.includes('disposeLivePhotoMotion') &&
      livePhoto.includes('preload="metadata"'),
    'shared Live Photo surface must own stream URL disposal and bounded preloading',
  )
  assert.ok(
    desktop.includes('const motionURL = result.data') &&
      desktop.includes('releaseMediaLivePhotoMotion(motionURL)') &&
      desktop.includes('lifecycleGeneration !== actionGenerationRef.current'),
    'Desktop LIVP loader must release protected stream URLs only through the owning lifecycle',
  )
  const desktopMotionStart = desktop.indexOf('const loadLivePhotoMotion = useCallback')
  const desktopMotionEnd = desktop.indexOf('const copyItemPaths', desktopMotionStart)
  assert.ok(desktopMotionStart >= 0 && desktopMotionEnd > desktopMotionStart)
  assert.equal(
    desktop.slice(desktopMotionStart, desktopMotionEnd).includes('new Blob('),
    false,
    'Desktop LIVP motion must not be materialized as a renderer ArrayBuffer Blob',
  )
  assert.ok(
    docs.includes('validated `.livp`') && docs.includes('FileExplorer'),
    'Preview Engine design must document the LIVP FileExplorer exception',
  )
  assert.ok(
    livePhoto.includes('XDriveLivePhotoGlyph') && !livePhoto.includes('PlayCircleOutline'),
    'shared Live Photo surface must use a Live Photo glyph rather than a generic play button',
  )
  assert.ok(
    livePhoto.includes('data-xdrive-live-photo-glyph="sf-livephoto"') &&
      livePhoto.includes('viewBox="4.5 14.5 62 62"') &&
      livePhoto.includes('XDRIVE_SF_LIVEPHOTO_PATH'),
    'shared Live Photo glyph must use the canonical SF livephoto vector geometry',
  )
})

test('Preview Engine design documents platform Open versus Preview semantics', () => {
  assert.ok(docs.includes('### Open Preview dialog'), 'Preview Engine design must document the shared preview shell')
  assert.ok(docs.includes('Web App Resolver'), 'Preview Engine design must document Web program dispatch')
  assert.ok(docs.includes('OS default application'), 'Preview Engine design must document Desktop native Open')
  assert.ok(docs.includes('Explicit Download remains a separate file-management action'), 'Preview Engine design must separate Open from Download')
  assert.ok(
    docs.includes('Double-clicking a Gallery media') && docs.includes('tile opens the media preview'),
    'Preview Engine design must document Gallery double-click',
  )
})


test('FileExplorer Quick Look matches the shared Finder-style browsing contract', () => {
  const explorer = read('ui', 'shared', 'src', 'mui', 'FileExplorer.tsx')
  for (const token of [
    'const [quickLookSessionIDs, setQuickLookSessionIDs]',
    'const selectedSessionItems = selectedKeySet.has(itemKey)',
    'setQuickLookSessionIDs(selectionSession)',
    'quickLookSessionIndex',
    'actions={quickLookActions}',
    "['open', 'system-open', 'download', 'share']",
    "id: 'tags'",
  ]) {
    assert.ok(explorer.includes(token), 'Quick Look session/actions missing: ' + token)
  }

  const sessionStart = explorer.indexOf('if (quickLookSessionIDs) {')
  const directoryStart = explorer.indexOf('if (!virtualCollectionEnabled) {', sessionStart)
  assert.ok(sessionStart >= 0 && directoryStart > sessionStart, 'multi-select Quick Look branch is missing')
  assert.equal(
    explorer.slice(sessionStart, directoryStart).includes('commitSelection('),
    false,
    'multi-select Quick Look navigation must not collapse the selection',
  )

  for (const token of [
    'interactiveImage',
    'fullScreen={fullScreen}',
    'immersive={fullScreen}',
    'slideshowPlaying',
    'slideshowIntervalMs = 5000',
    'const onNextRef = useRef(onNext)',
    'window.setTimeout(() => onNextRef.current?.(), slideshowIntervalMs)',
    "aria-label={slideshowPlaying ? '暂停幻灯片' : '开始幻灯片'}",
  ]) {
    assert.ok(quickLook.includes(token), 'Quick Look fullscreen/zoom/slideshow missing: ' + token)
  }

  assert.ok(
    openPreview.includes('if (fullScreen && onFullScreenChange)') &&
      openPreview.includes('onFullScreenChange(false)'),
    'Escape must exit fullscreen before closing Quick Look',
  )
  assert.ok(
    livePhoto.includes('event.stopPropagation()'),
    'Live Photo Space/Enter hold must not bubble to Quick Look close handling',
  )
  assert.ok(
    openPreview.includes('const interactiveKeyTarget = Boolean') &&
      openPreview.includes("if (quickLook && event.key === ' ' && !interactiveKeyTarget)") &&
      openPreview.includes('if (interactiveKeyTarget) return'),
    'Quick Look actions and media controls must own Space/arrow keys while focused',
  )
  assert.ok(
    docs.includes('freezes the selected **file** IDs') &&
      docs.includes('Markup, PDF signing'),
    'Preview Engine design must document the Quick Look session and non-goals',
  )
})


test('shared image preview does not restart source loading on equivalent target rerenders', () => {
  const generationMarker = 'const generation = previewGenerationRef.current + 1'
  const effectBodyStart = preview.lastIndexOf('useEffect(() => {', preview.indexOf(generationMarker))
  const effectDepsStart = preview.indexOf('  }, [', preview.indexOf(generationMarker))
  const effectDepsEnd = preview.indexOf('  ])', effectDepsStart)
  assert.ok(effectBodyStart >= 0 && effectDepsStart > effectBodyStart && effectDepsEnd > effectDepsStart,
    'shared preview loading effect is missing')
  const dependencies = preview.slice(effectDepsStart, effectDepsEnd)
  assert.equal(
    /\n\s*target,/.test(dependencies),
    false,
    'equivalent target object rerenders must not restart image preview loading',
  )
  for (const loader of ['loadImagePreview', 'loadPreviewURL', 'loadTextPreview']) {
    assert.equal(
      new RegExp('\\n\\s*' + loader + ',').test(dependencies),
      false,
      loader + ' callback identity churn must not restart image preview loading',
    )
  }
  for (const identity of ['previewKind', 'previewTargetID', 'previewTargetRevision']) {
    assert.ok(
      dependencies.includes(identity),
      'shared preview loading must still restart when ' + identity + ' changes',
    )
  }
  assert.ok(
    preview.includes('const previewTargetRef = useRef(target)') &&
      preview.includes('const previewLoadersRef = useRef({') &&
      preview.includes('const currentTarget = previewTargetRef.current') &&
      preview.includes('const loaders = previewLoadersRef.current'),
    'shared preview must read the latest target/loaders through refs without identity-triggered reloads',
  )
})
