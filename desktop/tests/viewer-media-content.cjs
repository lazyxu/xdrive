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
const docs = read('docs', 'preview-engine.md')
const webAppContract = read('ui', 'shared', 'src', 'web-app.ts')

test('Web and Gallery use one semantic media content layer', () => {
  assert.ok(index.includes("export * from './MediaViewerContent'"))
  assert.ok(content.includes('export function XDriveMediaViewerContent'))
  for (const token of [
    "item.live_photo || item.asset_kind === 'live_photo'",
    '<XDriveLivePhotoSurface',
    'xDriveMediaEditPreviewTransform(item.edit_recipe)',
    'loadLivePhotoMotion(item.node.id, onProgress)',
    'loadThumbnail(item.node.id)',
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

  const resolverStart = webViewers.indexOf('export function xDriveWebOpenRouteForNode')
  const resolver = webViewers.slice(resolverStart)
  assert.ok(resolver.includes("app: 'media-viewer', params: { node: node.id, context: contextID }"))
  assert.ok(resolver.includes("app: 'text-viewer', params: { node: node.id }"))
  assert.ok(resolver.includes("app: 'pdf-viewer', params: { node: node.id }"))
  assert.ok(resolver.includes("app: 'audio-player', params: { node: node.id }"))
  assert.equal(resolver.includes("app: 'audio-player', params: { node: node.id, context: contextID }"), false)
  assert.ok(webAppContract.includes("'audio-player': { node: number }"))
  assert.equal(webAppContract.includes("'audio-player': { node: number; context?: string }"), false)
  assert.ok(docs.includes('Viewer navigation scope'))
})
