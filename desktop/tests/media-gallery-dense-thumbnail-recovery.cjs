'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const gallery = read('ui/shared/src/mui/MediaGallery.tsx')

test('P0-L14 dense Gallery and grouped Timeline pass the same Live Photo still Scheduler', () => {
  const start = gallery.indexOf('function MediaTileGrid({')
  const end = gallery.indexOf('\nfunction mediaGalleryScrollParent(', start)
  assert.ok(start > -1 && end > start, 'shared dense presentation must remain')
  const dense = gallery.slice(start, end)
  assert.match(dense, /thumbnailScheduler: XDriveMediaThumbnailScheduler/)
  assert.match(dense, /<MediaTile\b[\s\S]*?thumbnailScheduler=\{thumbnailScheduler\}/)
  const calls = [...gallery.matchAll(/<MediaTileGrid\b([\s\S]*?)\/>/g)]
  assert.equal(calls.length, 2, 'local chronological groups and normal dense grid')
  for (const [, props] of calls) {
    assert.match(props, /thumbnailScheduler=\{thumbnailScheduler\}/)
    assert.match(props, /loadThumbnail=\{loadThumbnail\}/)
  }
  // A distinct scheduler per date group would lose decoder-failure state on
  // group changes and duplicate memory/network queues.
  assert.equal((gallery.match(/new XDriveMediaThumbnailScheduler\(/g) || []).length, 1)
})

test('P0-L14 the page retains all dense groups together and releases abandoned work', () => {
  const start = gallery.indexOf('const blockingCollectionError = Boolean(')
  const end = gallery.indexOf('const emptyCollectionTitle', start)
  assert.ok(start > -1 && end > start)
  const owner = gallery.slice(start, end)
  assert.match(owner, /if \(virtualCollection\) return/)
  assert.match(owner, /showPhotoCollection\s*&&\s*!mobileCollectionsOverview\s*&&\s*!blockingCollectionError/)
  assert.match(owner, /items\.filter\(\(item\) => item\.metadata\.has_thumbnail\)\.map\(\(item\) => item\.node\.id\)/)
  assert.match(owner, /thumbnailScheduler\.setRetention\(/)
  const denseStart = gallery.indexOf('function MediaTileGrid({')
  const denseEnd = gallery.indexOf('\nfunction mediaGalleryScrollParent(', denseStart)
  assert.doesNotMatch(gallery.slice(denseStart, denseEnd), /setRetention\(/,
    'one dense date group must not cancel sibling requests')
  assert.match(gallery, /thumbnailScheduler\.setRetention\(retainedNodeIDs\)/,
    'sparse virtual Grid/Timeline must retain their own viewport cancellation')
})

test('P0-L14 both mobile and wide Web still share authenticated REST and virtual Gallery', () => {
  const adapter = read('web/src/mediaGalleryAdapter.ts')
  const shared = read('ui/shared/src/mui/MediaGalleryAdapter.ts')
  const app = read('web/src/App.tsx')
  const scheduler = read('ui/shared/src/mui/MediaGalleryThumbnailScheduler.ts')
  assert.match(adapter, /loadThumbnail: \(nodeID, signal, revision, onProgress, bypassHTTPCache\) => api\.mediaThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(shared, /port\.loadThumbnail\(nodeID, signal, revision, onProgress, bypassHTTPCache\)/)
  assert.match(gallery, /<MediaVirtualTileGrid\b/)
  assert.match(gallery, /<MediaVirtualTimeline\b/)
  assert.equal((app.match(/<XDriveMediaGalleryPage\b/g) || []).length, 1)
  assert.match(scheduler, /invalidateDecodedURL =/)
  assert.match(read('ui/shared/src/mui/MobileAppHeader.tsx'), /calc\(52px \+ env\(safe-area-inset-top\)\)/)
})
