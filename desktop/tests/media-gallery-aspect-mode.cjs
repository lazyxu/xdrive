const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Gallery crop/contain view preference persists with existing density-by-scale', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  for (const contract of [
    "type MediaGalleryAspectMode = 'crop' | 'contain'",
    'aspectMode: MediaGalleryAspectMode',
    "aspectMode: 'crop'",
    "parsed.aspectMode === 'contain' ? 'contain' : 'crop'",
    'data-xdrive-gallery-aspect-mode={aspectMode}',
    'data-xdrive-gallery-aspect-crop',
    'data-xdrive-gallery-aspect-contain',
    'updateGalleryAspectMode',
    'xDriveWriteMediaGalleryViewPreferences(viewPreferences)',
    'densityByScale',
    "setViewAnchorRevision((current) => current + 1)",
  ]) assert.ok(gallery.includes(contract), 'Gallery ratio contract missing: ' + contract)
})

test('Uncropped media ratio never changes virtual layout or re-downloads thumbnails', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const thumbnail = read('ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
  const grid = read('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
  const timeline = read('ui/shared/src/mui/MediaGalleryVirtualTimeline.ts')
  assert.match(gallery, /& \[data-xdrive-media-tile\] img/)
  assert.match(gallery, /objectFit: aspectMode === 'contain' \? 'contain' : 'cover'/)
  assert.match(gallery, /<XDriveMediaAsyncThumbnail/)
  assert.match(gallery, /<XDriveMediaAsyncVideoPoster/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(grid, /export function xDriveMediaGalleryGridMetrics/)
  assert.match(timeline, /export function xDriveMediaGalleryTimelineLayout/)
  assert.doesNotMatch(gallery, /new Array\(virtualCollection\.itemCount\)/)
  assert.match(thumbnail, /component="img"/)
})