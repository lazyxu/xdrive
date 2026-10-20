'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.join(__dirname, '../..')
const read = filename => fs.readFileSync(path.join(repo, filename), 'utf8')

test('SH-P013 Owner and Share mount the same permission-neutral Grid Tile body', () => {
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const start = leaf.indexOf('export function XDriveFileExplorerGridTileContent(')
  const end = leaf.indexOf('export function xDriveFileKind(', start)
  assert.ok(start > 0 && end > start)
  const component = leaf.slice(start, end)
  for (const token of ['thumbnailWidth', 'thumbnailHeight', 'borderRadius: 0', "position: 'relative'", 'data-xdrive-file-explorer-grid-name', 'minHeight: 32', '{visual}', '{overlay}', '{label}']) {
    assert.ok(component.includes(token), 'missing shared Grid geometry: ' + token)
  }
  assert.match(owner, /<XDriveFileExplorerGridTileContent[\s\S]*?thumbnailWidth=\{gridMetrics.thumbnailWidth\}[\s\S]*?thumbnailHeight=\{gridMetrics.thumbnailHeight\}[\s\S]*?visual=\{thumbnailForItem\(item\)\}/)
  assert.match(owner, /label=\{renderItemName\(item, true\)\}/)
  assert.match(owner, /nativeDragOutHandle\(item, 'grid'\)/)
  assert.match(publicView, /<XDriveFileExplorerGridTileContent[\s\S]*?thumbnailWidth=\{72\}[\s\S]*?thumbnailHeight=\{72\}/)
  assert.match(publicView, /label=\{<XDriveFileExplorerItemName name=\{entry.name\} grid \/>\}/)
  assert.match(publicView, /border: view === 'grid' \? 0 : undefined/)
  assert.match(publicView, /borderRadius: view === 'grid' \? 1 : '4px'/)
  for (const forbidden of ['XDriveApi', 'JWT', 'onDelete', 'onRename', 'onUpload', 'onDropItemsToFolder']) {
    assert.ok(!component.includes(forbidden), 'pure presentation cannot request Owner mutation: ' + forbidden)
  }
})

test('SH-P013 Share keeps bounded read-only listing and genuine native 100k opt-in gates', () => {
  const publicView = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const jpeg = read('.github/workflows/sh-p005-browser-physical-jpeg-share-100k.yml')
  const pg = read('.github/workflows/folder-share-100k-metadata.yml')
  assert.match(publicView, /const pageItems = items.slice\(0, 100\)/)
  for (const token of ['onDownloadItem', 'onOpenFolder', 'loadImagePreview', 'setContextMenu', 'onPreviousPage', 'onNextPage']) {
    assert.ok(publicView.includes(token), token)
  }
  for (const workflow of [jpeg, pg]) {
    assert.ok(workflow.includes('feat/public-share-grid-tile-parity-shp013-20261020'))
  }
})
