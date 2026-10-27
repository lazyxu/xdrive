const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const content = read('ui', 'shared', 'src', 'mui', 'MediaViewerContent.tsx')
const galleryViewer = read('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
const previewSurface = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const webViewers = read('web', 'src', 'WebFileViewerApps.tsx')
const webViewerRoute = read('web', 'src', 'webViewerRoute.ts')
const docs = read('docs', 'preview-engine.md')
const webAppContract = read('ui', 'shared', 'src', 'web-app.ts')

test('Web and Gallery use one semantic media content layer', () => {
  assert.ok(index.includes("export * from './MediaViewerContent'"))
  assert.ok(content.includes('export function XDriveMediaViewerContent'))
  for (const token of [
    "item.live_photo || item.asset_kind === 'live_photo'",
    '<XDriveLivePhotoSurface',
    'xDriveMediaEditPreviewTransform(item.edit_recipe)',
    'loadLivePhotoMotion(item.node.id, onProgress, signal)',
    'loadThumbnail(item.node.id, signal, item.node.revision, onProgress)',
    'loadOpenThumbnail = useCallback<XDriveFilePreviewImageLoader>(async (_target, signal, onProgress) =>',
    'loadPreviewURL(item.node.id, kind, signal, item.node.name, item.node.revision, onProgress)',
  ]) {
    assert.ok(content.includes(token), 'shared media content contract missing: ' + token)
  }
  assert.ok(galleryViewer.includes('<XDriveMediaViewerContent'))
  assert.ok(webViewers.includes('<XDriveMediaViewerContent'))
  assert.ok(webViewers.includes('mediaItem.node.id !== viewer.node.id'), 'Web media content must never render stale metadata under a newer node')
  assert.equal(galleryViewer.includes('<XDriveLivePhotoSurface'), false)
  assert.equal(galleryViewer.includes('xDriveMediaEditPreviewTransform(item.edit_recipe)'), false)
})

test('saved image edits also apply to the still frame of LIVP previews', () => {
  const liveStart = previewSurface.indexOf("if (target && previewKind === 'live_photo')")
  const imageStart = previewSurface.indexOf("if (target && previewKind === 'image')")
  assert.ok(liveStart >= 0 && imageStart > liveStart)
  const liveBlock = previewSurface.slice(liveStart, imageStart)
  assert.ok(liveBlock.includes('mediaTransform={mediaTransform}'))
})

test('only viewers with a real browsing contract carry previous/next context', () => {
  const previewStart = webViewers.indexOf('function WebPreviewApp(')
  const mediaStart = webViewers.indexOf('function WebMediaViewerApp(')
  const textStart = webViewers.indexOf('function WebTextViewerApp(')
  const singleStart = webViewers.indexOf('function WebSinglePreviewApp(')
  const exportsStart = webViewers.indexOf('export function WebFileViewerApps(')
  assert.ok(previewStart >= 0 && mediaStart > previewStart && textStart > mediaStart)
  assert.ok(singleStart > textStart && exportsStart > singleStart)

  const previewBlock = webViewers.slice(previewStart, mediaStart)
  const mediaBlock = webViewers.slice(mediaStart, textStart)
  const textBlock = webViewers.slice(textStart, singleStart)
  const singleBlock = webViewers.slice(singleStart, exportsStart)

  assert.ok(previewBlock.includes('useViewerNode({'))
  assert.ok(mediaBlock.includes('useViewerNode({'))
  assert.equal(textBlock.includes('useViewerNode({'), false)
  assert.equal(singleBlock.includes('useViewerNode({'), false)

  assert.ok(webViewers.includes("export { xDriveWebOpenRouteForNode } from './webViewerRoute'"), 'Viewer compatibility route export missing')
  const resolverStart = webViewerRoute.indexOf('export function xDriveWebOpenRouteForNode')
  assert.ok(resolverStart >= 0)
  const resolver = webViewerRoute.slice(resolverStart)
  assert.ok(resolver.includes("app: 'media-viewer', params: { node: node.id, context: contextID }"))
  assert.ok(resolver.includes("app: 'text-viewer', params: { node: node.id }"))
  assert.ok(resolver.includes("app: 'pdf-viewer', params: { node: node.id }"))
  assert.ok(resolver.includes("app: 'audio-player', params: { node: node.id }"))
  assert.equal(resolver.includes("app: 'audio-player', params: { node: node.id, context: contextID }"), false)
  assert.ok(webAppContract.includes("'audio-player': { node: number }"))
  assert.equal(webAppContract.includes("'audio-player': { node: number; context?: string }"), false)
  assert.ok(docs.includes('Viewer navigation scope'))
})

test('both Gallery Viewer shells opt into one shared video playback controls clearance', () => {
  assert.ok(galleryViewer.includes("videoControlsSafeArea={narrowViewer ? (filmstripEntries.length > 0 ? 'actions-filmstrip' : 'actions') : undefined}"),
    'Desktop/shared Gallery should reserve mobile controls clearance')
  assert.ok(webViewers.includes("videoControlsSafeArea={narrowMediaViewer ? (viewer.filmstripEntries.length > 0 ? 'actions-filmstrip' : 'actions') : undefined}"),
    'routed Web/Mobile Gallery should use the same clearance')
  assert.ok(content.includes('videoControlsSafeArea={videoControlsSafeArea}'),
    'MediaViewerContent must pass a presentation-only clearance to the shared renderer')
  assert.ok(previewSurface.includes("videoControlsSafeArea === 'actions-filmstrip'"),
    'only the Preview Engine should implement native video controls clearance')
})

test('mobile video reserves space only while shared Viewer chrome is visible', () => {
  const inlineFrame = read('ui', 'shared', 'src', 'mui', 'FileOpenPreviewDialog.tsx')
  for (const frame of [inlineFrame, webViewers]) {
    assert.match(frame, /'--xdrive-viewer-video-actions-clearance'/)
    assert.match(frame, /'--xdrive-viewer-video-actions-filmstrip-clearance'/)
    assert.match(frame, /chromeVisible\s*\?\s*'calc\(56px \+ env\(safe-area-inset-bottom\)\)'\s*:\s*'0px'/)
    assert.match(frame, /chromeVisible\s*\?\s*'calc\(128px \+ env\(safe-area-inset-bottom\)\)'\s*:\s*'0px'/)
  }
  assert.match(previewSurface,
    /var\(--xdrive-viewer-video-actions-clearance, calc\(56px \+ env\(safe-area-inset-bottom\)\)\)/)
  assert.match(previewSurface,
    /var\(--xdrive-viewer-video-actions-filmstrip-clearance, calc\(128px \+ env\(safe-area-inset-bottom\)\)\)/)
  assert.match(previewSurface, /boxSizing: 'border-box'/)
})

test('empty Filmstrip never renders an otherwise blank Gallery chrome overlay', () => {
  assert.match(galleryViewer, /const footer = item && filmstripEntries\.length > 0 \? \(/)
  assert.match(webViewers, /filmstrip=\{mediaItem && viewer\.filmstripEntries\.length > 0 \? \(/)
  assert.match(galleryViewer, /videoControlsSafeArea=\{narrowViewer \? \(filmstripEntries\.length > 0/)
  assert.match(webViewers, /videoControlsSafeArea=\{narrowMediaViewer \? \(viewer\.filmstripEntries\.length > 0/)
})

test('Gallery Viewer borrows only warmed current thumbnail; routed Web keeps its scoped reader', () => {
  const gallery = read('ui','shared','src','mui','MediaGallery.tsx')
  const scheduler = read('ui','shared','src','mui','MediaGalleryThumbnailScheduler.ts')
  const preview = read('ui','shared','src','mui','FilePreviewImage.tsx')
  assert.match(gallery, /thumbnailScheduler\.borrowCachedForViewer\(nodeID, revision\)/)
  assert.match(gallery, /return loadThumbnail\(nodeID, signal, revision, onProgress\)/)
  assert.match(gallery, /loadBorrowedThumbnail=\{loadBorrowedViewerThumbnail\}/)
  assert.match(galleryViewer, /loadBorrowedThumbnail=\{loadBorrowedThumbnail\}/)
  assert.match(content, /if \(loadBorrowedThumbnail\) return loadBorrowedThumbnail\(_target, signal, onProgress\)/)
  assert.match(scheduler, /this\.retiredViewerURLs\.add\(url\)/)
  assert.match(preview, /borrowed\.release\(\)/)
  assert.match(webViewers, /loadThumbnail=\{gallerySource\.loadThumbnail\}/,
    'a separate routed Viewer must not borrow from a former Gallery Owner')
})
