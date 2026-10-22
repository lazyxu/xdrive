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
  const facade = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const start = leaf.indexOf('export function XDriveFileExplorerGridTileContent(')
  const end = leaf.indexOf('export function xDriveFileKind(', start)
  assert.ok(start > 0 && end > start)
  const component = leaf.slice(start, end)
  for (const token of ['thumbnailWidth', 'thumbnailHeight', 'borderRadius: 0', "position: 'relative'",
    'data-xdrive-file-explorer-grid-name', '{visual}', '{overlay}', '{label}']) {
    assert.ok(component.includes(token), 'missing shared Grid geometry: ' + token)
  }
  assert.ok(owner.includes('<XDriveFileExplorerGridTileContent'))
  assert.ok(bridge.includes('<XDriveFileExplorer'))
  assert.ok(facade.includes('return <XDrivePublicShareUnifiedDirectoryExplorer {...props} />'))
  assert.equal(facade.includes('<XDriveFileExplorerGridTileContent'), false,
    'single-file path must not duplicate Grid item geometry')
  assert.equal(bridge.includes('<XDriveFileExplorerGridTileContent'), false,
    'Share uses the Core renderer, not a second Grid implementation')
  for (const forbidden of ['XDriveApi', 'JWT', 'onDelete', 'onRename', 'onUpload', 'onDropItemsToFolder']) {
    assert.ok(!component.includes(forbidden))
  }
})


test('SH-P013 Share keeps bounded read-only listing and genuine native 100k opt-in gates', () => {
  const bridge = read('ui/shared/src/mui/PublicShareUnifiedDirectoryExplorer.tsx')
  const jpeg = read('.github/workflows/sh-p005-browser-physical-jpeg-share-100k.yml')
  const pg = read('.github/workflows/folder-share-100k-metadata.yml')
  assert.ok(bridge.includes('const sharePageLimit = 100'))
  assert.ok(bridge.includes('items.slice(0, fileLink ? 1 : sharePageLimit)'))
  for (const token of ['onDownloadItem', 'onOpenFolder', 'loadImagePreview', 'onPreviousPage', 'onNextPage'])
    assert.ok(bridge.includes(token), token)
  for (const workflow of [jpeg, pg])
    assert.ok(workflow.includes('feat/public-share-grid-tile-parity-shp013-20261020'))
})
