const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Gallery crop/contain view preference persists with existing density-by-scale', () => {
  const gallery = (read('ui/shared/src/mui/MediaGallery.tsx') + '\n' + read('ui/shared/src/mui/MediaGallerySharedTiles.tsx'))
  const policy = read('ui/shared/src/mui/MediaGalleryPhotoWallFraming.ts')
  const buttons = read('ui/shared/src/mui/MediaGalleryFramingControls.tsx')
  for (const contract of [
    'type MediaGalleryAspectMode = XDriveMediaGalleryFraming',
    'aspectMode: MediaGalleryAspectMode',
    "aspectMode: 'crop'",
    "parsed.aspectMode === 'contain' ? 'contain' : 'crop'",
    'data-xdrive-gallery-aspect-mode={aspectMode}',
    'updateGalleryAspectMode',
    'xDriveMediaGalleryWriteFraming(nextMode)',
    'xDriveWriteMediaGalleryViewPreferences({',
    'densityByScale',
    "setViewAnchorRevision((current) => current + 1)",
  ]) assert.ok(gallery.includes(contract), 'Gallery ratio contract missing: ' + contract)
  assert.match(policy, /xdrive.gallery.view-preferences.v1/)
  assert.match(policy, /xDriveMediaGalleryObserveFraming/)
  assert.match(buttons, /data-xdrive-gallery-aspect-crop/)
  assert.match(buttons, /data-xdrive-gallery-aspect-contain/)
  assert.match(buttons, /data-xdrive-places-photo-aspect-contain/)
  assert.doesNotMatch(gallery,
    /xDriveWriteMediaGalleryViewPreferences\(viewPreferences\)/)
})

test('Uncropped media ratio never changes virtual layout or re-downloads thumbnails', () => {
  const gallery = (read('ui/shared/src/mui/MediaGallery.tsx') + '\n' + read('ui/shared/src/mui/MediaGallerySharedTiles.tsx'))
  const thumbnail = read('ui/shared/src/mui/MediaGalleryPreviewMedia.tsx')
  const grid = read('ui/shared/src/mui/MediaGalleryVirtualGrid.ts')
  const timeline = read('ui/shared/src/mui/MediaGalleryVirtualTimeline.ts')
  const framing = read('ui/shared/src/mui/MediaGalleryPhotoWallFraming.ts')
  const host = read('ui/shared/src/mui/MediaGalleryPhotoWall.tsx')
  assert.match(framing, /& \[data-xdrive-media-tile\] img/)
  assert.match(framing, /objectFit: fit/)
  assert.match(framing, /maskSize: fit/)
  assert.match(gallery, /xDriveMediaGalleryFramingStyles\(aspectMode\)/)
  assert.match(host, /xDriveMediaGalleryFramingStyles\(framing\)/)
  assert.match(gallery, /<XDriveMediaAsyncThumbnail/)
  assert.match(gallery, /<XDriveMediaAsyncVideoPoster/)
  assert.match(gallery, /<MediaVirtualTileGrid/)
  assert.match(gallery, /<MediaVirtualTimeline/)
  assert.match(grid, /export function xDriveMediaGalleryGridMetrics/)
  assert.match(timeline, /export function xDriveMediaGalleryTimelineLayout/)
  assert.doesNotMatch(gallery, /new Array\(virtualCollection\.itemCount\)/)
  assert.match(thumbnail, /component="img"/)
})