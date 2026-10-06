const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
const read = (...parts) => fs.readFileSync(path.join(repo, ...parts), 'utf8')

const openPreview = read('ui', 'shared', 'src', 'mui', 'FileOpenPreviewDialog.tsx')
const quickLook = read('ui', 'shared', 'src', 'mui', 'FileQuickLookDialog.tsx')
const gallery = read('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const preview = read('ui', 'shared', 'src', 'mui', 'FilePreviewSurface.tsx')
const livePhoto = read('ui', 'shared', 'src', 'mui', 'LivePhotoSurface.tsx')
const web = read('web', 'src', 'WebFileExplorer.tsx')
const desktop = read('desktop', 'src', 'renderer', 'DesktopFileExplorer.tsx')
const actions = read('ui', 'shared', 'src', 'mui', 'FileExplorerActions.tsx')
const index = read('ui', 'shared', 'src', 'mui', 'index.tsx')
const docs = read('docs', 'preview-engine.md')

test('FileExplorer and Gallery share one open-preview dialog shell', () => {
  assert.ok(index.includes("export * from './FileOpenPreviewDialog'"), 'shared MUI index must export OpenPreviewDialog')
  assert.ok(openPreview.includes('export function XDriveOpenPreviewDialog'), 'shared OpenPreviewDialog is missing')
  assert.ok(quickLook.includes('<XDriveOpenPreviewDialog'), 'Quick Look must reuse OpenPreviewDialog')
  assert.ok(gallery.includes('<XDriveOpenPreviewDialog'), 'Gallery media open must reuse OpenPreviewDialog')
  assert.ok(quickLook.includes('<XDriveFilePreviewSurface'), 'Quick Look must keep the shared Preview Engine renderer')
  assert.ok(gallery.includes('<XDriveFilePreviewSurface'), 'Gallery ordinary media open must keep the shared Preview Engine renderer')
  assert.ok(preview.includes('xDriveClassifyFilePreview'), 'ordinary open preview must inherit the canonical preview classifier')
})

test('Web open semantics preview files while explicit Download remains separate', () => {
  const openStart = web.indexOf('const openWebNode = (node: Node) =>')
  const downloadStart = web.indexOf('const downloadSelected = async')
  assert.ok(openStart >= 0 && downloadStart > openStart, 'Web open/download functions are missing')
  const openBlock = web.slice(openStart, downloadStart)
  assert.ok(openBlock.includes('setOpenPreviewItem({'), 'Web open must target the shared preview dialog')
  assert.equal(openBlock.includes('api.download('), false, 'Web open must not implicitly download')
  assert.ok(web.includes('await api.download(plan.file)'), 'explicit single-file Download must remain available')
  assert.ok(web.includes('await api.downloadArchive(plan.ids, plan.filename)'), 'explicit archive Download must remain available')
  assert.ok(web.includes('<XDriveOpenPreviewDialog'), 'Web must render the shared open-preview dialog')
  assert.ok(web.includes('<XDriveFilePreviewSurface'), 'Web must render ordinary files through FilePreviewSurface')
  assert.ok(web.includes('onOpen: () => { void openItem(item, openWebNode) }'), 'context Open must use preview semantics')
})

test('Desktop FileExplorer Open previews while system shell open remains explicit', () => {
  for (const token of [
    'XDriveFilePreviewSurface',
    'XDriveOpenPreviewDialog',
    'const [openPreviewItem, setOpenPreviewItem]',
    'const openPreviewNode = (node: AgentCloudNode) =>',
    'onOpen: () => { void openWorkspaceItem(item, openPreviewNode) }',
    'onSystemOpen: node.type === \'file\'',
    'void openLocalNode(node)',
    'onReveal: () => { void openLocalNode(node, true) }',
    'onOpenItem={(item) => { void openWorkspaceItem(item, openPreviewNode) }}',
    '<XDriveOpenPreviewDialog',
    '<XDriveFilePreviewSurface',
  ]) {
    assert.ok(desktop.includes(token), 'Desktop shared open-preview contract missing: ' + token)
  }
  assert.ok(actions.includes("id: 'system-open'"), 'shared file menu must keep an explicit Desktop system-open action')
  assert.ok(actions.includes("label: systemOpenLabel"), 'system-open label must remain adapter-configurable')
})

test('Gallery single click keeps media details while double click opens media preview', () => {
  for (const token of [
    'const clickTimerRef = useRef<number | null>(null)',
    'const openDetails = () =>',
    'const openPreview = () =>',
    'onClick={openDetails}',
    'onDoubleClick={(event) =>',
    'onPreview(item)',
    'const [selected, setSelected] = useState<MediaItem | null>(null)',
    'const [previewItem, setPreviewItem] = useState<MediaItem | null>(null)',
    'onOpen={openMediaItem}',
    'onPreview={openMediaPreview}',
    '<XDriveMediaDetailsDialog',
    '<XDriveOpenPreviewDialog',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery open/details split missing: ' + token)
  }
})

test('Gallery Live Photo keeps semantic motion inside the shared open-preview shell', () => {
  for (const token of [
    'previewLivePhoto && loadLivePhotoMotion',
    '<XDriveLivePhotoSurface',
    'loadMotion={loadOpenLivePhotoMotion}',
    'still={(',
    '<XDriveFilePreviewSurface',
  ]) {
    assert.ok(gallery.includes(token), 'Gallery Live Photo open preview missing: ' + token)
  }
  assert.ok(livePhoto.includes('video.play()'), 'Live Photo semantic motion surface must remain intact')
  assert.equal(openPreview.includes('loadMotion'), false, 'OpenPreviewDialog must stay media-semantic neutral')
})

test('Preview Engine design documents Open versus Download semantics', () => {
  assert.ok(docs.includes('### Open Preview dialog'), 'Preview Engine design must document the shared open dialog')
  assert.ok(docs.includes('Web/Desktop FileExplorer must'), 'Preview Engine design must document Web/Desktop open behavior')
  assert.ok(docs.includes('not treat double-click/Enter/open as an implicit download'), 'Preview Engine design must separate Open from Download')
  assert.ok(docs.includes('explicit system-shell Open action'), 'Preview Engine design must preserve explicit Desktop system open')
  assert.ok(
    docs.includes('Double-clicking a Gallery media') && docs.includes('tile opens the media preview'),
    'Preview Engine design must document Gallery double-click',
  )
})
