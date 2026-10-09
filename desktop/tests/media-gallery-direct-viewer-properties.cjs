const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const source = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8')
const gallery = source('ui', 'shared', 'src', 'mui', 'MediaGallery.tsx')
const tile = gallery.slice(gallery.indexOf('function MediaTile({'), gallery.indexOf('function MediaTileGrid({'))
const viewer = source('ui', 'shared', 'src', 'mui', 'MediaGalleryViewer.tsx')
const inspector = source('ui', 'shared', 'src', 'mui', 'MediaGalleryInspector.tsx')
const web = source('web', 'src', 'WebFileViewerApps.tsx')

test('Gallery click immediately launches Viewer without a delayed Details launch', () => {
  assert.doesNotMatch(tile, /clickTimerRef|openDetails\s*=|window\.setTimeout/)
  assert.match(tile, /if \(event\.detail > 1\) return/)
  assert.match(tile, /onClick=\{\(event\) => \{[\s\S]*?openPreview\(\)/)
  assert.match(tile, /onDoubleClick=\{\(event\) => event\.preventDefault\(\)\}/)
})

test('Selection modifiers and Space remain selection rather than preview', () => {
  assert.match(tile, /selectionMode \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/)
  assert.match(tile, /event\.key === ' ' \|\| \(selectionMode && event\.key === 'Enter'\)/)
  assert.match(tile, /keyboardActivate\(event, \(\) => onPreview\(item\)\)/)
  assert.doesNotMatch(tile, /data-xdrive-gallery-touch-info|onOpen\(item\)/, 'mobile tiles have no overlay Info action')
  assert.match(gallery, /onPointerDownCapture=\{handleGalleryPointerDown\}/, 'stationary hold resolves the tile context')
  assert.match(gallery, /openMediaItem\(mediaContextMenu.item\)/, 'Properties remains available from Context Menu')
})

test('One context menu handles virtual and ordinary Gallery tiles', () => {
  assert.match(gallery, /onContextMenu=\{handleMediaContextMenu\}/)
  assert.match(gallery, /closest<HTMLElement>\('\[data-xdrive-media-tile\]'\)/)
  assert.match(gallery, /virtualCollection\?\.itemAt\(index\) \?\? items\[index\]/)
  assert.match(gallery, /anchorReference="anchorPosition"/)
  assert.match(gallery, />\s*属性\s*<\/MenuItem>/)
  assert.match(gallery, /!isTrashSection \? \(\s*<MenuItem/)
})

test('Gallery Viewer stays open while property Drawer is shown', () => {
  const openInfo = gallery.slice(gallery.indexOf('const openPreviewInfo'), gallery.indexOf('const toggleMediaFavorite'))
  assert.match(openInfo, /setSelected/)
  assert.doesNotMatch(openInfo, /closeMediaPreview\(/)
  assert.match(gallery, /setSelected\(\(current\) => current \? item : null\)/)
  assert.match(gallery, /overlayZIndex=\{previewItem \? 1400 : undefined\}/)
  assert.match(inspector, /data-xdrive-media-details-viewer-drawer/)
  assert.match(inspector, /anchor="right"/)
  assert.match(inspector, /anchor="bottom"/)
})

test('Gallery and Web Viewer reuse the property Inspector and accessible label', () => {
  assert.match(viewer, /<Tooltip title="属性">[\s\S]*?aria-label="查看属性"/)
  assert.match(web, /<Tooltip title="属性">[\s\S]*?aria-label="查看属性"/)
  assert.match(inspector, /<XDriveMediaDetailsContent/)
  assert.match(inspector, /关闭属性/)
})

test('Properties beside an active Viewer never mount a duplicate media player', () => {
  const details = source('ui', 'shared', 'src', 'mui', 'MediaGalleryDetails.tsx')
  assert.match(details, /showPreview\?: boolean/)
  assert.match(details, /showPreview = true/)
  assert.match(details, /\{showPreview \? \(\s*<Box/)
  assert.match(gallery, /showPreview=\{!previewItem\}/)
  assert.match(web, /showPreview=\{false\}/)
})

test('Trash tiles open Properties rather than ignoring single-click', () => {
  const start = gallery.indexOf('const openMediaPreview = useCallback')
  const end = gallery.indexOf('const previewIndex =', start)
  const handler = gallery.slice(start, end)
  assert.match(handler, /if \(section === 'trash'\) \{\s*setSelected\(item\)\s*return\s*\}/)
})
