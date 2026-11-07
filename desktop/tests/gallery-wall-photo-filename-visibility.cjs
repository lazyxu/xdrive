'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Gallery image wall keeps photos square without visual filename overlays', () => {
  const source = read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
  const tile = source.slice(source.indexOf('function MediaTile({'), source.indexOf('function MediaTileGrid({'))
  assert.ok(tile.includes("aspectRatio: '1 / 1'"))
  assert.doesNotMatch(tile, /className="media-name"|hover \.media-name|focus-visible \.media-name/)
  assert.doesNotMatch(tile, /\{item\.node\.name\}\s*<\/Typography>/)
  assert.match(tile, /aria-label=\{\x60\$\{item\.node\.name\}/,
    'screen readers keep media identity without an on-image filename')
  assert.match(tile, /alt=\{item\.node\.name\}/, 'image alternatives keep descriptive filenames')
  assert.match(tile, /data-xdrive-media-live-indicator/, 'live-photo badge stays visible')
})

test('Places photo drawer renders the canonical square, accessible Gallery tile', () => {
  const gallery = read('ui/shared/src/mui/MediaGallerySharedTiles.tsx')
  const drawer = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  const tile = gallery.slice(gallery.indexOf('export function MediaTile({'),
    gallery.indexOf('function MediaTileGrid({'))
  assert.ok(tile.includes("aspectRatio: '1 / 1'"))
  assert.ok(tile.includes('aria-label={`${item.node.name}'))
  assert.ok(tile.includes('alt={item.node.name}'))
  assert.ok(tile.includes('data-xdrive-places-photo-drawer-item={placesDrawer'))
  assert.ok(drawer.includes('<MediaVirtualTileGrid'))
  assert.ok(drawer.includes('<MediaTile'))
  assert.ok(!tile.includes('{item.node.name}</Typography>'))
})
