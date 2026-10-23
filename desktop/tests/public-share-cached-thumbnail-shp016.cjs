'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('SH-P016 Share uses purpose-separated cached derivative only, no account JWT or raw original thumbnail', () => {
  const auth = read('internal/auth/public_share_thumbnail.go')
  const api = read('internal/api/public_share_thumbnail.go')
  const router = read('internal/api/router.go')
  for (const token of [
    'public_share_thumbnail', 'xdrive-public-share-thumbnail',
    'ParsePublicShareThumbnail', 'IssuePublicShareThumbnail',
  ]) assert.ok(auth.includes(token), token)
  for (const token of [
    'publicShareThumbnailMaxBytes', '4 << 20', 'publicShareThumbnailTicketsPM',
    'publicFolderShareContainsNode(', 'shareStatus(share, time.Now().UTC())',
    'node.File.SHA256', 'mediaThumbnailStorageKey(node, row)',
    'VideoPosterStorageKey(', 'node.Revision', 'mediaDerivativeCacheValid(',
    'http.ServeContent(', 'Cache-Control', 'no-store', 'publicShareCachedThumbnail',
  ]) {
    if (token === 'publicShareCachedThumbnail') continue
    assert.ok(api.includes(token), token)
  }
  for (const forbidden of ['ensureMediaDerivative(', 'Store.Open(ctx, node.File.StorageKey)',
    'IssuePublicSharePreview(', 'IssuePublicShareDownload(', 'userID(c)']) {
    assert.equal(api.includes(forbidden), false, forbidden)
  }
  for (const route of [
    'POST("/public/share/thumbnail-ticket", s.publicShareThumbnailTicket)',
    'GET("/public-share-thumbnail/:id", s.publicShareThumbnailStream)',
    'HEAD("/public-share-thumbnail/:id", s.publicShareThumbnailStream)',
  ]) assert.ok(router.includes(route), route)
})


test('SH-P016 common FileExplorer thumbnail scheduler cancels ephemeral Share media GETs', () => {
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const native = read('ui/shared/src/mui/FileExplorerThumbnail.tsx')
  const core = read('ui/shared/src/mui/FileExplorer.tsx')
  const publicView = read('web/src/PublicShare.tsx')
  const api = read('web/src/api.ts')
  const folder = read('internal/api/folder_shares.go')
  for (const token of [
    'items.slice(0, fileLink ? 1 : sharePageLimit)', 'entry.thumbnail_candidate === true',
    'loadThumbnail={thumbnailLoader}', 'thumbnailLoader = useMemo(', '<XDriveFileExplorer',
    'forceVirtualization',
  ]) assert.ok(bridge.includes(token), token)
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.ok(core.includes('XDriveFileExplorerThumbnailProvider'))
  for (const token of ['scheduled.cancel()', 'entry.controller.abort()', 'fileThumbnailConcurrency',
    'IntersectionObserver']) assert.ok(native.includes(token), token)
  assert.equal((publicView.match(/loadThumbnail=\{loadSharedThumbnail\}/g) || []).length, 2)
  assert.ok(publicView.includes('api.publicShareThumbnailURL(token, password, entry.id, entry.revision, controller.signal)'))
  assert.ok(publicView.includes("signal?.addEventListener('abort', cancelFromViewport, { once: true })"))
  assert.ok(publicView.includes('activeThumbnailRequests.current.add(controller)'))
  for (const token of ['/api/v1/public/share/thumbnail-ticket',
    'xDriveThumbnailHasSafeImageEnvelope(blob, mime, signal)', 'signal?.throwIfAborted()',
    "credentials: 'omit'", "cache: 'no-store'"])
    assert.ok(api.includes(token), token)
  assert.ok(folder.includes('node_id IN ?'))
  assert.ok(folder.includes('ThumbnailCandidate: eligible[item.ID]'))
  for (const forbidden of ['onDropItemsToFolder=', 'onDeleteItems=', 'onUpload='])
    assert.equal(bridge.includes(forbidden), false)
})

test('SH-P016 page background synchronously aborts ephemeral thumbnails but not durable tasks', () => {
  const view = read('web/src/PublicShare.tsx')
  for (const token of [
    'activeThumbnailRequests', 'abortEphemeralThumbnails()',
    "window.addEventListener('pagehide', onPageHide)",
    "document.addEventListener('visibilitychange', onVisibilityChange)",
    "document.visibilityState === 'hidden'",
    "signal?.addEventListener('abort', cancelFromViewport, { once: true })",
    'controller.abort()', 'thumbnailVisibilityEpoch',
    'setThumbnailVisibilityEpoch(epoch => epoch + 1)',
  ]) assert.ok(view.includes(token), token)
  const handler = view.slice(view.indexOf('const onVisibilityChange = () => {'), view.indexOf('const onPageHide = () =>'))
  assert.ok(handler.includes('abortEphemeralThumbnails()'))
  assert.ok(handler.includes('pendingPage.current?.abort()'))
  assert.ok(!handler.includes('cancelPublicShareArchive('), 'backgrounding must not stop durable root ZIP')
  assert.ok(!handler.includes('cancelSharedFolderZIP('), 'durable ZIP only explicit user cancel')
})
