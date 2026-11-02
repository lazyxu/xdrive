'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('Gallery image wall keeps photos square without visual filename overlays', () => {
  const source = read('ui/shared/src/mui/MediaGallery.tsx')
  const tile = source.slice(source.indexOf('function MediaTile({'), source.indexOf('function MediaTileGrid({'))
  assert.ok(tile.includes("aspectRatio: '1 / 1'"))
  assert.doesNotMatch(tile, /className="media-name"|hover \.media-name|focus-visible \.media-name/)
  assert.doesNotMatch(tile, /\{item\.node\.name\}\s*<\/Typography>/)
  assert.match(tile, /aria-label=\{\x60\$\{item\.node\.name\}/,
    'screen readers keep media identity without an on-image filename')
  assert.match(tile, /alt=\{item\.node\.name\}/, 'image alternatives keep descriptive filenames')
  assert.match(tile, /data-xdrive-media-live-indicator/, 'live-photo badge stays visible')
})

test('Places photo drawer shows only square thumbnails while retaining accessible names', () => {
  const source = read('ui/shared/src/mui/MediaGalleryPlacesPhotoDrawer.tsx')
  assert.match(source, /aria-label=\{\x60查看 \$\{item\.node\.name\}/)
  assert.match(source, /alt=\{item\.node\.name\}/)
  assert.match(source, /gridAutoRows:expanded\?'minmax\(108px, max-content\)'/)
  const tile = source.slice(source.indexOf('data-xdrive-places-photo-drawer-item='), source.indexOf('data-xdrive-places-photo-drawer-load-more'))
  assert.doesNotMatch(tile, /\{item\.node\.name\}\s*<\/Typography>/)
  assert.match(tile, /aspectRatio:'1'/, 'square photos still anchor the grid layout')
})
