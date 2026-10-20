'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('SH-P014 Owner and public read-only Explorer actually mount the same neutral Details cell', () => {
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const shared = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const start = leaf.indexOf('export function XDriveFileExplorerDetailsRowCell(')
  const end = leaf.indexOf('export function xDriveFileExplorerDetailsHeaderGeometry(', start)
  assert.ok(start > 0 && end > start, 'pure presentational Details cell is required')
  const cell = leaf.slice(start,end)
  for(const token of ['role="cell"', "columnKey === 'name' ? 'relative'", "overflow: 'hidden'", "textAlign: rightAligned ? 'right' : 'left'", '{children}'])
    assert.ok(cell.includes(token), 'missing original Details cell geometry: ' + token)
  for(const target of [owner,shared])
    assert.ok(target.includes('<XDriveFileExplorerDetailsRowCell'), 'Both Owner and Public must mount the same Details cell')
  assert.match(owner, /rightAligned=\{detailsRightAlignedColumnKeys\.has\(key\)\}/)
  for(const name of ['name','updated','type','size'])
    assert.ok(shared.includes('columnKey="' + name + '"'), 'Public row lost data column: ' + name)
  assert.match(shared, /columnKey="size" rightAligned/)
  assert.match(shared, /<XDriveFileExplorerDetailsNameCell/)
  assert.match(owner, /<XDriveFileExplorerDetailsNameCell/)
  for(const forbidden of ['XDriveApi', 'jwt', 'sessionToken', 'onMoveItemsTo', 'onDeleteItems', 'onRenameItem', 'onUpload'])
    assert.ok(!cell.includes(forbidden), 'pure cell may not acquire Owner authority: ' + forbidden)
})

test('SH-P014 Owner and Public use same pure Details header geometry, preserving interactive ownership', () => {
  const leaf = read('ui/shared/src/mui/FileExplorerItemPresentation.tsx')
  const owner = read('ui/shared/src/mui/FileExplorer.tsx')
  const share = read('ui/shared/src/mui/PublicShareReadOnlyExplorer.tsx')
  const region = leaf.slice(leaf.indexOf('export function xDriveFileExplorerDetailsHeaderGeometry('),
    leaf.indexOf('// Owner and public Share use one neutral Grid visual/title layout.'))
  for(const token of ["position: 'sticky' as const", "display: 'grid' as const", 'gridTemplateColumns,',
      'minHeight: headerHeight', "alignItems: 'center' as const", "bgcolor: 'background.default'", 'borderBottom: 1'])
    assert.ok(region.includes(token), 'pure header layout missing ' + token)
  assert.match(owner, /xDriveFileExplorerDetailsHeaderGeometry\(detailsGridTemplate, detailsHeaderHeight\)/)
  assert.match(share, /xDriveFileExplorerDetailsHeaderGeometry\('minmax\(0,1fr\) 168px minmax\(110px,160px\) 118px 106px'\)/)
  for(const name of ["onDragOver={(event) => dragOverDetailsColumn(event, key)}", "onPointerDown={(event) => startDetailsColumnResize(event, key)}"])
    assert.ok(owner.includes(name), 'Owner sortable/resizable columns must be preserved: ' + name)
  for(const term of ['onDownloadItem?.(entry)', 'onOpenFolder?.(entry)', 'setContextMenu(', 'loadImagePreview'])
    assert.ok(share.includes(term), 'Public read-only capability must remain: '+term)
  for(const mutation of ['onDeleteItems', 'onMoveItemsTo', 'onRenameItem', 'onUploadItems', 'onDropItemsToFolder'])
    assert.ok(!share.includes(mutation), 'Public read-only page must not import Owner mutation '+mutation)
})

test('SH-P014 enables exact-head real public 100k JPEG browser and metadata scope gates', () => {
  const branch = 'feat/public-share-details-presenter-shp014-20261021'
  for(const name of ['folder-share-100k-metadata.yml','sh-p005-browser-physical-jpeg-share-100k.yml']) {
    const workflow = read('.github/workflows/'+name)
    assert.ok(workflow.includes("github.head_ref == '"+branch+"'"), 'must execute real 100k at new PR HEAD')
    assert.ok(workflow.includes('github.event.pull_request.head.sha'), 'exact-source checkout required')
    assert.ok(workflow.includes('postgres:17-alpine'), 'genuine Postgres17 required')
    assert.ok(!workflow.includes('go test -race'), 'do not widen into Race optimization')
  }
})
