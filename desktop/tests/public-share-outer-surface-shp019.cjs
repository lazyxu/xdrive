'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '../..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const owner = read('ui/shared/src/mui/FileExplorer.tsx')
const share = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
const pure = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
const publicPage = read('web/src/PublicShare.tsx')


test('SH-P019 Details/Grid reuse the identical neutral outer row component', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const core = read('ui/shared/src/mui/FileExplorer.tsx')
  assert.ok(pure.includes('export const XDriveFileExplorerItemSurface'))
  assert.ok(core.includes('<XDriveFileExplorerItemSurface'))
  assert.ok(bridge.includes('<XDriveFileExplorer') && bridge.includes('forceVirtualization'))
  assert.ok(share.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.equal(share.includes('visibleItems.map('), false,
    'single-file Share cannot retain a separate Grid/Details renderer')
  assert.equal(share.includes('<XDriveFileExplorerItemSurface'), false)
})


test('SH-P019 public Explorer has no Owner ButtonBase, upload, move or mutation actions', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  for (const forbidden of [
    'OwnerJWT', 'XDriveApi', 'onUpload=', 'onRenameItem=', 'onDeleteItems=',
    'onMoveItemsTo=', 'onDropItemsToFolder=', 'onPaste=', 'onCopy=', 'onCut=',
    'ownerToken', 'api.downloadURL(',
  ]) {
    assert.ok(!bridge.includes(forbidden), 'Share bridge cannot use Owner authority: ' + forbidden)
    assert.ok(!share.includes(forbidden), 'Share wrapper cannot use Owner authority: ' + forbidden)
  }
  for (const required of [
    "xDriveResolveFileExplorerCapabilities('share'", 'getItemMenuItems={contextActions}',
    'onDownloadItem?.(entry)', 'onOpenFolder?.(entry)', 'loadThumbnail={thumbnailLoader}',
    'items.slice(0, fileLink ? 1 : sharePageLimit)', 'onDownloadItems={caps.download',
  ]) assert.ok(bridge.includes(required), 'missing bounded Core-only behavior: ' + required)
  assert.ok(pure.includes('no API client, token, clipboard'))
})


test('SH-P019 real Share tokens stay within dedicated public loader, never in Owner explorer', () => {
  for (const token of [
    'XDrivePublicShareReadOnlyExplorer', 'api.publicShareImagePreviewURL(token, password, entry.id, signal)',
    'onDownloadFolder={(entry) => void startSharedFolderZIP(entry)}',
    'onDownloadItem={(entry) => void download(entry)}', 'loadThumbnail={loadSharedThumbnail}',
  ]) assert.ok(publicPage.includes(token), 'Share-only capability adapter: ' + token)
  assert.ok(!owner.includes('publicShareImagePreviewURL(') && !owner.includes('api.publicShareThumbnailURL('))
})


test('SH-P019 Owner and public Share suppress only pointer-focus viewport outline', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const core = read('ui/shared/src/mui/FileExplorer.tsx')
  const start = core.indexOf('data-xdrive-file-explorer-scroll-host')
  const end = core.indexOf('onScroll={handleScroll}', start)
  assert.ok(start > 0 && end > start, 'shared scroll host is missing')
  const host = core.slice(start, end)

  // Owner and public Share both use the same focusable scroll host.
  assert.ok(core.includes('scrollHostRef.current?.focus()'))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(host.includes("'&:focus:not(:focus-visible)': { outline: 'none' }"))
  // Keyboard navigation must still be visibly indicated. The deliberately
  // selected row and drag target highlights must NOT be affected.
  assert.ok(host.includes("'&:focus-visible': {"))
  assert.ok(host.includes("outline: '2px solid'"))
  assert.ok(host.includes("outlineColor: 'primary.main'"))
  assert.ok(pure.includes("selected ? 'action.selected' : 'transparent'"))
  assert.ok(pure.includes("'&:focus-visible': {"))
  assert.equal(bridge.includes("[data-xdrive-file-explorer-scroll-host]:focus"),
    false, 'public Share cannot diverge from the shared focus policy')
})

test('SH-P019 unrelated gallery, mobile row and task focus indicators stay intact', () => {
  const gallery = read('ui/shared/src/mui/MediaGallery.tsx')
  const mobile = read('web/src/MobileFiles.tsx')
  const task = read('ui/shared/src/mui/TaskPresentation.tsx')
  assert.ok(gallery.includes("outline: selectedForAction ? '2px solid' : 'none'"))
  assert.ok(gallery.includes("'&:focus-visible': {"))
  assert.ok(mobile.includes("outline: dropFolderID === String(item.id) ? '2px solid' : 'none'"))
  assert.ok(mobile.includes("'&:focus-visible': { outline: '2px solid'"))
  assert.ok(task.includes("'&:focus-visible': {"))
})
