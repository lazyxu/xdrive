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
  assert.equal((owner.match(/<XDriveFileExplorerItemSurface/g) || []).length, 2)
  assert.equal((share.match(/<XDriveFileExplorerItemSurface/g) || []).length, 1)
  assert.ok(pure.includes('export const XDriveFileExplorerItemSurface'))
  assert.ok(pure.includes('<ButtonBase ref={ref} component="div"'))
  assert.ok(pure.includes('<Box ref={ref}'))
  assert.ok(owner.includes('ownerInteraction'), 'Owner retains ButtonBase and registered privileged event handlers')
  assert.ok(share.includes('surfaceMode={view}') &&
    share.includes("columns={view === 'details' ? shareDetailsColumns : undefined}"))
  assert.ok(share.includes('data-xdrive-file-explorer-item') &&
    share.includes('data-xdrive-public-share-item-id={entry.id}'))
  assert.ok(pure.includes('gridMinItemHeight = 124') &&
    pure.includes('gridMaxItemWidth = 180') &&
    pure.includes('detailsRowHeight = xDriveFileExplorerDetailsNormalRowHeight'))
  assert.ok(pure.includes('contentVisibility: grid ?') &&
    pure.includes('containIntrinsicSize: grid'))
})

test('SH-P019 public Explorer has no Owner ButtonBase, upload, move or mutation actions', () => {
  const row = share.slice(share.indexOf('{visibleItems.map(entry => ('), share.indexOf('      ))}'))
  assert.ok(row.includes('<XDriveFileExplorerItemSurface') &&
    row.includes('</XDriveFileExplorerItemSurface>'))
  assert.ok(!row.includes('ownerInteraction'))
  for (const forbidden of [
    'OwnerJWT', 'XDriveApi', 'onUpload', 'onRename', 'onDelete', 'onMove',
    'onDropItemsToFolder', 'onPaste', 'onCopy', 'onCut', 'ownerToken',
  ]) {
    assert.ok(!share.includes(forbidden), 'Share-only component must exclude: ' + forbidden)
  }
  for (const required of [
    'onContextMenu={(event) => openContextMenu(event, entry)}',
    'onDownloadFolder?.(entry)', 'onDownloadItem?.(entry)', 'onOpenFolder?.(entry)',
    'setPropertiesEntry(', 'items.slice(0, 100)',
    'XDriveFileExplorerThumbnailProvider', 'XDrivePublicShareThumbnailSlot',
  ]) assert.ok(share.includes(required), 'missing bounded read-only feature: ' + required)
  assert.ok(pure.includes('no API client, token, clipboard'), 'neutral component has no authority')
  assert.ok(!pure.includes("from '../../web/src/api'"))
})

test('SH-P019 real Share tokens stay within dedicated public loader, never in Owner explorer', () => {
  for (const token of [
    'XDrivePublicShareReadOnlyExplorer',
    'api.publicShareImagePreviewURL(token, password, entry.id, signal)',
    'onDownloadFolder={(entry) => void startSharedFolderZIP(entry)}',
    'onDownloadItem={(entry) => void download(entry)}',
    'loadThumbnail={loadSharedThumbnail}',
  ]) assert.ok(publicPage.includes(token), 'missing public capability-only adapter: ' + token)
  assert.ok(!owner.includes('publicShareImagePreviewURL(') &&
    !owner.includes('api.publicShareThumbnailURL('),
    'Owner explorer cannot consume Share capability tickets')
})
